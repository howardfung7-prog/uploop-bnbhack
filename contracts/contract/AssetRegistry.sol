// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAssetRegistry} from "./interfaces/IAssetRegistry.sol";
import {ICertificate} from "./interfaces/ICertificate.sol";
import {IPancakeV2FactoryMinimal, IPancakeV2PairMinimal} from "./interfaces/IPancakeV2Minimal.sol";
import {IRedeemableCertificate} from "./interfaces/IRedeemableCertificate.sol";
import {Labels} from "./libraries/Labels.sol";
import {IPancakeV3FactoryMinimal} from "./libraries/V3SpotPrice.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/// @title AssetRegistry
/// @notice The manager contract. Registers certificate contracts, registers assets, assigns every asset to exactly
///         one certificate contract and holds the pricing configuration the oracle reads.
/// @dev Upgradeable through a UUPS proxy: certificate contracts and the oracle keep the proxy address forever while
///      the owner can replace the logic. State lives in an ERC-7201 namespaced struct; new fields must only be
///      appended to it. A REDEEMABLE certificate contract serves exactly one asset and must be bound to it by
///      construction; a BURN contract serves any number. Pools are resolved through the matching PancakeSwap factory
///      so a mistyped or fake pool cannot be registered. The registry can change parameters but never touches assets.
contract AssetRegistry is IAssetRegistry, Initializable, Ownable2StepUpgradeable, UUPSUpgradeable {
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @custom:storage-location erc7201:stock.certificate.AssetRegistry
    struct RegistryStorage {
        address v3Factory;
        address v2Factory;
        address usdt;
        uint8 usdtDecimals;
        mapping(address asset => AssetConfig config) configs;
        mapping(address asset => string symbol) assetSymbols;
        mapping(address certificate => CertificateInfo info) certificateInfos;
        mapping(address certificate => EnumerableSet.AddressSet assets) assetsOf;
        EnumerableSet.AddressSet assets;
        EnumerableSet.AddressSet certificates;
    }

    // ───────────────────────── Constants ─────────────────────────

    /// @notice Shortest accepted TWAP window, in seconds
    uint32 public constant MIN_TWAP_WINDOW = 60;
    /// @notice Longest accepted TWAP window, in seconds
    uint32 public constant MAX_TWAP_WINDOW = 1 days;
    /// @notice Largest accepted spot vs TWAP deviation, in basis points
    uint16 public constant MAX_DEVIATION_LIMIT = 5000;
    /// @dev keccak256(abi.encode(uint256(keccak256("stock.certificate.AssetRegistry")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant REGISTRY_STORAGE_LOCATION =
        0x6d6e493754ff0a91f2951db0723ff65fe691491ecd2f4784ff40d0daaa2ad800;

    // ───────────────────────── Constructor / initializer ─────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the proxy. Called once, through the proxy, at deployment.
    /// @param initialOwner Owner, a multisig in production
    /// @param v3Factory_ PancakeSwap V3 factory
    /// @param v2Factory_ PancakeSwap V2 factory
    /// @param usdt_ Quote token every asset is priced against
    function initialize(address initialOwner, address v3Factory_, address v2Factory_, address usdt_)
        external
        initializer
    {
        if (v3Factory_ == address(0) || v2Factory_ == address(0) || usdt_ == address(0)) revert ZeroAddress();
        __Ownable_init(initialOwner);
        __Ownable2Step_init();
        __UUPSUpgradeable_init();
        RegistryStorage storage $ = _storage();
        $.v3Factory = v3Factory_;
        $.v2Factory = v2Factory_;
        $.usdt = usdt_;
        $.usdtDecimals = IERC20Metadata(usdt_).decimals();
    }

    // ───────────────────────── Owner ─────────────────────────

    /// @inheritdoc IAssetRegistry
    function registerCertificate(address certificate, Mode mode) external onlyOwner {
        RegistryStorage storage $ = _storage();
        if (certificate == address(0)) revert ZeroAddress();
        if ($.certificates.contains(certificate)) revert CertificateAlreadyRegistered(certificate);
        // The contract must agree on its own mode; this also proves the address is a certificate contract
        if (ICertificate(certificate).mode() != mode) revert CertificateNotRegistered(certificate);
        $.certificateInfos[certificate] = CertificateInfo({registered: true, mode: mode, assetCount: 0});
        $.certificates.add(certificate);
        emit CertificateRegistered(certificate, mode);
    }

    /// @inheritdoc IAssetRegistry
    function addAsset(AssetParams calldata params) external onlyOwner {
        RegistryStorage storage $ = _storage();
        if (params.asset == address(0)) revert ZeroAddress();
        if ($.assets.contains(params.asset)) revert AssetAlreadyRegistered(params.asset);
        _validatePricingParams(params.twapWindow, params.maxDeviationBps);
        Labels.validate(params.symbol);
        Mode mode = _assignToCertificate(params.asset, params.certificate);
        (address pool, bool assetIsToken0) = _resolvePool(params.asset, params.priceSource, params.fee);
        $.configs[params.asset] = AssetConfig({
            kind: params.kind,
            mode: mode,
            certificate: params.certificate,
            priceSource: params.priceSource,
            pool: pool,
            assetIsToken0: assetIsToken0,
            assetDecimals: IERC20Metadata(params.asset).decimals(),
            twapWindow: params.twapWindow,
            maxDeviationBps: params.maxDeviationBps,
            mintPaused: false
        });
        $.assetSymbols[params.asset] = params.symbol;
        $.assets.add(params.asset);
        emit AssetAdded(params.asset, params.certificate, params.kind, mode, params.priceSource, pool, assetIsToken0);
        emit AssetSymbolSet(params.asset, params.symbol);
    }

    /// @inheritdoc IAssetRegistry
    function setAssetSymbol(address asset, string calldata symbol) external onlyOwner {
        _storedConfig(asset);
        Labels.validate(symbol);
        _storage().assetSymbols[asset] = symbol;
        emit AssetSymbolSet(asset, symbol);
    }

    /// @inheritdoc IAssetRegistry
    function setPricingParams(address asset, uint32 twapWindow, uint16 maxDeviationBps) external onlyOwner {
        AssetConfig storage cfg = _storedConfig(asset);
        _validatePricingParams(twapWindow, maxDeviationBps);
        cfg.twapWindow = twapWindow;
        cfg.maxDeviationBps = maxDeviationBps;
        emit PricingParamsSet(asset, twapWindow, maxDeviationBps);
    }

    /// @inheritdoc IAssetRegistry
    function setMintPaused(address asset, bool paused) external onlyOwner {
        _storedConfig(asset).mintPaused = paused;
        emit AssetMintPausedSet(asset, paused);
    }

    // ───────────────────────── Views ─────────────────────────

    /// @notice Logic version, bumped on every upgrade.
    function version() external pure virtual returns (string memory) {
        return "1";
    }

    /// @inheritdoc IAssetRegistry
    function v3Factory() external view returns (address) {
        return _storage().v3Factory;
    }

    /// @inheritdoc IAssetRegistry
    function v2Factory() external view returns (address) {
        return _storage().v2Factory;
    }

    /// @inheritdoc IAssetRegistry
    function usdt() external view returns (address) {
        return _storage().usdt;
    }

    /// @inheritdoc IAssetRegistry
    function usdtDecimals() external view returns (uint8) {
        return _storage().usdtDecimals;
    }

    /// @inheritdoc IAssetRegistry
    function config(address asset) external view returns (AssetConfig memory cfg) {
        return _storedConfig(asset);
    }

    /// @inheritdoc IAssetRegistry
    function certificateInfo(address certificate) external view returns (CertificateInfo memory info) {
        return _storage().certificateInfos[certificate];
    }

    /// @inheritdoc IAssetRegistry
    function assetSymbol(address asset) external view returns (string memory) {
        _storedConfig(asset);
        return _storage().assetSymbols[asset];
    }

    /// @inheritdoc IAssetRegistry
    function isSupported(address asset) public view returns (bool) {
        return _storage().assets.contains(asset);
    }

    /// @inheritdoc IAssetRegistry
    function assets() external view returns (address[] memory) {
        return _storage().assets.values();
    }

    /// @inheritdoc IAssetRegistry
    function assetsOf(address certificate) external view returns (address[] memory) {
        return _storage().assetsOf[certificate].values();
    }

    /// @inheritdoc IAssetRegistry
    function certificates() external view returns (address[] memory) {
        return _storage().certificates.values();
    }

    // ───────────────────────── Internal ─────────────────────────

    /// @dev Only the owner may upgrade the logic.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ───────────────────────── Private ─────────────────────────

    /// @dev Namespaced storage pointer.
    function _storage() private pure returns (RegistryStorage storage $) {
        assembly ("memory-safe") {
            $.slot := REGISTRY_STORAGE_LOCATION
        }
    }

    /// @dev Storage pointer to a registered asset's configuration; reverts for unknown assets.
    function _storedConfig(address asset) private view returns (AssetConfig storage cfg) {
        RegistryStorage storage $ = _storage();
        if (!$.assets.contains(asset)) revert AssetNotSupported(asset);
        return $.configs[asset];
    }

    /// @dev Checks the certificate contract can take the asset and records the assignment. Returns its mode.
    function _assignToCertificate(address asset, address certificate) private returns (Mode mode) {
        RegistryStorage storage $ = _storage();
        CertificateInfo storage info = $.certificateInfos[certificate];
        if (!info.registered) revert CertificateNotRegistered(certificate);
        if (info.mode == Mode.REDEEMABLE) {
            if (info.assetCount != 0) revert CertificateFull(certificate);
            address bound = IRedeemableCertificate(certificate).asset();
            if (bound != asset) revert CertificateAssetMismatch(certificate, bound, asset);
        }
        info.assetCount += 1;
        $.assetsOf[certificate].add(asset);
        return info.mode;
    }

    /// @dev Resolves the asset/USDT pool through the factory of the price source and reports the asset's side.
    function _resolvePool(address asset, PriceSource priceSource, uint24 fee)
        private
        view
        returns (address pool, bool assetIsToken0)
    {
        RegistryStorage storage $ = _storage();
        if (priceSource == PriceSource.V3_POOL) {
            pool = IPancakeV3FactoryMinimal($.v3Factory).getPool(asset, $.usdt, fee);
        } else {
            pool = IPancakeV2FactoryMinimal($.v2Factory).getPair(asset, $.usdt);
        }
        if (pool == address(0)) revert PoolNotFound(asset);
        // V3 pools and V2 pairs expose the same token0 / token1 getters
        address token0 = IPancakeV2PairMinimal(pool).token0();
        address token1 = IPancakeV2PairMinimal(pool).token1();
        if (token0 == asset && token1 == $.usdt) return (pool, true);
        if (token0 == $.usdt && token1 == asset) return (pool, false);
        revert PoolTokensMismatch(pool, asset);
    }

    /// @dev Shared bounds check for addAsset and setPricingParams. The guard only applies to V3 pools; the values
    ///      are still bounded for V2 pairs so a later move to a V3 pool starts from sane parameters.
    function _validatePricingParams(uint32 twapWindow, uint16 maxDeviationBps) private pure {
        bool windowOk = twapWindow >= MIN_TWAP_WINDOW && twapWindow <= MAX_TWAP_WINDOW;
        bool deviationOk = maxDeviationBps > 0 && maxDeviationBps <= MAX_DEVIATION_LIMIT;
        if (!windowOk || !deviationOk) revert InvalidPricingParams(twapWindow, maxDeviationBps);
    }
}

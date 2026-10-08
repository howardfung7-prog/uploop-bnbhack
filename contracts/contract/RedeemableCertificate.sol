// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CertificateBase} from "./CertificateBase.sol";
import {IAssetRegistry} from "./interfaces/IAssetRegistry.sol";
import {ICertificate} from "./interfaces/ICertificate.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {IRedeemableCertificate} from "./interfaces/IRedeemableCertificate.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title RedeemableCertificate
/// @notice Warehouse receipts over one asset. Each certificate locks the asset quantity that was worth `faceValue`
///         USDT at mint time; redeeming returns exactly that quantity. One instance is deployed per asset and the
///         registry assigns the asset to it.
/// @dev Redemption never reads a price and cannot be paused. Fee-on-transfer tokens are rejected because the vault
///      must always hold every batch's full quantity.
contract RedeemableCertificate is CertificateBase, IRedeemableCertificate {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    address private immutable _ASSET;

    // ───────────────────────── Constructor ─────────────────────────

    /// @param initialOwner Owner, a multisig in production
    /// @param registry_ Manager contract
    /// @param oracle_ Price oracle
    /// @param asset_ The one asset this instance serves
    /// @param name_ Name, fixed for the lifetime of the contract, for example "Apple Stock Certificate"
    /// @param symbol_ Symbol, fixed for the lifetime of the contract
    constructor(
        address initialOwner,
        IAssetRegistry registry_,
        IPriceOracle oracle_,
        address asset_,
        string memory name_,
        string memory symbol_
    ) CertificateBase(initialOwner, registry_, oracle_, name_, symbol_) {
        if (asset_ == address(0)) revert ZeroAddress();
        _ASSET = asset_;
    }

    // ───────────────────────── Mint ─────────────────────────

    /// @inheritdoc IRedeemableCertificate
    function mint(uint256 n, address to) external nonReentrant returns (uint256 id, uint256 assetIn) {
        id = _createBatch(_ASSET, _assignedConfig(_ASSET));
        assetIn = _quote(id, n);
        _lock(assetIn);
        _issue(id, to, n, assetIn);
    }

    /// @inheritdoc IRedeemableCertificate
    function mintToMany(address[] calldata tos, uint256[] calldata ns)
        external
        nonReentrant
        returns (uint256 id, uint256 assetIn)
    {
        uint256 length = _pairedLength(tos.length, ns.length);
        id = _createBatch(_ASSET, _assignedConfig(_ASSET));
        assetIn = _quote(id, _total(ns));
        _lock(assetIn);
        for (uint256 i = 0; i < length; ++i) {
            _issue(id, tos[i], ns[i], _quote(id, ns[i]));
        }
    }

    // ───────────────────────── Redeem ─────────────────────────

    /// @inheritdoc IRedeemableCertificate
    function redeem(uint256 id, uint256 n, address to) external nonReentrant returns (uint256 assetOut) {
        return _redeemOne(id, n, to);
    }

    /// @inheritdoc IRedeemableCertificate
    function redeemBatch(uint256[] calldata ids, uint256[] calldata ns, address to)
        external
        nonReentrant
        returns (uint256[] memory assetOuts)
    {
        uint256 length = _pairedLength(ids.length, ns.length);
        assetOuts = new uint256[](length);
        for (uint256 i = 0; i < length; ++i) {
            assetOuts[i] = _redeemOne(ids[i], ns[i], to);
        }
    }

    /// @inheritdoc IRedeemableCertificate
    function roll(uint256 idOld, uint256 n) external nonReentrant returns (uint256 idNew, uint256 m, uint256 refund) {
        uint256 released = _release(idOld, n);
        idNew = _createBatch(_ASSET, _assignedConfig(_ASSET));
        uint256 assetPerCert = _batches[idNew].assetPerCert;
        m = released / assetPerCert;
        if (m == 0) revert RollYieldsNothing(idOld, n);
        uint256 locked = m * assetPerCert;
        refund = released - locked;
        if (refund > 0) _unlock(refund, msg.sender);
        _issue(idNew, msg.sender, m, locked);
        emit Rolled(msg.sender, idOld, idNew, n, m, refund);
    }

    // ───────────────────────── Views ─────────────────────────

    /// @inheritdoc ICertificate
    function mode() public pure override returns (IAssetRegistry.Mode) {
        return IAssetRegistry.Mode.REDEEMABLE;
    }

    /// @inheritdoc IRedeemableCertificate
    function asset() external view returns (address) {
        return _ASSET;
    }

    /// @inheritdoc IRedeemableCertificate
    function certValue1e18(uint256 id, uint256 n) public view returns (uint256 value) {
        Batch storage batch_ = _existingBatch(id);
        return n * batch_.assetPerCert * _ORACLE.twapPrice1e18(_ASSET) / 10 ** batch_.assetDecimals;
    }

    /// @inheritdoc IRedeemableCertificate
    function certValues1e18(uint256[] calldata ids, uint256[] calldata ns)
        external
        view
        returns (uint256[] memory values)
    {
        uint256 length = _pairedLength(ids.length, ns.length);
        values = new uint256[](length);
        for (uint256 i = 0; i < length; ++i) {
            values[i] = certValue1e18(ids[i], ns[i]);
        }
    }

    // ───────────────────────── Internal steps ─────────────────────────

    /// @dev Full redeem path for one batch: burn, then release the asset.
    function _redeemOne(uint256 id, uint256 n, address to) internal returns (uint256 assetOut) {
        assetOut = _release(id, n);
        _unlock(assetOut, to);
    }

    /// @dev Pulls `amount` of the asset into the vault; rejects short deliveries.
    function _lock(uint256 amount) internal {
        uint256 received = _pullAsset(_ASSET, amount);
        if (received < amount) revert InsufficientReceived(amount, received);
    }

    /// @dev Pays `amount` of the asset out of the vault.
    function _unlock(uint256 amount, address to) internal {
        IERC20(_ASSET).safeTransfer(to, amount);
    }

    /// @dev Burns `n` certificates of a batch held by the caller and returns the asset they stand for.
    function _release(uint256 id, uint256 n) internal returns (uint256 amount) {
        Batch storage batch_ = _existingBatch(id);
        if (n == 0) revert ZeroAmount();
        _burn(msg.sender, id, n);
        amount = n * batch_.assetPerCert;
        emit Redeemed(msg.sender, id, n, amount);
    }

    /// @inheritdoc CertificateBase
    function _describe(Batch storage batch_, string memory assetSymbol) internal view override returns (string memory) {
        return string.concat(
            "Warehouse receipt. Each certificate redeems ",
            batch_.assetPerCert.toString(),
            " raw units of ",
            assetSymbol,
            ", locked at a spot price of ",
            batch_.mintPrice1e18.toString(),
            " (USDT per whole token, 1e18 fixed point)."
        );
    }
}

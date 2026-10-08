// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IAssetRegistry
/// @notice The manager contract: which assets can be exchanged for certificates, which certificate contract serves
///         each asset, and how each asset is priced.
interface IAssetRegistry {
    /// @notice Product grouping of an asset.
    enum Kind {
        STOCK,
        TOKEN,
        MEME
    }

    /// @notice Behaviour of the certificate contract serving an asset: lock and redeem, or burn.
    enum Mode {
        REDEEMABLE,
        BURN
    }

    /// @notice Where the asset's price comes from.
    enum PriceSource {
        V3_POOL,
        V2_PAIR
    }

    /// @notice A registered certificate contract.
    /// @dev registered: set once; mode: how the contract handles assets; assetCount: assets assigned to it, at most
    ///      one for REDEEMABLE contracts. The contract's own name and symbol are fixed in its constructor.
    struct CertificateInfo {
        bool registered;
        Mode mode;
        uint16 assetCount;
    }

    /// @notice Inputs of addAsset.
    /// @dev asset: asset token. kind: product grouping. certificate: registered certificate contract that will serve
    ///      the asset. priceSource: V3 pool or V2 pair. fee: V3 fee tier, ignored for V2. twapWindow: TWAP window in
    ///      seconds, V3 only. maxDeviationBps: maximum spot vs TWAP deviation in basis points, V3 only; V2 pairs are
    ///      priced at their current reserves. symbol: display symbol of the asset used in certificate metadata,
    ///      decided by the owner instead of trusting the token's own symbol().
    struct AssetParams {
        address asset;
        Kind kind;
        address certificate;
        PriceSource priceSource;
        uint24 fee;
        uint32 twapWindow;
        uint16 maxDeviationBps;
        string symbol;
    }

    /// @notice Per-asset configuration, resolved once at registration.
    /// @dev kind: product grouping. mode: copied from the certificate contract. certificate: the only contract allowed
    ///      to mint against the asset. priceSource and pool: PancakeSwap V3 pool or V2 pair against USDT, validated
    ///      through the matching factory. assetIsToken0 and assetDecimals: cached. twapWindow and maxDeviationBps:
    ///      guard between spot and TWAP for V3 pools, the deviation is measured in basis points of price; unused for
    ///      V2 pairs. mintPaused: pauses minting for this asset only.
    struct AssetConfig {
        Kind kind;
        Mode mode;
        address certificate;
        PriceSource priceSource;
        address pool;
        bool assetIsToken0;
        uint8 assetDecimals;
        uint32 twapWindow;
        uint16 maxDeviationBps;
        bool mintPaused;
    }

    /// @notice A certificate contract was registered.
    event CertificateRegistered(address indexed certificate, Mode mode);
    /// @notice The display symbol of an asset was updated.
    event AssetSymbolSet(address indexed asset, string symbol);
    /// @notice An asset was registered and assigned to a certificate contract.
    event AssetAdded(
        address indexed asset,
        address indexed certificate,
        Kind kind,
        Mode mode,
        PriceSource priceSource,
        address pool,
        bool assetIsToken0
    );
    /// @notice Pricing guard parameters of an asset were updated.
    event PricingParamsSet(address indexed asset, uint32 twapWindow, uint16 maxDeviationBps);
    /// @notice Minting against an asset was paused or resumed.
    event AssetMintPausedSet(address indexed asset, bool paused);

    /// @notice A zero address was supplied where a real one is required.
    error ZeroAddress();
    /// @notice The certificate contract is already registered.
    error CertificateAlreadyRegistered(address certificate);
    /// @notice The certificate contract is not registered.
    error CertificateNotRegistered(address certificate);
    /// @notice A REDEEMABLE certificate contract already serves its one asset.
    error CertificateFull(address certificate);
    /// @notice The REDEEMABLE certificate contract is bound to a different asset.
    error CertificateAssetMismatch(address certificate, address expected, address actual);
    /// @notice The asset is already registered.
    error AssetAlreadyRegistered(address asset);
    /// @notice The asset is not registered.
    error AssetNotSupported(address asset);
    /// @notice No pool or pair pairs the asset with USDT under the given source and fee.
    error PoolNotFound(address asset);
    /// @notice The pool returned by the factory does not pair the asset with USDT.
    error PoolTokensMismatch(address pool, address asset);
    /// @notice The pricing guard parameters are outside the accepted bounds.
    error InvalidPricingParams(uint32 twapWindow, uint16 maxDeviationBps);

    /// @notice Registers a certificate contract so assets can be assigned to it.
    /// @param certificate Certificate contract
    /// @param mode Its behaviour; must match the contract's own mode()
    function registerCertificate(address certificate, Mode mode) external;

    /// @notice Registers an asset, resolves its pool through the matching factory and assigns it to a certificate.
    /// @param params See AssetParams
    function addAsset(AssetParams calldata params) external;

    /// @notice Updates the display symbol of a registered asset.
    function setAssetSymbol(address asset, string calldata symbol) external;

    /// @notice Updates the pricing guard parameters of an asset.
    function setPricingParams(address asset, uint32 twapWindow, uint16 maxDeviationBps) external;

    /// @notice Pauses or resumes minting against one asset. Redemption is never affected.
    function setMintPaused(address asset, bool paused) external;

    /// @notice PancakeSwap V3 factory.
    function v3Factory() external view returns (address);

    /// @notice PancakeSwap V2 factory.
    function v2Factory() external view returns (address);

    /// @notice Quote token every asset is priced against.
    function usdt() external view returns (address);

    /// @notice Decimals of the quote token, cached.
    function usdtDecimals() external view returns (uint8);

    /// @notice Configuration of a registered asset; reverts with AssetNotSupported for unknown assets.
    function config(address asset) external view returns (AssetConfig memory cfg);

    /// @notice Registration record of a certificate contract.
    function certificateInfo(address certificate) external view returns (CertificateInfo memory info);

    /// @notice Display symbol of a registered asset; reverts with AssetNotSupported for unknown assets.
    function assetSymbol(address asset) external view returns (string memory);

    /// @notice Whether an asset is registered.
    function isSupported(address asset) external view returns (bool);

    /// @notice All registered assets.
    function assets() external view returns (address[] memory);

    /// @notice Assets assigned to a certificate contract.
    function assetsOf(address certificate) external view returns (address[] memory);

    /// @notice All registered certificate contracts.
    function certificates() external view returns (address[] memory);
}

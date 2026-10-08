// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CertificateBase} from "./CertificateBase.sol";
import {IAssetRegistry} from "./interfaces/IAssetRegistry.sol";
import {IBurnCertificate} from "./interfaces/IBurnCertificate.sol";
import {ICertificate} from "./interfaces/ICertificate.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title BurnCertificate
/// @notice Proofs of burn for burn-type assets, shared by every such asset. Minting pulls the asset and sends it to
///         the dead address, where nobody can ever move it; the certificates cannot be redeemed.
/// @dev Fee-on-transfer tokens are accepted: the caller pays the requested amount, whatever the contract holds is
///      sent to the dead address, and the Burned event records what the dead address actually gained. That gain is
///      what proves the burn, so a token that keeps or reroutes the transfer cannot mint against it, while tokens
///      that reward holders on every transfer (reflection tokens) keep working even after someone parks dust here:
///      the contract's own balance is never compared, and the dust is burned along the way.
contract BurnCertificate is CertificateBase, IBurnCertificate {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    // ───────────────────────── Constants ─────────────────────────

    /// @notice Where burned assets go; nothing can ever move them out of it
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ───────────────────────── Constructor ─────────────────────────

    /// @param initialOwner Owner, a multisig in production
    /// @param registry_ Manager contract
    /// @param oracle_ Price oracle
    /// @param name_ Name, fixed for the lifetime of the contract, for example "Burn Certificate"
    /// @param symbol_ Symbol, fixed for the lifetime of the contract
    constructor(
        address initialOwner,
        IAssetRegistry registry_,
        IPriceOracle oracle_,
        string memory name_,
        string memory symbol_
    ) CertificateBase(initialOwner, registry_, oracle_, name_, symbol_) {}

    // ───────────────────────── Mint ─────────────────────────

    /// @inheritdoc IBurnCertificate
    function mint(address asset, uint256 n, address to, uint256 maxAssetIn)
        external
        nonReentrant
        returns (uint256 id, uint256 assetIn, uint256 burned)
    {
        return _mintOne(asset, n, to, maxAssetIn);
    }

    /// @inheritdoc IBurnCertificate
    function mintBatch(address[] calldata assets, uint256[] calldata ns, address to, uint256[] calldata maxAssetIns)
        external
        nonReentrant
        returns (uint256[] memory ids, uint256[] memory assetIns)
    {
        uint256 length = _pairedLength(assets.length, ns.length);
        if (maxAssetIns.length != length) revert LengthMismatch();
        ids = new uint256[](length);
        assetIns = new uint256[](length);
        for (uint256 i = 0; i < length; ++i) {
            (ids[i], assetIns[i],) = _mintOne(assets[i], ns[i], to, maxAssetIns[i]);
        }
    }

    /// @inheritdoc IBurnCertificate
    function mintToMany(address asset, address[] calldata tos, uint256[] calldata ns, uint256 maxAssetIn)
        external
        nonReentrant
        returns (uint256 id, uint256 assetIn, uint256 burned)
    {
        uint256 length = _pairedLength(tos.length, ns.length);
        id = _createBatch(asset, _assignedConfig(asset));
        assetIn = _quote(id, _total(ns));
        _checkLimit(asset, assetIn, maxAssetIn);
        burned = _burnIn(asset, assetIn);
        for (uint256 i = 0; i < length; ++i) {
            _issue(id, tos[i], ns[i], _quote(id, ns[i]));
        }
    }

    // ───────────────────────── Views ─────────────────────────

    /// @inheritdoc ICertificate
    function mode() public pure override returns (IAssetRegistry.Mode) {
        return IAssetRegistry.Mode.BURN;
    }

    // ───────────────────────── Internal steps ─────────────────────────

    /// @dev Full mint path for one asset: open a batch, quote, check the caller's limit, pull and burn, issue.
    function _mintOne(address asset, uint256 n, address to, uint256 maxAssetIn)
        internal
        returns (uint256 id, uint256 assetIn, uint256 burned)
    {
        id = _createBatch(asset, _assignedConfig(asset));
        assetIn = _quote(id, n);
        _checkLimit(asset, assetIn, maxAssetIn);
        burned = _burnIn(asset, assetIn);
        _issue(id, to, n, assetIn);
    }

    /// @dev The price can move within the deviation guard between signing and execution; the caller's limit stops
    ///      a move, natural or a sandwich, from burning more than they agreed to.
    function _checkLimit(address asset, uint256 assetIn, uint256 maxAssetIn) internal pure {
        if (assetIn > maxAssetIn) revert AssetInAboveLimit(asset, assetIn, maxAssetIn);
    }

    /// @dev Pulls the asset and sends everything the contract holds of it to the dead address. The dead address
    ///      must end up holding strictly more; that gain is the burned quantity.
    function _burnIn(address asset, uint256 amount) internal returns (uint256 burned) {
        _pullAsset(asset, amount);
        IERC20 token = IERC20(asset);
        uint256 deadBefore = token.balanceOf(DEAD);
        token.safeTransfer(DEAD, token.balanceOf(address(this)));
        uint256 deadAfter = token.balanceOf(DEAD);
        if (deadAfter <= deadBefore) revert BurnIncomplete(asset);
        burned = deadAfter - deadBefore;
        emit Burned(asset, msg.sender, amount, burned);
    }

    /// @inheritdoc CertificateBase
    function _describe(Batch storage batch_, string memory assetSymbol) internal view override returns (string memory) {
        return string.concat(
            "Proof of burn. Each certificate stands for ",
            batch_.assetPerCert.toString(),
            " raw units of ",
            assetSymbol,
            " burned at a spot price of ",
            batch_.mintPrice1e18.toString(),
            " (USDT per whole token, 1e18 fixed point). Not redeemable."
        );
    }
}

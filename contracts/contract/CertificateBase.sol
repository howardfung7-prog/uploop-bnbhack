// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAssetRegistry} from "./interfaces/IAssetRegistry.sol";
import {ICertificate} from "./interfaces/ICertificate.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {Labels} from "./libraries/Labels.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title CertificateBase
/// @notice Everything the certificate contracts share: batch records priced at `faceValue` USDT per certificate
///         through the oracle, issuance, metadata and the batch transfer helper. Minting charges no fee.
/// @dev Every mint opens a new batch, and the batch is the ERC-1155 id. Batch data never changes after creation.
///      Concrete contracts decide what happens to the asset (RedeemableCertificate locks it, BurnCertificate burns
///      it) and implement mode(). The ERC-1155 receiver hook fired by _mint is the last external call of every path.
abstract contract CertificateBase is ICertificate, ERC1155Supply, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Strings for uint256;
    using Strings for address;

    // ───────────────────────── Constants / immutables ─────────────────────────

    IAssetRegistry internal immutable _REGISTRY;
    IPriceOracle internal immutable _ORACLE;
    uint256 internal immutable _FACE_VALUE;

    // ───────────────────────── State ─────────────────────────

    /// @inheritdoc ICertificate
    string public name;
    /// @inheritdoc ICertificate
    string public symbol;
    /// @inheritdoc ICertificate
    uint256 public batchCount;
    /// @inheritdoc ICertificate
    bool public mintPaused;
    mapping(uint256 id => Batch batch) internal _batches;

    // ───────────────────────── Constructor ─────────────────────────

    /// @param initialOwner Owner, a multisig in production
    /// @param registry_ Manager contract
    /// @param oracle_ Price oracle
    /// @param name_ Name of this instance, fixed for its lifetime
    /// @param symbol_ Symbol of this instance, fixed for its lifetime
    constructor(
        address initialOwner,
        IAssetRegistry registry_,
        IPriceOracle oracle_,
        string memory name_,
        string memory symbol_
    ) ERC1155("") Ownable(initialOwner) {
        if (address(registry_) == address(0) || address(oracle_) == address(0)) {
            revert ZeroAddress();
        }
        Labels.validate(name_);
        Labels.validate(symbol_);
        _REGISTRY = registry_;
        _ORACLE = oracle_;
        _FACE_VALUE = 10 * 10 ** registry_.usdtDecimals();
        name = name_;
        symbol = symbol_;
    }

    // ───────────────────────── Transfer ─────────────────────────

    /// @inheritdoc ICertificate
    function transferToMany(uint256 id, address[] calldata tos, uint256[] calldata ns) external nonReentrant {
        uint256 length = _pairedLength(tos.length, ns.length);
        for (uint256 i = 0; i < length; ++i) {
            _safeTransferFrom(msg.sender, tos[i], id, ns[i], "");
        }
    }

    // ───────────────────────── Owner ─────────────────────────

    /// @inheritdoc ICertificate
    function setMintPaused(bool paused) external onlyOwner {
        mintPaused = paused;
        emit MintPausedSet(paused);
    }

    // ───────────────────────── Views ─────────────────────────

    /// @inheritdoc ICertificate
    function registry() external view returns (IAssetRegistry) {
        return _REGISTRY;
    }

    /// @inheritdoc ICertificate
    function oracle() external view returns (IPriceOracle) {
        return _ORACLE;
    }

    /// @inheritdoc ICertificate
    function faceValue() external view returns (uint256) {
        return _FACE_VALUE;
    }

    /// @inheritdoc ICertificate
    function batch(uint256 id) external view returns (Batch memory batch_) {
        return _existingBatch(id);
    }

    /// @notice On-chain metadata for a batch as a base64 data URI.
    /// @param id Batch id
    /// @return uri_ JSON metadata with the asset, the quantity per certificate, the mint price and the mint time
    function uri(uint256 id) public view override returns (string memory uri_) {
        Batch storage batch_ = _existingBatch(id);
        // Both strings were validated (constructor and registry), so they are safe inside JSON
        string memory assetSymbol = _REGISTRY.assetSymbol(batch_.asset);
        string memory head = string.concat(
            '{"name":"', name, " #", id.toString(), '","description":"', _describe(batch_, assetSymbol), '",'
        );
        string memory attributes = string.concat(
            '"attributes":[{"trait_type":"asset","value":"',
            batch_.asset.toHexString(),
            '"},{"trait_type":"asset_per_certificate","value":"',
            batch_.assetPerCert.toString(),
            '"},{"trait_type":"mint_price_1e18","value":"',
            batch_.mintPrice1e18.toString(),
            '"},{"trait_type":"minted_at","value":"',
            uint256(batch_.mintedAt).toString(),
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(string.concat(head, attributes))));
    }

    // ───────────────────────── Internal steps ─────────────────────────

    /// @dev Loads the asset's configuration and checks this contract may mint against it right now.
    function _assignedConfig(address asset) internal view returns (IAssetRegistry.AssetConfig memory cfg) {
        if (mintPaused) revert MintPaused();
        cfg = _REGISTRY.config(asset);
        if (cfg.certificate != address(this)) revert AssetNotAssigned(asset, address(this));
        if (cfg.mintPaused) revert AssetMintPaused(asset);
    }

    /// @dev Opens a batch priced at the current guarded spot price and records it; callers quote and issue against
    ///      it, and _quote rejects zero counts.
    function _createBatch(address asset, IAssetRegistry.AssetConfig memory cfg) internal returns (uint256 id) {
        (uint256 assetAmount, uint256 price) = _ORACLE.quoteForFaceValue(asset, _FACE_VALUE);
        // Round up by one wei so a redeemable vault never runs short
        uint256 assetPerCert = assetAmount + 1;
        id = ++batchCount;
        _batches[id] = Batch({
            asset: asset,
            // block.timestamp fits in 64 bits for the foreseeable future.
            // forge-lint: disable-next-line(unsafe-typecast)
            mintedAt: uint64(block.timestamp),
            assetDecimals: cfg.assetDecimals,
            assetPerCert: assetPerCert,
            mintPrice1e18: price
        });
        emit BatchCreated(id, asset, assetPerCert, price);
    }

    /// @dev Raw asset units behind `n` certificates of a batch.
    function _quote(uint256 id, uint256 n) internal view returns (uint256 amount) {
        if (n == 0) revert ZeroAmount();
        return n * _batches[id].assetPerCert;
    }

    /// @dev Sum of a list of certificate counts, each of which must be positive.
    function _total(uint256[] calldata ns) internal pure returns (uint256 total) {
        for (uint256 i = 0; i < ns.length; ++i) {
            if (ns[i] == 0) revert ZeroAmount();
            total += ns[i];
        }
    }

    /// @dev Pulls `amount` of the asset from the caller and reports how much actually arrived.
    function _pullAsset(address asset, uint256 amount) internal returns (uint256 received) {
        uint256 before = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        received = IERC20(asset).balanceOf(address(this)) - before;
    }

    /// @dev Issues `n` certificates of a batch. The ERC-1155 receiver hook is the last external call of every path.
    function _issue(uint256 id, address to, uint256 n, uint256 amount) internal {
        emit Minted(to, _batches[id].asset, id, n, amount);
        _mint(to, id, n, "");
    }

    /// @dev Storage pointer to an existing batch; reverts for unknown ids.
    function _existingBatch(uint256 id) internal view returns (Batch storage batch_) {
        batch_ = _batches[id];
        if (batch_.asset == address(0)) revert UnknownBatch(id);
    }

    /// @dev Validates paired array lengths for the batch entry points.
    function _pairedLength(uint256 a, uint256 b) internal pure returns (uint256 length) {
        if (a == 0) revert EmptyArray();
        if (a != b) revert LengthMismatch();
        return a;
    }

    /// @dev Metadata description; overridden to say "locks" or "burned".
    function _describe(Batch storage batch_, string memory assetSymbol) internal view virtual returns (string memory);
}

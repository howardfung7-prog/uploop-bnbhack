// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAssetRegistry} from "./IAssetRegistry.sol";
import {IPriceOracle} from "./IPriceOracle.sol";

/// @title ICertificate
/// @notice Surface shared by every certificate contract: ERC-1155 receipts where each mint opens a batch priced at
///         `faceValue` USDT per certificate. Implementations also expose the full IERC1155 surface.
interface ICertificate {
    /// @notice Immutable record of one batch; every ERC-1155 id is one batch.
    /// @dev asset: token the batch was minted against. mintedAt: block timestamp of the mint. assetDecimals: cached
    ///      decimals of the asset. assetPerCert: raw asset units each certificate stands for, the quantity locked for
    ///      redeemable certificates or burned for burn certificates. mintPrice1e18: spot price the batch was priced
    ///      at, USDT per whole asset, 1e18 fixed point.
    struct Batch {
        address asset;
        uint64 mintedAt;
        uint8 assetDecimals;
        uint256 assetPerCert;
        uint256 mintPrice1e18;
    }

    /// @notice A new batch was opened.
    event BatchCreated(uint256 indexed id, address indexed asset, uint256 assetPerCert, uint256 mintPrice1e18);
    /// @notice Certificates were issued.
    event Minted(address indexed to, address indexed asset, uint256 indexed id, uint256 n, uint256 assetIn);
    /// @notice Minting was paused or resumed for the whole contract.
    event MintPausedSet(bool paused);

    /// @notice A zero address was supplied where a real one is required.
    error ZeroAddress();
    /// @notice An amount of zero certificates was requested.
    error ZeroAmount();
    /// @notice Paired arrays differ in length.
    error LengthMismatch();
    /// @notice An empty array was supplied to a batch function.
    error EmptyArray();
    /// @notice Minting is paused for the whole contract.
    error MintPaused();
    /// @notice Minting against this asset is paused in the registry.
    error AssetMintPaused(address asset);
    /// @notice The registry does not assign this asset to this certificate contract.
    error AssetNotAssigned(address asset, address certificate);
    /// @notice No batch exists with this id.
    error UnknownBatch(uint256 id);

    /// @notice Transfers certificates of one batch from the caller to several recipients.
    function transferToMany(uint256 id, address[] calldata tos, uint256[] calldata ns) external;

    /// @notice Pauses or resumes minting for the whole contract. Redemption is never affected.
    function setMintPaused(bool paused) external;

    /// @notice Human readable name of this certificate contract.
    function name() external view returns (string memory);

    /// @notice Short symbol of this certificate contract.
    function symbol() external view returns (string memory);

    /// @notice Registry of supported assets.
    function registry() external view returns (IAssetRegistry);

    /// @notice Price oracle used for minting and valuation.
    function oracle() external view returns (IPriceOracle);

    /// @notice USDT value each certificate is priced at when minted, raw USDT units.
    function faceValue() external view returns (uint256);

    /// @notice Whether this contract locks or burns the assets it receives.
    function mode() external view returns (IAssetRegistry.Mode);

    /// @notice Number of batches opened so far; ids run from 1 to this value.
    function batchCount() external view returns (uint256);

    /// @notice Whether minting is paused for the whole contract.
    function mintPaused() external view returns (bool);

    /// @notice Immutable record of a batch; reverts with UnknownBatch for unknown ids.
    function batch(uint256 id) external view returns (Batch memory batch_);
}

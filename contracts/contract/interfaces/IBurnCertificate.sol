// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICertificate} from "./ICertificate.sol";

/// @title IBurnCertificate
/// @notice Shared certificate contract for burn-type assets. Minting sends the asset to the dead address; the
///         certificates are proofs of burn and cannot be redeemed.
interface IBurnCertificate is ICertificate {
    /// @notice Asset was sent to the dead address for a mint. `burned` is what the dead address gained: below
    ///         `requested` for fee-on-transfer tokens, above it when tokens parked in the contract were swept along.
    event Burned(address indexed asset, address indexed payer, uint256 requested, uint256 burned);

    /// @notice The dead address did not gain anything from the transfer.
    error BurnIncomplete(address asset);
    /// @notice The quote taken at execution asks for more asset than the caller allowed.
    error AssetInAboveLimit(address asset, uint256 assetIn, uint256 maxAssetIn);

    /// @notice Sends asset worth `faceValue` per certificate at the guarded spot price to the dead address and issues
    ///         `n` certificates.
    /// @dev The quote is taken at execution time and can differ from what the caller saw; `maxAssetIn` bounds what
    ///      the caller pays for the certificates.
    /// @param asset Asset token, must be assigned to this contract in the registry
    /// @param n Number of certificates
    /// @param to Recipient
    /// @param maxAssetIn Most raw asset units the caller accepts to pay
    /// @return id Batch id opened by this call
    /// @return assetIn Raw asset units requested from the caller
    /// @return burned Raw asset units the dead address gained
    function mint(address asset, uint256 n, address to, uint256 maxAssetIn)
        external
        returns (uint256 id, uint256 assetIn, uint256 burned);

    /// @notice Mints against several assets in one call; every asset opens its own batch and has its own limit.
    function mintBatch(address[] calldata assets, uint256[] calldata ns, address to, uint256[] calldata maxAssetIns)
        external
        returns (uint256[] memory ids, uint256[] memory assetIns);

    /// @notice Mints one batch of an asset and distributes it to several recipients; the caller pays all the asset,
    ///         at most `maxAssetIn`.
    function mintToMany(address asset, address[] calldata tos, uint256[] calldata ns, uint256 maxAssetIn)
        external
        returns (uint256 id, uint256 assetIn, uint256 burned);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAssetRegistry} from "./IAssetRegistry.sol";

/// @title ICertificatePledge
/// @notice Custody for certificates: users pledge certificates of whitelisted certificate contracts and redeem the
///         same certificates later. The contract keeps a ledger per user, certificate contract and batch; the
///         events are the record an indexer builds user positions from. Pledging yields nothing else.
interface ICertificatePledge {
    /// @notice One entry of pledge or redeem: `amount` certificates of batch `id` of `certificate`.
    struct Entry {
        address certificate;
        uint256 id;
        uint256 amount;
    }

    /// @notice A user pledged certificates.
    event Pledged(address indexed user, address indexed certificate, uint256 indexed id, uint256 amount);
    /// @notice A user took pledged certificates back.
    event Redeemed(address indexed user, address indexed certificate, uint256 indexed id, uint256 amount);
    /// @notice A certificate contract was allowed or disallowed for new pledges.
    event WhitelistSet(address indexed certificate, bool allowed);
    /// @notice Pledging was paused or resumed.
    event PausedSet(bool paused);

    /// @notice A zero address was supplied where a real one is required.
    error ZeroAddress();
    /// @notice An amount of zero certificates was supplied.
    error ZeroAmount();
    /// @notice An empty array was supplied to a batch function.
    error EmptyArray();
    /// @notice Pledging is paused.
    error PledgePaused();
    /// @notice The address is not a certificate contract registered in the asset registry.
    error CertificateNotRegistered(address certificate);
    /// @notice The certificate contract is not on the whitelist.
    error CertificateNotWhitelisted(address certificate);
    /// @notice The caller has fewer certificates of this batch pledged than requested.
    error InsufficientPledged(address certificate, uint256 id, uint256 pledged);
    /// @notice Certificates may only enter the contract through pledge().
    error DirectTransferNotAllowed();

    /// @notice Pledges certificates for the caller, one entry per certificate contract and batch. The caller must
    ///         have approved this contract on each certificate contract.
    /// @param items See Entry
    function pledge(Entry[] calldata items) external;

    /// @notice Returns pledged certificates to the caller. Never blocked by the whitelist or the pause.
    /// @param items See Entry
    function redeem(Entry[] calldata items) external;

    /// @notice Allows or disallows a certificate contract for new pledges. Allowing requires the contract to be
    ///         registered in the asset registry; disallowing never affects redemption.
    /// @param certificate Certificate contract
    /// @param allowed Whether new pledges may use it
    function setWhitelisted(address certificate, bool allowed) external;

    /// @notice Pauses or resumes pledging. Redemption is never paused.
    function setPaused(bool paused_) external;

    /// @notice Registry the whitelist is checked against.
    function registry() external view returns (IAssetRegistry);

    /// @notice Whether pledging is paused.
    function paused() external view returns (bool);

    /// @notice Whether a certificate contract is allowed for new pledges.
    function isWhitelisted(address certificate) external view returns (bool);

    /// @notice Certificates of a batch a user has pledged.
    function pledgedOf(address user, address certificate, uint256 id) external view returns (uint256);

    /// @notice Certificates of a batch pledged by everyone, which is exactly what the contract holds of it.
    function totalPledged(address certificate, uint256 id) external view returns (uint256);
}

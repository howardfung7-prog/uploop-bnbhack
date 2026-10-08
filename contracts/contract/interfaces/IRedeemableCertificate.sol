// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICertificate} from "./ICertificate.sol";

/// @title IRedeemableCertificate
/// @notice Certificate contract bound to exactly one asset. Minting locks the asset, redeeming returns the exact
///         locked quantity. One instance is deployed per asset.
interface IRedeemableCertificate is ICertificate {
    /// @notice Certificates were burned and their asset released.
    event Redeemed(address indexed from, uint256 indexed id, uint256 n, uint256 assetOut);
    /// @notice Certificates of an old batch were rolled into a new batch at the current price.
    event Rolled(
        address indexed user, uint256 indexed idOld, uint256 indexed idNew, uint256 n, uint256 m, uint256 refund
    );

    /// @notice The vault received less than the requested amount, for example from a fee-on-transfer token.
    error InsufficientReceived(uint256 expected, uint256 received);
    /// @notice The asset released by the old batch is worth less than one certificate at the current price.
    error RollYieldsNothing(uint256 id, uint256 n);

    /// @notice The asset this contract is bound to.
    function asset() external view returns (address);

    /// @notice Locks asset worth `faceValue` per certificate at the guarded spot price and issues `n` certificates.
    /// @param n Number of certificates
    /// @param to Recipient
    /// @return id Batch id opened by this call
    /// @return assetIn Raw asset units locked
    function mint(uint256 n, address to) external returns (uint256 id, uint256 assetIn);

    /// @notice Mints one batch and distributes it to several recipients; the caller pays all the asset.
    function mintToMany(address[] calldata tos, uint256[] calldata ns) external returns (uint256 id, uint256 assetIn);

    /// @notice Burns `n` certificates of a batch and releases the locked asset. Never reads a price, never pausable.
    function redeem(uint256 id, uint256 n, address to) external returns (uint256 assetOut);

    /// @notice Redeems several batches in one call.
    function redeemBatch(uint256[] calldata ids, uint256[] calldata ns, address to)
        external
        returns (uint256[] memory assetOuts);

    /// @notice Redeems `n` certificates of an old batch and re-mints the released asset into a new batch at the
    ///         current price, refunding the remainder.
    function roll(uint256 idOld, uint256 n) external returns (uint256 idNew, uint256 m, uint256 refund);

    /// @notice Current value of `n` certificates of a batch in USDT, 1e18 fixed point, at the TWAP price.
    function certValue1e18(uint256 id, uint256 n) external view returns (uint256 value);

    /// @notice Batched certValue1e18.
    function certValues1e18(uint256[] calldata ids, uint256[] calldata ns)
        external
        view
        returns (uint256[] memory values);
}

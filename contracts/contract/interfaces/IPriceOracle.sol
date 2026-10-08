// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAssetRegistry} from "./IAssetRegistry.sol";

/// @title IPriceOracle
/// @notice One pricing entry point for every certificate contract. Dispatches to a PancakeSwap V3 pool or a V2 pair
///         according to the asset's registry configuration. V3 spot prices are guarded by the pool's own TWAP; V2
///         pairs are priced at their current reserves, with no history and no guard, by product decision.
interface IPriceOracle {
    /// @notice A zero address was supplied where a real one is required.
    error ZeroAddress();
    /// @notice The spot price is further from the TWAP than the asset's guard allows.
    error PriceDeviationTooHigh(address asset, uint256 spotPrice1e18, uint256 twapPrice1e18, uint16 maxDeviationBps);

    /// @notice Registry the oracle reads asset configuration from.
    function registry() external view returns (IAssetRegistry);

    /// @notice How many raw units of the asset `faceValue` USDT buys at the current spot price.
    /// @dev For V3 pools, reverts with PriceDeviationTooHigh when spot and TWAP disagree by more than the configured
    ///      guard. V2 pairs are quoted from their current reserves without a guard.
    /// @param asset Asset token
    /// @param faceValue USDT amount in raw units
    /// @return assetAmount Asset amount in raw units, rounded down
    /// @return spotPrice1e18 Spot price of one whole asset in USDT, 1e18 fixed point
    function quoteForFaceValue(address asset, uint256 faceValue)
        external
        view
        returns (uint256 assetAmount, uint256 spotPrice1e18);

    /// @notice Unguarded spot price of one whole asset in USDT, 1e18 fixed point, for display.
    function spotPrice1e18(address asset) external view returns (uint256);

    /// @notice Reference price of one whole asset in USDT, 1e18 fixed point: the pool TWAP for V3 assets, the
    ///         current reserve price for V2 assets, which keep no history.
    function twapPrice1e18(address asset) external view returns (uint256);
}

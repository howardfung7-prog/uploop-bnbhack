// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAssetRegistry} from "./interfaces/IAssetRegistry.sol";
import {IPancakeV2PairMinimal} from "./interfaces/IPancakeV2Minimal.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {IPancakeV3PoolMinimal, V3SpotPrice} from "./libraries/V3SpotPrice.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title PriceOracle
/// @notice One pricing entry point for every certificate contract. Reads the asset's configuration from the
///         registry and prices it from a PancakeSwap V3 pool or V2 pair. V3 spot prices are refused when they stray
///         from the pool's own TWAP by more than the configured basis points; V2 pairs are priced at their current
///         reserves without a guard, by product decision, so the registry owner must vet V2 pairs before listing.
/// @dev Stateless apart from the registry reference. Redemption never reads a price at all.
contract PriceOracle is IPriceOracle {
    uint256 internal constant BPS = 10_000;

    IAssetRegistry private immutable _REGISTRY;
    uint8 private immutable _USDT_DECIMALS;

    // ───────────────────────── Constructor ─────────────────────────

    /// @param registry_ Registry holding asset configuration
    constructor(IAssetRegistry registry_) {
        if (address(registry_) == address(0)) revert ZeroAddress();
        _REGISTRY = registry_;
        _USDT_DECIMALS = registry_.usdtDecimals();
    }

    // ───────────────────────── Views ─────────────────────────

    /// @inheritdoc IPriceOracle
    function registry() external view returns (IAssetRegistry) {
        return _REGISTRY;
    }

    /// @inheritdoc IPriceOracle
    function quoteForFaceValue(address asset, uint256 faceValue)
        external
        view
        returns (uint256 assetAmount, uint256 spotPrice1e18_)
    {
        IAssetRegistry.AssetConfig memory cfg = _REGISTRY.config(asset);
        if (cfg.priceSource == IAssetRegistry.PriceSource.V2_PAIR) {
            return _quoteV2(cfg, faceValue);
        }
        (assetAmount, spotPrice1e18_) = _quoteV3(cfg, faceValue);
        _checkDeviation(asset, spotPrice1e18_, _twapV3(cfg), cfg.maxDeviationBps);
    }

    /// @inheritdoc IPriceOracle
    function spotPrice1e18(address asset) external view returns (uint256 spot) {
        IAssetRegistry.AssetConfig memory cfg = _REGISTRY.config(asset);
        (, spot) = cfg.priceSource == IAssetRegistry.PriceSource.V3_POOL ? _quoteV3(cfg, 0) : _quoteV2(cfg, 0);
    }

    /// @inheritdoc IPriceOracle
    function twapPrice1e18(address asset) external view returns (uint256 twap) {
        IAssetRegistry.AssetConfig memory cfg = _REGISTRY.config(asset);
        if (cfg.priceSource == IAssetRegistry.PriceSource.V3_POOL) return _twapV3(cfg);
        (, twap) = _quoteV2(cfg, 0);
    }

    // ───────────────────────── Private ─────────────────────────

    /// @dev Spot quote and spot price from a V3 pool.
    function _quoteV3(IAssetRegistry.AssetConfig memory cfg, uint256 faceValue)
        private
        view
        returns (uint256 assetAmount, uint256 spot)
    {
        (uint160 sqrtPriceX96,,,,,,) = IPancakeV3PoolMinimal(cfg.pool).slot0();
        assetAmount = V3SpotPrice.quoteFromSqrtPrice(sqrtPriceX96, !cfg.assetIsToken0, faceValue);
        spot = V3SpotPrice.price1e18FromSqrtPrice(sqrtPriceX96, cfg.assetIsToken0, cfg.assetDecimals, _USDT_DECIMALS);
    }

    /// @dev TWAP price from a V3 pool's own observations.
    function _twapV3(IAssetRegistry.AssetConfig memory cfg) private view returns (uint256) {
        int24 tick = V3SpotPrice.averageTick(cfg.pool, cfg.twapWindow);
        return V3SpotPrice.tickToPrice1e18(tick, cfg.assetIsToken0, cfg.assetDecimals, _USDT_DECIMALS);
    }

    /// @dev Quote and price from a V2 pair's current reserves.
    function _quoteV2(IAssetRegistry.AssetConfig memory cfg, uint256 faceValue)
        private
        view
        returns (uint256 assetAmount, uint256 spot)
    {
        (uint112 reserve0, uint112 reserve1,) = IPancakeV2PairMinimal(cfg.pool).getReserves();
        (uint256 assetReserve, uint256 usdtReserve) =
            cfg.assetIsToken0 ? (uint256(reserve0), uint256(reserve1)) : (uint256(reserve1), uint256(reserve0));
        assetAmount = Math.mulDiv(faceValue, assetReserve, usdtReserve);
        spot = Math.mulDiv(usdtReserve * 10 ** cfg.assetDecimals, 1e18, assetReserve * 10 ** _USDT_DECIMALS);
    }

    /// @dev Reverts when spot and TWAP differ by more than `maxDeviationBps` basis points of the TWAP.
    function _checkDeviation(address asset, uint256 spot, uint256 twap, uint16 maxDeviationBps) private pure {
        uint256 diff = spot > twap ? spot - twap : twap - spot;
        if (twap == 0 || diff * BPS > twap * maxDeviationBps) {
            revert PriceDeviationTooHigh(asset, spot, twap, maxDeviationBps);
        }
    }
}

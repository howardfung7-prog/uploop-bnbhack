// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title V3SpotPrice
/// @notice Dependency-free helpers for reading spot prices from PancakeSwap V3 (or Uniswap V3) pools.
///         Reusable for any "tokenized stock / USDT" pool.
/// @dev A V3 pool stores no price, only slot0().sqrtPriceX96:
///      ratio = token1 / token0 (raw units) = (sqrtPriceX96 / 2^96)^2;
///      price of one whole base in quote = ratio * 10^(dec0 - dec1) when base is token0, the inverse otherwise.
///      Notes:
///      1. token0 / token1 are ordered by address, so the same stock can sit on either side of a pool.
///         Every function here resolves the direction from the base token passed by the caller.
///      2. PancakeSwap V3 slot0().feeProtocol is uint32 while Uniswap V3 uses uint8; a wrong type reverts on ABI decode.
///      3. The spot price is the state after the last swap and can be moved by one large trade or a flash loan.
///         Settlement, liquidation and valuation paths must pair it with a TWAP (see averageTick) or another source,
///         and must never swap and read the price inside the same transaction.
library V3SpotPrice {
    // ───────────────────────── Constants ─────────────────────────

    /// @notice PancakeSwap V3 factory on BSC
    address internal constant PANCAKE_V3_FACTORY = 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865;
    /// @notice USDT on BSC (18 decimals)
    address internal constant USDT_BSC = 0x55d398326f99059fF775485246999027B3197955;
    /// @notice Fee tier of the main bStocks pools: 0.25%
    uint24 internal constant FEE_2500 = 2500;
    /// @notice Lower bound of a V3 tick
    int24 internal constant MIN_TICK = -887_272;
    /// @notice Upper bound of a V3 tick
    int24 internal constant MAX_TICK = 887_272;
    /// @notice One in X128 fixed point, used by the tick math
    uint256 internal constant ONE_X128 = 1 << 128;
    /// @notice sqrt(1.0001) in X128 fixed point, rounded to nearest
    uint256 internal constant SQRT_1_0001_X128 = 340_299_380_613_952_818_054_172_298_683_778_356_828;

    // ───────────────────────── Errors ─────────────────────────

    /// @notice The factory has no pool for this pair and fee tier
    error PoolNotFound(address tokenA, address tokenB, uint24 fee);
    /// @notice The base token is neither token0 nor token1 of the pool
    error TokenNotInPool(address pool, address token);
    /// @notice The TWAP window must be positive
    error ZeroWindow();
    /// @notice The average tick does not fit in int24 (mathematically impossible, kept as a guard)
    error TickOutOfRange(int56 averageTick);
    /// @notice The mulDiv result does not fit in uint256
    error MulDivOverflow();

    // ───────────────────────── Pool lookup ─────────────────────────

    /// @notice Looks up a pool through the factory.
    /// @param tokenA One token of the pair
    /// @param tokenB The other token of the pair
    /// @param fee Fee tier, e.g. 2500 for 0.25%
    /// @return pool Pool address; reverts when none exists
    function findPool(address tokenA, address tokenB, uint24 fee) internal view returns (address pool) {
        pool = IPancakeV3FactoryMinimal(PANCAKE_V3_FACTORY).getPool(tokenA, tokenB, fee);
        if (pool == address(0)) revert PoolNotFound(tokenA, tokenB, fee);
    }

    /// @notice Convenience for bStocks: the 0.25% pool of a stock token against USDT.
    /// @param stockToken Stock token address
    /// @return pool Pool address
    function findUsdtPool(address stockToken) internal view returns (address pool) {
        return findPool(stockToken, USDT_BSC, FEE_2500);
    }

    // ───────────────────────── Spot price ─────────────────────────

    /// @notice Price of one whole baseToken in quoteToken as an 1e18 fixed-point number.
    /// @dev Example: the NVDAB/USDT pool returns 219_750000000000000000 for 219.75 USDT.
    /// @param pool Pool address
    /// @param baseToken Token to price; must be token0 or token1 of the pool
    /// @return price 1e18 fixed-point price
    function price1e18(address pool, address baseToken) internal view returns (uint256 price) {
        (uint160 sqrtPriceX96,,,,,,) = IPancakeV3PoolMinimal(pool).slot0();
        bool baseIsToken0 = _baseIsToken0(pool, baseToken);
        address quoteToken = baseIsToken0 ? IPancakeV3PoolMinimal(pool).token1() : IPancakeV3PoolMinimal(pool).token0();
        return price1e18FromSqrtPrice(
            sqrtPriceX96,
            baseIsToken0,
            IERC20DecimalsMinimal(baseToken).decimals(),
            IERC20DecimalsMinimal(quoteToken).decimals()
        );
    }

    /// @notice Converts baseAmount of baseToken (raw units) into quoteToken (raw units) at the spot price.
    /// @dev No fee and no slippage; this is a plain conversion at the current price.
    /// @param pool Pool address
    /// @param baseToken Token to convert from
    /// @param baseAmount Amount in raw units
    /// @return quoteAmount Amount of the other token in raw units
    function quote(address pool, address baseToken, uint256 baseAmount) internal view returns (uint256 quoteAmount) {
        (uint160 sqrtPriceX96,,,,,,) = IPancakeV3PoolMinimal(pool).slot0();
        return quoteFromSqrtPrice(sqrtPriceX96, _baseIsToken0(pool, baseToken), baseAmount);
    }

    /// @notice Pure-math variant of price1e18 for unit tests or callers that already hold a sqrtPrice.
    /// @param sqrtPriceX96 Pool sqrtPriceX96
    /// @param baseIsToken0 Whether the base token is token0 of the pool
    /// @param baseDecimals Decimals of the base token
    /// @param quoteDecimals Decimals of the quote token
    /// @return price 1e18 fixed-point price
    function price1e18FromSqrtPrice(uint160 sqrtPriceX96, bool baseIsToken0, uint8 baseDecimals, uint8 quoteDecimals)
        internal
        pure
        returns (uint256 price)
    {
        // Quote 1e18 whole base tokens first, then strip the quote decimals; this keeps the most precision.
        uint256 rawQuote = quoteFromSqrtPrice(sqrtPriceX96, baseIsToken0, (10 ** baseDecimals) * 1e18);
        return rawQuote / (10 ** quoteDecimals);
    }

    /// @notice Pure math: sqrtPriceX96 to quote amount, following Uniswap's OracleLibrary.getQuoteAtTick.
    /// @dev sqrtPriceX96 squared overflows uint256 once it reaches 2^128, hence the two branches and the 512-bit mulDiv.
    /// @param sqrtPriceX96 Pool sqrtPriceX96
    /// @param baseIsToken0 Whether the base token is token0 of the pool
    /// @param baseAmount Base amount in raw units
    /// @return quoteAmount Quote amount in raw units
    function quoteFromSqrtPrice(uint160 sqrtPriceX96, bool baseIsToken0, uint256 baseAmount)
        internal
        pure
        returns (uint256 quoteAmount)
    {
        if (sqrtPriceX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
            return baseIsToken0 ? mulDiv(ratioX192, baseAmount, 1 << 192) : mulDiv(1 << 192, baseAmount, ratioX192);
        }
        uint256 ratioX128 = mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 64);
        return baseIsToken0 ? mulDiv(ratioX128, baseAmount, 1 << 128) : mulDiv(1 << 128, baseAmount, ratioX128);
    }

    // ───────────────────────── Tick math ─────────────────────────

    /// @notice sqrt(1.0001^tick) in X96 fixed point, the quantity a pool stores in slot0().sqrtPriceX96.
    /// @dev Exponentiation by squaring in X128 fixed point, independent of Uniswap's TickMath. The result matches
    ///      TickMath's MIN_SQRT_RATIO and MAX_SQRT_RATIO to better than 1e-30 relative before Uniswap's own rounding.
    ///      Intermediate values stay below 2^200 for the whole tick range.
    /// @param tick Tick in [MIN_TICK, MAX_TICK]
    /// @return sqrtPriceX96 sqrt ratio in X96
    function sqrtRatioX96AtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        if (tick < MIN_TICK || tick > MAX_TICK) revert TickOutOfRange(tick);
        uint256 exponent = uint256(int256(tick < 0 ? -tick : tick));
        uint256 resultX128 = ONE_X128;
        uint256 baseX128 = SQRT_1_0001_X128;
        while (exponent > 0) {
            if (exponent & 1 == 1) resultX128 = mulDiv(resultX128, baseX128, ONE_X128);
            exponent >>= 1;
            if (exponent > 0) baseX128 = mulDiv(baseX128, baseX128, ONE_X128);
        }
        if (tick < 0) resultX128 = mulDiv(ONE_X128, ONE_X128, resultX128);
        uint256 x96 = resultX128 >> 32;
        // The range check above bounds x96 below 2^160; the guard keeps the narrowing cast provably safe.
        if (x96 > type(uint160).max) revert TickOutOfRange(tick);
        // forge-lint: disable-next-line(unsafe-typecast)
        sqrtPriceX96 = uint160(x96);
    }

    /// @notice Price of one whole base token in quote at a given tick, as an 1e18 fixed-point number.
    /// @param tick Pool tick (spot or time-weighted average)
    /// @param baseIsToken0 Whether the base token is token0 of the pool
    /// @param baseDecimals Decimals of the base token
    /// @param quoteDecimals Decimals of the quote token
    /// @return price 1e18 fixed-point price
    function tickToPrice1e18(int24 tick, bool baseIsToken0, uint8 baseDecimals, uint8 quoteDecimals)
        internal
        pure
        returns (uint256 price)
    {
        return price1e18FromSqrtPrice(sqrtRatioX96AtTick(tick), baseIsToken0, baseDecimals, quoteDecimals);
    }

    // ───────────────────────── TWAP helper ─────────────────────────

    /// @notice Time-weighted average tick over the last `window` seconds (manipulation resistant).
    /// @dev Convert it to a price with TickMath.getSqrtRatioAtTick from pancakeswap v3-core and feed the result to
    ///      quoteFromSqrtPrice. The pool reverts with "OLD" when the window exceeds its oracle history.
    /// @param pool Pool address
    /// @param window Window length in seconds
    /// @return tick Average tick, rounded toward negative infinity like Uniswap's OracleLibrary
    function averageTick(address pool, uint32 window) internal view returns (int24 tick) {
        if (window == 0) revert ZeroWindow();
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = window;
        secondsAgos[1] = 0;
        (int56[] memory tickCumulatives,) = IPancakeV3PoolMinimal(pool).observe(secondsAgos);
        int56 delta = tickCumulatives[1] - tickCumulatives[0];
        int56 windowSigned = int56(uint56(window));
        int56 average = delta / windowSigned;
        if (delta < 0 && delta % windowSigned != 0) average--;
        // The average always lies within the tick range; check explicitly before narrowing so the cast is provably safe.
        if (average < MIN_TICK || average > MAX_TICK) revert TickOutOfRange(average);
        // forge-lint: disable-next-line(unsafe-typecast)
        tick = int24(average);
    }

    // ───────────────────────── Math ─────────────────────────

    /// @notice floor(x * y / denominator) with 512-bit intermediate precision.
    /// @dev Ported from OpenZeppelin Math.mulDiv (MIT). Reverts when the result does not fit in uint256.
    /// @param x Multiplicand
    /// @param y Multiplier
    /// @param denominator Divisor
    /// @return result Quotient
    function mulDiv(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            // 512-bit product prod1 * 2^256 + prod0. Everything below follows OpenZeppelin's derivation;
            // wrapping modulo 2^256 is intentional.
            uint256 prod0 = x * y;
            uint256 prod1;
            assembly {
                let mm := mulmod(x, y, not(0))
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) {
                return prod0 / denominator;
            }
            if (denominator <= prod1) revert MulDivOverflow();
            uint256 remainder;
            assembly {
                remainder := mulmod(x, y, denominator)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }
            uint256 twos = denominator & (0 - denominator);
            assembly {
                denominator := div(denominator, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;
            uint256 inverse = (3 * denominator) ^ 2;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            result = prod0 * inverse;
        }
    }

    // ───────────────────────── Private ─────────────────────────

    /// @dev Returns true when baseToken is token0, false when it is token1, reverts otherwise.
    function _baseIsToken0(address pool, address baseToken) private view returns (bool) {
        if (baseToken == IPancakeV3PoolMinimal(pool).token0()) return true;
        if (baseToken == IPancakeV3PoolMinimal(pool).token1()) return false;
        revert TokenNotInPool(pool, baseToken);
    }
}

/// @title IPancakeV3PoolMinimal
/// @notice Only the pool functions needed for pricing.
/// @dev feeProtocol is uint32 on PancakeSwap V3 (uint8 on Uniswap V3).
interface IPancakeV3PoolMinimal {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint32 feeProtocol,
            bool unlocked
        );
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function liquidity() external view returns (uint128);
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

/// @title IPancakeV3FactoryMinimal
/// @notice Only getPool.
interface IPancakeV3FactoryMinimal {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

/// @title IERC20DecimalsMinimal
/// @notice Only decimals.
interface IERC20DecimalsMinimal {
    function decimals() external view returns (uint8);
}

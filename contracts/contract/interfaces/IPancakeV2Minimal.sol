// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IPancakeV2FactoryMinimal
/// @notice Only getPair.
interface IPancakeV2FactoryMinimal {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

/// @title IPancakeV2PairMinimal
/// @notice Only the pair functions needed for pricing and the cumulative price oracle.
interface IPancakeV2PairMinimal {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function price0CumulativeLast() external view returns (uint256);
    function price1CumulativeLast() external view returns (uint256);
}

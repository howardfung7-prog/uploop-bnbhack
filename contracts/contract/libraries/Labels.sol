// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Labels
/// @notice Validation shared by every name and symbol that ends up inside certificate metadata JSON.
library Labels {
    /// @notice Longest accepted name or symbol, in bytes
    uint256 internal constant MAX_LENGTH = 64;

    /// @notice A name or symbol is empty, longer than MAX_LENGTH, or contains a quote, backslash or control
    ///         character that would break the metadata JSON.
    error InvalidLabel(string label);

    /// @notice Reverts unless `label` is safe to embed in JSON without escaping.
    /// @param label Name or symbol
    function validate(string memory label) internal pure {
        bytes memory raw = bytes(label);
        if (raw.length == 0 || raw.length > MAX_LENGTH) revert InvalidLabel(label);
        for (uint256 i = 0; i < raw.length; ++i) {
            bytes1 c = raw[i];
            if (c < 0x20 || c == 0x22 || c == 0x5c) revert InvalidLabel(label);
        }
    }
}

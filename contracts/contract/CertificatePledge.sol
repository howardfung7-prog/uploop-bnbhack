// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAssetRegistry} from "./interfaces/IAssetRegistry.sol";
import {ICertificatePledge} from "./interfaces/ICertificatePledge.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {
    ERC1155HolderUpgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC1155/utils/ERC1155HolderUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

/// @title CertificatePledge
/// @notice Custody for the certificates of this system. Users pledge certificates of whitelisted certificate
///         contracts and take the same certificates back whenever they want; the ledger is per user, certificate
///         contract and batch, and the events are what an indexer builds positions from. Pledging yields nothing
///         else: no rewards, no receipt token, no lock period.
/// @dev Upgradeable through a UUPS proxy with ERC-7201 namespaced storage; new fields must only be appended to the
///      struct. Both entry points are nonReentrant and finish the ledger before the certificate moves. The whitelist
///      and the pause gate new pledges only, so a user can always redeem. The owner can never move a pledged
///      certificate. Certificates enter only through pledge(); direct transfers are rejected so nothing is stranded.
contract CertificatePledge is
    ICertificatePledge,
    Initializable,
    Ownable2StepUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC1155HolderUpgradeable
{
    /// @custom:storage-location erc7201:stock.certificate.CertificatePledge
    struct PledgeStorage {
        IAssetRegistry registry;
        bool paused;
        mapping(address certificate => bool allowed) whitelist;
        mapping(address user => mapping(address certificate => mapping(uint256 id => uint256 amount))) pledged;
        mapping(address certificate => mapping(uint256 id => uint256 amount)) totalPledged;
    }

    // ───────────────────────── Constants ─────────────────────────

    /// @dev keccak256(abi.encode(uint256(keccak256("stock.certificate.CertificatePledge")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant PLEDGE_STORAGE_LOCATION =
        0xedb4b80be1130546d359d477667c2e11ee02b38d80857faa440d18ee643ab400;

    // ───────────────────────── Constructor / initializer ─────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the proxy. Called once, through the proxy, at deployment. The whitelist starts empty.
    /// @param initialOwner Owner, a multisig in production
    /// @param registry_ Manager contract the whitelist is checked against
    function initialize(address initialOwner, IAssetRegistry registry_) external initializer {
        if (address(registry_) == address(0)) revert ZeroAddress();
        __Ownable_init(initialOwner);
        __Ownable2Step_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __ERC1155Holder_init();
        _storage().registry = registry_;
    }

    // ───────────────────────── Users ─────────────────────────

    /// @inheritdoc ICertificatePledge
    function pledge(Entry[] calldata items) external nonReentrant {
        PledgeStorage storage $ = _storage();
        if ($.paused) revert PledgePaused();
        if (items.length == 0) revert EmptyArray();
        for (uint256 i = 0; i < items.length; ++i) {
            _pledge($, items[i]);
        }
    }

    /// @inheritdoc ICertificatePledge
    function redeem(Entry[] calldata items) external nonReentrant {
        PledgeStorage storage $ = _storage();
        if (items.length == 0) revert EmptyArray();
        for (uint256 i = 0; i < items.length; ++i) {
            _redeem($, items[i]);
        }
    }

    // ───────────────────────── Owner ─────────────────────────

    /// @inheritdoc ICertificatePledge
    function setWhitelisted(address certificate, bool allowed) external onlyOwner {
        PledgeStorage storage $ = _storage();
        if (allowed && !$.registry.certificateInfo(certificate).registered) {
            revert CertificateNotRegistered(certificate);
        }
        $.whitelist[certificate] = allowed;
        emit WhitelistSet(certificate, allowed);
    }

    /// @inheritdoc ICertificatePledge
    function setPaused(bool paused_) external onlyOwner {
        _storage().paused = paused_;
        emit PausedSet(paused_);
    }

    // ───────────────────────── ERC-1155 receiver ─────────────────────────

    /// @notice Accepts only the transfers the contract itself makes inside pledge(); anything sent directly would
    ///         be stranded, so it is rejected.
    function onERC1155Received(address operator, address from, uint256 id, uint256 value, bytes memory data)
        public
        override
        returns (bytes4)
    {
        if (operator != address(this)) revert DirectTransferNotAllowed();
        return super.onERC1155Received(operator, from, id, value, data);
    }

    /// @notice The contract never pulls certificates through batch transfers, so none are accepted.
    function onERC1155BatchReceived(address, address, uint256[] memory, uint256[] memory, bytes memory)
        public
        pure
        override
        returns (bytes4)
    {
        revert DirectTransferNotAllowed();
    }

    // ───────────────────────── Views ─────────────────────────

    /// @notice Logic version, bumped on every upgrade.
    function version() external pure virtual returns (string memory) {
        return "1";
    }

    /// @inheritdoc ICertificatePledge
    function registry() external view returns (IAssetRegistry) {
        return _storage().registry;
    }

    /// @inheritdoc ICertificatePledge
    function paused() external view returns (bool) {
        return _storage().paused;
    }

    /// @inheritdoc ICertificatePledge
    function isWhitelisted(address certificate) external view returns (bool) {
        return _storage().whitelist[certificate];
    }

    /// @inheritdoc ICertificatePledge
    function pledgedOf(address user, address certificate, uint256 id) external view returns (uint256) {
        return _storage().pledged[user][certificate][id];
    }

    /// @inheritdoc ICertificatePledge
    function totalPledged(address certificate, uint256 id) external view returns (uint256) {
        return _storage().totalPledged[certificate][id];
    }

    // ───────────────────────── Internal ─────────────────────────

    /// @dev Only the owner may upgrade the logic.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ───────────────────────── Private ─────────────────────────

    /// @dev Namespaced storage pointer.
    function _storage() private pure returns (PledgeStorage storage $) {
        assembly ("memory-safe") {
            $.slot := PLEDGE_STORAGE_LOCATION
        }
    }

    /// @dev Records one entry for the caller, then pulls the certificates. The receiver hook fired by the transfer
    ///      is the external call of this path and lands in onERC1155Received above.
    function _pledge(PledgeStorage storage $, Entry calldata item) private {
        if (item.amount == 0) revert ZeroAmount();
        if (!$.whitelist[item.certificate]) revert CertificateNotWhitelisted(item.certificate);
        $.pledged[msg.sender][item.certificate][item.id] += item.amount;
        $.totalPledged[item.certificate][item.id] += item.amount;
        emit Pledged(msg.sender, item.certificate, item.id, item.amount);
        IERC1155(item.certificate).safeTransferFrom(msg.sender, address(this), item.id, item.amount, "");
    }

    /// @dev Deducts one entry from the caller's ledger, then returns the certificates to the caller.
    function _redeem(PledgeStorage storage $, Entry calldata item) private {
        if (item.amount == 0) revert ZeroAmount();
        uint256 held = $.pledged[msg.sender][item.certificate][item.id];
        if (item.amount > held) revert InsufficientPledged(item.certificate, item.id, held);
        $.pledged[msg.sender][item.certificate][item.id] = held - item.amount;
        $.totalPledged[item.certificate][item.id] -= item.amount;
        emit Redeemed(msg.sender, item.certificate, item.id, item.amount);
        IERC1155(item.certificate).safeTransferFrom(address(this), msg.sender, item.id, item.amount, "");
    }
}

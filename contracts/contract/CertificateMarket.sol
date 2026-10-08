// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAssetRegistry} from "./interfaces/IAssetRegistry.sol";
import {ICertificateMarket} from "./interfaces/ICertificateMarket.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {
    ERC1155HolderUpgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC1155/utils/ERC1155HolderUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title CertificateMarket
/// @notice Sell-only, fixed-price marketplace for the certificates registered in the AssetRegistry. Listings escrow
///         the certificates here; purchases pay the seller and the treasury and hand the certificates to the buyer
///         in the same transaction; sellers may cancel whatever is unsold.
/// @dev Upgradeable through a UUPS proxy with ERC-7201 namespaced storage; new fields must only be appended to the
///      struct. Every entry point that changes state and makes an external call is nonReentrant, and each listing's
///      state is final before the external calls it causes. Payments are pushed: BNB with a bounded gas stipend,
///      ERC-20 through a non-reverting transfer after the total was pulled from the buyer. A delivery that fails is
///      credited for withdrawal, so one recipient that cannot receive (a rejecting contract, a blocklisted address)
///      never blocks a purchase; outside a purchase the market holds exactly those credits. The owner tunes fees,
///      currencies and the pause switch but can never move escrowed certificates or deferred payments.
contract CertificateMarket is
    ICertificateMarket,
    Initializable,
    Ownable2StepUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC1155HolderUpgradeable
{
    using SafeERC20 for IERC20;

    /// @custom:storage-location erc7201:stock.certificate.CertificateMarket
    struct MarketStorage {
        IAssetRegistry registry;
        address treasury;
        uint16 feeBps;
        bool paused;
        uint256 listingCount;
        mapping(uint256 listingId => Listing listing) listings;
        mapping(address currency => bool allowed) paymentTokens;
        mapping(address account => mapping(address currency => uint256 amount)) pending;
    }

    /// @dev One settled entry of a purchase, carried from the accounting phase to the delivery phase of buy.
    struct Fill {
        address seller;
        address certificate;
        uint256 id;
        uint256 amount;
        uint256 proceeds;
    }

    // ───────────────────────── Constants ─────────────────────────

    /// @notice Cap on the platform fee, in basis points
    uint16 public constant MAX_FEE_BPS = 1000;
    /// @notice Gas forwarded with every pushed BNB payment; recipients needing more receive it through withdraw()
    uint256 public constant PAYMENT_GAS_LIMIT = 20_000;
    /// @notice Currency address standing for BNB
    address public constant BNB = address(0);
    uint16 internal constant BPS = 10_000;
    /// @dev keccak256(abi.encode(uint256(keccak256("stock.certificate.CertificateMarket")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant MARKET_STORAGE_LOCATION =
        0x8e11010957699333c2dd635df93c831c83176c955c91fd43cce8f613c4cf8900;

    // ───────────────────────── Constructor / initializer ─────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the proxy. Called once, through the proxy, at deployment. BNB and the registry's USDT
    ///         are allowed as currencies from the start.
    /// @param initialOwner Owner, a multisig in production
    /// @param registry_ Manager contract that decides which certificate contracts can be traded
    /// @param treasury_ Fee recipient
    /// @param feeBps_ Platform fee in basis points
    function initialize(address initialOwner, IAssetRegistry registry_, address treasury_, uint16 feeBps_)
        external
        initializer
    {
        if (address(registry_) == address(0)) revert ZeroAddress();
        __Ownable_init(initialOwner);
        __Ownable2Step_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __ERC1155Holder_init();
        MarketStorage storage $ = _storage();
        $.registry = registry_;
        _setFee($, feeBps_, treasury_);
        _setPaymentToken($, BNB, true);
        _setPaymentToken($, registry_.usdt(), true);
    }

    // ───────────────────────── Sellers ─────────────────────────

    /// @inheritdoc ICertificateMarket
    function list(ListingInput[] calldata items) external nonReentrant returns (uint256[] memory listingIds) {
        MarketStorage storage $ = _storage();
        if ($.paused) revert MarketPaused();
        if (items.length == 0) revert EmptyArray();
        listingIds = new uint256[](items.length);
        for (uint256 i = 0; i < items.length; ++i) {
            listingIds[i] = _list($, items[i]);
        }
    }

    /// @inheritdoc ICertificateMarket
    function updatePrice(uint256 listingId, uint256 unitPrice) external {
        if (unitPrice == 0) revert ZeroPrice();
        Listing storage listing_ = _ownActiveListing(listingId);
        listing_.unitPrice = unitPrice;
        emit PriceUpdated(listingId, unitPrice);
    }

    /// @inheritdoc ICertificateMarket
    function cancel(uint256[] calldata listingIds) external nonReentrant {
        if (listingIds.length == 0) revert EmptyArray();
        for (uint256 i = 0; i < listingIds.length; ++i) {
            _cancel(listingIds[i]);
        }
    }

    // ───────────────────────── Buyers ─────────────────────────

    /// @inheritdoc ICertificateMarket
    function buy(address currency, Purchase[] calldata items, bool allOrNothing)
        external
        payable
        nonReentrant
        returns (uint256 spent)
    {
        MarketStorage storage $ = _storage();
        if ($.paused) revert MarketPaused();
        if (items.length == 0) revert EmptyArray();
        if (currency != BNB && msg.value != 0) revert UnexpectedValue();
        // Phase one: every listing's state is final before any value or certificate moves
        Fill[] memory fills = new Fill[](items.length);
        uint256 fee;
        for (uint256 i = 0; i < items.length; ++i) {
            (uint256 cost, uint256 fee_) = _fill($, currency, items[i], allOrNothing, fills[i]);
            spent += cost;
            fee += fee_;
        }
        if (spent == 0) revert NothingPurchased();
        if (currency == BNB) {
            if (msg.value < spent) revert InsufficientPayment(spent, msg.value);
        } else {
            IERC20(currency).safeTransferFrom(msg.sender, address(this), spent);
        }
        // Phase two: pay the sellers and deliver, then the treasury, then return any excess BNB
        for (uint256 i = 0; i < fills.length; ++i) {
            Fill memory fill = fills[i];
            if (fill.amount == 0) continue;
            _pay(currency, fill.seller, fill.proceeds);
            IERC1155(fill.certificate).safeTransferFrom(address(this), msg.sender, fill.id, fill.amount, "");
        }
        _pay(currency, $.treasury, fee);
        if (currency == BNB) _pay(BNB, msg.sender, msg.value - spent);
    }

    /// @inheritdoc ICertificateMarket
    function withdraw(address currency) external nonReentrant {
        MarketStorage storage $ = _storage();
        uint256 amount = $.pending[msg.sender][currency];
        if (amount == 0) revert NothingToWithdraw();
        $.pending[msg.sender][currency] = 0;
        emit Withdrawn(msg.sender, currency, amount);
        if (currency != BNB) {
            IERC20(currency).safeTransfer(msg.sender, amount);
            return;
        }
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert PaymentFailed();
    }

    // ───────────────────────── Owner ─────────────────────────

    /// @inheritdoc ICertificateMarket
    function setFee(uint16 feeBps_, address treasury_) external onlyOwner {
        _setFee(_storage(), feeBps_, treasury_);
    }

    /// @inheritdoc ICertificateMarket
    function setPaymentToken(address token, bool allowed) external onlyOwner {
        _setPaymentToken(_storage(), token, allowed);
    }

    /// @inheritdoc ICertificateMarket
    function setPaused(bool paused_) external onlyOwner {
        _storage().paused = paused_;
        emit PausedSet(paused_);
    }

    // ───────────────────────── ERC-1155 receiver ─────────────────────────

    /// @notice Accepts only the escrow transfers the market itself makes inside list(); anything sent directly
    ///         would be stranded, so it is rejected.
    function onERC1155Received(address operator, address from, uint256 id, uint256 value, bytes memory data)
        public
        override
        returns (bytes4)
    {
        if (operator != address(this)) revert DirectTransferNotAllowed();
        return super.onERC1155Received(operator, from, id, value, data);
    }

    /// @notice The market never escrows through batch transfers, so none are accepted.
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

    /// @inheritdoc ICertificateMarket
    function registry() external view returns (IAssetRegistry) {
        return _storage().registry;
    }

    /// @inheritdoc ICertificateMarket
    function feeBps() external view returns (uint16) {
        return _storage().feeBps;
    }

    /// @inheritdoc ICertificateMarket
    function treasury() external view returns (address) {
        return _storage().treasury;
    }

    /// @inheritdoc ICertificateMarket
    function paused() external view returns (bool) {
        return _storage().paused;
    }

    /// @inheritdoc ICertificateMarket
    function listingCount() external view returns (uint256) {
        return _storage().listingCount;
    }

    /// @inheritdoc ICertificateMarket
    function listing(uint256 listingId) external view returns (Listing memory) {
        return _storage().listings[listingId];
    }

    /// @inheritdoc ICertificateMarket
    function isPaymentToken(address token) external view returns (bool) {
        return _storage().paymentTokens[token];
    }

    /// @inheritdoc ICertificateMarket
    function pending(address account, address currency) external view returns (uint256) {
        return _storage().pending[account][currency];
    }

    // ───────────────────────── Internal ─────────────────────────

    /// @dev Only the owner may upgrade the logic.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ───────────────────────── Private ─────────────────────────

    /// @dev Namespaced storage pointer.
    function _storage() private pure returns (MarketStorage storage $) {
        assembly ("memory-safe") {
            $.slot := MARKET_STORAGE_LOCATION
        }
    }

    /// @dev Records one listing, then escrows its certificates. The receiver hook fired by the transfer is the
    ///      external call of this path and lands in onERC1155Received above.
    function _list(MarketStorage storage $, ListingInput calldata item) private returns (uint256 listingId) {
        if (item.amount == 0) revert ZeroAmount();
        if (item.unitPrice == 0) revert ZeroPrice();
        if (!$.registry.certificateInfo(item.certificate).registered) {
            revert CertificateNotRegistered(item.certificate);
        }
        if (!$.paymentTokens[item.currency]) revert CurrencyNotAllowed(item.currency);
        listingId = ++$.listingCount;
        $.listings[listingId] = Listing({
            seller: msg.sender,
            status: Status.ACTIVE,
            certificate: item.certificate,
            currency: item.currency,
            id: item.id,
            remaining: item.amount,
            unitPrice: item.unitPrice
        });
        emit Listed(listingId, msg.sender, item.certificate, item.id, item.amount, item.unitPrice, item.currency);
        IERC1155(item.certificate).safeTransferFrom(msg.sender, address(this), item.id, item.amount, "");
    }

    /// @dev Closes one of the caller's listings and returns what was left.
    function _cancel(uint256 listingId) private {
        Listing storage listing_ = _ownActiveListing(listingId);
        uint256 returned = listing_.remaining;
        listing_.remaining = 0;
        listing_.status = Status.CANCELLED;
        emit Cancelled(listingId, returned);
        IERC1155(listing_.certificate).safeTransferFrom(address(this), listing_.seller, listing_.id, returned, "");
    }

    /// @dev Settles one purchase entry against its listing at the current fee and records the fill. Returns zeros
    ///      for an entry that was skipped in best-effort mode.
    function _fill(
        MarketStorage storage $,
        address currency,
        Purchase calldata purchase,
        bool allOrNothing,
        Fill memory fill
    ) private returns (uint256 cost, uint256 fee) {
        if (purchase.amount == 0) revert ZeroAmount();
        Listing storage listing_ = $.listings[purchase.listingId];
        uint256 amount = _fillable(listing_, purchase, allOrNothing);
        if (amount == 0) return (0, 0);
        if (listing_.currency != currency) revert CurrencyMismatch(purchase.listingId);
        cost = amount * listing_.unitPrice;
        fee = cost * $.feeBps / BPS;
        listing_.remaining -= amount;
        if (listing_.remaining == 0) listing_.status = Status.FILLED;
        fill.seller = listing_.seller;
        fill.certificate = listing_.certificate;
        fill.id = listing_.id;
        fill.amount = amount;
        fill.proceeds = cost - fee;
        emit Purchased(purchase.listingId, msg.sender, amount, cost, fee);
    }

    /// @dev How many certificates a purchase entry takes from its listing. All-or-nothing entries must be filled in
    ///      full, for the certificate and batch they name, at or under their price limit; best-effort entries are
    ///      skipped when the listing is not for sale, sells something else or is too expensive, and capped at what
    ///      is left.
    function _fillable(Listing storage listing_, Purchase calldata purchase, bool allOrNothing)
        private
        view
        returns (uint256 amount)
    {
        if (listing_.status != Status.ACTIVE) {
            if (allOrNothing) revert ListingNotActive(purchase.listingId);
            return 0;
        }
        if (listing_.certificate != purchase.certificate || listing_.id != purchase.id) {
            if (allOrNothing) revert ListingMismatch(purchase.listingId);
            return 0;
        }
        if (listing_.unitPrice > purchase.maxUnitPrice) {
            if (allOrNothing) revert PriceAboveLimit(purchase.listingId, listing_.unitPrice);
            return 0;
        }
        if (purchase.amount > listing_.remaining) {
            if (allOrNothing) revert InsufficientRemaining(purchase.listingId, listing_.remaining);
            return listing_.remaining;
        }
        return purchase.amount;
    }

    /// @dev Pushes `amount` of `currency`, already held by the market, to `to`: BNB with a bounded stipend, ERC-20
    ///      through a transfer that reports failure instead of reverting. Whatever cannot be delivered is credited
    ///      for withdrawal.
    function _pay(address currency, address to, uint256 amount) private {
        if (amount == 0) return;
        bool ok;
        if (currency == BNB) {
            (ok,) = to.call{value: amount, gas: PAYMENT_GAS_LIMIT}("");
        } else {
            ok = IERC20(currency).trySafeTransfer(to, amount);
        }
        if (!ok) {
            _storage().pending[to][currency] += amount;
            emit PaymentDeferred(to, currency, amount);
        }
    }

    /// @dev Storage pointer to one of the caller's active listings; reverts otherwise.
    function _ownActiveListing(uint256 listingId) private view returns (Listing storage listing_) {
        listing_ = _storage().listings[listingId];
        if (listing_.status != Status.ACTIVE) revert ListingNotActive(listingId);
        if (listing_.seller != msg.sender) revert NotSeller(listingId);
    }

    /// @dev Shared by initialize and setFee.
    function _setFee(MarketStorage storage $, uint16 feeBps_, address treasury_) private {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh(feeBps_);
        if (feeBps_ > 0 && treasury_ == address(0)) revert ZeroAddress();
        if (treasury_ == address(this)) revert InvalidTreasury(treasury_);
        $.feeBps = feeBps_;
        $.treasury = treasury_;
        emit FeeSet(feeBps_, treasury_);
    }

    /// @dev Shared by initialize and setPaymentToken.
    function _setPaymentToken(MarketStorage storage $, address token, bool allowed) private {
        $.paymentTokens[token] = allowed;
        emit PaymentTokenSet(token, allowed);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAssetRegistry} from "./IAssetRegistry.sol";

/// @title ICertificateMarket
/// @notice Fixed-price marketplace for the certificates of this system. Sellers escrow certificates in listings,
///         each priced per certificate in BNB or an allowed ERC-20; buyers fill listings in batches; the platform
///         takes a fee from the proceeds.
interface ICertificateMarket {
    /// @notice Life cycle of a listing. NONE is the state of an id that was never created.
    enum Status {
        NONE,
        ACTIVE,
        FILLED,
        CANCELLED
    }

    /// @notice One listing: `remaining` certificates of batch `id` of `certificate`, each sold for `unitPrice`
    ///         in `currency`.
    /// @dev seller: who listed and who may cancel or reprice. status: see Status. certificate: certificate contract.
    ///      currency: address(0) for BNB, otherwise an ERC-20 that was allowed when the listing was created. id:
    ///      batch id. remaining: certificates still for sale. unitPrice: price per certificate in raw currency units.
    struct Listing {
        address seller;
        Status status;
        address certificate;
        address currency;
        uint256 id;
        uint256 remaining;
        uint256 unitPrice;
    }

    /// @notice One entry of list: `amount` certificates of batch `id` of `certificate` at `unitPrice` in `currency`.
    struct ListingInput {
        address certificate;
        uint256 id;
        uint256 amount;
        uint256 unitPrice;
        address currency;
    }

    /// @notice One entry of buy: take `amount` certificates of `listingId` as long as it still sells batch `id` of
    ///         `certificate` at no more than `maxUnitPrice` per certificate.
    /// @dev certificate and id pin what the buyer saw, so a listing id that ends up naming another listing after a
    ///      reorg is not filled by mistake.
    struct Purchase {
        uint256 listingId;
        address certificate;
        uint256 id;
        uint256 amount;
        uint256 maxUnitPrice;
    }

    /// @notice A listing was created and its certificates escrowed.
    event Listed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed certificate,
        uint256 id,
        uint256 amount,
        uint256 unitPrice,
        address currency
    );
    /// @notice The seller changed the price of a listing.
    event PriceUpdated(uint256 indexed listingId, uint256 unitPrice);
    /// @notice The seller cancelled a listing and got the unsold certificates back.
    event Cancelled(uint256 indexed listingId, uint256 returned);
    /// @notice Part or all of a listing was bought. `cost` is what the buyer paid, `fee` the platform's share of it.
    event Purchased(uint256 indexed listingId, address indexed buyer, uint256 amount, uint256 cost, uint256 fee);
    /// @notice A payment could not be delivered and was credited for withdrawal instead.
    event PaymentDeferred(address indexed account, address indexed currency, uint256 amount);
    /// @notice An account withdrew a deferred payment.
    event Withdrawn(address indexed account, address indexed currency, uint256 amount);
    /// @notice Fee parameters were updated.
    event FeeSet(uint16 feeBps, address treasury);
    /// @notice A currency was allowed or disallowed for new listings.
    event PaymentTokenSet(address indexed token, bool allowed);
    /// @notice Listing and buying were paused or resumed.
    event PausedSet(bool paused);

    /// @notice A zero address was supplied where a real one is required.
    error ZeroAddress();
    /// @notice An amount of zero certificates was supplied.
    error ZeroAmount();
    /// @notice A price of zero was supplied.
    error ZeroPrice();
    /// @notice An empty array was supplied to a batch function.
    error EmptyArray();
    /// @notice Listing and buying are paused.
    error MarketPaused();
    /// @notice The certificate contract is not registered in the asset registry.
    error CertificateNotRegistered(address certificate);
    /// @notice The currency is not allowed for new listings.
    error CurrencyNotAllowed(address currency);
    /// @notice The listing is priced in a different currency than the purchase.
    error CurrencyMismatch(uint256 listingId);
    /// @notice The listing does not exist or is no longer for sale.
    error ListingNotActive(uint256 listingId);
    /// @notice The listing sells a different certificate or batch than the purchase entry names.
    error ListingMismatch(uint256 listingId);
    /// @notice Only the seller may cancel or reprice a listing.
    error NotSeller(uint256 listingId);
    /// @notice The listing has fewer certificates left than requested.
    error InsufficientRemaining(uint256 listingId, uint256 remaining);
    /// @notice The listing's price per certificate exceeds the purchase's limit.
    error PriceAboveLimit(uint256 listingId, uint256 unitPrice);
    /// @notice Less BNB was sent than the purchase costs.
    error InsufficientPayment(uint256 required, uint256 provided);
    /// @notice BNB was sent with a purchase paid in an ERC-20.
    error UnexpectedValue();
    /// @notice No entry of a best-effort purchase could be filled.
    error NothingPurchased();
    /// @notice The caller has nothing deferred in this currency.
    error NothingToWithdraw();
    /// @notice The BNB transfer to the caller failed.
    error PaymentFailed();
    /// @notice The requested fee exceeds the cap.
    error FeeTooHigh(uint16 feeBps);
    /// @notice The treasury may not be the market itself, which has no way to withdraw.
    error InvalidTreasury(address treasury);
    /// @notice Certificates may only enter the market through list().
    error DirectTransferNotAllowed();

    /// @notice Creates one listing per entry and escrows the certificates. Each entry carries its own price and
    ///         currency; the caller must have approved the market on each certificate contract.
    /// @param items See ListingInput
    /// @return listingIds Id of every listing created, in input order
    function list(ListingInput[] calldata items) external returns (uint256[] memory listingIds);

    /// @notice Changes the price per certificate of one of the caller's active listings.
    /// @param listingId Listing to reprice
    /// @param unitPrice New price per certificate in the listing's currency
    function updatePrice(uint256 listingId, uint256 unitPrice) external;

    /// @notice Cancels the caller's active listings and returns their unsold certificates. Works while paused.
    /// @param listingIds Listings to cancel
    function cancel(uint256[] calldata listingIds) external;

    /// @notice Buys from several listings priced in `currency`. Every filled entry pays its seller minus the current
    ///         platform fee and transfers the certificates to the caller.
    /// @dev BNB purchases send at least the total with the call; the excess is returned. ERC-20 purchases pull the
    ///      exact total through an allowance given to the market, then pay it out. A payment that cannot be
    ///      delivered, in either currency, is credited to the recipient for withdraw() instead of failing the
    ///      purchase. With `allOrNothing` every entry must be filled in full, at or under its price limit and for
    ///      the certificate and batch it names, otherwise the call reverts. Without it, entries that are not active,
    ///      name another certificate or batch, or exceed their price limit are skipped and entries larger than the
    ///      listing take what is left; the call reverts only when nothing at all could be bought.
    /// @param currency address(0) for BNB, otherwise the ERC-20 every listing must be priced in
    /// @param items See Purchase
    /// @param allOrNothing Whether the whole basket must be filled exactly as requested
    /// @return spent Total paid in `currency`
    function buy(address currency, Purchase[] calldata items, bool allOrNothing)
        external
        payable
        returns (uint256 spent);

    /// @notice Sends the caller what could not be delivered to it during purchases in one currency. Works while
    ///         paused.
    /// @param currency address(0) for BNB, otherwise the ERC-20
    function withdraw(address currency) external;

    /// @notice Sets the platform fee taken from every sale and its recipient. Applies to sales from now on.
    /// @param feeBps_ Fee in basis points, at most MAX_FEE_BPS
    /// @param treasury_ Fee recipient, required when the fee is positive, never the market itself
    function setFee(uint16 feeBps_, address treasury_) external;

    /// @notice Allows or disallows a currency for new listings. Existing listings keep their currency.
    /// @param token address(0) for BNB, otherwise an ERC-20 without transfer fees
    /// @param allowed Whether new listings may use it
    function setPaymentToken(address token, bool allowed) external;

    /// @notice Pauses or resumes listing and buying. Cancelling and withdrawing are never paused.
    function setPaused(bool paused_) external;

    /// @notice Registry that decides which certificate contracts can be traded.
    function registry() external view returns (IAssetRegistry);

    /// @notice Current platform fee in basis points.
    function feeBps() external view returns (uint16);

    /// @notice Current fee recipient.
    function treasury() external view returns (address);

    /// @notice Whether listing and buying are paused.
    function paused() external view returns (bool);

    /// @notice Number of listings created so far; ids run from 1 to this value.
    function listingCount() external view returns (uint256);

    /// @notice A listing by id; status NONE for ids that were never created.
    function listing(uint256 listingId) external view returns (Listing memory);

    /// @notice Whether a currency is allowed for new listings.
    function isPaymentToken(address token) external view returns (bool);

    /// @notice Amount of a currency credited to an account after a failed delivery, claimable through withdraw().
    function pending(address account, address currency) external view returns (uint256);
}

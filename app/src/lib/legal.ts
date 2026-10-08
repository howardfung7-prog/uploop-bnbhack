/**
 * Public disclaimer and privacy notice; shares the platform positioning sentence with the home page.
 *
 * 🔴 This file was translated from the Chinese original on 2026-09-20 (§71.163). It is a careful
 * semantic translation, NOT a legal review, and nobody qualified has signed off on the English
 * wording as a legal text. Every substantive point of the original is preserved; if these terms
 * ever need to hold up somewhere, have a lawyer read them.
 */
import { tr } from "./i18n";
import { PLATFORM_INTRO } from "./brandCopy";

/// Official X account (address given by the user 2026-09-14)
export const X_URL = "https://x.com/Uploop_Index";
export const X_HANDLE = "@Uploop_Index";

export const DISCLAIMER: string[] = [
  tr("{0} Entrants pay their buy-in in USDT, and prizes and fees follow the rules assigned to each match. Under the new rules, 90% of the net prize pool is allocated by shares × return tier^(-0.25), and 10% by ranking bonuses, with equal returns sharing a tier. A positive strategy return does not guarantee a profit or recovery of the buy-in. Check the result page for the status of the BNB Chain settlement record; a credited payout does not mean that record is already on-chain. Creating a strategy does not automatically buy or sell its constituent assets, and the platform does not take a price position on the other side of its entrants.", PLATFORM_INTRO),
  tr("You may lose your entire buy-in. Raising your buy-in raises the total amount you can lose. Strategy return measures how the strategy performed; it is not the return on the money you staked, and a positive return does not guarantee that your prize exceeds your buy-in. Short-horizon moves are hard to predict, and past results do not indicate future results. Only enter with money you can afford to lose in full."),
  tr("Tickers such as uNVDA and uBTC identify the asset a price refers to; entering a match grants no shareholder rights in the corresponding company. Asset certificates convert the deposited amount at $10 per certificate at mint time, with the actual token amount fixed by the on-chain oracle. Every certificate in the same batch represents the same amount; different batches may differ. Redemption burns the selected certificates and returns their locked tokens — it does not guarantee $10 of value. A certificate is not a share, and not an interest in any security or derivative. The rights and risks of the underlying token are defined by its issuer, and UPLOOP makes no warranty about them. Certificate trading prices are set by the market and may swing sharply or find no buyer at all."),
  tr("MEME burn certificates follow their own rules. Burning tokens is irreversible; these certificates cannot be redeemed for the original tokens, nor exchanged for USDT at the conversion amount. The fee share is whatever is actually generated and distributed — no fixed yield and no minimum amount is promised."),
  tr("Leaderboards, strategy contents, rankings and publicly visible participant information are not investment advice, financial advice, or a recommendation of any asset. Statements about opening index assets and ETF portfolio logic describe where the platform intends to go; they do not mean traditional ETFs are being issued today or that fund management services are offered."),
  tr("UPLOOP is not a broker, an exchange, an investment adviser or a fund manager, and offers no leverage. Arena balances are held and booked by UPLOOP; deposits, entries, prizes, refunds and withdrawals are recorded in your account ledger, and withdrawals are sent back to the wallet address you logged in with. Tokens staked against assets are held by BNB Chain smart contracts and redeemed under the certificate rules; the platform does not touch those assets, and custody itself earns no interest. Login signatures, approvals and transactions are confirmed in your own wallet, and the security of your keys and wallet is your responsibility. The platform's systems, smart contracts, third-party price sources, the blockchain network and the frontend may all suffer defects, outages or attacks, and any resulting loss is borne by the user."),
  tr("Before taking part, assess your financial situation and risk tolerance, and make sure you understand the rules. Do not use UPLOOP if activity of this kind is prohibited or restricted where you live. To the maximum extent permitted by law, UPLOOP accepts no liability for loss, damage or problems arising from use of the platform."),
];

/// The one line kept in the footer (click through for the full text)
export const DISCLAIMER_LEAD = tr("You may lose your entire buy-in; a certificate is not a share, and not an interest in any security or derivative.");

export interface Section {
  h: string;
  p: string[];
}

export const PRIVACY_UPDATED = "2026-09-17";

export const PRIVACY: Section[] = [
  { h: tr("Scope and principles"), p: [
    tr("UPLOOP identifies users by wallet address; there is no separate account to register. The platform processes the data needed to run matches, settle them, keep funding records and control risk. It does not sell user data and does not use it for advertising profiles."),
  ] },
  { h: tr("Data collected and processed"), p: [
    tr("Wallet and account records: wallet address, login session, submitted strategies, arena balance, and deposit, withdrawal, prize and refund records — used to identify the account, provide the service and reconcile funds."),
    tr("Public on-chain data: on-chain transactions, certificate holdings and match settlement records. This information is publicly queryable on the blockchain, and the platform reads the parts relevant to the features it offers."),
    tr("Access logs: basic information such as request time, IP address and browser identifier — used for troubleshooting, abuse prevention and risk control."),
    tr("Listing applications: the token details, market capitalisation, contact Telegram, developer identity statement and connected wallet address supplied with an application — used to assess it and to contact the applicant."),
  ] },
  { h: tr("Browser local storage"), p: [
    tr("Unsubmitted strategy drafts, display name, avatar choice, view and theme preferences, and the last wallet you connected are stored in the current browser. Clearing local data may lose these settings or drafts; the platform keeps no server-side recovery copy of unsubmitted drafts."),
    tr("The strategy, display name and avatar you submit when entering a match are stored with the match record, to show entry information and to verify results. Local drafts and submitted records are two different things."),
  ] },
  { h: tr("Private keys and wallet information"), p: [
    tr("The platform never asks for or holds private keys or seed phrases, and never signs on your behalf. Never give your private key or seed phrase to anyone."),
    tr("The current wallet login flow asks for no email address, phone number or identity document. Contact details you choose to submit with a listing application are handled for that application's purpose."),
    tr("The platform does not enumerate every token and balance in your wallet, but it does read the on-chain records needed to display, stake and trade certificates."),
  ] },
  { h: tr("Cookies and connection sessions"), p: [
    tr("The platform uses a login session cookie to keep your signed-in state; the session ends when you log out. No advertising cookies and no advertising tracking scripts are used."),
    tr("When you use WalletConnect, the connection service stores session data in your browser; how that data is handled is governed by your wallet's and WalletConnect's own policies."),
  ] },
  { h: tr("Third-party services"), p: [
    tr("Blockchain networks and RPC nodes: handle on-chain queries and transactions; the resulting transaction records are held publicly by BNB Chain."),
    tr("Wallets and connection services: handle wallet connection, message signing and transaction confirmation, under each provider's own privacy policy."),
    tr("Market data services: the platform fetches public quotes and candles for display and settlement, and does not query personal trading data tied to your wallet identity."),
    tr("Web font services: pages may request font resources from Google Fonts, and that provider may receive the IP address and browser information the request requires."),
  ] },
  { h: tr("Retention periods"), p: [
    tr("Access logs are kept for one year and then deleted."),
    tr("Funding and match records are kept long term for reconciliation, result review and dispute handling."),
    tr("Public on-chain records are not under the platform's unilateral control and cannot be deleted from the blockchain by the platform."),
    tr("Browser-local data stays until you clear it or the browser does; there is no server-side backup of unsubmitted strategy drafts."),
  ] },
  { h: tr("Your choices and how to reach us"), p: [
    tr("You can disconnect your wallet, log out or stop using the platform at any time, and you can clear local drafts and preferences in your browser. None of that deletes public on-chain records or the funding and match records that must be retained."),
    tr("If you have questions about how data is handled, contact the platform through the channel published in the site notices or via the official X account."),
  ] },
  { h: tr("Limits on use and policy updates"), p: [
    tr("Minors must not use the platform. Do not use UPLOOP if activity of this kind is prohibited or restricted where you live."),
    tr("When this policy is revised the date on this page is updated; material changes are announced in the site notices."),
  ] },
];

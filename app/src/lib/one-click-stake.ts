import type { Asset } from "./assets";
import type { Address, Hash, TransactionReceipt } from "viem";
import { BaseError, ContractFunctionRevertedError, isAddress, erc20Abi, parseEventLogs, zeroAddress } from "viem";
import { assetRegistryAbi, certificatePledgeAbi, redeemableCertificateAbi, priceOracleAbi } from "./abi.certs";
import { assetSwapAbi } from "./abi.asset-swap";
import { addresses, CHAIN_ID, walletRpcClient, coreConfigured, walletClient } from "./chain";
import { resolveAddresses } from "./certindex";
import { tr } from "./i18n";
import { loadOneClickConfig } from "./one-click-config";

export function oneClickPoolOpen(a: Asset): boolean {
  return a.status === "listed" && a.pool === "open" && a.one_click_stake !== false;
}
export const STAKE_ORDER_COUNT = 1;
export const MAX_STAKE_ORDER_COUNT = 100;
export const ONE_CLICK_SLIPPAGE_BPS = 50;
export const ONE_CLICK_QUOTE_TTL_MS = 60_000;
// BSC USDT has 18 decimals. AssetSwap charges a percentage of the token purchase amount;
// `usdtIn` includes that fee, so the gross-to-net ratio is 10000 + feeBps.
export const ONE_CLICK_FEE_BPS = 300;
const BPS_DENOMINATOR = 10_000n;
export function oneClickServiceFeeFromTotal(usdtIn: bigint): bigint {
  if (usdtIn < 0n) throw new Error("Invalid USDT amount");
  return (usdtIn * BigInt(ONE_CLICK_FEE_BPS)) / (BPS_DENOMINATOR + BigInt(ONE_CLICK_FEE_BPS));
}
/// Allow one wei of rounding variance across contract implementations using floor/ceil division.
export function oneClickFeeMatches(usdtIn: bigint, feeUsdt: bigint): boolean {
  const expected = oneClickServiceFeeFromTotal(usdtIn);
  return feeUsdt === expected || feeUsdt === expected + 1n;
}
const swapAbi = [...assetSwapAbi, ...priceOracleAbi.filter(x => x.type === "error"),
  ...redeemableCertificateAbi.filter(x => x.type === "error"), ...certificatePledgeAbi.filter(x => x.type === "error")] as const;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function validStakeCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > MAX_STAKE_ORDER_COUNT) throw new Error(tr("Choose 1–100 certificates."));
}
export function maxOneClickPayment(value: bigint, slippageBps = ONE_CLICK_SLIPPAGE_BPS): bigint {
  return (value * BigInt(10_000 + slippageBps) + 9_999n) / 10_000n;
}
/// Convert the slippage-adjusted token purchase amount back to a gross USDT amount,
/// including the percentage service fee charged by AssetSwap.
export function maxOneClickGrossPayment(netUsdt: bigint, feeBps = ONE_CLICK_FEE_BPS): bigint {
  const numerator = BPS_DENOMINATOR + BigInt(feeBps);
  if (netUsdt < 0n || feeBps < 0 || numerator <= 0n) throw new Error("Invalid service fee");
  return (netUsdt * numerator + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}
/// Two decimals like every amount on screen. Round the displayed ceiling UP, never show a lower
/// maximum than the signed integer.
export function formatOneClickUsdt(value: bigint): string {
  const unit = 10n ** 16n;
  const cents = (value + unit - 1n) / unit;
  return `${(cents / 100n).toLocaleString()}.${(cents % 100n).toString().padStart(2, "0")}`;
}
export interface OneClickQuote {
  asset: Address; certificate: Address; swap: Address; pledge: Address; registry: Address; usdt: Address;
  chainId: number; count: number; quotedAt: number;
  configRevision: string; slippageBps: number; deadlineMinutes: number;
  usdtIn: bigint; feeUsdt: bigint; assetIn: bigint; maxUsdtIn: bigint;
}
export interface OneClickResult { hash: Hash; id: bigint; count: number; usdtIn: bigint; feeUsdt: bigint; refundedAsset: bigint }
export type OneClickProgress = "approving" | "confirming" | "pending";
export type OneClickSubmit = (quote: OneClickQuote, progress: (phase: OneClickProgress, hash?: Hash) => void) => Promise<OneClickResult>;

/// Nonpayable Quoter-style function: simulate with eth_call, never send a quote transaction.
export async function quoteOneClick(asset: Address, count = STAKE_ORDER_COUNT): Promise<OneClickQuote> {
  validStakeCount(count);
  // Address discovery is page metadata and may use the API once. All live state below is
  // obtained from the connected wallet RPC; no server request is made when the user submits.
  await resolveAddresses();
  const { config, revision } = await loadOneClickConfig();
  if (!config.enabled || config.disabled_assets.some(a => same(a, asset))) throw new Error(tr("One-click staking is paused for this asset."));
  if (config.chain_id !== CHAIN_ID) throw new Error(tr("The swap configuration does not match this site. Please contact support."));
  if (count > config.max_certificates) throw new Error(tr("One-click staking allows up to {0} certificates per order.", config.max_certificates));
  const swap = (config.swap_address || addresses.swap) as Address;
  const { registry, pledge, usdt } = addresses;
  if (!coreConfigured() || !isAddress(swap, { strict: false }) || same(swap, zeroAddress)) throw new Error(tr("AssetSwap is not configured."));
  const rpc = walletRpcClient();
  const [cfg, buyState, settings, linkedRegistry, linkedPledge, linkedUsdt, chainId, decimals] = await Promise.all([
    rpc.readContract({ address: registry, abi: assetRegistryAbi, functionName: "config", args: [asset] }),
    rpc.readContract({ address: swap, abi: assetSwapAbi, functionName: "paused" }),
    rpc.readContract({ address: swap, abi: assetSwapAbi, functionName: "assetSettings", args: [asset] }),
    rpc.readContract({ address: swap, abi: assetSwapAbi, functionName: "registry" }),
    rpc.readContract({ address: swap, abi: assetSwapAbi, functionName: "pledge" }),
    rpc.readContract({ address: swap, abi: assetSwapAbi, functionName: "usdt" }),
    rpc.getChainId(),
    rpc.readContract({ address: usdt, abi: erc20Abi, functionName: "decimals" }),
  ]);
  if (chainId !== CHAIN_ID || decimals !== 18 || !same(linkedRegistry, registry) || !same(linkedPledge, pledge) || !same(linkedUsdt, usdt)) throw new Error(tr("The swap configuration does not match this site. Please contact support."));
  const certificate = cfg.certificate;
  if (same(certificate, zeroAddress) || cfg.mode !== 0) throw new Error("CertificateMismatch");
  if (cfg.mintPaused) throw new Error("AssetMintPaused");
  if (buyState[0] || !settings.buyEnabled) throw new Error("BuyClosed");
  const [mintPaused, pledgePaused, whitelisted] = await Promise.all([
    rpc.readContract({ address: certificate, abi: redeemableCertificateAbi, functionName: "mintPaused" }),
    rpc.readContract({ address: pledge, abi: certificatePledgeAbi, functionName: "paused" }),
    rpc.readContract({ address: pledge, abi: certificatePledgeAbi, functionName: "isWhitelisted", args: [certificate] }),
  ]);
  if (mintPaused) throw new Error("MintPaused");
  if (pledgePaused) throw new Error("PledgePaused");
  if (!whitelisted) throw new Error("CertificateNotWhitelisted");
  const { result: [usdtIn, feeUsdt, assetIn] } = await rpc.simulateContract({
    address: swap, abi: swapAbi, functionName: "quoteBuyAndMint", args: [certificate, asset, BigInt(count)],
  });
  if (usdtIn <= 0n || feeUsdt > usdtIn || assetIn <= 0n) throw new Error(tr("The live quote is unavailable."));
  if (!oneClickFeeMatches(usdtIn, feeUsdt)) throw new Error("ServiceFeeMismatch");
  const maxNetUsdtIn = maxOneClickPayment(usdtIn - feeUsdt, config.slippage_bps);
  return { asset, certificate, count, swap, registry, pledge, usdt, chainId, usdtIn, feeUsdt, assetIn,
    maxUsdtIn: maxOneClickGrossPayment(maxNetUsdtIn), quotedAt: Date.now(),
    configRevision: revision, slippageBps: config.slippage_bps, deadlineMinutes: config.deadline_minutes };
}

export function verifyOneClickReceipt(receipt: TransactionReceipt, q: OneClickQuote, account: Address): OneClickResult {
  if (receipt.status !== "success") throw new Error(tr("The transaction reverted. No purchase completed; Gas may have been spent."));
  const minted = parseEventLogs({ abi: assetSwapAbi, logs: receipt.logs.filter(l => same(l.address, q.swap)), eventName: "BoughtAndMinted" });
  const bought = minted.find(({ args: a }) => same(a.buyer, account) && same(a.certificate, q.certificate)
    && same(a.asset, q.asset) && a.n === BigInt(q.count) && a.pledged);
  const pledged = parseEventLogs({ abi: certificatePledgeAbi, logs: receipt.logs.filter(l => same(l.address, q.pledge)), eventName: "Pledged" });
  if (!bought || bought.args.usdtIn > q.maxUsdtIn || !oneClickFeeMatches(bought.args.usdtIn, bought.args.feeUsdt) || !pledged.some(({ args: a }) => same(a.user, account)
    && same(a.certificate, q.certificate) && a.id === bought.args.id && a.amount === BigInt(q.count))) {
    throw new Error(tr("Transaction confirmed, but the pledge could not be verified. Check the transaction before trying again."));
  }
  const refunds = parseEventLogs({ abi: assetSwapAbi, logs: receipt.logs.filter(l => same(l.address, q.swap)), eventName: "AssetRefunded" });
  return { hash: receipt.transactionHash, id: bought.args.id, count: q.count, usdtIn: bought.args.usdtIn, feeUsdt: bought.args.feeUsdt,
    refundedAsset: refunds.filter(({ args: a }) => same(a.to, account) && same(a.asset, q.asset)).reduce((n, l) => n + l.args.amount, 0n) };
}

/// Freeze the amount the user accepted. Fresh quotes may invalidate it, never silently raise it.
export async function writeOneClickStake(q: OneClickQuote, account: Address,
  progress: (phase: OneClickProgress, hash?: Hash) => void): Promise<OneClickResult> {
  validStakeCount(q.count);
  if (!oneClickFeeMatches(q.usdtIn, q.feeUsdt)) throw new Error("ServiceFeeMismatch");
  if (Date.now() - q.quotedAt > ONE_CLICK_QUOTE_TTL_MS) throw new Error("Expired");
  const wc = walletClient();
  if (!wc) throw new Error(tr("Connect a wallet first"));
  const checkWallet = async () => {
    const [activeAccount] = await wc.getAddresses();
    if (await wc.getChainId() !== q.chainId || !activeAccount || !same(activeAccount, account)) throw new Error(tr("Wallet account or network changed. Reopen the quote."));
  };
  const rpc = walletRpcClient();
  const checkUsdtBalance = async () => {
    await checkWallet();
    const balance = await rpc.readContract({ address: q.usdt, abi: erc20Abi, functionName: "balanceOf", args: [account] });
    if (balance < q.maxUsdtIn) throw new Error(tr("You need at least {0} USDT in your wallet for the maximum payment.", formatOneClickUsdt(q.maxUsdtIn)));
  };
  const checkQuote = async () => {
    // Revalidate only from the connected wallet's RPC. This is deliberately independent of the
    // platform API: the quote was already accepted by the user and the contract is the source of
    // truth for pool state, configuration and the live amount at signing time.
    const [cfg, buyState, settings, linkedRegistry, linkedPledge, linkedUsdt, chainId, decimals] = await Promise.all([
      rpc.readContract({ address: q.registry, abi: assetRegistryAbi, functionName: "config", args: [q.asset] }),
      rpc.readContract({ address: q.swap, abi: assetSwapAbi, functionName: "paused" }),
      rpc.readContract({ address: q.swap, abi: assetSwapAbi, functionName: "assetSettings", args: [q.asset] }),
      rpc.readContract({ address: q.swap, abi: assetSwapAbi, functionName: "registry" }),
      rpc.readContract({ address: q.swap, abi: assetSwapAbi, functionName: "pledge" }),
      rpc.readContract({ address: q.swap, abi: assetSwapAbi, functionName: "usdt" }),
      rpc.getChainId(), rpc.readContract({ address: q.usdt, abi: erc20Abi, functionName: "decimals" }),
    ]);
    if (chainId !== q.chainId || decimals !== 18 || !same(linkedRegistry, q.registry) || !same(linkedPledge, q.pledge) || !same(linkedUsdt, q.usdt)
      || same(cfg.certificate, zeroAddress) || cfg.certificate.toLowerCase() !== q.certificate.toLowerCase() || cfg.mode !== 0
      || cfg.mintPaused || buyState[0] || !settings.buyEnabled) throw new Error("BuyClosed");
    const [mintPaused, pledgePaused, whitelisted] = await Promise.all([
      rpc.readContract({ address: q.certificate, abi: redeemableCertificateAbi, functionName: "mintPaused" }),
      rpc.readContract({ address: q.pledge, abi: certificatePledgeAbi, functionName: "paused" }),
      rpc.readContract({ address: q.pledge, abi: certificatePledgeAbi, functionName: "isWhitelisted", args: [q.certificate] }),
    ]);
    if (mintPaused || pledgePaused || !whitelisted) throw new Error(mintPaused ? "MintPaused" : pledgePaused ? "PledgePaused" : "CertificateNotWhitelisted");
    const { result: [usdtIn, feeUsdt, assetIn] } = await rpc.simulateContract({
      address: q.swap, abi: swapAbi, functionName: "quoteBuyAndMint", args: [q.certificate, q.asset, BigInt(q.count)],
    });
    if (usdtIn <= 0n || assetIn <= 0n || !oneClickFeeMatches(usdtIn, feeUsdt) || usdtIn > q.maxUsdtIn) throw new Error(usdtIn > q.maxUsdtIn ? "CostAboveLimit" : "RouteUnavailable");
    await checkUsdtBalance();
  };
  await checkQuote();
  const allowance = await rpc.readContract({ address: q.usdt, abi: erc20Abi, functionName: "allowance", args: [account, q.swap] });
  if (allowance < q.maxUsdtIn) {
    progress("approving");
    const approval = await wc.writeContract({ account, address: q.usdt, abi: erc20Abi, functionName: "approve", args: [q.swap, q.maxUsdtIn], chain: wc.chain });
    const receipt = await rpc.waitForTransactionReceipt({ hash: approval });
    if (receipt.status !== "success") throw new Error(tr("USDT approval failed. No purchase was submitted."));
  }
  await checkQuote();
  progress("confirming");
  const deadline = (await rpc.getBlock()).timestamp + BigInt(q.deadlineMinutes * 60);
  await checkUsdtBalance();
  const { request } = await rpc.simulateContract({ account, address: q.swap, abi: swapAbi, functionName: "buyMintAndPledge",
    args: [q.certificate, q.asset, BigInt(q.count), q.maxUsdtIn, deadline] });
  await checkUsdtBalance();
  const hash = await wc.writeContract({ ...request, account, chain: wc.chain });
  progress("pending", hash);
  const receipt = await rpc.waitForTransactionReceipt({ hash,
    onReplaced: ({ transaction }) => progress("pending", transaction.hash),
  });
  return verifyOneClickReceipt(receipt, q, account);
}

export function oneClickError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const reverted = e instanceof BaseError ? e.walk(x => x instanceof ContractFunctionRevertedError) : null;
  const errors: Record<string, string> = {
    ServiceFeeMismatch: tr("The contract service fee does not match the configured 3% rate. Buying is unavailable until the contract is updated."),
    CertificateMismatch: tr("The selected certificate does not belong to this asset. Refresh and try again."),
    AssetMintPaused: tr("Deposits for this asset are paused."), MintPaused: tr("Deposits for this asset are paused."),
    BuyClosed: tr("Buying this asset is paused or not open."), PledgePaused: tr("Pledging is paused for now."),
    CertificateNotWhitelisted: tr("This certificate is not enabled for pledging yet."),
    InsufficientLiquidity: tr("The PancakeSwap pool does not have enough liquidity for this order."),
    ReceivedTooLittle: tr("The token transfer returned too little; the order was rejected."),
    PoolTooShallow: tr("This PancakeSwap pool is too shallow for the order."),
    CardinalityTooLow: tr("The pool price history is not ready yet."), RouteUnavailable: tr("The USDT route is unavailable right now."),
    PriceDeviationTooHigh: tr("The live price moved too far from its reference price."),
    CostAboveLimit: tr("The quote moved above the allowed payment limit. Refresh and try again."),
    TradeTooLarge: tr("This order is too large for the pool. Reduce the number of certificates."),
    Expired: tr("The quote expired. Refresh and try again."), ERC20InsufficientBalance: tr("Your wallet does not hold enough USDT."),
    ERC20InsufficientAllowance: tr("USDT approval is too low. Try again."),
    SafeERC20FailedOperation: tr("The token transfer failed. Check your balance and approval."),
  };
  const name = reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : Object.keys(errors).find(k => raw.includes(k));
  if (/User rejected|User denied|user rejected/i.test(raw)) return tr("You cancelled the wallet request.");
  return (name && errors[name]) || raw.split("\n")[0] || tr("The transaction could not be prepared.");
}

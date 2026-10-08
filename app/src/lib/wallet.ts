import { tr } from "./i18n";
import { CHAIN_ID, CHAIN_LABEL, RPC } from "./env";
import { getAddress } from "viem";
import type { Address, EIP1193Provider } from "viem";
import type { EthereumProvider as WcEthereumProvider } from "@walletconnect/ethereum-provider";

/// The wallet picker (DECISIONS §71.28).
///
/// Two kinds of wallet:
/// 1. Injected (a browser extension / the browser built into a wallet app). Discovery takes two
///    routes: the main one is EIP-6963 — the page broadcasts `eip6963:requestProvider` and every
///    installed extension answers with its own `eip6963:announceProvider` (carrying a name, an
///    icon, an rdns and a provider), so several wallets installed at once do not overwrite one
///    another; the fallback is the old-style flags on `window.ethereum` such as isMetaMask (which
///    is usually all a wallet app's built-in browser offers).
/// 2. WalletConnect (§71.28 addendum 2, listed last): scan a QR code with a phone wallet. This goes
///    through the official @walletconnect/ethereum-provider (a dynamic import, so users who do not
///    choose it never download it); with VITE_WC_PROJECT_ID unset, that row reads "Not configured"
///    and cannot be clicked.
///
/// Only four kinds of request go to a wallet: switch chain (wallet_switch/addEthereumChain, sent by
/// chain.ts's ensureChain before a write), ask for the address (eth_requestAccounts / eth_accounts),
/// ask which chain (eth_chainId), and signing / sending a transaction, which each write operation
/// sends for itself. The balance inside the wallet is never read (§69.16).
///
/// The chosen wallet is kept in a module variable for chain.ts's walletClient(); its id goes into
/// localStorage and is restored silently on the next visit only while the wallet is still
/// authorised (eth_accounts has an address / the WalletConnect session is still there), with no
/// dialog.

export interface WalletEntry {
  /// A fixed id for the default list (metamask / binance / trust); an EIP-6963 wallet outside the
  /// list uses its rdns; the old-style injected fallback uses "injected"; WalletConnect is always
  /// "walletconnect".
  id: string;
  name: string;
  kind: "injected" | "walletconnect";
  /// The icon EIP-6963 supplied (a data: URI); old-style injection and WalletConnect have none →
  /// null, and the interface draws the initial instead.
  icon: string | null;
  /// Injected: the provider detected (null = not installed). WalletConnect: only there once a
  /// session has been established.
  provider: EIP1193Provider | null;
  /// Whether it can be clicked: injected = detected; WalletConnect = the project ID is set.
  available: boolean;
  /// What the interface says when it cannot be clicked: "Not detected" / "Not configured".
  why: string;
  /// The official download page; wallets outside the list and WalletConnect have none.
  install: string | null;
}

interface Known {
  id: string;
  name: string;
  rdns: string[];
  /// The old-style injected flag: whether window.ethereum (or each entry of
  /// window.ethereum.providers[]) is this one.
  flag: (eth: Record<string, unknown>) => boolean;
  /// Wallets with a global object of their own (window.trustwallet and the like), which is more
  /// reliable than a flag.
  global?: (w: Record<string, unknown>) => unknown;
  install: string;
}

const truthy = (e: Record<string, unknown>, k: string) => !!e[k];

/// The default list (the user, 2026-09-13: "these three by default — MetaMask, Binance Wallet,
/// Trust Wallet"). The order here is the order in the interface.
/// A wallet outside the list (OKX, Coinbase, Rabby…) that is installed and announced itself over
/// EIP-6963 is appended after the list and can be chosen just the same; it simply is not listed
/// when it is not installed.
const KNOWN: Known[] = [
  {
    id: "metamask", name: "MetaMask", rdns: ["io.metamask", "io.metamask.flask"],
    // Plenty of wallets claim isMetaMask for compatibility, so the other families' flags have to be
    // excluded
    flag: (e) => truthy(e, "isMetaMask") && !["isOkxWallet", "isTrust", "isTrustWallet", "isCoinbaseWallet", "isBraveWallet", "isRabby", "isBinance"].some((k) => truthy(e, k)),
    install: "https://metamask.io/download/",
  },
  {
    id: "binance", name: "Binance Wallet", rdns: ["com.binance.wallet", "com.binance.w3w"],
    flag: (e) => truthy(e, "isBinance"),
    global: (w) => (w.binancew3w as Record<string, unknown> | undefined)?.ethereum ?? w.BinanceChain,
    install: "https://www.binance.com/web3wallet",
  },
  {
    id: "trust", name: "Trust Wallet", rdns: ["com.trustwallet.app"],
    flag: (e) => truthy(e, "isTrust") || truthy(e, "isTrustWallet"),
    global: (w) => w.trustwallet,
    install: "https://trustwallet.com/download",
  },
];

interface Announced {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

const announced = new Map<string, Announced>(); // rdns → the announcement
const listeners = new Set<() => void>();
let listening = false;

const notify = () => { for (const fn of listeners) fn(); };

/// Start — or re-run — EIP-6963 discovery. Idempotent: the listener is attached once, and the
/// broadcast can be sent repeatedly (wallets answer again, and answers are deduplicated by rdns).
/// It is called again when the picker opens, so an extension that injected late can still answer.
export function discover(): void {
  if (typeof window === "undefined") return;
  if (!listening) {
    listening = true;
    window.addEventListener("eip6963:announceProvider", (e: Event) => {
      const d = (e as CustomEvent<Announced>).detail;
      if (!d?.info?.rdns || !d.provider) return;
      announced.set(d.info.rdns, d);
      notify();
    });
  }
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/// Fires whenever the discovery result changes (the picker uses it to redraw the list).
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function isProvider(x: unknown): x is EIP1193Provider {
  return !!x && typeof (x as { request?: unknown }).request === "function";
}

// ---- WalletConnect (§71.28 addendum 2) ----

export const WC_ID = "walletconnect";
const WC_PROJECT = import.meta.env.VITE_WC_PROJECT_ID ?? "";
/// The chain the session asks for = the chain the site is on (§71.30, VITE_CHAIN_ID, 56 by
/// default), and the RPC read is the site's own.
/// Taken from env.ts rather than chain.ts — chain.ts imports chosenProvider from here, and that
/// must not be turned into a cycle.
const WC_CHAIN = CHAIN_ID;
const WC_RPC = RPC;
/// A local anvil only exists on this computer and a phone wallet cannot reach it; while the site
/// runs on 31337 that row cannot be clicked.
const WC_LOCAL = CHAIN_ID === 31337;

/// Configured means the project ID is set (the 32 hex characters Reown Cloud issues). It is a
/// public value (the frontend is bound to ship it) rather than a secret, but it is still only read
/// from env.
export function wcConfigured(): boolean {
  return /^[0-9a-f]{32}$/i.test(WC_PROJECT);
}

/// The package exports EthereumProvider as a value (a class), so the instance type is taken like
/// this.
type WcProvider = InstanceType<typeof WcEthereumProvider>;

let wcProvider: WcProvider | null = null;
let wcInit: Promise<WcProvider> | null = null;
/// WalletConnect's provider is EIP-1193 too (request / on / removeListener), and handing it to viem
/// needs nothing but a type assertion.
const asEip = (p: WcProvider) => p as unknown as EIP1193Provider;

/// Initialise the WalletConnect provider (once only; init also restores the previous session out of
/// localStorage while it is at it).
/// The package is large (the QR dialog comes with it), hence the dynamic import: users who do not
/// choose WalletConnect never download it.
async function wc(): Promise<WcProvider> {
  if (wcProvider) return wcProvider;
  if (!wcInit) {
    wcInit = (async () => {
      const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
      const p = await EthereumProvider.init({
        projectId: WC_PROJECT,
        /// 🔴 §71.161: this has to be `optionalChains` and **must not** be written as `chains`.
        ///
        /// `chains: [56]` puts eip155:56 into the session proposal's **requiredNamespaces**, and
        /// (the SDK's buildNamespaces: with no optional* argument at all it goes straight to
        /// `return { required }`) sends no optionalNamespaces whatsoever.
        /// The phone wallet reads that as "give me BNB Chain, no discount of any kind", and
        /// whenever it cannot meet that right now (the network was never added to the wallet, the
        /// user is currently on another chain, the wallet only allows some chains by allowlist) it
        /// **rejects the whole proposal** — reporting exactly "Unsupported namespace key. No
        /// supported namespaces". That sentence is not ours (searching all of node_modules for "No
        /// supported namespaces" finds nothing); the wallet threw it back at us.
        ///
        /// With optionalChains the proposal carries optionalNamespaces only, so the wallet gives
        /// what it can and the connection comes first. It also widens the method table from 2
        /// (eth_sendTransaction / personal_sign) to the SDK's full optional table — which includes
        /// `wallet_switchEthereumChain`, meaning that **only after connecting do we have any way to
        /// ask the wallet to switch chain**; the previous arrangement did not even request that
        /// permission.
        ///
        /// The cost: the wallet may bring the session up on another chain, so `provider.chainId`
        /// will not be 56.
        /// That is already handled — every write-to-chain operation starts by calling chain.ts's
        /// `ensureChain()`, which switches when the wallet is not on this site's chain and sends no
        /// transaction if the switch fails (App.tsx:343). Reads go over publicClient's own RPC,
        /// regardless of which chain the wallet is on.
        optionalChains: [WC_CHAIN],
        showQrModal: true,
        rpcMap: WC_RPC ? { [WC_CHAIN]: WC_RPC } : undefined,
        metadata: {
          name: "Uploop",
          description: tr("Open platform for creating index strategies across stock and crypto assets"),
          url: location.origin,
          icons: [`${location.origin}/apple-touch-icon.png`],
        },
        qrModalOptions: { themeMode: "dark" },
      });
      wcProvider = p;
      return p;
    })().catch((e) => { wcInit = null; throw e; });
  }
  return wcInit;
}

function wcEntry(): WalletEntry {
  return {
    id: WC_ID, name: "WalletConnect", kind: "walletconnect", icon: null, provider: wcProvider ? asEip(wcProvider) : null,
    available: wcConfigured() && !WC_LOCAL, why: WC_LOCAL ? tr("A phone cannot reach the local chain") : tr("Not configured"), install: null,
  };
}

/// The list the user can currently choose from: the three defaults (listed whether installed or
/// not, with a null provider when they are not) + wallets outside the list that announced
/// themselves + the old-style injected fallback (when nothing announced itself and no flag
/// recognised window.ethereum, called "Browser wallet") + WalletConnect on the last row.
export function wallets(): WalletEntry[] {
  const w = (typeof window === "undefined" ? {} : window) as unknown as Record<string, unknown>;
  const eth = w.ethereum as Record<string, unknown> | undefined;
  const pool: Record<string, unknown>[] = Array.isArray(eth?.providers)
    ? (eth!.providers as Record<string, unknown>[])
    : eth ? [eth] : [];
  const used = new Set<string>();
  const injected = (id: string, name: string, icon: string | null, provider: EIP1193Provider | null, install: string | null): WalletEntry =>
    ({ id, name, kind: "injected", icon, provider, available: !!provider, why: tr("Not detected"), install });
  const out: WalletEntry[] = KNOWN.map((k) => {
    const rdns = k.rdns.find((r) => announced.has(r));
    if (rdns) {
      used.add(rdns);
      const a = announced.get(rdns)!;
      return injected(k.id, k.name, a.info.icon || null, a.provider, k.install);
    }
    const g = k.global?.(w);
    const legacy = isProvider(g) ? g : pool.find(k.flag);
    return injected(k.id, k.name, null, isProvider(legacy) ? legacy : null, k.install);
  });
  for (const [rdns, a] of announced) {
    if (!used.has(rdns)) out.push(injected(rdns, a.info.name, a.info.icon || null, a.provider, null));
  }
  if (announced.size === 0 && isProvider(eth) && !out.some((e) => e.provider === eth)) {
    out.push(injected("injected", tr("Browser wallet"), null, eth, null));
  }
  out.push(wcEntry());
  return out;
}

const KEY = "uploop.wallet";
let chosen: WalletEntry | null = null;

function remember(e: WalletEntry): void {
  chosen = e;
  try { localStorage.setItem(KEY, e.id); } catch { /* when private mode will not let it be written, remember it for this once only */ }
}

/// The user clicked a wallet in the picker: connect to it and remember it, and walletClient() goes
/// through that provider from then on. Returns a checksummed address.
/// Injected: eth_requestAccounts (the wallet raises its own authorisation dialog). WalletConnect:
/// with no session, raise the QR code first to establish one, then ask for the address.
/// Errors are not swallowed here (the user declining is the commonest of them); the picker displays
/// them.
export async function connectEntry(e: WalletEntry): Promise<Address> {
  if (e.kind === "walletconnect") {
    if (!wcConfigured()) throw new Error(tr("WalletConnect is not configured"));
    const p = await wc();
    const accounts = await p.enable();
    if (!accounts?.length) throw new Error(tr("The wallet did not give an address"));
    remember({ ...e, provider: asEip(p) });
    return getAddress(accounts[0]);
  }
  if (!e.provider) throw new Error(tr("That wallet was not detected"));
  const accounts = await e.provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new Error(tr("The wallet did not give an address"));
  remember(e);
  return getAddress(accounts[0]);
}

export function chosenProvider(): EIP1193Provider | null { return chosen?.provider ?? null; }
export function chosenName(): string | null { return chosen?.name ?? null; }

/// Disconnect: forget the choice, so the next visit does not restore it silently.
export function forget(): void {
  chosen = null;
  try { localStorage.removeItem(KEY); } catch { /* as above */ }
}

/// The best-effort part of disconnecting that reaches the wallet: WalletConnect ends the session
/// (otherwise it stays live inside the phone wallet); injected wallets have the site's
/// authorisation revoked (MetaMask's wallet_revokePermissions, and never mind the families that do
/// not support it). Any failure is fine — clicking "Connect wallet" again still raises the
/// authorisation dialog.
export async function revoke(): Promise<void> {
  const c = chosen;
  if (!c?.provider) return;
  try {
    if (c.kind === "walletconnect") {
      await wcProvider?.disconnect();
    } else {
      await (c.provider.request as (a: { method: string; params?: unknown[] }) => Promise<unknown>)({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    }
  } catch { /* the wallet does not support revoking / the session is already gone */ }
}

/// Silently restore the previous wallet when the page opens: injected wallets are only asked
/// eth_accounts (no dialog); for WalletConnect, look for an address in the session init restored.
/// Authorisation revoked in the wallet / session expired / not installed / never remembered → null.
/// Wait a moment first, to let extensions finish answering the announcement before looking.
export async function resume(): Promise<{ entry: WalletEntry; address: Address } | null> {
  let id: string | null = null;
  try { id = localStorage.getItem(KEY); } catch { return null; }
  if (!id) return null;
  try {
    if (id === WC_ID) {
      if (!wcConfigured()) return null;
      const p = await wc();
      if (!p.accounts?.length) return null;
      const entry = { ...wcEntry(), provider: asEip(p) };
      chosen = entry;
      return { entry, address: getAddress(p.accounts[0]) };
    }
    discover();
    await new Promise((r) => setTimeout(r, 250));
    const entry = wallets().find((e) => e.id === id && e.provider);
    if (!entry?.provider) return null;
    const accounts = await entry.provider.request({ method: "eth_accounts" });
    if (!accounts?.length) return null;
    chosen = entry;
    return { entry, address: getAddress(accounts[0]) };
  } catch {
    return null;
  }
}

/// The account changed in the wallet / the site was disconnected: an empty `accounts` means
/// disconnected (injected wallets' accountsChanged([]), or a WalletConnect session deleted on the
/// phone — that side sends a disconnect event, which is normalised to an empty list here). Returns
/// the unsubscribe function.
export function onAccountsChanged(fn: (accounts: Address[]) => void): () => void {
  const p = chosen?.provider;
  if (!p) return () => {};
  const onDisc = () => fn([]);
  p.on("accountsChanged", fn);
  p.on("disconnect", onDisc);
  return () => { p.removeListener("accountsChanged", fn); p.removeListener("disconnect", onDisc); };
}

/// Turn an error thrown by a wallet into one plain sentence: the user declining inside the wallet
/// (EIP-1193 4001) is the commonest and gets its own; the WalletConnect QR dialog being closed,
/// where the SDK throws "Connection request reset. Please try again.", gets its own too.
export function walletErrorText(e: unknown): string {
  const code = (e as { code?: number })?.code;
  const m = ((e as Error)?.message ?? String(e)).split("\n")[0];
  if (/connection request reset|modal closed|user closed/i.test(m)) return tr("The QR dialog was closed");
  if (code === 4001 || /rejected|denied|cancel/i.test(m)) return tr("Cancelled in the wallet");
  if (code === -32002 || /already pending/i.test(m)) return tr("The wallet still has a request waiting; deal with that one in the wallet first");
  /// The wallet rejected the session proposal (§71.161). The SDK's codes 5100/5104 and these few
  /// English phrases all belong to this case: the namespace is the chain and the capabilities we
  /// asked for, and a wallet that cannot supply them rejects the whole thing. Say it plainly and
  /// spell out **what to do about it** — echoing "Unsupported namespace key. No supported
  /// namespaces" back at the user explains nothing.
  if (code === 5100 || code === 5104 || /namespace|unsupported chains/i.test(m)) {
    return tr("This wallet did not accept the site's connection request: add {0} (chain ID {1}) in the wallet and switch to it, then scan again; a different wallet that supports {0} works too", CHAIN_LABEL, CHAIN_ID);
  }
  return m || tr("The wallet did not respond");
}

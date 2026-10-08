import { tr } from "./i18n";
import { createPublicClient, createWalletClient, custom, defineChain, http } from "viem";
import type { Chain, EIP1193Provider } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { CHAIN_ID, CHAIN_LABEL, RPC } from "./env";
import { chosenProvider } from "./wallet";
import { anchorChainTime } from "./chain-config";

export { CHAIN_ID, CHAIN_LABEL, RPC };
/// Addresses, the *Configured() checks and `chainNow()` (§71.174: split out so the first screen can
/// use them without loading viem). Re-exported, so every existing `from "./chain"` import still works.
export * from "./chain-config";

/// Local anvil (used when `VITE_CHAIN_ID=31337`).
export const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

/// The chain the site runs on (§71.30): 56 = BNB Chain mainnet by default, 97 = testnet,
/// 31337 = local anvil. Other chain IDs work too, but viem does not know them, so the RPC has to
/// come from VITE_RPC.
function pick(id: number): Chain {
  if (id === 56) return bsc;
  if (id === 97) return bscTestnet;
  if (id === 31337) return anvil;
  return defineChain({
    id, name: tr("Chain {0}", id),
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  });
}
export const chain = pick(CHAIN_ID);
/// CHAIN_LABEL now lives in env.ts (wallet.ts needs it too and cannot import from here); it is
/// re-exported unchanged above.

export const publicClient = createPublicClient({ chain, transport: http(RPC), batch: { multicall: true } });

/// Reads that are tied to a connected wallet should use the same EIP-1193 provider as the
/// wallet.  This keeps quotes, allowances and receipt polling on the wallet's selected RPC
/// instead of waiting on the site's shared HTTP endpoint.  The shared client remains the
/// fallback for read-only pages and before a wallet is connected.
/// One client per provider, kept for the page's lifetime (§71.174). viem's multicall batching works
/// per client: reads issued in the same tick are folded into one `aggregate3` call only if they go
/// through the same client. Building a fresh client for every read meant a board load with dozens of
/// reads went out as dozens of separate `eth_call`s — through a WalletConnect or in-app wallet RPC,
/// one after another.
const walletClients = new WeakMap<EIP1193Provider, typeof publicClient>();
export function walletRpcClient(): typeof publicClient {
  const eth = chosenProvider();
  if (!eth) return publicClient;
  let c = walletClients.get(eth);
  if (!c) {
    c = createPublicClient({ chain, transport: custom(eth), batch: { multicall: true } }) as unknown as typeof publicClient;
    walletClients.set(eth, c);
  }
  return c;
}

/// The wallet's chain, asked once and then remembered (§71.174). Previously every read asked
/// `eth_chainId` first — as many extra round trips as there were reads. A `chainChanged` event
/// drops the cached answer at once; for providers that do not emit it, the answer expires after 15 s.
const CHAIN_ID_TTL_MS = 15_000;
const walletChains = new WeakMap<EIP1193Provider, { at: number; id: Promise<number> }>();
function walletChainId(eth: EIP1193Provider): Promise<number> {
  const hit = walletChains.get(eth);
  if (hit && Date.now() - hit.at < CHAIN_ID_TTL_MS) return hit.id;
  if (!hit) {
    try { eth.on("chainChanged", () => walletChains.delete(eth)); } catch { /* provider without events */ }
  }
  const id = Promise.resolve(eth.request({ method: "eth_chainId" })).then(Number);
  walletChains.set(eth, { at: Date.now(), id });
  id.catch(() => walletChains.delete(eth));
  return id;
}

/**
 * Read contract state through the connected wallet when it is on the configured chain.
 * Wallet providers occasionally return empty data for otherwise valid calls; the public
 * BNB RPC is the read-only fallback. Transaction simulation and writes intentionally keep
 * using the wallet client directly.
 */
export async function readContractWithFallback(params: any): Promise<any> {
  const eth = chosenProvider();
  if (eth) {
    try {
      if ((await walletChainId(eth)) === CHAIN_ID) {
        return await walletRpcClient().readContract(params);
      }
    } catch (walletError) {
      console.warn("Wallet RPC contract read failed; falling back to public RPC", walletError);
    }
  }
  return publicClient.readContract(params);
}

export function walletClient() {
  const eth = chosenProvider();
  if (!eth) return null;
  return createWalletClient({ chain, transport: custom(eth) });
}

/// Switch the wallet to this site's chain before writing to it (§71.30). A wallet on another chain
/// is asked to switch (EIP-3326); a wallet that does not have the chain (4902) is asked to add it
/// (EIP-3085); if the user refuses, or the chain is still wrong afterwards, this throws and no
/// transaction is sent. Called only when the user triggers a write, never on page load.
export async function ensureChain(): Promise<void> {
  const eth = chosenProvider();
  if (!eth) throw new Error(tr("Connect a wallet first"));
  const hex = `0x${CHAIN_ID.toString(16)}` as const;
  const current = async () => Number(await eth.request({ method: "eth_chainId" }));
  if ((await current()) === CHAIN_ID) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) {
      throw new Error(tr("Could not switch to {0}: {1}", CHAIN_LABEL, (e as Error).message.split("\n")[0]));
    }
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hex, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [RPC],
        blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
      }],
    });
  }
  const now = await current();
  if (now !== CHAIN_ID) throw new Error(tr("The wallet is still on chain {0}. Switch it to {1} (chain ID {2}) and try again", now, CHAIN_LABEL, CHAIN_ID));
}

/// Switch to the chain **the caller names** (§71.157). Exactly one thing separates this from
/// `ensureChain` above, and it matters: the target chain is not the site's configured
/// `VITE_CHAIN_ID` but whatever the API just returned. A deposit address lives on the **custody
/// platform's** chain, which can be nothing like the chain the site's contracts are on (and today
/// is not: the site is on 56, the deposit address on 11155111).
/// Deposits used to go through `ensureChain`, so "switch to the site's chain first" and "you must
/// be on the deposit address's chain" fought each other, and the wallet was never even raised —
/// the transaction was blocked by our own check after the chain switch and before the signature.
///
/// 🔴 Switch only, **never add**. `ensureChain` calls `wallet_addEthereumChain` on 4902 because
/// the site's own chain has an RPC and an explorer URL in the configuration, both checked. Here
/// there are none — inventing an RPC from memory and writing it into the user's wallet amounts to
/// having them send real money over a chain nobody verified (§71.31: never guess a chain ID,
/// never guess an address).
/// So when the wallet does not have the chain, say so and ask the user to add it themselves.
export async function ensureChainId(id: number, label: string): Promise<void> {
  const eth = chosenProvider();
  if (!eth) throw new Error(tr("Connect a wallet first"));
  const current = async () => Number(await eth.request({ method: "eth_chainId" }));
  if ((await current()) === id) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${id.toString(16)}` }] });
  } catch (e) {
    if ((e as { code?: number }).code === 4902) {
      throw new Error(tr("Transaction not submitted: your wallet does not have {0} (chain ID {1}). Add that network in your wallet first, then try again", label, id));
    }
    throw new Error(tr("Transaction not submitted: could not switch to {0}: {1}", label, (e as Error).message.split("\n")[0]));
  }
  const now = await current();
  if (now !== id) throw new Error(tr("Transaction not submitted: the wallet is still on chain {0}. Switch it to {1} (chain ID {2}) and try again", now, label, id));
}

/// The on-chain time anchor (§71.174: the anchor itself and `chainNow()` live in chain-config.ts, so
/// api.ts can read the time without loading viem). Read the latest block's timestamp once, then move
/// forward on the local clock (🔴 a countdown must not use Date.now()).
export async function syncChainTime(): Promise<void> {
  let lastError: unknown = null;
  try {
    const block = await publicClient.getBlock();
    anchorChainTime(Number(block.timestamp));
    return;
  } catch (error) {
    lastError = error;
  }
  if (chosenProvider()) {
    try {
      const block = await walletRpcClient().getBlock();
      anchorChainTime(Number(block.timestamp));
      return;
    } catch (error) {
      lastError = error;
    }
  }
  // Chain time is only a countdown anchor. Keep the page usable when the public
  // RPC is temporarily unavailable; a later refresh will re-anchor it (until then `chainNow()`
  // follows the local clock).
  console.warn("Unable to read the latest BNB Chain block; using the local clock until the next successful sync.", lastError);
}

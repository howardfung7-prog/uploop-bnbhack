import { tr } from "./i18n";
/// Chain selection (DECISIONS §71.30). A standalone module with no imports at all: chain.ts and
/// wallet.ts both need it, and chain.ts already imports wallet.ts's chosenProvider, so putting it
/// on either side would close a cycle.
/// `VITE_CHAIN_ID`: 56 = BNB Chain mainnet (default); 97 = BNB Chain testnet; 31337 = local anvil.
export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? "56") || 56;

/// The chain name as people read it (§22 calls it BNB Chain). It lives here rather than in chain.ts
/// because wallet.ts has to name the chain in its errors too, and wallet.ts cannot import chain.ts
/// (that closes the cycle above). chain.ts re-exports it as before, so no import elsewhere changes.
export const CHAIN_LABEL: string =
  CHAIN_ID === 56 ? "BNB Chain" : CHAIN_ID === 97 ? tr("BNB Chain testnet") : CHAIN_ID === 31337 ? tr("local anvil") : tr("chain {0}", CHAIN_ID);

/// Default RPC per chain: mainnet and testnet use BNB Chain's official public nodes, local uses
/// anvil. `VITE_RPC` overrides; an unrecognised chain ID must set VITE_RPC.
const DEFAULT_RPC: Record<number, string> = {
  56: "https://bsc-dataseed.bnbchain.org",
  97: "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
  31337: "http://127.0.0.1:8545",
};
// Docker passes an empty build argument when no custom RPC is configured. Treat both an
// omitted value and an empty value as "use the chain's official public endpoint" so wallet
// reads do not inherit an opaque provider default that may be blocked by the site's CORS policy.
export const RPC: string = (import.meta.env.VITE_RPC ?? "").trim() || DEFAULT_RPC[CHAIN_ID] || "";

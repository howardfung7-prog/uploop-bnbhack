/// Everything App needs that talks to the chain — RPC reads, wallet writes, the ABIs — gathered into
/// one module that App loads on first use (§71.174), not at startup. viem, the certificate ABIs and
/// the readers behind them were about half of the main bundle, and the home and arena pages need none
/// of it: those visitors no longer download it before first paint. The chain pages (and a connected
/// wallet, which prefetches it) fetch it once; after that it is in the browser cache.
/// Pure helpers and config stay importable directly: chain-config.ts, board-model.ts, market-model.ts.
export { erc20Abi } from "viem";
export { walletClient, walletRpcClient, ensureChain, syncChainTime } from "./chain";
export { burnCertificateAbi, certificateMarketAbi, certificatePledgeAbi, redeemableCertificateAbi } from "./abi.certs";
export { loadBoard, loadHoldings, loadLots, loadMintQuotes } from "./board";
export { resolveAddresses } from "./certindex";
export { loadFeeBps, loadListings } from "./market";
export { loadMemePools } from "./meme";
export { writeOneClickStake } from "./one-click-stake";

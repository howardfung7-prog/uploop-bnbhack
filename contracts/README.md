# Certificate contracts

Solidity sources and ABIs of the certificate system that UPLOOP uses on BSC mainnet
(package version 2026-09-15; minting charges no fee).

| Path | Contents |
|---|---|
| `contract/` | `AssetRegistry`, `PriceOracle`, `CertificateBase`, `RedeemableCertificate`, `BurnCertificate`, `CertificateMarket`, `CertificatePledge`; interfaces in `interfaces/`, the V3 spot-price and label libraries in `libraries/` |
| `abi/` | ABI (JSON array) for every contract and interface, ready for ethers / viem / web3 |
| `docs/integration-guide.md` | Integration guide (in Chinese): address discovery, data model, events to index, mint, redeem, pledge, list, buy, admin |
| `foundry.toml` | Compiler settings |

## Build

- Solidity `0.8.28` (sources use `pragma ^0.8.20`), optimizer 200 runs.
- Depends on OpenZeppelin Contracts v5.4.0 and OpenZeppelin Contracts Upgradeable v5.4.0. `lib/` is not
  included: `forge install` both into a Foundry project, then `forge build`.

## Using the ABIs

- `AssetRegistry`, `CertificateMarket` and `CertificatePledge` are UUPS proxies: call the proxy address with
  the implementation's ABI. The address does not change on upgrade.
- There is one `RedeemableCertificate` per redeemable asset. List them with `AssetRegistry.certificates()`;
  `certificateInfo(addr).mode` is 0 for redeemable and 1 for burn certificates.
- Every certificate contract is ERC-1155 (`balanceOf`, `safeTransferFrom`, `setApprovalForAll`, `TransferSingle`, ...).
- Minting charges no fee. The market takes its fee from the seller's proceeds at the `feeBps` in force at the trade.

## Mainnet (BSC, chain id 56)

Only three addresses are needed; everything else is read from the registry.

| Contract | Address |
|---|---|
| AssetRegistry (proxy) | `0xd664C5F8aba2A4C351910201741fFa52883b52f5` |
| CertificateMarket (proxy) | `0x71b9Eb4F30431f739Ce5835ef8E857ea48BaBe76` |
| CertificatePledge (proxy) | `0xfC45bFe78E6662F92B4D4b188c5657E7aF719a1F` |

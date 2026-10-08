# 对接文档：前端 / 后台如何使用凭证系统合约

> 适用代码状态：2026-09-15 工作区。所有合约地址由部署时决定，本文只写"怎么拿到"和"怎么用"。单位约定：代币数量一律是原始单位（USDT 是 18 位小数，`1 USDT = 1e18`）；价格 `xxx1e18` 一律是"1 个完整资产值多少 USDT"的 1e18 定点数；bps 是万分之一（300 = 3%）。

## 1. 合约一览与地址发现

| 合约 | 作用 | 数量 | 可升级 |
|---|---|---|---|
| `AssetRegistry` | 管理合约：登记凭证合约与资产，决定每个资产由哪个凭证合约服务、怎么定价 | 1 个（代理） | 是 |
| `PriceOracle` | 定价：V3 池按 slot0 现货加 TWAP 偏差闸，V2 交易对按当前储备 | 1 个 | 否 |
| `RedeemableCertificate` | 可赎回凭证：抵押代币 / 股票换凭证，赎回退回锁定数量 | **每种资产一个实例** | 否 |
| `BurnCertificate` | 销毁型凭证：代币转入 dead 地址换凭证，不可赎回 | 所有销毁型资产共用 1 个 | 否 |
| `CertificateMarket` | 凭证交易：挂卖、购买 | 1 个（代理） | 是 |
| `CertificatePledge` | 凭证抵押：存入、取回 | 1 个（代理） | 是 |

只需要配置 `AssetRegistry`、`CertificateMarket`、`CertificatePledge` 三个地址，其余都能从管理合约读出来：

```solidity
registry.certificates()            // 全部凭证合约地址
registry.certificateInfo(cert)     // {registered, mode, assetCount}，mode 0 = 可赎回，1 = 销毁型
registry.assets()                  // 全部已登记资产
registry.assetsOf(cert)            // 某个凭证合约服务的资产（可赎回型恰好 1 个）
registry.config(asset)             // 见 §2.3
registry.assetSymbol(asset)        // 管理员指定的展示符号
registry.usdt()                    // 计价用的 USDT 地址
cert.name() / cert.symbol()        // 凭证合约的名称与符号，构造时写死
cert.asset()                       // 可赎回型：绑定的资产
cert.oracle() / cert.registry()    // 凭证合约用的预言机与管理合约
```

每个凭证合约都是标准 **ERC-1155**：`balanceOf(account, id)`、`balanceOfBatch`、`setApprovalForAll`、`isApprovedForAll`、`safeTransferFrom`、`safeBatchTransferFrom`、`uri(id)`，另外带 ERC1155Supply 的 `totalSupply(id)`、`exists(id)`，以及一个便利函数 `transferToMany(id, tos[], ns[])`（一批次分发给多个地址）。

## 2. 数据模型

### 2.1 批次就是 ERC-1155 的 id

每一次铸造调用开一个新批次，批次号从 1 开始自增，同一批次内的凭证完全同质。批次记录写入后永不修改：

```solidity
struct Batch {
    address asset;          // 铸造时用的资产
    uint64  mintedAt;       // 铸造区块时间戳
    uint8   assetDecimals;  // 资产小数位（缓存）
    uint256 assetPerCert;   // 每张凭证对应的资产原始单位数量：可赎回型是锁定量，销毁型是销毁量
    uint256 mintPrice1e18;  // 铸造时的价格，1 个完整资产值多少 USDT
}
cert.batch(id)        // 读批次；未知 id 回滚 UnknownBatch
cert.batchCount()     // 已开批次数
cert.faceValue()      // 铸造时每张的面值，BSC 上是 10e18（10 USDT）
```

**面值只在铸造那一刻成立**：`assetPerCert × mintPrice1e18 / 10^assetDecimals ≈ 10 USDT`。之后每张凭证的价值随资产价格浮动，不同批次的凭证价值不同。

### 2.2 一张凭证现在值多少

可赎回型：

```solidity
cert.certValue1e18(id, n)            // n 张凭证按当前参考价折算的 USDT 价值，1e18 定点
cert.certValues1e18(ids[], ns[])     // 批量
```

参考价来自 `oracle.twapPrice1e18(asset)`：V3 资产是池子的 TWAP，V2 资产是当前储备比（V2 没有历史）。展示时同时显示 `assetPerCert`（每张对应多少股 / 多少代币），让用户能对比不同批次。销毁型凭证没有可赎回价值，只展示每张对应的销毁数量和铸造价。

### 2.3 资产配置

```solidity
struct AssetConfig {
    Kind    kind;            // 0 STOCK, 1 TOKEN, 2 MEME，只是分类
    Mode    mode;            // 0 REDEEMABLE, 1 BURN，从凭证合约复制
    address certificate;     // 唯一允许对该资产铸造的凭证合约
    PriceSource priceSource; // 0 V3_POOL, 1 V2_PAIR
    address pool;            // 资产 / USDT 的 V3 池或 V2 交易对
    bool    assetIsToken0;
    uint8   assetDecimals;
    uint32  twapWindow;      // V3 才生效
    uint16  maxDeviationBps; // V3 才生效：现货偏离 TWAP 超过它就拒绝铸造
    bool    mintPaused;      // 该资产暂停铸造
}
```

### 2.4 metadata

`cert.uri(id)` 返回 `data:application/json;base64,...`，JSON 里有名称（`<合约名> #<批次>`）、描述、`asset`、`asset_per_certificate`、`mint_price_1e18`、`minted_at` 四个属性。钱包和市场可以直接用；后台不必解析它，字段都能从 `batch(id)` 读。

## 3. 后台索引：监听哪些事件、重建哪些状态

建议以事件为唯一事实来源重建状态，用 view 函数做校验和补数。所有事件的 indexed 字段都按查询习惯设计。

### 3.1 管理合约 `AssetRegistry`

| 事件 | 用途 |
|---|---|
| `CertificateRegistered(address indexed certificate, Mode mode)` | 发现新的凭证合约，开始监听它 |
| `AssetAdded(address indexed asset, address indexed certificate, Kind kind, Mode mode, PriceSource priceSource, address pool, bool assetIsToken0)` | 发现新资产及其归属 |
| `AssetSymbolSet(address indexed asset, string symbol)` | 展示符号变更 |
| `PricingParamsSet(address indexed asset, uint32 twapWindow, uint16 maxDeviationBps)` | 定价参数变更 |
| `AssetMintPausedSet(address indexed asset, bool paused)` | 该资产铸造暂停 / 恢复 |

### 3.2 凭证合约（可赎回型与销毁型共有）

| 事件 | 含义 |
|---|---|
| ERC-1155 `TransferSingle(operator, from, to, id, value)` / `TransferBatch(...)` | **持仓的唯一依据**。`from == 0` 是铸造，`to == 0` 是销毁（赎回、换新）。按 (合约, id, 地址) 累加即得持仓 |
| ERC-1155 `ApprovalForAll(account, operator, approved)` | 用户对交易合约 / 抵押合约的授权状态 |
| `BatchCreated(uint256 indexed id, address indexed asset, uint256 assetPerCert, uint256 mintPrice1e18)` | 新批次，记录批次表 |
| `Minted(address indexed to, address indexed asset, uint256 indexed id, uint256 n, uint256 assetIn)` | 铸造明细：给谁、几张、收了多少资产（`mintToMany` 每个收款人一条，`assetIn` 是该收款人份额） |
| `MintPausedSet(bool paused)` | 合约级铸造开关 |

可赎回型专有：

| 事件 | 含义 |
|---|---|
| `Redeemed(address indexed from, uint256 indexed id, uint256 n, uint256 assetOut)` | 赎回：烧 n 张，退回 `assetOut` 资产 |
| `Rolled(address indexed user, uint256 indexed idOld, uint256 indexed idNew, uint256 n, uint256 m, uint256 refund)` | 换新：旧批次 n 张换成新批次 m 张，多余资产 `refund` 退回。**换新会先发一条 `Redeemed` 再发 `BatchCreated`、`Minted`**，统计"用户赎回"时要用 `Rolled` 把这组事件剔掉 |

销毁型专有：

| 事件 | 含义 |
|---|---|
| `Burned(address indexed asset, address indexed payer, uint256 requested, uint256 burned)` | `requested` 是按报价应收的数量，`burned` 是 dead 地址实际增加的数量：带转账税的代币会少（扣两次税），合约里有别人转进来的灰尘时会多（一并烧掉）。展示"销毁了多少"用 `burned` |

### 3.3 交易合约 `CertificateMarket`

| 事件 | 含义 |
|---|---|
| `Listed(uint256 indexed listingId, address indexed seller, address indexed certificate, uint256 id, uint256 amount, uint256 unitPrice, address currency)` | 新挂单；`currency == address(0)` 是 BNB |
| `PriceUpdated(uint256 indexed listingId, uint256 unitPrice)` | 改价 |
| `Cancelled(uint256 indexed listingId, uint256 returned)` | 撤单，退回 `returned` 张 |
| `Purchased(uint256 indexed listingId, address indexed buyer, uint256 amount, uint256 cost, uint256 fee)` | 成交：买家付 `cost`，其中 `fee` 给平台，卖家得 `cost - fee`。**事件里没有卖家和凭证信息，用 `listingId` 关联 `Listed`** |
| `PaymentDeferred(address indexed account, address indexed currency, uint256 amount)` | 某笔付款推送失败，记入待提取，收款方需要调 `withdraw(currency)` |
| `Withdrawn(address indexed account, address indexed currency, uint256 amount)` | 待提取已领取 |
| `FeeSet`、`PaymentTokenSet(address indexed token, bool allowed)`、`PausedSet(bool)` | 参数 |

挂单状态机：`Listed` → ACTIVE；每次 `Purchased` 扣减 `remaining`，减到 0 → FILLED；`Cancelled` → CANCELLED。随时可用 `market.listing(id)` 校验：

```solidity
struct Listing { address seller; Status status; address certificate; address currency; uint256 id; uint256 remaining; uint256 unitPrice; }
// Status: 0 NONE（不存在）, 1 ACTIVE, 2 FILLED, 3 CANCELLED
market.listingCount()                  // 挂单总数，id 从 1 到它
market.pending(account, currency)      // 待提取余额
market.feeBps() / market.treasury() / market.paused() / market.isPaymentToken(token)
```

### 3.4 抵押合约 `CertificatePledge`

| 事件 | 含义 |
|---|---|
| `Pledged(address indexed user, address indexed certificate, uint256 indexed id, uint256 amount)` | 抵押 |
| `Redeemed(address indexed user, address indexed certificate, uint256 indexed id, uint256 amount)` | 取回 |
| `WhitelistSet(address indexed certificate, bool allowed)`、`PausedSet(bool)` | 参数 |

持仓 = Σ `Pledged` − Σ `Redeemed`，按 (用户, 凭证合约, 批次) 分组。**必须同时扣掉 `Redeemed`**，否则"抵押后立刻取回"能刷数据；如果以后要按抵押时长发权益，按时间加权。校验用 `pledge.pledgedOf(user, certificate, id)` 和 `pledge.totalPledged(certificate, id)`。

### 3.5 索引要点

- 凭证在交易合约里托管或在抵押合约里抵押时，ERC-1155 持仓在那两个合约名下；给用户展示"我的凭证"要把三处加起来：钱包里的、挂单中的（`Listed` 减去成交与撤单）、抵押中的。
- 事件里的价格和数量都是原始单位，展示时按 `assetDecimals`、币种小数位换算。
- 新登记的凭证合约通过 `CertificateRegistered` 发现，要动态加监听；市场和抵押合约只接受管理合约登记过的凭证。
- 起始区块用部署时的区块号；三个代理的地址永不变，升级只换逻辑。

## 4. 铸造凭证

铸造不收任何手续费，用户只付凭证对应的资产。

### 4.1 报价

```solidity
address asset = ...;                              // 已登记资产
AssetConfig cfg = registry.config(asset);         // cfg.mintPaused 为 true 时不能铸
ICertificate cert = ICertificate(cfg.certificate);
require(!cert.mintPaused());
(uint256 assetAmount, uint256 spot) = cert.oracle().quoteForFaceValue(asset, cert.faceValue());
uint256 perCert = assetAmount + 1;                // 合约会向上加 1 wei
uint256 assetIn = n * perCert;                    // 铸 n 张要付的资产，铸造不收手续费
// spot 是当时价格，用于展示
```

`quoteForFaceValue` 是 view。V3 资产在现货偏离 TWAP 超过 `maxDeviationBps` 时会回滚 `PriceDeviationTooHigh(asset, spot, twap, maxDeviationBps)`，前端提示"价格波动过大，稍后再试"。V2 资产没有这道闸。实际执行时价格可能和报价略有差异，可赎回型多锁的资产赎回时原样拿回，销毁型用 `maxAssetIn` 兜底。

### 4.2 可赎回型

```solidity
IERC20(asset).approve(address(cert), assetIn);
(uint256 id, uint256 assetIn) = RedeemableCertificate(cert).mint(n, to);
// 一批次分给多个地址，调用方付全部资产：
(uint256 id, uint256 assetIn) = RedeemableCertificate(cert).mintToMany(tos, ns);
```

`to` 若是合约必须实现 `onERC1155Received`。带转账税的代币会因到账不足回滚 `InsufficientReceived(expected, received)`。

### 4.3 销毁型

```solidity
IERC20(asset).approve(address(burnCert), assetIn);
uint256 maxAssetIn = assetIn * 102 / 100;          // 用户接受的最大支出，例如报价上浮 2%
(uint256 id, uint256 assetIn, uint256 burned) = burnCert.mint(asset, n, to, maxAssetIn);
burnCert.mintBatch(assets[], ns[], to, maxAssetIns[]);   // 多种资产各开一个批次，每种一个上限
burnCert.mintToMany(asset, tos[], ns[], maxAssetIn);     // 一批次分发
```

执行时报价超过 `maxAssetIn` 回滚 `AssetInAboveLimit(asset, assetIn, maxAssetIn)`。**前端必须传报价，不要传 `type(uint256).max`**，那等于放弃保护。代币被转到 `0x…dEaD`，合约不留任何余额；代币若把 dead 地址的转账吞掉或改道，回滚 `BurnIncomplete(asset)`。

### 4.4 铸造相关错误

| 错误 | 含义 |
|---|---|
| `MintPaused()` | 该凭证合约整体暂停铸造 |
| `AssetMintPaused(asset)` | 该资产在管理合约里暂停铸造 |
| `AssetNotAssigned(asset, certificate)` | 资产不归这个凭证合约，去 `registry.config(asset).certificate` 找对的 |
| `AssetNotSupported(asset)` | 资产没登记 |
| `ZeroAmount()` / `EmptyArray()` / `LengthMismatch()` | 入参问题 |
| `PriceDeviationTooHigh(...)` | V3 现货偏离 TWAP 过大 |
| `InsufficientReceived(expected, received)` | 可赎回型收到的代币不足（带税代币） |
| `AssetInAboveLimit(asset, assetIn, max)` | 销毁型报价超过用户上限 |
| `BurnIncomplete(asset)` | 销毁型代币没有到达 dead 地址 |
| ERC-20 的 `ERC20InsufficientAllowance` 等 | 授权或余额不足 |

## 5. 赎回凭证换回代币 / 股票（只有可赎回型）

```solidity
uint256 assetOut = cert.redeem(id, n, to);            // 烧 n 张，退回 n × assetPerCert 的资产给 to
uint256[] memory outs = cert.redeemBatch(ids[], ns[], to);
```

- 退回数量是**铸造时锁定的数量**，与当前价格无关；同一批次每张一样，不同批次不同，用 `batch(id).assetPerCert` 提前算给用户看。
- 赎回不读价格、不能被任何开关暂停，只要求调用者手里有这些凭证。挂单中、抵押中的凭证要先撤单 / 取回。
- 底层是 bStocks 这类合规代币时，如果代币方暂停了转账或拉黑了金库地址，转账会失败，赎回暂时不可用，这是代币方的限制。
- `to` 不要填交易合约或抵押合约地址，转过去的代币取不回来。

换新（可选功能）：`(idNew, m, refund) = cert.roll(idOld, n)`，把旧批次 n 张按当前价格换成新批次 m 张，多余资产退回。价格没变时 m == n、refund == 0。受铸造暂停开关影响。

销毁型凭证不能赎回，`Burned` 事件和 `batch(id)` 就是销毁证明。

## 6. 抵押与取回凭证（`CertificatePledge`）

抵押只是托管记账，不发放任何东西；后台从事件读用户抵押信息（§3.4）。

```solidity
// 一次性授权（每个凭证合约各一次）
cert.setApprovalForAll(address(pledge), true);

struct Entry { address certificate; uint256 id; uint256 amount; }
pledge.pledge(entries);    // 只能给自己抵押，可跨合约跨批次
pledge.redeem(entries);    // 只能取回自己的，退回自己地址；不受暂停和白名单影响
pledge.isWhitelisted(certificate);   // 只有白名单里的凭证合约能抵押
pledge.pledgedOf(user, certificate, id);
```

错误：`PledgePaused()`（暂停抵押，取回不受影响）、`CertificateNotWhitelisted(certificate)`、`InsufficientPledged(certificate, id, pledged)`、`ZeroAmount()`、`EmptyArray()`、ERC-1155 的授权 / 余额错误。直接 `safeTransferFrom` 到抵押合约会被 `DirectTransferNotAllowed()` 拒绝，必须走 `pledge`。

## 7. 挂单卖凭证（`CertificateMarket`）

```solidity
cert.setApprovalForAll(address(market), true);     // 每个凭证合约各一次

struct ListingInput { address certificate; uint256 id; uint256 amount; uint256 unitPrice; address currency; }
uint256[] memory listingIds = market.list(items);
```

- 一条挂单 = 同一批次 `amount` 张按同一单价 `unitPrice` 出售；同一批次要卖不同价就拆成多条。凭证转入交易合约托管。
- `currency`：`address(0)` 是 BNB，`registry.usdt()` 是 USDT；其他 ERC-20 要 owner 先 `setPaymentToken` 允许。`unitPrice` 是币种原始单位（BNB 为 wei，USDT 为 18 位）。
- 手续费按**成交时**的 `market.feeBps()` 从卖家所得里扣，卖家净得 `unitPrice × amount × (1 − feeBps/10000)`，买家付的永远是 `unitPrice × amount`。费率上限 10%。
- 改价：`market.updatePrice(listingId, newUnitPrice)`；撤单：`market.cancel(listingIds[])`，退回未卖出的张数，暂停期间也能撤。
- 收款：BNB 和 ERC-20 都是成交时直接推给卖家。推送失败（卖家是拒收 BNB 的合约、`receive` 超过 20000 gas、被代币拉黑）会发 `PaymentDeferred`，卖家自己调 `market.withdraw(currency)` 领取，`market.pending(seller, currency)` 能查。合约钱包卖家要在界面上给出提款入口。
- 挂单后授权仍然有效，可以提示用户卖完后 `setApprovalForAll(market, false)`。

错误：`MarketPaused()`（暂停挂单和购买）、`CertificateNotRegistered(certificate)`、`CurrencyNotAllowed(currency)`、`ZeroAmount()`、`ZeroPrice()`、`ListingNotActive(listingId)`、`NotSeller(listingId)`、`NothingToWithdraw()`、`PaymentFailed()`（BNB 提款时自己的地址拒收）。

## 8. 买凭证

```solidity
Listing memory l = market.listing(listingId);      // 读到 certificate、id、currency、unitPrice、remaining
struct Purchase { uint256 listingId; address certificate; uint256 id; uint256 amount; uint256 maxUnitPrice; }
// certificate 和 id 填挂单当前的值，maxUnitPrice 填当前展示价：卖家抢先涨价时保护买家，重组后挂单号指向别的东西时不会误买

// 用 USDT：
IERC20(usdt).approve(address(market), total);       // total = Σ unitPrice × amount
uint256 spent = market.buy(usdt, items, allOrNothing);
// 用 BNB：
uint256 spent = market.buy{value: total}(address(0), items, allOrNothing);   // 多付的部分自动退回
```

- 一次购买只能用一种币种，篮子里所有挂单都必须以它计价，否则 `CurrencyMismatch(listingId)`。混合币种由前端拆成两笔。
- `allOrNothing = true`：任一条不能按要求成交（已关闭、凭证不符、超过价格上限、数量不够）就整笔回滚，分别报 `ListingNotActive`、`ListingMismatch`、`PriceAboveLimit(listingId, unitPrice)`、`InsufficientRemaining(listingId, remaining)`。
- `allOrNothing = false`：能买多少买多少，不能成交的跳过，数量不够的按剩余成交，只付实际成交的钱；一条都没成交才回滚 `NothingPurchased()`。前端可以先 `eth_call` 模拟一次拿到实际会花多少。
- BNB 不够报 `InsufficientPayment(required, provided)`；ERC-20 购买带了 BNB 报 `UnexpectedValue()`。
- 买家若是合约，必须实现 `onERC1155Received`，否则整笔回滚。
- 成交后凭证直接到买家钱包，`Purchased` 事件里 `cost` 是买家实付，`fee` 是平台份额。

## 9. 后台管理：添加新的凭证合约与资产

管理操作都由 `AssetRegistry` 的 owner（上线时应是多签）执行，仓库里有对应的 Foundry 脚本，环境变量见各脚本头部注释。

### 9.1 新增一种可赎回资产（股票、代币、不销毁的 meme）

每种可赎回资产一个凭证合约实例，名称和符号构造时写死，之后不能改。

```bash
OWNER=<多签> REGISTRY=<管理合约代理> ORACLE=<PriceOracle> ASSET=<代币地址> \
NAME="Apple Stock Certificate" SYMBOL="AAPLB-C" ASSET_SYMBOL=AAPLB \
KIND=0 SOURCE=0 FEE=2500 TWAP_WINDOW=600 MAX_DEV_BPS=200 \
forge script script/DeployRedeemableCertificate.s.sol --tc DeployRedeemableCertificate --rpc-url $RPC --broadcast --private-key $OWNER_KEY
```

脚本做三件事：部署 `RedeemableCertificate(owner, registry, oracle, asset, name, symbol)`；`registry.registerCertificate(cert, REDEEMABLE)`；`registry.addAsset(params)`。手工调用时顺序相同。参数含义：

| 参数 | 含义 |
|---|---|
| `KIND` | 0 股票，1 代币，2 meme；只是分类，不影响逻辑 |
| `SOURCE` | 0 用 V3 池（`FEE` 是费率档，bStocks 是 2500），1 用 V2 交易对（`FEE` 忽略）。管理合约通过 factory 反查资产 / USDT 的池子，找不到报 `PoolNotFound` |
| `TWAP_WINDOW` | V3 的 TWAP 窗口秒数，60 到 86400；V2 不生效但仍要在范围内 |
| `MAX_DEV_BPS` | V3 现货偏离 TWAP 的上限 bps，1 到 5000；V2 不生效 |
| `ASSET_SYMBOL` | 管理员指定的展示符号，不信任代币自己的 `symbol()`；最长 64 字节，不能含引号、反斜杠、控制字符 |

约束：一个可赎回凭证合约只能服务它构造时绑定的那一个资产（`CertificateAssetMismatch`、`CertificateFull`）；一个资产只能登记一次（`AssetAlreadyRegistered`）；登记后不能更换价格源或凭证合约，只能暂停。

### 9.2 新增一种销毁型资产（销毁的 meme）

销毁型共用一个 `BurnCertificate`，首次部署一次：

```bash
OWNER=... REGISTRY=... ORACLE=... NAME="Burn Certificate" SYMBOL="BURN-C" \
forge script script/DeployBurnCertificate.s.sol --tc DeployBurnCertificate --rpc-url $RPC --broadcast --private-key $OWNER_KEY
```

之后每加一种销毁型资产只需登记，指向这个合约：

```bash
REGISTRY=... ASSET=<meme 地址> ASSET_SYMBOL=<符号> CERTIFICATE=<BurnCertificate> \
KIND=2 SOURCE=1 FEE=0 TWAP_WINDOW=1800 MAX_DEV_BPS=200 \
forge script script/AddAsset.s.sol --tc AddAsset --rpc-url $RPC --broadcast --private-key $OWNER_KEY
```

### 9.3 登记前的检查清单

管理合约不做流动性和代币行为的校验，这些是登记前的人工责任：

- **流动性**：V2 资产按当前储备定价，没有 TWAP 闸，一笔闪电贷就能把薄池子的价格推到任意位置再铸凭证。只登记流动性足够深、有套利机器人盯着的交易对；能用 V3 池的优先用 V3（有 TWAP 闸）。
- **V3 池的观测容量**：新池子 observation cardinality 为 1 时 `observe` 会回滚，先对池子调一次无需权限的 `increaseObservationCardinalityNext`（例如 300）。
- **代币行为**：小数位不要超过 36；可赎回型不能是带转账税的代币（到账不足会回滚）；销毁型要在测试网或 fork 上试一笔 `mint`，确认代币允许向 `0x…dEaD` 转账且真的到达（反射型代币可以，改道或吞掉转账的不行）；不要用 rebase 代币。
- **bStocks 合规**：代币方可能暂停转账或拉黑地址，金库被拉黑时赎回会失败，属于代币方风险，要在产品条款里说明。

### 9.4 其他管理操作

| 操作 | 调用 | 说明 |
|---|---|---|
| 暂停某资产铸造 | `registry.setMintPaused(asset, true)` | 只影响铸造，赎回照常 |
| 暂停某凭证合约全部铸造 | `cert.setMintPaused(true)` | 同上 |
| 改展示符号 | `registry.setAssetSymbol(asset, symbol)` | |
| 改 V3 定价参数 | `registry.setPricingParams(asset, window, devBps)` | |
| 交易手续费 | `market.setFee(feeBps, treasury)` | 上限 10%，按成交时费率从卖家所得扣；平台地址不能是交易合约自己，且要能收 BNB（20000 gas 内）或自己会调 `withdraw` |
| 交易币种 | `market.setPaymentToken(token, allowed)` | 只允许无税、不 rebase、无黑名单、不可暂停的普通 ERC-20；停用只挡新挂单 |
| 暂停交易 / 抵押 | `market.setPaused(true)`、`pledge.setPaused(true)` | 撤单、提款、取回不受影响 |
| 抵押白名单 | `pledge.setWhitelisted(certificate, allowed)` | 加入时要求已在管理合约登记；移除只挡新抵押 |
| 部署交易 / 抵押合约 | `script/DeployMarket.s.sol`（OWNER、REGISTRY、TREASURY、FEE_BPS）、`script/DeployPledge.s.sol`（OWNER、REGISTRY、可选 WHITELIST） | |
| 升级三个代理 | `script/UpgradeRegistry.s.sol`、`UpgradeMarket.s.sol`、`UpgradePledge.s.sol` | 由 owner 广播；升级前做存储布局比对，代理 owner 应是多签加时间锁。升级权等于对托管资产和用户授权的完全控制权 |
| 转让 owner | `transferOwnership(new)` 后由新 owner `acceptOwnership()` | 两步转让；不要调 `renounceOwnership` |

### 9.5 前端 / 后台上线前要知道的边界

- 凭证的"10 USDT"是铸造时的面值，不是保证价值；展示时以 `assetPerCert` 和当前价为准。
- V2 资产的铸造价格是当时区块的现货，可以被同一区块的交易影响，这是产品决定；不要在任何地方按"张数"或"面值"发放权益。
- 用户给交易合约、抵押合约的 `setApprovalForAll` 不会过期，界面上提供撤销入口。
- 合约钱包用户：接收凭证要实现 `onERC1155Received`；卖凭证收 BNB 若 `receive` 超过 20000 gas 会转为待提取。
- 换新（`roll`）在事件上表现为一次赎回加一次铸造，统计时用 `Rolled` 区分。

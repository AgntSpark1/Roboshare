# 第五阶段报告：Aave 只读数据

日期：2026-10-09　分支：`phase5/aave-readonly`（基于 `phase3/backend`）

## 1. 做了什么

- **地址来源。** Aave V3 在 BNB 链上的合约地址，从官方 BGD Labs 地址簿复制而来（`bgd-labs/aave-address-book`，提交 `6a83d118`，文件 `src/AaveV3BNB.sol`）。读取接口按 `aave-dao/aave-v3-origin`（提交 `8305565a`）的接口定义编写。代码位置是 `packages/shared/src/aave.ts`。
- **USDT 地址的第二个来源。** 同一份地址簿把 `0x55d398326f99059fF775485246999027B3197955` 列为 Aave 的 USDT 储备，小数位是 18。这和我们之前写的平台 USDT 地址一致。但它仍然只是文档来源，还没有在链上核实。
- **读取器**（`apps/worker/src/aave.ts`）每次读取前都会做下面这些检查，任何一项不通过就直接报错，不会发布数据：
  - 当前链 ID 必须是 56。
  - 4 个合约地址都必须有代码。
  - `PoolAddressesProvider` 当前指向的 Pool、Oracle、数据合约，必须和地址簿一致。
  - 白名单里的每个资产都必须是该 Pool 的储备，并且小数位和白名单一致。
- **读取的数据：** 白名单资产（USDT、USDC、FDUSD、WBNB、BTCB、ETH）的状态、抵押率、上限、总存款、总借款、存借利率和预言机价格。所有数据都固定在同一个区块读取，并记录区块号和区块哈希。
- **运行方式：** 设置 `AAVE_RPC_URL`（BSC 主网 RPC）后，worker 每 5 分钟读一次并保存快照。这个配置和平台自身所在的链相互独立。
- **接口：** `GET /api/v1/aave/markets` 返回最新的已验证快照。返回内容标明只读，附带数据来源地址、区块号、是否过期，以及“这是第三方市场数据，不是 RoboShare 的收益”的说明。
- **不包含任何交易功能。** 没有存款、借款或授权相关的代码。

## 2. 测试（实际运行）

- 用 TEST-ONLY 的模拟 Aave 合约，在本地 anvil 链上测试读取器，5 个测试全部通过：
  - 正常读取。
  - 链 ID 不对时拒绝。
  - 地址上没有代码时拒绝。
  - Provider 指向别的 Pool 时拒绝。
  - 资产不在储备里、或小数位不一致时拒绝。
- API 新增 1 个测试，通过。
- 全部测试：
  - 共享包 8 个、API 20 个、worker 10 个，全部通过。
  - 合约 91 个通过，另有 1 组分叉测试被跳过（原因见下一节）。

## 3. 没能验证的

- `contracts/test/fork/AaveBnb.fork.t.sol` 会在 BSC 主网分叉上核对上面这些地址，以及 USDT 的小数位。沙盒访问 BSC RPC 被拦截（返回 403），所以这组测试**没有运行**。路线图要求这组测试通过，因此第五阶段的退出条件还差这一项。
- 在能联网的机器上运行：`BSC_RPC_URL=<RPC 地址> forge test --match-path 'test/fork/*'`。

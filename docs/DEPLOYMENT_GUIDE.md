# RoboShare — 部署指南

状态：**草案（DRAFT，第 1 阶段）。** 流程设计。尚未进行任何部署。此处引用的脚本将在第 2/6 阶段编写。**主网（chain ID 56）部署需要明确的书面批准，并完成 SECURITY_MODEL §7 中规定的各项审查。**

## 1. 环境

| 环境 | 链 | 用途 |
|---|---|---|
| local | anvil (31337) | 开发、测试 |
| fork | 分叉 BSC 测试网或主网的 anvil | 模拟、读取 Aave 数据 |
| testnet | BNB Smart Chain（BSC）测试网 (97) | 集成、彩排 |
| mainnet | BNB Smart Chain（BSC）(56) | 生产环境，仅在获批后使用 |

## 2. 前置条件

- Foundry（固定版本）、Node 22、pnpm、Docker。
- 目标链的 RPC 端点（两个提供商），通过环境变量提供，绝不提交到代码库。
- 部署者密钥：仅用于部署的全新密钥，仅充值足以支付 gas 的 BNB。在主网上，优先使用硬件钱包（`--ledger`）或通过 Safe 进行部署。
- 在目标链上为治理、守护者（Guardian）、运营方、审核人创建 Safe 多签；签名人地址记录在部署配置中。
- 目标链的 USDT（BEP20）地址（D-22）：主网从官方来源获取并在 BscScan 上核对，部署脚本从链上读取 `symbol` 和 `decimals` 并与预期比对，不一致则拒绝部署。测试网部署标注 TEST-ONLY 的模拟 USDT。
- 用于合约验证的 BscScan API 密钥（仅限环境变量）。

## 3. 配置

`contracts/script/config/<chainId>.json`（提交到代码库，**仅包含公开地址**）：

```json
{
  "chainId": 97,
  "governanceSafe": "0x…",
  "guardianSafe": "0x…",
  "operator": "0x…",
  "reviewerSafe": "0x…",
  "complianceRelayer": "0x…",
  "timelockDelaySeconds": 86400,
  "usdt": "0x…"
}
```

如果任一地址为零地址、`block.chainid` 与 `chainId` 不一致，或 `chainId == 56` 但未设置 `CONFIRM_MAINNET=yes`，部署脚本将拒绝运行。

密钥（仅限环境变量）：`DEPLOYER_PRIVATE_KEY`（仅限测试网）或 `--ledger`、`BSC_RPC_URL`、`BSCSCAN_API_KEY`。

## 4. 合约部署步骤

```bash
cd contracts
forge build
forge test
# 1. Simulate (no broadcast)
forge script script/Deploy.s.sol --rpc-url $BSC_RPC_URL
# 2. Broadcast + verify (testnet)
forge script script/Deploy.s.sol --rpc-url $BSC_RPC_URL --broadcast --verify
```

该脚本将：
1. 部署 `TimelockController`（proposer/executor = 治理 Safe，canceller = 守护者 Safe，admin = 无）。
2. 部署 `IdentityRegistry`、`AssetRegistry`、`AuditRegistry`、`ProjectFactory`。
3. 按照 SECURITY_MODEL §1 授予角色。
4. 将 `DEFAULT_ADMIN_ROLE` 转移给时间锁，并放弃部署者的所有角色。
5. 在链上断言：部署者不持有任何角色；时间锁持有 admin 角色；每个角色持有者均与配置一致。
6. 根据广播输出（地址、区块号、交易哈希）写入 `infra/deployments/<chainId>.json`。该文件是应用获取地址的唯一来源。

按项目部署（在项目进入 VERIFIED 状态后）：治理通过时间锁调度 `ProjectFactory.deployProject(...)`；延迟期满后执行。随后通过同一路径配置并开启募集。

## 5. 应用部署

1. 配置 Postgres（启用 PITR）、Redis、私有存储桶（SSE-KMS、版本控制、对象锁定）。
2. 运行迁移：`pnpm --filter db prisma migrate deploy`。
3. 使用密钥存储中的环境变量部署 API 和 worker 容器。启动时会校验配置，并拒绝缺失或为零的地址。
4. 从每个合约的部署区块开始启动索引器；等待追平；运行对账。
5. 部署 Web 应用，并配置该环境的链白名单。
6. 冒烟测试：健康检查端点、公开项目列表、使用测试网钱包进行 SIWE 登录。

## 6. 部署后检查

- 合约已在 BscScan 上完成验证。
- 角色持有者与配置一致（也可在 `/contracts` 页面查看）。
- 索引器延迟在阈值以内；对账无异常。
- 在测试网上触发测试性 `Paused` 事件时，监控告警正常触发。

## 7. 回滚

合约无法回滚。对于应用发布：重新部署上一个镜像；迁移必须对前一个版本保持向后兼容。对于尚未开启募集的有缺陷项目部署：取消该项目并部署一个新项目。

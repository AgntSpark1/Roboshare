# RoboShare — 部署指南

状态：第 6 阶段更新（2026-10-10）。本文描述的是**代码里实际实现的**部署流程。
**尚未部署到任何测试网或主网。主网（chain ID 56）部署需要 Charlene 明确的书面批准，并完成 §8 的上线前置条件。**

## 1. 环境

| 环境 | 链 | 用途 | 当前状态 |
|---|---|---|---|
| local | anvil (31337) | 开发、测试、部署彩排 | 测试中使用 |
| testnet | BSC 测试网 (97) | 集成、彩排 | 未部署 |
| mainnet | BSC 主网 (56) | 生产 | 未部署，需批准 |

## 2. 前置条件

- Foundry v1.5.1、solc 0.8.30、Node 22、pnpm 10.28.0、Postgres 16、Redis 7。
- 目标链 RPC（建议两个提供商），只放在环境变量里，绝不提交。
- 部署者账户：全新、只用于部署、只充值少量 gas 用的 BNB。主网用硬件钱包（`--ledger`）。
- 在目标链上先创建 2/3 Safe 多签（D-16），并准备运营方、审核人、暂停人、合规代理、手续费接收这几个地址。
- USDT（BEP20）地址（D-22）：主网必须在 BscScan 上核对官方地址，部署脚本会检查小数位必须为 18。测试网不传 `USDT` 时，脚本会部署 TEST-ONLY 的 `MockUSDT`（该合约在 56 链上会直接报错）。

## 3. 配置（环境变量）

`contracts/script/Deploy.s.sol` 从环境变量读取地址，任何一个为空或零地址都会拒绝部署：

| 变量 | 含义 |
|---|---|
| `SAFE` | 2/3 多签，时间锁唯一的提案人和执行人 |
| `OPERATOR` | 运营方（登记项目、提交报告、提交分配批次） |
| `REVIEWER` | 审核人（审批项目、报告、分配批次；不能是提交人本人） |
| `PAUSER` | 紧急暂停 |
| `COMPLIANCE_AGENT` | 设置投资者资格（目前由运营人工设置，见 §8） |
| `FEE_RECIPIENT` | 手续费接收地址（每个项目部署后不可修改） |
| `USDT` | 主网必填；测试网留空则部署 TEST-ONLY 模拟币 |
| `CONFIRM_MAINNET` | 主网必须等于 `I_UNDERSTAND_THIS_IS_MAINNET` |

## 4. 合约部署步骤

```bash
cd contracts
forge build && forge test && FOUNDRY_PROFILE=ci forge test

# 1. 模拟（不广播）
forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --sender "$DEPLOYER"

# 2. 测试网广播 + 验证（需要 Charlene 同意后再做）
forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --verify --ledger --sender "$DEPLOYER"
```

脚本实际做的事：

1. 部署 `TimelockController`，延迟 24 小时，提案人和执行人都只有 `SAFE`，没有管理员。
2. 部署 `IdentityRegistry`、`AssetRegistry`、`AuditRegistry`、`SubscriptionRouter`、`ProjectFactory`（含三个部署辅助合约）。
3. 授予运营、审核、暂停、合规代理、工厂角色。
4. 把所有合约的管理员角色交给时间锁，部署者放弃管理员角色。
5. 在同一次执行里逐项核对：时间锁是各合约管理员、部署者已无权限、时间锁延迟为 24 小时、Safe 是提案人和执行人、路由使用的 USDT 正确且有代码。任一项不符就整体回滚。

部署后，把 `broadcast/Deploy.s.sol/<chainId>/run-latest.json` 里的地址和部署区块填入后端环境变量（`ASSET_REGISTRY`、`AUDIT_REGISTRY`、`IDENTITY_REGISTRY`、`SUBSCRIPTION_ROUTER`、`PROJECT_FACTORY`、`REFERRAL_REWARDS`、`TIMELOCK`、`START_BLOCK`、`PAYMENT_TOKEN`）。不要手抄，不要用占位地址。

按项目部署：项目在 `AssetRegistry` 里变成 VERIFIED 后，由后端 `/admin/.../prepare` 接口生成时间锁 `schedule` 调用数据，Safe 签名提交；24 小时后再提交 `execute`。配置并开启募集走同一路径。

## 5. 本地部署彩排

```bash
./scripts/local-deploy-sim.sh
```

在本地 anvil 上用解锁账户（不需要任何私钥）执行完整部署脚本，再用 `cast` 从链上核对：时间锁延迟、管理员归属、部署者已不能授予权限。

完整业务流程（登记 → 审核 → 部署项目 → 募集 → 结算 → 报告 → 分配 → 领取）由 `apps/worker/test/indexer.e2e.test.ts` 在 anvil 上实际跑过，并核对了数据库与链上状态一致。

## 6. 应用部署

1. 准备 Postgres（开启时间点恢复）、Redis。
2. 迁移：`pnpm db:migrate`（即 `prisma migrate deploy`）。
3. 部署 API 和 worker，环境变量来自密钥管理服务。生产环境必须设置 `SESSION_SECRET`（≥32 字节随机）、`TOTP_ENC_KEY`（32 字节十六进制），否则 API 拒绝启动。
4. worker 从 `START_BLOCK` 开始索引，只处理已确认区块（默认 15 个确认），追平后运行对账。
5. 运营和审核人员用 `apps/api/src/scripts/enroll-staff.ts` 绑定 TOTP 二次验证。
6. 冒烟测试：`/health`、项目列表、测试网钱包 SIWE 登录。

## 7. 部署后检查与回滚

- 合约在 BscScan 上完成源码验证。
- 角色持有人与配置一致（`/contracts` 接口可查）。
- 索引器延迟正常，对账无异常。
- 合约不能回滚。有缺陷但尚未开募的项目：取消并重新部署新项目。应用发布：回退到上一个镜像，迁移需向后兼容。

## 8. 上线前置条件（主网或任何公开募集之前必须全部满足）

1. **接入真实 KYC/AML 服务商。** 2026-10-09 Charlene 决定暂不接 KYC，等项目正常运营后再加。在此之前：
   - 合约里的资格登记和转让限制保留不变；
   - 投资者资格只由运营人员通过 `COMPLIANCE_AGENT` 角色人工设置，**仅用于测试和内部演示**；
   - 平台**没有做任何真实的 KYC/AML 审查**，不得向公众募集。
2. 第三方合约审计完成，高/中风险问题全部修复。
3. 在 BscScan 上核对 USDT 地址；在 BSC 测试网确认 Cancun 操作码可用。
4. 用 soliditylang.org 官方校验值核对 solc 0.8.30 二进制（本沙盒无法访问该网站）。
5. Safe 签名人、时间锁流程在测试网完整演练一次。
6. 法律意见：份额的法律性质（D-1 合同收益权）在目标司法辖区可合法发售。
7. Charlene 书面批准主网部署。

# RoboShare — 测试指南

状态：**草案（DRAFT，Phase 1）。** 仅为测试计划。目前尚无任何测试，也未运行过任何测试。编写测试后，本指南将记录确切的命令及运行这些测试的 CI 作业。

## 1. 测试层级

| 层级 | 工具 | 位置 |
|---|---|---|
| 合约单元/集成测试 | Foundry `forge test` | `contracts/test/unit`、`contracts/test/integration` |
| 合约模糊测试 | Foundry 模糊测试 | `contracts/test/fuzz` |
| 合约不变量测试 | 带 handler 的 Foundry 不变量测试 | `contracts/test/invariant` |
| 分叉测试（Aave） | `forge test --fork-url $BSC_RPC_URL` | `contracts/test/fork` |
| 静态分析 | Slither、solhint（可选 Aderyn） | CI |
| 共享 TS（费用计算） | Vitest + fast-check；与从 Solidity 测试导出的向量交叉核对 | `packages/shared` |
| API | Jest/Vitest + supertest，针对测试用 Postgres | `apps/api/test` |
| 工作进程 | Vitest + anvil（通过 `anvil_reorg` / 快照回滚模拟链重组（reorg）） | `apps/worker/test` |
| 前端组件 | Vitest + Testing Library + axe | `apps/web` |
| 端到端（E2E） | Playwright，针对 anvil + API + web | `e2e/` |
| 依赖/机密信息 | `pnpm audit`、OSV-Scanner、gitleaks | CI |

## 2. 必需的合约测试（源自需求说明）

| # | 用例 | 测试要点 |
|---|---|---|
| 1 | 未授权铸造 | 非铸造者调用 `mint` 回滚；铸造者只能绑定一次 |
| 2 | 供应量超过上限 | 已售数量将超过 100 时无法结算；超出上限的直接铸造回滚；对单位数进行模糊测试 |
| 3 | 重复登记项目 | 相同的 projectId 或 assetId 回滚 |
| 4 | 未授权转让 | 转给不合格方、从已冻结方转出、转给已冻结方、类别不被允许、状态错误；分别通过 `transfer` 和 `transferFrom` |
| 5 | 投资资格过期 | `vm.warp` 超过 `expiresAt` → 认购/转让回滚；除非被冻结，否则仍允许领取（D-13） |
| 6 | 重复分配批次 | 超出报告金额的第二个批次回滚；已有一个待处理批次时提出第二个提案回滚 |
| 7 | 分配额错误 | 表驱动向量，包括需求说明中的示例（10 个单位，15 %，D=10 000 → 850）及 TOKENOMICS §4.4 |
| 8 | 舍入尾差（dust） | 对 D 和持有人集合进行模糊测试；断言 Σnet+Σfee+dust == pool、dust < 持有人数、尾差被结转 |
| 9 | 空批次/零批次 | `amount == 0` 回滚；持有人为空回滚；持有人合计 < 供应量回滚 |
| 10 | 无效的生命周期转换 | 依据转换表对所有状态进行穷举两两测试 |
| 11 | 未授权管理操作 | 每个特权函数由每个未授权角色调用时均回滚 |
| 12 | 暂停行为 | 每个可暂停函数在暂停时回滚；仅管理员可解除暂停 |
| 13 | 无效的 Aave 配置 | 错误的链 ID、不匹配的 pool/oracle、非白名单资产回滚 |
| 14 | 意外的授权/支出 | 合约拉取的金额绝不超过计算值；转账收费（fee-on-transfer）模拟被拒绝；剩余授权额度不被使用 |
| 15 | 格式错误/未经核实的报告 | 引用 SUBMITTED、REJECTED、SUPERSEDED、其他项目或错误代币的批次回滚；自我批准回滚 |
| 16 | 重入/攻击路径 | 恶意 ERC-20 模拟重入 `claim`、`claimRefund`、`subscribe`；未排序/重复的持有人；未来区块的快照 |

## 3. 不变量

源自 [SMART_CONTRACT_SPEC.md §12](SMART_CONTRACT_SPEC.md)。Handler 随机执行：设置/撤销投资资格、认购、推进时间、结算/失败、转让、提出/批准/驳回批次、领取、暂停/解除暂停。

## 4. Foundry 配置（计划中）

```toml
[profile.default]
fuzz = { runs = 1000 }
invariant = { runs = 64, depth = 64 }

[profile.ci]
fuzz = { runs = 10000 }
invariant = { runs = 256, depth = 128 }
```

## 5. 命令（代码就绪后）

```bash
cd contracts
forge build
forge test -vvv
FOUNDRY_PROFILE=ci forge test
forge coverage --report summary
forge test --gas-report --match-contract RevenueDistributor
slither . --filter-paths "lib|test"
pnpm -r test
pnpm --filter web exec playwright test
```

## 6. 规则

- 只有在测试已实际执行且其输出已被记录后，才能称其为"通过"；各阶段总结须引用实际输出。
- 绝不为了让结果变绿而跳过或禁用测试。
- 模拟组件命名为 `Mock*`/`TestOnly*`，并置于测试目录下。

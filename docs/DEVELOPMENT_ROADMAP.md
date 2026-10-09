# RoboShare — 开发路线图

状态：**草案（DRAFT，Phase 1）。** 里程碑按依赖关系排序，而非按日历排序。每个阶段结束时须总结：变更内容、测试内容（附实际命令输出）、未完成事项，以及下一步要运行的命令。

## M0 — Phase 1：需求与架构 ✅ 已交付待审阅
- 交付物：`docs/*`（15 份文档 + PHASE1_ANALYSIS.md）。
- 退出条件：决策 D-1 … D-20 经审阅签核，尤其是标注 ⚠ 的事项。

## M1 — Phase 2：核心智能合约
顺序（每项在进入下一项前须完成测试）：
1. Foundry 脚手架、固定版本的 solc + OpenZeppelin 标签、带模糊测试/不变量测试配置的 `foundry.toml`、CI 作业。
2. `IdentityRegistry` + TEST-ONLY 模拟服务商辅助工具。
3. 带转换表的 `AssetRegistry`。
4. `AuditRegistry`。
5. `RwaShareToken`（上限、铸造者绑定、`_update` 限制、检查点）。
6. `OfferingManager`（托管、结算、失败、取消、退款）与 `SubscriptionRouter`（一次授权、按份额认购，USDT BEP20）。
7. `RevenueDistributor`（+ `FeeTiers` 库）。
8. `ProjectFactory`（或脚本化部署，视字节码大小而定）。
9. 面向 anvil 和链 97 的 `Deploy.s.sol`，附部署后角色断言。

退出条件：
- `forge build` 干净通过，除已记录的警告外无其他警告。
- `forge test` 全部通过：单元、集成、模糊测试（CI 配置下 ≥ 10 000 次运行）、不变量测试（深度 ≥ 100）。
- 提交 `forge coverage` 报告（目标：核心合约行覆盖率 ≥ 95 %）。
- 已运行 Slither，发现项在 `docs/security/slither-triage.md` 中分级处理。
- 针对 100 个持有人的 `proposeBatch` 的 Gas 报告。

## M2 — Phase 3：后端
1. Monorepo 脚手架（pnpm、Turborepo）、`packages/shared`（zod schema、费用计算 TS 镜像，并针对 Solidity 向量进行属性测试）、`packages/contracts-abi`。
2. Prisma schema + 迁移；数据库角色；compliance schema。
3. NestJS API：认证（SIWE）、公开、投资者、管理模块，守卫，DTO。
4. 工作进程：可处理链重组（reorg）的索引器、报告流水线、对账、合规中继器（开发环境使用 TEST-ONLY 模拟服务商）。
5. Docker Compose：Postgres、Redis、MinIO、anvil。

退出条件：API 端到端测试（supertest）全部通过；索引器通过脚本化的 anvil 链重组测试；对账能检测到注入的不一致。

## M3 — Phase 4：前端
1. 设计系统（Tailwind + shadcn/ui）、布局、无障碍基线。
2. 公开页面：落地页、概览、项目列表、项目详情、架构、运作方式、风险披露、文档、白皮书、常见问题。
3. 投资者仪表盘：投资资格、持仓、分配额、头寸、交易、分配、实际与预测对比、核验链接。
4. 管理后台：项目、文件、募集、合规、报告、分配、角色、审计历史、紧急控制（Safe 提案）。

退出条件：组件测试（Vitest + Testing Library）及在 anvil 上针对 认购 → 结算 → 报告 → 批次 → 领取 流程的 Playwright 端到端测试；axe 无障碍检查通过；不存在没有处理函数的按钮。

## M4 — Phase 5：Aave 只读适配器
1. 从官方来源（Aave 地址簿、治理提案）收集 Aave V3 在 BNB Smart Chain（BSC）上的地址，并在链上交叉核对（`PoolAddressesProvider.getPool()`、`getPriceOracle()`、数据提供合约的储备列表）。
2. 工作进程读取器 + 可选的 `AaveReader.sol`；链 ID 与地址检查；白名单。
3. 展示经验证市场数据的 UI 面板，附来源区块和地址。

退出条件：针对 BSC 主网状态的分叉测试（`forge test --fork-url`）通过；无效配置测试通过。在明确审查之前，交易类功能仍不在范围之内。

## M5 — Phase 6：安全与测试网部署
1. 完整测试套件、覆盖率、Slither/Aderyn、`pnpm audit`、OSV-Scanner、gitleaks。
2. 在 anvil 和 BSC 测试网分叉上进行部署模拟；然后在测试网上连同 Safe + 时间锁部署到链 97。
3. 在 BscScan 测试网上验证合约。
4. 在测试网上对完整生命周期进行彩排，包括暂停、被驳回的报告、失败的募集及退款。
5. 内部安全审查报告。

退出条件：测试网地址依据真实部署输出记录在 `infra/deployments/97.json` 中；审查报告已发布。

## M6 — 主网上线前（不在工程团队控制范围内）
- 独立审计；对权益文件 (Rights Document)、募集条款、披露内容的法律签核；已签约 KYC 服务商；运营就绪（值班、处置手册已演练）。
- 仅在获得明确书面批准后部署主网。

## 后续（未排期）
- Aave 交易类功能（单独审查）。
- 跨链（单独设计 + 审计）。
- 二级市场 / 过户代理集成。
- 多语言 UI（例如中文/英文）。

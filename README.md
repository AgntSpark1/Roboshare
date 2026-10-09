# RoboShare

RoboShare 是一个规划中的平台，用于在 BNB Smart Chain（BSC）上发行并管理针对单个 Robotaxi 车辆项目、具有法律定义的投资权益。

> **状态：第一阶段（需求与架构），等待评审。** 本仓库目前仅包含文档。尚不存在任何智能合约、后端或前端代码；没有任何内容经过编译、测试、部署或审计。本仓库中的任何内容均不构成证券要约。

## 功能（目标设计）

- 为每个车辆项目登记资产 ID、发行方引用、文档哈希，并强制执行生命周期。
- 为每个项目发行一个限制转让、采用 ERC-20 接口的代币：**100 个整数单位，decimals 为 0，上限不可更改**。
- 以白名单内的稳定币开展托管式募集（允许部分募集，最低成交量按项目设定）。
- 将财务报告锚定上链，强制要求提交人 ≠ 审核人，并在链上分配经核实的利润，采用分档的运营方费用和主动领取（pull）模式。
- 将链上状态索引到 PostgreSQL，支持链重组（reorg）处理与对账。
- 展示来自经核实的 BNB Smart Chain（BSC）部署的只读 Aave V3 市场数据（不进行自动存款）。

## 文档

| 文档 | 用途 |
|---|---|
| [docs/PHASE1_ANALYSIS.md](docs/PHASE1_ANALYSIS.md) | **从这里开始。** 需求分析、图表、假设、待决事项、仓库结构、工具 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系统组件、数据层级、索引、对账 |
| [docs/SMART_CONTRACT_SPEC.md](docs/SMART_CONTRACT_SPEC.md) | 合约模块、角色、函数、事件、不变量 |
| [docs/TOKENOMICS.md](docs/TOKENOMICS.md) | 单位结构、发行、费率档位、分配公式 |
| [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | PostgreSQL 实体与完整性规则 |
| [docs/API_SPEC.md](docs/API_SPEC.md) | 按可见性层级划分的 REST 端点 |
| [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) | 权限结构与控制措施 |
| [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) | 资产、参与者、威胁、缓解措施 |
| [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md) | 阶段划分与退出标准 |
| [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) | 测试计划与必需用例 |
| [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) | 部署流程（先测试网） |
| [docs/ADMIN_OPERATIONS.md](docs/ADMIN_OPERATIONS.md) | 运营方操作手册 |
| [docs/INCIDENT_RESPONSE.md](docs/INCIDENT_RESPONSE.md) | 事件严重级别与应对手册 |
| [docs/RISK_DISCLOSURES.md](docs/RISK_DISCLOSURES.md) | 投资者风险披露草案 |
| [docs/WHITEPAPER.md](docs/WHITEPAPER.md) | 白皮书草案 |

## 规划技术栈

Solidity + Foundry + OpenZeppelin Contracts v5 · BNB Smart Chain（BSC）（测试网 97 → 获批后主网 56） · Next.js、React、TypeScript、Tailwind、shadcn/ui、wagmi/viem · NestJS、PostgreSQL、Prisma、Redis（BullMQ） · Docker Compose · GitHub Actions。

## 快速开始（第二阶段开始后）

参见 [PHASE1_ANALYSIS.md §10](docs/PHASE1_ANALYSIS.md)。

## 重要限制

- 除非项目的权益文件（Rights Document）另有规定，代币单位并不代表对车辆的所有权。
- 文档哈希只能证明文件未被改动，不能证明其真实性。
- 生命周期状态是授权角色作出的声明/证明（attestation），并非现实世界事件的证据。
- 不假定存在任何 Tesla 合作关系、API、价格、收益或地点。
- 限制转让的代币本身并不能使募集在法律上合规。

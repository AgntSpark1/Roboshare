# RoboShare

RoboShare 是一个在 BNB Smart Chain（BSC）上把单个 Robotaxi 车辆项目做成链上投资份额（RWA）的平台：投资者用 USDT（BEP20）认购某个车辆项目的份额，项目运营产生的经审核利润按份额在链上分配。

> **当前状态：BSC 测试网试运行。** 合约、后端、投资者网站和运营后台都已实现并部署在 BSC 测试网，只使用测试币（tUSDT）。**尚未部署主网，尚未经过第三方审计和法律审阅，也不做 KYC/AML（项目负责人决定）。** 本仓库中的任何内容均不构成证券要约或投资建议。

- 投资者试用站点：<https://web-production-eb5dab.up.railway.app>
- 测试网合约地址：[`deployments/bsc-testnet.json`](deployments/bsc-testnet.json)（测试网正在重新部署，地址以该文件为准）

## 已实现的功能

### 智能合约（`contracts/`，Solidity + Foundry + OpenZeppelin v5）

| 合约 | 作用 |
|---|---|
| `AssetRegistry` / `AuditRegistry` | 登记车辆项目（资产 ID、文件哈希、生命周期）；财务报告上链存证，提交人与审核人必须是不同的人 |
| `IdentityRegistry` | 冻结名单（不做 KYC；只用于拦截被盗或受制裁的钱包） |
| `RwaShareToken` | 每个项目一个限制转让的 ERC-20 份额代币，decimals 为 0，只能在合格钱包之间转让 |
| `OfferingManager` / `SubscriptionRouter` | USDT 募集：用户授权一次后按份数购买；允许部分募集（每个项目设最低成交份数，没卖出的份额不发行）；募集失败可退款。默认不设单个钱包上限 |
| `RevenueDistributor` / `FeeTiers` | 按已发行份额分配经审核的利润，投资者主动领取；平台只收分档手续费，没有额外管理费 |
| `ShareMarket` | 投资者之间的二手转让市场：卖家挂单（份数 + 价格），合格买家用 USDT 原子成交。平台不出资、不收手续费，**不承诺回购或保本赎回** |
| `ReferralRewards` | 单级推荐奖励：被推荐人产生的平台手续费的 20%，12 个月，用 Merkle 证明领取 USDT；不动用投资者本金和收益；**全局开关默认关闭**，待律师确认后再开 |
| `ProjectFactory` | 按项目部署代币、募集和分配合约 |

**治理：** 所有合约的管理员是一个 2/3 Safe 多签，签名后**立即生效，不设时间锁**（2026-10-11 决定，测试网和主网相同）。部署者在部署结束时放弃全部权限。没有丢失私钥后的找回或强制转账功能。

### 应用

| 目录 | 说明 |
|---|---|
| `apps/web` | 投资者网站（Next.js + wagmi/viem）：项目列表与认购、我的资产与领取、二手转让市场、新手指南、常见问题、白皮书页面。支持 9 种语言（简体中文、繁体中文、English、日本語、한국어、Tiếng Việt、ไทย、Bahasa Indonesia、Español），默认跟随手机/电脑的系统语言，也可在页头手动切换 |
| `apps/admin` | 运营后台（中文）：项目登记与审核、募集配置、报告与分配、生成 Safe 多签交易；员工登录需要 TOTP 二次验证 |
| `apps/api` | 后端 API（NestJS + Prisma），钱包用 SIWE 登录 |
| `apps/worker` | 链上索引器：只处理已确认区块，支持链重组处理和对账 |
| `packages/*` | 共享的数据库模型、ABI/类型和 UI 组件 |
| `e2e/` | Playwright 端到端测试 |

## 本地开发

需要：Node 22、pnpm 10.28.0、Foundry（forge / anvil）、Docker（或本机的 PostgreSQL 16 + Redis 7）。

```bash
# 合约
cd contracts && forge build && forge test && cd ..

# 应用
docker compose up -d          # 本地 PostgreSQL + Redis（仅限本地的一次性账号）
cp .env.example .env          # 填写数据库、RPC、合约地址、SESSION_SECRET 等（.env 不要提交）
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm build
node apps/worker/dist/main.js # 索引器
node apps/api/dist/main.js    # API，默认端口 4000
pnpm --filter @roboshare/web dev    # 投资者网站 http://localhost:3000
pnpm --filter @roboshare/admin dev  # 运营后台 http://localhost:3001

# 测试
pnpm typecheck
DATABASE_URL=<以 _test 结尾的数据库> pnpm test
./scripts/local-deploy-sim.sh # 在本地 anvil 上完整彩排部署脚本
```

部署流程见 [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)。私钥、助记词、TOTP 密钥等任何秘密都不能提交到仓库。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/WHITEPAPER.md](docs/WHITEPAPER.md) | 白皮书（草案，待法律审阅；网站上有 PDF 版） |
| [docs/PHASE1_ANALYSIS.md](docs/PHASE1_ANALYSIS.md) | 需求分析与已确认的设计决策（§8） |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系统架构、索引与对账 |
| [docs/SMART_CONTRACT_SPEC.md](docs/SMART_CONTRACT_SPEC.md) | 合约模块、角色、函数、事件、不变量 |
| [docs/TOKENOMICS.md](docs/TOKENOMICS.md) | 份额结构、费率档位、分配公式 |
| [docs/EARLY_EXIT_DESIGN.md](docs/EARLY_EXIT_DESIGN.md) | 二手转让市场（提前退出）设计 |
| [docs/REFERRAL_DESIGN.md](docs/REFERRAL_DESIGN.md) | 推荐奖励设计 |
| [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) · [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) · [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) | 权限结构、威胁模型、内部安全检查 |
| [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) · [docs/API_SPEC.md](docs/API_SPEC.md) | 数据库与 API |
| [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) · [docs/ADMIN_OPERATIONS.md](docs/ADMIN_OPERATIONS.md) · [docs/INCIDENT_RESPONSE.md](docs/INCIDENT_RESPONSE.md) | 部署、运营手册、事件应对 |
| [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) | 测试计划 |
| [docs/RISK_DISCLOSURES.md](docs/RISK_DISCLOSURES.md) | 投资者风险披露 |
| [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md) | 阶段划分 |

## 上主网之前必须完成

1. 第三方智能合约审计（需告知审计方：治理没有时间锁）。
2. 法律审阅：份额的法律性质、募集合规、二手转让市场、推荐奖励、风险披露和各语言译文。
3. 律师评估不做 KYC/AML 的合规风险。项目负责人 2026-10-11 决定不做 KYC（“都不要KYC验证了”“kyc 验证这个功能都去掉”），KYC/投资资格功能已完全移除，链上只保留冻结名单。
4. 主网多签签名人使用硬件钱包。
5. 项目方书面批准主网部署。

## 重要限制

- 份额代表的是合同约定的利润分配权，除非项目权益文件另有规定，不代表对车辆的所有权。
- 文件哈希只能证明文件没有被改动，不能证明内容真实。
- 生命周期状态是授权角色的声明，不是现实事件的证据。
- RoboShare 与 Tesla 不存在任何合作关系；不承诺任何收益。
- 限制转让的代币本身不能让募集在法律上合规。

---

## English summary

RoboShare tokenizes individual Robotaxi vehicle projects as restricted-transfer shares on BNB Smart Chain. Investors subscribe with USDT (BEP20) and claim pro-rata audited profit on-chain. The repo contains Foundry contracts (registries, share token, USDT offering router, revenue distributor, a peer-to-peer share market with no buyback promise, and a single-level referral program that is off by default), a NestJS API, a chain indexer, a 9-language investor site that follows the device language, and an admin console. Governance is a 2-of-3 Safe multisig that acts immediately (no timelock).

**Status: BSC testnet trial only, using test USDT.** Not deployed to mainnet, not audited, no legal review yet, and no KYC/AML: by the owner's decision of 2026-10-11 the KYC/eligibility feature was removed entirely and only a freeze list remains (to block stolen or sanctioned wallets). Counsel must assess the no-KYC/AML compliance risk before mainnet. Nothing here is an offer of securities. Testnet addresses: [`deployments/bsc-testnet.json`](deployments/bsc-testnet.json). Trial site: <https://web-production-eb5dab.up.railway.app>. See the local development section above for build and test commands.

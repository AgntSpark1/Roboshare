# RoboShare — API 规范

状态：**草案（DRAFT，Phase 1）。** 基于 HTTPS 的 REST 接口，使用 JSON。Phase 3 将根据 NestJS 装饰器生成 OpenAPI 3.1 文档，届时该文档将成为权威规范。

## 1. 约定

- 基础路径为 `/api/v1`。金额以整数基础单位的字符串表示，并同时附带支付代币的 `decimals`。
- 错误格式：`{ "error": { "code": "OFFERING_CLOSED", "message": "...", "details": {} } }`。
- 分页：基于游标，`?cursor=&limit=`（最大 100）。
- 凡包含数值的响应，均包含 `figureKind: "ACTUAL" | "PROJECTED"`。
- 凡源自链上的对象，均包含 `chain: { chainId, txHash, blockNumber, confirmed }`。
- 幂等性：会修改状态的管理端接口接受 `Idempotency-Key`。
- 按 IP 和按钱包进行限流（Redis）。

## 2. 可见性层级

| 层级 | 认证 | 守卫 |
|---|---|---|
| `public` | 无 | — |
| `investor` | SIWE 会话 Cookie | `InvestorGuard`（钱包已关联到用户） |
| `admin:<role>` | SIWE + 员工 TOTP + 链上角色镜像 | `RoleGuard(OPERATOR / REVIEWER / COMPLIANCE / GOV_VIEW)` |

响应 DTO 按层级区分；公开层级的 DTO 类型完全不包含受限字段。

## 3. 认证

| 方法 | 路径 | 层级 | 说明 |
|---|---|---|---|
| GET | `/auth/nonce?address=` | public | SIWE nonce（Redis，TTL 5 分钟） |
| POST | `/auth/verify` | public | 请求体 `{message, signature}`；校验 domain、chainId、nonce；设置 httpOnly 会话 Cookie |
| POST | `/auth/logout` | investor | 撤销会话 |
| GET | `/auth/me` | investor | 用户、已关联钱包、`frozen`（是否在冻结名单上） |
| POST | `/auth/staff/totp` | investor | 员工二次验证（step-up） |

## 4. 公开接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/projects` | 列表：id、标题、状态、品牌/型号、已发行/授权供应量、募集状态 |
| GET | `/projects/:id` | 详情：法律权益摘要、发行人名称、状态历史、供应量、募集条款摘要、费率档位、风险因素、带哈希的公开文档列表 |
| GET | `/projects/:id/financials` | 仅限已批准的报告摘要：期间、收入、支出、储备、可分配金额、鉴证级别、报告哈希、记录交易 |
| GET | `/projects/:id/distributions` | 批次汇总：期间、资金池、净额合计、费用合计、尾差（dust）、快照区块、交易哈希 |
| GET | `/projects/:id/documents/:docId/versions/:v/verify?hash=` | 将哈希与已锚定的记录进行比对 |
| GET | `/contracts` | 各链上已部署合约地址、区块浏览器验证状态、角色持有者 |
| GET | `/aave/markets` | Phase 5：经验证的市场元数据及白名单内的储备数据，附来源地址和读取区块 |
| GET | `/content/*` | 白皮书、常见问题、风险披露（带版本） |
| GET | `/health` | 存活/就绪状态，索引器延迟 |

## 5. 投资者接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/me/eligibility` | `{ wallet, frozen, eligibleNow: !frozen }`。不做 KYC（2026-10-11 决定，见 PHASE1_ANALYSIS D-24），只看冻结名单 |
| POST | `/me/risk-acknowledgement` | 记录对某一披露版本的确认 |
| GET | `/me/portfolio` | 各项目持仓、分配额百分比、基于已结算认购的成本基础 |
| GET | `/me/subscriptions` | 各募集的认购状态，含退款可用性 |
| GET | `/me/transactions` | 铸造、转让、退款、领取记录及交易哈希 |
| GET | `/me/distributions` | 分配额：批次、快照时的单位数、总额、费率档位、费用、净额、是否已领取、领取交易 |
| GET | `/projects/:id/documents/:docId/download` | INVESTOR 文档的预签名 URL（需合格钱包），并记录日志 |
| GET | `/projects/:id/reports/:reportId` | 含明细项的完整已批准报告 |
| POST | `/tx/pending` | 登记由钱包提交的交易哈希，供 UI 跟踪 |

涉及价值转移的写操作（认购、领取、退款、转让）由投资者钱包直接对合约签名。API 从不持有投资者私钥，也不托管资产。

## 6. 管理接口

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| POST | `/admin/projects` | OPERATOR | 创建草稿（数据库）+ 准备 `registerProject` 交易 |
| PATCH | `/admin/projects/:id` | OPERATOR | 编辑草稿字段 |
| POST | `/admin/projects/:id/documents` | OPERATOR | 上传版本 → 计算哈希 → 准备 `submitRecord` |
| POST | `/admin/projects/:id/transition` | REVIEWER / GOV_VIEW | 准备状态转换交易或 Safe 提案 |
| POST | `/admin/projects/:id/offering` | GOV_VIEW | 校验配置（从链上读取稳定币 decimals），为 `configure` + `open` 准备 Safe 提案 |
| POST | `/admin/offerings/:id/settle` | OPERATOR | 预检查认购人是否被冻结（有则 409 `SUBSCRIBER_FROZEN`，需先排除）；准备 `settle`（合约上任何钱包都可调用；worker 配置 `SETTLER_PRIVATE_KEY` 后会在满额或到期达标后自动结算） |
| POST | `/admin/offerings/:id/exclude` | GOV_VIEW | 为 `excludeSubscriber` 准备 Safe 提案 |
| POST | `/admin/reports` | OPERATOR | 提交报告 JSON + 附件；经 zod 校验；返回规范哈希 |
| POST | `/admin/reports/:id/review` | REVIEWER | 批准/驳回（必须与提交人不同）并准备链上交易 |
| POST | `/admin/distributions/preview` | OPERATOR | 输入 reportId、金额、snapshotBlock → 基于快照的持有人列表 + TS 分配额预览 |
| POST | `/admin/distributions` | OPERATOR | 准备 `proposeBatch` |
| POST | `/admin/distributions/:id/approve` | REVIEWER | 准备 `approveBatch`（Safe 提案） |
| GET | `/admin/compliance/wallets` | COMPLIANCE | 钱包状态列表（仅代码） |
| POST | `/admin/compliance/wallets/:addr/freeze` | COMPLIANCE | 将中继交易加入队列 |
| GET | `/admin/roles` | 任意管理员 | 各合约的链上角色持有者 |
| GET | `/admin/audit-log` | 任意管理员 | `admin_action` + 链上事件 |
| POST | `/admin/pause` | （Guardian） | 准备 Safe 提案；绝不由服务器发送 |
| GET | `/admin/reconciliation` | 任意管理员 | 最近的对账运行及未解决问题 |
| POST | `/admin/reconciliation/run` | OPERATOR | 触发对账运行 |
| GET | `/admin/exports/:kind?projectId=&format=csv` | 任意管理员 | 项目、持仓、分配、报告 |

"准备"是指 API 返回未签名的 calldata（供员工钱包使用）或创建 Safe 交易提案；它不会使用服务器私钥签名。唯一的服务器端签名者是受限流的合规中继器。

## 7. Webhooks

无。不做 KYC/AML，因此没有 KYC 服务商 webhook（2026-10-11 已删除）。

## 8. 错误代码（示意性）

`UNAUTHENTICATED`、`FORBIDDEN`、`WALLET_FROZEN`、`SUBSCRIBER_FROZEN`、`PROJECT_STATE_INVALID`、`OFFERING_CLOSED`、`CAP_EXCEEDED`、`REPORT_INVALID`、`SELF_REVIEW_FORBIDDEN`、`PERIOD_ALREADY_APPROVED`、`AMOUNT_EXCEEDS_REPORT`、`RECONCILIATION_BLOCKED`、`CHAIN_UNAVAILABLE`。

// 中文白皮书内容（参考版本）。事实来源：docs/WHITEPAPER.md、TOKENOMICS.md、RISK_DISCLOSURES.md、EARLY_EXIT_DESIGN.md、OPERATING_TERM、MATCHMAKER_DESIGN.md、REFERRAL_DESIGN.md 及项目决策记录。
// 不得加入未经确认的数字、合作方或收益承诺。

export default ({ icon, structure }) => ({
  lang: "zh-CN",
  file: "RoboShare-Whitepaper-zh.pdf",
  docTitle: "RoboShare 白皮书",
  footer: "RoboShare 白皮书 · 草案 v0.3 · 待法律审阅",
  cover: {
    eyebrow: "WHITEPAPER · 白皮书",
    title: `Robo<span>Share</span>`,
    sub: "按份参与自动驾驶网约车的运营收益。<br>USDT 结算，规则写在合约里，账目链上可查。",
    chips: ["一辆车 = 100 份", "USDT 认购 · 每月分配", "满额自动投入运营", "2/3 多签治理"],
    ver: `版本 <b>0.3 草案</b><br>2026 年 10 月`,
    note: "本文件为草案，仅用于介绍项目设计，不构成任何证券或投资的要约或邀约。正式募集前须经律师审阅。",
  },
  toc: {
    title: "目录",
    lede: "RoboShare 把单辆 Robotaxi 车辆的运营利润拆成 100 份，按份发行、每月分配。以下是它的运作方式。",
  },
  sections: [
    {
      id: "overview", kicker: "01 · 概述", title: "一辆车，一个项目，100 份", toc: "每辆车独立成项目，按份认购", page: true,
      html: `
<p class="lead">RoboShare 是在 BNB Smart Chain 上发行和管理 Robotaxi 车辆收益份额的平台。每辆车是一个独立项目，发行 100 份；投资者用 USDT 按份认购，在车辆运营期内按持有份数分享该车经审核的可分配利润；运营期满车辆出售，所得按份额返还持有人。</p>
<div class="stats">
  <div class="stat"><b>100<em>份</em></b><span>每个项目的份额总数，写死在合约里，不能增发</span></div>
  <div class="stat"><b>USDT</b><span>认购、退款、分配全部使用 BEP20 USDT</span></div>
  <div class="stat"><b>70%<em>归你</em></b><span>每笔分配投资者固定拿 70%，推广奖励不从中扣</span></div>
  <div class="stat"><b>2/3</b><span>多签管理全部合约，每项管理操作需 3 人中 2 人签名</span></div>
</div>
<p>平台的核心是透明：谁持有多少份、每期报告了什么、由谁批准、分了多少钱，都通过链上交易和文件哈希相互关联，任何人都能核对。</p>
<p>从结算、投入运营到每月分配都由系统自动完成，投资者不需要任何额外操作，只需在“我的资产”领取 USDT。份额放在投资者自己的钱包里，平台无法转走；分配规则在部署时写入合约，之后不能随意修改。</p>`,
    },
    {
      id: "problem", kicker: "02 · 为什么", title: "让车辆收益变得可参与、可核对", toc: "门槛、透明度与分配效率",
      html: `
<p>一辆投入运营的 Robotaxi 会持续产生收入，但普通人很难参与：</p>
<div class="cards">
  <div class="card"><div class="ic">${icon("layers")}</div><h4>门槛高</h4><p>每辆车都要单独搭建法律结构，个人很难按小份额参与单一车辆。</p></div>
  <div class="card"><div class="ic">${icon("eye")}</div><h4>账目不透明</h4><p>投资者很少能看到报告数字背后的证据，也无从核对。</p></div>
  <div class="card"><div class="ic">${icon("coin")}</div><h4>分配靠人工</h4><p>收益计算和发放依赖人工，周期长，容易出错。</p></div>
</div>
<p>RoboShare 的做法是：每辆车独立核算，按份发行；运营报告经审核后记录在链上；每月由系统自动生成分配，金额由合约计算，投资者自己领取。</p>`,
    },
    {
      id: "how", kicker: "03 · 运作方式", title: "从认购到领取收益", toc: "四步参与流程", page: true,
      html: `
<div class="steps">
  <div class="step"><h4>选择项目</h4><p>查看车辆资料、单价、运营期、最低成团份数和募集期限。</p></div>
  <div class="step"><h4>USDT 认购</h4><p>首次授权一次，之后按份数直接认购。资金在结算前由合约托管。</p></div>
  <div class="step"><h4>满额自动运营</h4><p>募集成功后系统自动结算，份额自动发到钱包，车辆自动投入运营，无需任何人点按钮。</p></div>
  <div class="step"><h4>每月分配</h4><p>每月初系统汇总上月运营数据，生成报告并审核后自动发放；在“我的资产”一键领取 USDT。</p></div>
</div>
<div class="cards two">
  <div class="card"><div class="ic">${icon("eye")}</div><h4>每天看得见</h4><p>车辆每天的运营收入在“我的资产”中展示，标注为“待结算”，月度结算后进入分配。</p></div>
  <div class="card"><div class="ic">${icon("clock")}</div><h4>运营期</h4><p>每辆车单独设定运营期，默认 720 天，认购前即可看到。运营期满车辆出售，所得按份额返还持有人，这部分不收平台分成。</p></div>
</div>`,
    },
    {
      id: "rights", kicker: "04 · 权益结构", title: "你持有的是什么", toc: "份额代表的权利与法律结构",
      html: `
<p class="lead">一份份额代表按已发行份数比例，分享该项目可分配利润的合同性经济权利。具体以每个项目的权益文件（Rights Document）为准。</p>
<div class="diagram">${structure({
        boxes: [
          ["投资者", ["自己的钱包", "持有份额"]],
          ["份额代币", ["每项目 100 份", "整数，无小数"]],
          ["权益文件", ["定义每份的权利", "哈希记录在链上"]],
          ["发行主体", ["SPV 或同等主体", "结构待律师确定"]],
          ["车辆", ["资产 ID", "VIN 加盐哈希"]],
        ],
        arrows: ["持有", "权利由其定义", "由其发行", "拥有/运营"],
      })}</div>
<ul class="ticks">
  <li>卖满 100 份时，1 份 = 可分配利润的 1%；只卖出 80 份时，1 份 = 1/80（1.25%）。</li>
  <li>份额<b>不是</b>车辆所有权，也不是运营方的股份，不对其他项目享有权利。</li>
  <li>一个项目、一辆车、一个发行主体、一种代币，各项目在结构上相互隔离。</li>
  <li>运营期满车辆出售，出售净额、未用储备和保险赔付按份额返还持有人，不收平台分成。</li>
</ul>`,
    },
    {
      id: "offering", kicker: "05 · 份额发行", title: "发行规则", toc: "总量、价格、成团与托管", page: true,
      html: `
<table>
  <tr><th style="width:30%">项目</th><th>规则</th></tr>
  <tr><td class="k">总量</td><td>每个项目 100 份，合约强制上限，不可增发；份额为整数</td></tr>
  <tr><td class="k">价格</td><td>每次募集启动前设定固定单价，以 USDT 计</td></tr>
  <tr><td class="k">运营期</td><td>每辆车单独设定，默认 720 天；认购前公开</td></tr>
  <tr><td class="k">最低成团份数</td><td>启动前设定（1–100 份）；截止时达到即成功，否则全额退款</td></tr>
  <tr><td class="k">每个钱包</td><td>默认不限制单个钱包的认购份数，可一直买到售完</td></tr>
  <tr><td class="k">资金托管</td><td>认购款在结算前由募集合约托管，任何角色都不能挪用</td></tr>
  <tr><td class="k">自动结算</td><td>售罄或截止时达到最低份数即自动结算，份额自动发到认购人钱包；只有该项目的募集合约能铸造</td></tr>
  <tr><td class="k">投入运营</td><td>结算成功后车辆自动投入运营，开始累计运营收入</td></tr>
  <tr><td class="k">未售出份额</td><td>募集截止前平台可能用自有资金认购剩余份额；仍未售出的份额不发行，收益按实际发行份数分配</td></tr>
</table>
<h3>募集结果只有两种</h3>
<div class="cards two">
  <div class="card dark"><div class="ic">${icon("check")}</div><h4>达到最低份数：成功</h4><p>募集截止时售出份数达到项目事先设定的最低成团份数，即自动结算。份额自动发给认购人，募集款进入发行人金库，车辆随即投入运营。</p></div>
  <div class="card"><div class="ic">${icon("refund")}</div><h4>未达到：全额退款</h4><p>售出份数不足最低成团份数，募集取消，所有认购人的 USDT 可全额退回。</p></div>
</div>`,
    },
    {
      id: "returns", kicker: "06 · 收益分配", title: "收益如何计算", toc: "可分配利润、7:3 分配与示例", page: true,
      html: `
<p>车辆每天的运营数据录入系统；每月初系统自动汇总上月数据生成财务报告，经审核后记录在链上。可分配利润按以下方式确定：</p>
<div class="formula">
  <div>实际收入</div><i>−</i><div>运营成本<small>充电、清洁、维护、保险等</small></div><i>−</i><div>已批准储备</div><i>−</i><div>优先义务<small>偿债、税款等</small></div><i>=</i><div class="res">可分配利润 D</div>
</div>
<p>可分配利润为零或为负的期间，不分配，平台分成也为零。</p>
<div class="keep"><h3>7 : 3 分配：投资者 70%，平台 30%</h3>
<p>平台不收管理费，也不另收任何认购或转让费用。每位持有人按份额分到的金额中，投资者拿 70%，平台拿 30%，不论持有多少份都一样。平台的 30% 用于车辆运营管理、技术与合规开支，以及推广奖励。</p>
<table>
  <tr><th>项目</th><th class="r">比例</th><th>说明</th></tr>
  <tr><td class="k">投资者到手</td><td class="r"><span class="tier-bar" style="width:28mm"></span>70%</td><td>固定比例，有没有推荐人都一样</td></tr>
  <tr><td class="k">平台分成</td><td class="r"><span class="tier-bar" style="width:12mm"></span>30%</td><td>推广奖励从这 30% 里支付</td></tr>
  <tr><td class="k">运营期满返还</td><td class="r">0%</td><td>车辆出售所得按份额返还，不收平台分成</td></tr>
</table>
<p style="font-size:8.4pt;color:#66728D">7:3 分配适用于新发行的项目；已发行项目保持其募集时公布的费率。</p></div>
<div class="keep"><h3>计算示例 <span class="tag">仅用于说明</span></h3>
<p>假设某月可分配利润 D = 10 000 USDT，已发行 100 份：</p>
<table>
  <tr><th>持有人</th><th class="r">份数</th><th class="r">按份额分到</th><th class="r">平台 30%</th><th class="r">投资者到手 70%</th></tr>
  <tr><td>A</td><td class="r">50</td><td class="r">5 000</td><td class="r">1 500</td><td class="r">3 500</td></tr>
  <tr><td>B</td><td class="r">25</td><td class="r">2 500</td><td class="r">750</td><td class="r">1 750</td></tr>
  <tr><td>C</td><td class="r">15</td><td class="r">1 500</td><td class="r">450</td><td class="r">1 050</td></tr>
  <tr><td>D</td><td class="r">10</td><td class="r">1 000</td><td class="r">300</td><td class="r">700</td></tr>
  <tr class="total"><td>合计</td><td class="r">100</td><td class="r">10 000</td><td class="r">3 000</td><td class="r">7 000</td></tr>
</table>
<p class="note" style="font-size:8.4pt;color:#66728D">示例数字不代表任何项目的预期收益。产品中出现的预测一律标注为“预测”，并与“实际”数字分开展示。</p></div>
<div class="pb"></div>
<h3>分配与领取</h3>
<ul class="ticks">
  <li>每月自动分配：每月初系统汇总上月运营数据，生成报告、审核并发放分配批次，全程无需投资者操作。</li>
  <li>每期在报告期末做持有快照，合约按快照计算每位持有人的金额。</li>
  <li>持有人自己领取（运营方也可代为发起，资金仍直接到持有人钱包）。</li>
  <li>未领取的金额一直保留，可随时领取，永远不会转给运营方。</li>
  <li>计算取整产生的零头结转到下一期，取整偏向投资者。</li>
  <li>运营期满车辆出售后，所得按份额一次性返还，不收平台分成。</li>
</ul>
`,
    },
    {
      id: "exit", kicker: "07 · 转让与退出", title: "转让市场", toc: "提前退出的方式",
      html: `
<p class="lead">想提前退出的投资者，可以在平台的链上转让市场挂单出售份额，由其他投资者用 USDT 买下。网站的“转让市场”页面展示所有在售份额、价格和成交记录。</p>
<div class="cards">
  <div class="card"><div class="ic">${icon("swap")}</div><h4>一笔交易完成</h4><p>买家付 USDT、卖家交份额在同一笔链上交易中完成，可部分成交。</p></div>
  <div class="card"><div class="ic">${icon("lock")}</div><h4>不托管、不收费</h4><p>市场合约从不持有资金或份额，转让不收手续费，价格由卖家自定。</p></div>
  <div class="card"><div class="ic">${icon("users")}</div><h4>人人可买卖</h4><p>任何未被冻结的钱包都可以挂单和购买；项目须处于运营状态，规则由份额合约强制执行。</p></div>
</div>
<p>平台可以像普通买家一样买入挂单，但没有回购义务，不保证价格、时间或成交。份额应视为低流动性资产。</p>`,
    },
    {
      id: "promo", kicker: "08 · 推广计划", title: "推广奖励与推广团队", toc: "三级推广奖励，从平台 30% 中支付", page: true,
      html: `
<p class="lead">投资者可以用自己的专属链接邀请朋友。被邀请人每次分配时，推荐人按三级获得奖励，奖励全部从平台的 30% 中支付，被邀请人的 70% 一分不少。</p>
<div class="keep"><h3>三级奖励比例</h3>
<p>奖励按被推荐投资者当期按份额分到的金额（分润总额）计算，最多三级，第四级起没有奖励；直推人数不限。</p>
<table>
  <tr><th>层级</th><th>关系</th><th class="r">奖励比例</th></tr>
  <tr><td class="k">第一级</td><td>你直接邀请的人</td><td class="r"><span class="tier-bar" style="width:10mm"></span>10%</td></tr>
  <tr><td class="k">第二级</td><td>你邀请的人再邀请的人</td><td class="r"><span class="tier-bar" style="width:5mm"></span>5%</td></tr>
  <tr><td class="k">第三级</td><td>第二级再邀请的人</td><td class="r"><span class="tier-bar" style="width:3mm"></span>3%</td></tr>
</table></div>
<div class="keep"><h3>计算示例 <span class="tag">仅用于说明</span></h3>
<p>被推荐投资者 X 某月按份额分到 1 000 USDT，推荐链为 A → B → C → X：</p>
<table>
  <tr><th>去向</th><th class="r">金额（USDT）</th><th>来源</th></tr>
  <tr><td class="k">投资者 X 到手</td><td class="r">700</td><td>固定 70%，不受推荐关系影响</td></tr>
  <tr><td class="k">C（第一级）</td><td class="r">100</td><td rowspan="4">平台 30%（300 USDT）</td></tr>
  <tr><td class="k">B（第二级）</td><td class="r">50</td></tr>
  <tr><td class="k">A（第三级）</td><td class="r">30</td></tr>
  <tr><td class="k">平台留存</td><td class="r">120</td></tr>
</table></div>
<div class="cards">
  <div class="card"><div class="ic">${icon("users")}</div><h4>推广团队</h4><p>团队长拥有专属团队链接和只读的团队后台，可查看成员、业绩与奖励；成员归属按链上邀请关系确定，已有成员不能被其他团队抢走。</p></div>
  <div class="card"><div class="ic">${icon("coin")}</div><h4>链上领取</h4><p>奖励以 USDT 计算，汇总后发布链上领取凭证，推荐人在“推广”页面自己领取，全部团队统一结算。</p></div>
  <div class="card"><div class="ic">${icon("shield")}</div><h4>不碰本金</h4><p>奖励只来自平台分成，不来自任何人的本金或投资者的 70%，也不按认购金额发放佣金。</p></div>
</div>
<div class="callout amber"><p><b>开启条件：</b>推广奖励设有总开关，主网默认关闭。多级推广在部分法域可能涉及传销或无牌销售的认定，主网开启前须由律师书面确认。推广材料不得承诺任何固定收益。</p></div>`,
    },
    {
      id: "trust", kicker: "09 · 透明与安全", title: "规则写在合约里", toc: "证据上链、权限分离与资产自管", page: true,
      html: `
<div class="cards">
  <div class="card"><div class="ic">${icon("doc")}</div><h4>证据，而不是声称</h4><p>购车、保险、运营等文件经哈希后记录在链上。哈希能证明文件没被改过，并不证明文件本身真实，因此每项变更都由具名角色签署证明。</p></div>
  <div class="card"><div class="ic">${icon("users")}</div><h4>双人规则</h4><p>财务报告和分配批次都由提交方提交、审核方批准，自动化流程同样使用两把独立的密钥，同一把密钥不能兼任两者。</p></div>
  <div class="card"><div class="ic">${icon("lock")}</div><h4>多签治理</h4><p>所有合约的管理权由 2/3 多签持有：任何管理操作都要 3 位签名人中至少 2 位签名才能执行，一个人无法单独改动。部署账户不保留任何权限。</p></div>
  <div class="card"><div class="ic">${icon("shield")}</div><h4>权限有边界</h4><p>任何角色都不能超过上限铸造份额、挪用托管资金、改写记录，也不能转走投资者的份额。</p></div>
  <div class="card"><div class="ic">${icon("pause")}</div><h4>紧急暂停</h4><p>出现安全事件时，独立的暂停角色可以暂停合约；解除暂停必须经过治理。</p></div>
  <div class="card"><div class="ic">${icon("key")}</div><h4>资产自管</h4><p>份额和收益都在投资者自己的钱包里。平台不提供私钥找回，也没有强制转移功能。</p></div>
</div>
<p>合约基于 OpenZeppelin 编写，部署后不可升级；分档费率、分配算法在部署时固定。自动化服务器钱包只拿各自需要的最小权限（例如只能把已满额的车辆投入运营），多签可以随时收回。</p>`,
    },
    {
      id: "tech", kicker: "10 · 技术架构", title: "技术架构", toc: "BNB Chain 合约与链下服务",
      html: `
<div class="arch">
  <div class="layer"><span class="lab">网站</span><div><b>投资者网站</b><i>认购 · 资产 · 领取 · 转让市场 · 9 种语言</i></div><div><b>运营后台</b><i>项目、报告与分配的提交和审核</i></div></div>
  <div class="layer"><span class="lab">链下服务</span><div><b>API 与自动化任务</b><i>自动结算 · 自动投入运营 · 每月自动分配</i></div><div><b>链上索引</b><i>只采用已确认区块，处理链重组，定期与合约对账</i></div><div><b>数据与文件</b><i>PostgreSQL · Redis · 项目文件加密保存，哈希上链</i></div></div>
  <div class="layer chain"><span class="lab">BNB Smart Chain</span><div><b>登记</b><i>AssetRegistry · AuditRegistry · IdentityRegistry（冻结名单）</i></div><div><b>每个项目</b><i>RwaShareToken · OfferingManager · RevenueDistributor</i></div><div><b>公共</b><i>ProjectFactory · SubscriptionRouter · ShareMarket · ProjectActivator</i></div></div>
</div>
<p>每日运营数据通过运营后台录入，经审核的月度报告流程进入分配，不依赖任何车辆厂商的数据接口。投资者资金不会被自动存入任何 DeFi 协议。</p>`,
    },
    {
      id: "compliance", kicker: "11 · 合规", title: "合规与身份审核", toc: "当前状态与上线前提", page: true,
      html: `
<p>使用特定代币结构或法律实体，本身并不能让平台合规。募集、转让、托管、税务和数据保护义务取决于所在司法管辖区和份额的法律定性，必须在任何公开募集之前由律师确定。</p>
<div class="callout amber"><p><b>当前状态：</b>平台不做 KYC/AML 身份认证，任何未被冻结的钱包都可以认购、持有和转让份额。平台保留冻结名单，用于阻止被盗或受制裁的钱包。如果日后法律要求身份认证，平台可能需要调整服务，甚至暂停认购和转让。主网上线前须由律师确认这一安排。</p></div>`,
    },
    {
      id: "roadmap", kicker: "12 · 路线图", title: "路线图", toc: "已完成、进行中与上线条件",
      html: `
<ol class="road">
  <li class="done"><h4>架构与产品设计 <small>已完成</small></h4><p>权益结构、费率、发行与分配规则确定。</p></li>
  <li class="done"><h4>核心合约、后端与网站 <small>已完成</small></h4><p>份额、募集、分配、转让市场合约；索引与 API；投资者网站和运营后台。</p></li>
  <li class="done"><h4>安全测试与 BSC 测试网部署 <small>2026 年 10 月</small></h4><p>全部合约由 2/3 多签管理，部署账户无权限。</p></li>
  <li class="done"><h4>运营期、自动化与转让市场 <small>2026 年 10 月</small></h4><p>按车设定运营期；自动结算、满额自动投入运营、每月自动分配；全站转让市场；推广团队与三级推广奖励（主网默认关闭）。</p></li>
  <li class="now"><h4>测试网试运行 <small>进行中</small></h4><p>使用测试 USDT 走通认购、自动运营、每月分配、领取和转让全流程。</p></li>
  <li><h4>上线准备</h4><p>外部安全审计、法律意见（含无 KYC、自动运营、转让市场与多级推广安排）、多语言文本专业审校。</p></li>
  <li><h4>主网上线</h4><p>以上条件全部满足并获得书面批准后进行。</p></li>
</ol>`,
    },
    {
      id: "risks", kicker: "13 · 主要风险", title: "投资前请了解", toc: "主要风险摘要", page: true,
      html: `
<p>你可能损失部分或全部投资。认购前请阅读项目的权益文件、募集条款和网站上的“投资须知”。</p>
<div class="risks">
  <div><h4>收益不作保证</h4><p>分配取决于扣除成本、储备和分成后的实际利润，没有利润的期间不分配。</p></div>
  <div><h4>车辆与运营</h4><p>事故、停运、维护、折旧、保险，以及第三方自动驾驶与网约车平台的变化。</p></div>
  <div><h4>运营方与发行人</h4><p>报告由运营方提交、审核人批准，除另有标注外未经独立审计；募集截止时平台可能用自有资金认购未售出份额。</p></div>
  <div><h4>流动性</h4><p>转让需要有买家，可能无法按期望价格或时间卖出；运营期满前没有赎回。</p></div>
  <div><h4>智能合约与区块链</h4><p>合约可能存在缺陷；网络拥堵、钱包故障或钓鱼网站。</p></div>
  <div><h4>私钥</h4><p>私钥丢失将永久失去份额和收益，任何人都无法找回。</p></div>
  <div><h4>稳定币</h4><p>USDT 由第三方发行，可能脱锚或被冻结；授权额度请只在官方网站操作，可随时撤销。</p></div>
  <div><h4>监管与税务</h4><p>平台不做身份认证，相关法律可能变化并限制或终止项目；纳税义务由投资者自行承担。</p></div>
</div>`,
    },
    {
      id: "notice", kicker: "14 · 重要声明", title: "重要声明", toc: "本文件的性质与限制",
      html: `
<div class="legal">
<p>本白皮书为草案，仅用于介绍 RoboShare 的产品设计，不构成出售或购买任何证券、投资产品的要约或邀约，也不构成投资、法律或税务建议。目前没有面向公众的募集。</p>
<p>本文不声明任何汽车厂商或自动驾驶平台的合作关系、已获批的运营地点、车辆价格、历史回报、保证收益或监管批准。文中分配比例与推广奖励为拟议业务规则，示例数字仅用于说明计算方式。</p>
<p>具体权利以每个项目的权益文件和募集条款为准；如有不一致，以上述文件为准。本文的非中文版本为翻译件，以中文版为准。</p>
</div>`,
    },
  ],
  back: {
    title: "透明，从第一份开始。",
    text: "RoboShare 把每辆车的发行、报告和分配都放在链上，让每位持有人都能自己核对。",
    end: "ROBOSHARE · BNB SMART CHAIN · USDT",
    note: "草案 v0.3 · 2026 年 10 月 · 待法律审阅 · 不构成要约",
  },
});

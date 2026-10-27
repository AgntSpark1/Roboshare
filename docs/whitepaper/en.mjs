// English whitepaper. Mirrors zh.mjs section by section; the Chinese text is the reference version.

export default ({ icon, structure }) => ({
  lang: "en",
  file: "RoboShare-Whitepaper-en.pdf",
  docTitle: "RoboShare Whitepaper",
  footer: "RoboShare Whitepaper · Draft v0.3 · Pending legal review",
  cover: {
    eyebrow: "WHITEPAPER",
    title: `Robo<span>Share</span>`,
    sub: "Unit-based participation in the operating profit of autonomous ride-hailing vehicles.<br>Settled in USDT, governed by smart contracts, auditable on-chain.",
    chips: ["1 vehicle = 100 units", "USDT in · monthly payouts", "Auto-start when fully funded", "2-of-3 multisig governance"],
    ver: `Version <b>0.3 draft</b><br>October 2026`,
    note: "This document is a draft that describes the product design. It is not an offer or solicitation to buy or sell any security or investment. Subject to legal review before any offering.",
  },
  toc: {
    title: "Contents",
    lede: "RoboShare splits the operating profit of a single robotaxi into 100 units, issued per vehicle and distributed every month. Here is how it works.",
  },
  sections: [
    {
      id: "overview", kicker: "01 · Overview", title: "One vehicle, one project, 100 units", toc: "Each vehicle is its own project", page: true,
      html: `
<p class="lead">RoboShare issues and manages robotaxi profit units on BNB Smart Chain. Each vehicle is a separate project with 100 units. Investors subscribe with USDT and, during the vehicle's operating term, share its audited distributable profit in proportion to the units they hold; at the end of the term the vehicle is sold and the proceeds are returned to holders pro rata.</p>
<div class="stats">
  <div class="stat"><b>100<em>units</em></b><span>Per project, capped in the contract; no further issuance</span></div>
  <div class="stat"><b>USDT</b><span>Subscriptions, refunds and payouts all use BEP20 USDT</span></div>
  <div class="stat"><b>70%<em>yours</em></b><span>Investors always keep 70% of every payout; referral rewards never come out of it</span></div>
  <div class="stat"><b>2/3</b><span>Multisig controls every contract; each admin action needs 2 of 3 signers</span></div>
</div>
<p>Transparency is the core of the platform: who holds what, what each period reported, who approved it and what was paid are all linked through on-chain transactions and document hashes that anyone can check.</p>
<p>Settlement, the start of operations and monthly payouts all run automatically; investors only claim their USDT under "My assets". Units sit in the investor's own wallet and the platform cannot move them. Distribution rules are fixed in the contracts at deployment.</p>`,
    },
    {
      id: "problem", kicker: "02 · Why", title: "Making vehicle income accessible and verifiable", toc: "Access, transparency, payouts",
      html: `
<p>A robotaxi in service earns money every day, yet ordinary investors can hardly take part:</p>
<div class="cards">
  <div class="card"><div class="ic">${icon("layers")}</div><h4>High barriers</h4><p>Each vehicle needs its own legal structure, so small stakes in a single vehicle are hard to offer.</p></div>
  <div class="card"><div class="ic">${icon("eye")}</div><h4>Opaque books</h4><p>Investors rarely see, or can check, the evidence behind reported numbers.</p></div>
  <div class="card"><div class="ic">${icon("coin")}</div><h4>Manual payouts</h4><p>Profit calculation and payment are handled by hand: slow and error-prone.</p></div>
</div>
<p>RoboShare accounts for each vehicle separately and issues it in units. Operating reports are recorded on-chain after review, payouts are generated automatically every month, computed by the contract, and claimed by investors themselves.</p>`,
    },
    {
      id: "how", kicker: "03 · How it works", title: "From subscription to payout", toc: "Four steps", page: true,
      html: `
<div class="steps">
  <div class="step"><h4>Pick a project</h4><p>Review the vehicle, unit price, operating term, minimum units and offering period.</p></div>
  <div class="step"><h4>Subscribe in USDT</h4><p>Approve once, then buy by choosing a number of units. Funds stay in contract escrow until settlement.</p></div>
  <div class="step"><h4>Auto-start when funded</h4><p>A successful offering settles by itself, units arrive in your wallet and the vehicle goes into service, with no button for anyone to press.</p></div>
  <div class="step"><h4>Monthly payouts</h4><p>Early each month the system totals last month's operating data, files and reviews the report, then pays out; claim your USDT in one tap.</p></div>
</div>
<div class="cards two">
  <div class="card"><div class="ic">${icon("eye")}</div><h4>Visible every day</h4><p>Each vehicle's daily operating income shows under "My assets", marked "pending settlement", and is distributed after the monthly settlement.</p></div>
  <div class="card"><div class="ic">${icon("clock")}</div><h4>Operating term</h4><p>Each vehicle has its own term, 720 days by default, shown before you subscribe. At the end the vehicle is sold and proceeds go to holders pro rata, with no platform share.</p></div>
</div>`,
    },
    {
      id: "rights", kicker: "04 · Rights", title: "What you hold", toc: "What a unit represents",
      html: `
<p class="lead">A unit is a contractual economic right to a pro-rata share, by units issued, of the project's distributable profit, as defined in that project's Rights Document.</p>
<div class="diagram">${structure({
        boxes: [
          ["Investor", ["Own wallet", "holds units"]],
          ["Unit token", ["100 per project", "whole units only"]],
          ["Rights Document", ["Defines each unit", "hash on-chain"]],
          ["Issuer", ["SPV or equivalent", "to be set by counsel"]],
          ["Vehicle", ["Asset ID", "salted VIN hash"]],
        ],
        arrows: ["holds", "defined by", "issued by", "owns/operates"],
      })}</div>
<ul class="ticks">
  <li>With all 100 units sold, 1 unit = 1% of distributable profit; with 80 sold, 1 unit = 1/80 (1.25%).</li>
  <li>A unit is <b>not</b> ownership of the vehicle or equity in the operator, and gives no claim on other projects.</li>
  <li>One project, one vehicle, one issuer, one token: projects are ring-fenced by design.</li>
  <li>At the end of the term the vehicle is sold; net proceeds, unused reserves and insurance payouts go to holders pro rata, with no platform share.</li>
</ul>`,
    },
    {
      id: "offering", kicker: "05 · Offering", title: "Offering rules", toc: "Supply, price, minimum, escrow", page: true,
      html: `
<table>
  <tr><th style="width:30%">Item</th><th>Rule</th></tr>
  <tr><td class="k">Supply</td><td>100 whole units per project, capped in the contract, no further issuance</td></tr>
  <tr><td class="k">Price</td><td>A fixed unit price in USDT, set before each offering opens</td></tr>
  <tr><td class="k">Operating term</td><td>Set per vehicle, 720 days by default; published before subscription</td></tr>
  <tr><td class="k">Minimum units</td><td>Set before launch (1–100); reached at close means success, otherwise full refund</td></tr>
  <tr><td class="k">Per wallet</td><td>No per-wallet limit by default; a wallet can buy until the offering sells out</td></tr>
  <tr><td class="k">Escrow</td><td>Subscriptions are held by the offering contract until settlement; no role can divert them</td></tr>
  <tr><td class="k">Auto-settlement</td><td>Settles automatically when sold out, or at close once the minimum is reached; units go straight to subscribers' wallets, minted only by that project's offering contract</td></tr>
  <tr><td class="k">Start of service</td><td>After settlement the vehicle goes into service automatically and starts earning</td></tr>
  <tr><td class="k">Unsold units</td><td>Before the close the platform may buy remaining units with its own funds; units still unsold are never issued, and profit is shared over units issued</td></tr>
</table>
<h3>Only two possible outcomes</h3>
<div class="cards two">
  <div class="card dark"><div class="ic">${icon("check")}</div><h4>Minimum reached: settled</h4><p>If units sold at close reach the preset minimum, the offering settles. The offering settles automatically: units go to subscribers, proceeds go to the issuer treasury and the vehicle goes into service.</p></div>
  <div class="card"><div class="ic">${icon("refund")}</div><h4>Minimum missed: full refund</h4><p>If fewer units were sold, the offering is cancelled and every subscriber can take back their full USDT.</p></div>
</div>`,
    },
    {
      id: "returns", kicker: "06 · Distributions", title: "How payouts are calculated", toc: "Profit, fee tiers, example", page: true,
      html: `
<p>Daily operating data is entered into the system; early each month it totals last month's data into a financial report, which is recorded on-chain once reviewed. Distributable profit is:</p>
<div class="formula">
  <div>Actual revenue</div><i>−</i><div>Operating costs<small>charging, cleaning, upkeep, insurance</small></div><i>−</i><div>Approved reserves</div><i>−</i><div>Senior obligations<small>debt service, taxes</small></div><i>=</i><div class="res">Distributable profit D</div>
</div>
<p>A period with zero or negative profit pays nothing, and the platform takes nothing.</p>
<div class="keep"><h3>70 : 30 split: investors 70%, platform 30%</h3>
<p>There is no management fee and no subscription or transfer fee. Of what each holder receives pro rata, the investor keeps 70% and the platform takes 30%, however many units they hold. The platform's 30% covers vehicle management, technology and compliance costs, and referral rewards.</p>
<table>
  <tr><th>Item</th><th class="r">Share</th><th>Note</th></tr>
  <tr><td class="k">Investor keeps</td><td class="r"><span class="tier-bar" style="width:28mm"></span>70%</td><td>Fixed, with or without a referrer</td></tr>
  <tr><td class="k">Platform share</td><td class="r"><span class="tier-bar" style="width:12mm"></span>30%</td><td>Referral rewards are paid out of this 30%</td></tr>
  <tr><td class="k">End-of-term return</td><td class="r">0%</td><td>Vehicle sale proceeds returned pro rata, no platform share</td></tr>
</table>
<p style="font-size:8.4pt;color:#66728D">The 70:30 split applies to newly issued projects; projects already issued keep the rate published in their offering.</p></div>
<div class="keep"><h3>Worked example <span class="tag">illustration only</span></h3>
<p>Assume distributable profit D = 10,000 USDT for a month and 100 units issued:</p>
<table>
  <tr><th>Holder</th><th class="r">Units</th><th class="r">Pro-rata</th><th class="r">Platform 30%</th><th class="r">Investor keeps 70%</th></tr>
  <tr><td>A</td><td class="r">50</td><td class="r">5,000</td><td class="r">1,500</td><td class="r">3,500</td></tr>
  <tr><td>B</td><td class="r">25</td><td class="r">2,500</td><td class="r">750</td><td class="r">1,750</td></tr>
  <tr><td>C</td><td class="r">15</td><td class="r">1,500</td><td class="r">450</td><td class="r">1,050</td></tr>
  <tr><td>D</td><td class="r">10</td><td class="r">1,000</td><td class="r">300</td><td class="r">700</td></tr>
  <tr class="total"><td>Total</td><td class="r">100</td><td class="r">10,000</td><td class="r">3,000</td><td class="r">7,000</td></tr>
</table>
<p class="note" style="font-size:8.4pt;color:#66728D">Example figures do not represent the expected return of any project. Any projection in the product is labelled "Projected" and shown apart from "Actual" figures.</p></div>
<div class="pb"></div>
<h3>Distribution and claiming</h3>
<ul class="ticks">
  <li>Monthly autopilot: early each month the system totals last month's data, files and reviews the report and releases the payout batch, with nothing for investors to do.</li>
  <li>Holdings are snapshotted at the end of each period; the contract computes every holder's amount from that snapshot.</li>
  <li>Holders claim for themselves (the operator may trigger a claim, but funds still go straight to the holder).</li>
  <li>Unclaimed amounts stay claimable indefinitely and are never swept to the operator.</li>
  <li>Rounding dust rolls into the next period; rounding favours investors.</li>
  <li>After the vehicle is sold at the end of the term, proceeds are returned pro rata in one go, with no platform share.</li>
</ul>`,
    },
    {
      id: "exit", kicker: "07 · Transfers", title: "Transfer market", toc: "Exiting early",
      html: `
<p class="lead">Investors who want to exit early can list units on the platform's on-chain transfer market, where other investors buy them with USDT. The site's "Transfer market" page lists every unit for sale with its price and recent trades.</p>
<div class="cards">
  <div class="card"><div class="ic">${icon("swap")}</div><h4>One atomic trade</h4><p>The buyer's USDT and the seller's units change hands in the same transaction; partial fills are allowed.</p></div>
  <div class="card"><div class="ic">${icon("lock")}</div><h4>No custody, no fee</h4><p>The market contract never holds funds or units, charges no fee, and sellers set their own price.</p></div>
  <div class="card"><div class="ic">${icon("users")}</div><h4>Open to everyone</h4><p>Any wallet that is not frozen can list and buy; the project must be in service, and the unit contract enforces the rules.</p></div>
</div>
<p>The platform may buy listings like any other buyer, but has no obligation to repurchase and guarantees no price, timing or fill. Units should be treated as illiquid.</p>`,
    },
    {
      id: "promo", kicker: "08 · Referral programme", title: "Referral rewards and promotion teams", toc: "Three levels, paid from the platform's 30%", page: true,
      html: `
<p class="lead">Investors can invite friends with their own link. Each time an invitee receives a payout, referrers earn rewards over up to three levels, paid entirely from the platform's 30%; the invitee's 70% is never touched. Rates apply to the invitee's gross payout; nothing from level 4 on, no limit on direct invites.</p>
<div class="keep"><h3>Reward rates</h3>
<table>
  <tr><th>Level</th><th>Relationship</th><th class="r">Reward</th></tr>
  <tr><td class="k">Level 1</td><td>People you invite directly</td><td class="r"><span class="tier-bar" style="width:10mm"></span>10%</td></tr>
  <tr><td class="k">Level 2</td><td>People they invite</td><td class="r"><span class="tier-bar" style="width:5mm"></span>5%</td></tr>
  <tr><td class="k">Level 3</td><td>People invited by level 2</td><td class="r"><span class="tier-bar" style="width:3mm"></span>3%</td></tr>
</table></div>
<div class="keep"><h3>Worked example <span class="tag">illustration only</span></h3>
<p>Referred investor X receives 1,000 USDT pro rata in a month; the referral chain is A → B → C → X:</p>
<table>
  <tr><th>Goes to</th><th class="r">USDT</th><th>Source</th></tr>
  <tr><td class="k">Investor X keeps</td><td class="r">700</td><td>Fixed 70%, unaffected by referrals</td></tr>
  <tr><td class="k">C (level 1)</td><td class="r">100</td><td rowspan="4">Platform 30% (300 USDT)</td></tr>
  <tr><td class="k">B (level 2)</td><td class="r">50</td></tr>
  <tr><td class="k">A (level 3)</td><td class="r">30</td></tr>
  <tr><td class="k">Platform keeps</td><td class="r">120</td></tr>
</table></div>
<div class="cards">
  <div class="card"><div class="ic">${icon("users")}</div><h4>Promotion teams</h4><p>Leaders get a team link and a read-only back office; membership follows on-chain invites and members cannot be poached.</p></div>
  <div class="card"><div class="ic">${icon("coin")}</div><h4>Claimed on-chain</h4><p>Rewards are published as on-chain USDT claim proofs and claimed on the "Referral" page.</p></div>
  <div class="card"><div class="ic">${icon("shield")}</div><h4>Never principal</h4><p>Paid only from the platform's share, never from principal or the investor's 70%.</p></div>
</div>
<div class="callout amber"><p><b>Switch-on condition:</b> referral rewards have a master switch that is off by default on mainnet. Multi-level referral may be treated as pyramid selling or unlicensed sales in some jurisdictions, so counsel must confirm in writing before it is enabled on mainnet. Promotional material must never promise a fixed return.</p></div>`,
    },
    {
      id: "trust", kicker: "09 · Trust & security", title: "Rules enforced by contracts", toc: "Evidence, separation of duties, self-custody", page: true,
      html: `
<div class="cards">
  <div class="card"><div class="ic">${icon("doc")}</div><h4>Evidence, not claims</h4><p>Purchase, insurance and operating documents are hashed on-chain. A hash proves a file is unchanged, not that it is genuine, so each change is attested by a named role.</p></div>
  <div class="card"><div class="ic">${icon("users")}</div><h4>Four-eyes rule</h4><p>Reports and payout batches are submitted by one party and approved by another; the automation also uses two separate keys, and one key cannot do both.</p></div>
  <div class="card"><div class="ic">${icon("lock")}</div><h4>Multisig governance</h4><p>Admin rights over every contract sit with a 2-of-3 multisig: any admin action needs at least 2 of 3 signers, so no single person can make changes. The deployer keeps no roles.</p></div>
  <div class="card"><div class="ic">${icon("shield")}</div><h4>Bounded powers</h4><p>No role can mint above the cap, divert escrow, rewrite records or move an investor's units. Contracts are built on OpenZeppelin and are not upgradeable.</p></div>
  <div class="card"><div class="ic">${icon("pause")}</div><h4>Emergency pause</h4><p>A separate pauser can halt contracts during an incident; unpausing requires governance.</p></div>
  <div class="card"><div class="ic">${icon("key")}</div><h4>Self-custody</h4><p>Units and payouts live in the investor's own wallet. There is no key recovery and no forced transfer.</p></div>
</div>`,
    },
    {
      id: "tech", kicker: "10 · Technology", title: "Architecture", toc: "BNB Chain contracts and services",
      html: `
<div class="arch">
  <div class="layer"><span class="lab">Apps</span><div><b>Investor site</b><i>Subscribe · portfolio · claim · transfer market · 9 languages</i></div><div><b>Operations console</b><i>Submission and review of projects, reports and payouts</i></div></div>
  <div class="layer"><span class="lab">Services</span><div><b>API and automation</b><i>Auto-settlement · auto-start · monthly payouts</i></div><div><b>Chain indexer</b><i>Confirmed blocks only, reorg-safe, reconciled with contracts</i></div><div><b>Data and files</b><i>PostgreSQL · Redis · project files encrypted, hashes on-chain</i></div></div>
  <div class="layer chain"><span class="lab">BNB Smart Chain</span><div><b>Registries</b><i>AssetRegistry · AuditRegistry · IdentityRegistry (freeze list)</i></div><div><b>Per project</b><i>RwaShareToken · OfferingManager · RevenueDistributor</i></div><div><b>Shared</b><i>ProjectFactory · SubscriptionRouter · ShareMarket · ProjectActivator</i></div></div>
</div>
<p>Payouts follow a reviewed monthly report; investor funds are never deposited into DeFi protocols.</p>`,
    },
    {
      id: "compliance", kicker: "11 · Compliance", title: "Compliance and identity checks", toc: "Current status and launch conditions", page: true,
      html: `
<p>A particular token structure or legal entity does not by itself make the platform compliant. Offering, transfer, custody, tax and data-protection duties depend on jurisdiction and on how the units are characterised legally, and must be settled by counsel before any public offering.</p>
<div class="callout amber"><p><b>Current status:</b> the platform performs no KYC/AML identity checks; any wallet that is not frozen can subscribe, hold and transfer units. A freeze list blocks stolen or sanctioned wallets. If the law later requires identity checks, the platform may need to change its service or even pause subscriptions and transfers. Counsel must confirm this arrangement before mainnet.</p></div>`,
    },
    {
      id: "roadmap", kicker: "12 · Roadmap", title: "Roadmap", toc: "Done, in progress, launch gate",
      html: `
<ol class="road">
  <li class="done"><h4>Architecture and product design <small>done</small></h4><p>Rights structure, fees, offering and distribution rules defined.</p></li>
  <li class="done"><h4>Core contracts, backend and apps <small>done</small></h4><p>Unit, offering, distribution and transfer-market contracts; indexer and API; investor site and operations console.</p></li>
  <li class="done"><h4>Security testing and BSC testnet <small>Oct 2026</small></h4><p>All contracts governed by a 2-of-3 multisig; the deployer holds no roles.</p></li>
  <li class="done"><h4>Operating term, automation and transfer market <small>Oct 2026</small></h4><p>Per-vehicle terms; auto-settlement, automatic start of service and monthly payouts; site-wide transfer market; promotion teams and three-level referral rewards (off by default on mainnet).</p></li>
  <li class="now"><h4>Testnet trial <small>in progress</small></h4><p>End-to-end subscribe, auto-start, monthly payouts, claim and transfer with test USDT.</p></li>
  <li><h4>Launch readiness</h4><p>External security audit, legal opinion (covering no KYC, automatic operation, the transfer market and multi-level referral), professional review of translations.</p></li>
  <li><h4>Mainnet</h4><p>Only after all of the above and explicit written approval.</p></li>
</ol>`,
    },
    {
      id: "risks", kicker: "13 · Key risks", title: "Before you invest", toc: "Summary of key risks", page: true,
      html: `
<p>You may lose part or all of your investment. Read the project's Rights Document, offering terms and the investor notes on the website before subscribing.</p>
<div class="risks">
  <div><h4>No guaranteed return</h4><p>Payouts depend on actual profit after costs, reserves and fees; periods without profit pay nothing.</p></div>
  <div><h4>Vehicle and operations</h4><p>Accidents, downtime, maintenance, depreciation, insurance, and changes at third-party autonomy and ride-hailing platforms.</p></div>
  <div><h4>Operator and issuer</h4><p>Reports are submitted by the operator and approved by a reviewer; unless stated, they are not independently audited; before the close the platform may buy unsold units with its own funds.</p></div>
  <div><h4>Liquidity</h4><p>A sale needs a buyer; you may not be able to sell at the price or time you want, and there is no redemption before the term ends.</p></div>
  <div><h4>Smart contracts and chain</h4><p>Contracts may contain bugs; congestion, wallet faults or phishing sites.</p></div>
  <div><h4>Private keys</h4><p>Losing your key permanently loses your units and payouts; nobody can recover them.</p></div>
  <div><h4>Stablecoin</h4><p>USDT is issued by a third party and may depeg or be frozen; only approve spending on the official site, and revoke at any time.</p></div>
  <div><h4>Regulation and tax</h4><p>No identity checks are performed, and laws may change and restrict or end a project; investors are responsible for their own taxes.</p></div>
</div>`,
    },
    {
      id: "notice", kicker: "14 · Notice", title: "Important notice", toc: "Nature and limits of this document",
      html: `
<div class="legal">
<p>This whitepaper is a draft that describes the design of RoboShare. It is not an offer or solicitation to buy or sell any security or investment product, and it is not investment, legal or tax advice. No public offering is currently open.</p>
<p>It claims no partnership with any vehicle manufacturer or autonomy platform, no approved operating location, vehicle price, historical return, guaranteed yield or regulatory approval. The revenue split and referral rewards are proposed business rules; example figures only illustrate the calculation.</p>
<p>Each project's Rights Document and offering terms govern; where they differ from this paper, they prevail. This English version is a translation; the Chinese version is the reference text.</p>
</div>`,
    },
  ],
  back: {
    title: "Transparency, from the first unit.",
    text: "RoboShare puts every vehicle's issuance, reports and payouts on-chain, so every holder can check for themselves.",
    end: "ROBOSHARE · BNB SMART CHAIN · USDT",
    note: "Draft v0.3 · October 2026 · Pending legal review · Not an offer",
  },
});

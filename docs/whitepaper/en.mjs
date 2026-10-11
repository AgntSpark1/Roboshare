// English whitepaper. Mirrors zh.mjs section by section; the Chinese text is the reference version.

export default ({ icon, structure }) => ({
  lang: "en",
  file: "RoboShare-Whitepaper-en.pdf",
  docTitle: "RoboShare Whitepaper",
  footer: "RoboShare Whitepaper · Draft v0.2 · Pending legal review",
  cover: {
    eyebrow: "WHITEPAPER",
    title: `Robo<span>Share</span>`,
    sub: "Unit-based participation in the operating profit of autonomous ride-hailing vehicles.<br>Settled in USDT, governed by smart contracts, auditable on-chain.",
    chips: ["1 vehicle = 100 units", "USDT (BEP20) in and out", "BNB Smart Chain", "2-of-3 multisig governance"],
    ver: `Version <b>0.2 draft</b><br>October 2026`,
    note: "This document is a draft that describes the product design. It is not an offer or solicitation to buy or sell any security or investment. Subject to legal review before any offering.",
  },
  toc: {
    title: "Contents",
    lede: "RoboShare splits the operating profit of a single robotaxi into 100 units, issued per vehicle and distributed per period. Here is how it works.",
  },
  sections: [
    {
      id: "overview", kicker: "01 · Overview", title: "One vehicle, one project, 100 units", toc: "Each vehicle is its own project", page: true,
      html: `
<p class="lead">RoboShare issues and manages robotaxi profit units on BNB Smart Chain. Each vehicle is a separate project with 100 units. Investors subscribe with USDT and share the vehicle's audited distributable profit in proportion to the units they hold.</p>
<div class="stats">
  <div class="stat"><b>100<em>units</em></b><span>Per project, capped in the contract; no further issuance</span></div>
  <div class="stat"><b>USDT</b><span>Subscriptions, refunds and payouts all use BEP20 USDT</span></div>
  <div class="stat"><b>0<em>mgmt fee</em></b><span>The platform only takes a tiered share of profit</span></div>
  <div class="stat"><b>2/3</b><span>Multisig controls every contract; each admin action needs 2 of 3 signers</span></div>
</div>
<p>Transparency is the core of the platform: who holds what, what each period reported, who approved it and what was paid are all linked through on-chain transactions and document hashes that anyone can check.</p>
<p>Units sit in the investor's own wallet and the platform cannot move them. Distribution rules are fixed in the contracts at deployment.</p>`,
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
<p>RoboShare accounts for each vehicle separately and issues it in units. Operating reports are recorded on-chain after review, payouts are computed by the contract and investors claim them themselves.</p>`,
    },
    {
      id: "how", kicker: "03 · How it works", title: "From subscription to payout", toc: "Four steps", page: true,
      html: `
<div class="steps">
  <div class="step"><h4>Pick a project</h4><p>Review the vehicle, unit price, minimum units and offering period.</p></div>
  <div class="step"><h4>Subscribe in USDT</h4><p>Approve once, then buy by choosing a number of units. Funds stay in contract escrow until settlement.</p></div>
  <div class="step"><h4>Vehicle operates</h4><p>After a successful offering, units arrive in your wallet; each period's financial report is reviewed and approved.</p></div>
  <div class="step"><h4>Claim each period</h4><p>The contract computes each holder's amount from a snapshot; claim your USDT in one tap.</p></div>
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
</ul>`,
    },
    {
      id: "offering", kicker: "05 · Offering", title: "Offering rules", toc: "Supply, price, minimum, escrow", page: true,
      html: `
<table>
  <tr><th style="width:30%">Item</th><th>Rule</th></tr>
  <tr><td class="k">Supply</td><td>100 whole units per project, capped in the contract, no further issuance</td></tr>
  <tr><td class="k">Price</td><td>A fixed unit price in USDT, set before each offering opens</td></tr>
  <tr><td class="k">Minimum units</td><td>Set before launch (1–100); reached at close means success, otherwise full refund</td></tr>
  <tr><td class="k">Per wallet</td><td>No per-wallet limit by default; a wallet can buy until the offering sells out</td></tr>
  <tr><td class="k">Escrow</td><td>Subscriptions are held by the offering contract until settlement; no role can divert them</td></tr>
  <tr><td class="k">Minting</td><td>Only at settlement, to subscribers who are still eligible, and only by that project's offering contract</td></tr>
  <tr><td class="k">Unsold units</td><td>Never issued, no follow-on offering; profit is shared over units actually issued</td></tr>
</table>
<h3>Only two possible outcomes</h3>
<div class="cards two">
  <div class="card dark"><div class="ic">${icon("check")}</div><h4>Minimum reached: settled</h4><p>If units sold at close reach the preset minimum, the offering settles. Units go to subscribers and proceeds go to the issuer treasury. Unsold units are never issued.</p></div>
  <div class="card"><div class="ic">${icon("refund")}</div><h4>Minimum missed: full refund</h4><p>If fewer units were sold, the offering is cancelled and every subscriber can take back their full USDT.</p></div>
</div>`,
    },
    {
      id: "returns", kicker: "06 · Distributions", title: "How payouts are calculated", toc: "Profit, fee tiers, example", page: true,
      html: `
<p>Each reporting period the operator submits a financial report; once a reviewer approves it, it is recorded on-chain. Distributable profit is:</p>
<div class="formula">
  <div>Actual revenue</div><i>−</i><div>Operating costs<small>charging, cleaning, upkeep, insurance</small></div><i>−</i><div>Approved reserves</div><i>−</i><div>Senior obligations<small>debt service, taxes</small></div><i>=</i><div class="res">Distributable profit D</div>
</div>
<p>A period with zero or negative profit pays nothing, and the platform takes nothing.</p>
<div class="keep"><h3>Platform share: the more you hold, the lower it is</h3>
<p>There is no management fee. The platform only takes a tiered share of what each holder receives, based on units held. Tiers are fixed when a project is deployed; changes apply to new projects only.</p>
<table>
  <tr><th>Units held in the project</th><th>Platform share</th><th class="r">Investor keeps</th></tr>
  <tr><td>1–4</td><td><span class="tier-bar" style="width:20mm"></span>20%</td><td class="r">80%</td></tr>
  <tr><td>5–9</td><td><span class="tier-bar" style="width:17.5mm"></span>17.5%</td><td class="r">82.5%</td></tr>
  <tr><td>10–19</td><td><span class="tier-bar" style="width:15mm"></span>15%</td><td class="r">85%</td></tr>
  <tr><td>20–49</td><td><span class="tier-bar" style="width:12.5mm"></span>12.5%</td><td class="r">87.5%</td></tr>
  <tr><td>50–100</td><td><span class="tier-bar" style="width:10mm"></span>10%</td><td class="r">90%</td></tr>
</table></div>
<div class="keep"><h3>Worked example <span class="tag">illustration only</span></h3>
<p>Assume distributable profit D = 10,000 USDT for a period and 100 units issued:</p>
<table>
  <tr><th>Holder</th><th class="r">Units</th><th class="r">Pro-rata</th><th class="r">Tier</th><th class="r">Platform</th><th class="r">Net</th></tr>
  <tr><td>A</td><td class="r">50</td><td class="r">5,000</td><td class="r">10%</td><td class="r">500</td><td class="r">4,500</td></tr>
  <tr><td>B</td><td class="r">25</td><td class="r">2,500</td><td class="r">12.5%</td><td class="r">312.5</td><td class="r">2,187.5</td></tr>
  <tr><td>C</td><td class="r">10</td><td class="r">1,000</td><td class="r">15%</td><td class="r">150</td><td class="r">850</td></tr>
  <tr><td>D</td><td class="r">9</td><td class="r">900</td><td class="r">17.5%</td><td class="r">157.5</td><td class="r">742.5</td></tr>
  <tr><td>E</td><td class="r">4</td><td class="r">400</td><td class="r">20%</td><td class="r">80</td><td class="r">320</td></tr>
  <tr><td>F</td><td class="r">2</td><td class="r">200</td><td class="r">20%</td><td class="r">40</td><td class="r">160</td></tr>
  <tr class="total"><td>Total</td><td class="r">100</td><td class="r">10,000</td><td class="r"></td><td class="r">1,240</td><td class="r">8,760</td></tr>
</table>
<p class="note" style="font-size:8.4pt;color:#66728D">Example figures do not represent the expected return of any project. Any projection in the product is labelled "Projected" and shown apart from "Actual" figures.</p></div>
<div class="pb"></div>
<h3>Distribution and claiming</h3>
<ul class="ticks">
  <li>Holdings are snapshotted at the end of each period; the contract computes every holder's amount from that snapshot.</li>
  <li>Holders claim for themselves (the operator may trigger a claim, but funds still go straight to the holder).</li>
  <li>Unclaimed amounts stay claimable indefinitely and are never swept to the operator.</li>
  <li>Rounding dust rolls into the next period; rounding favours investors.</li>
</ul>
<div class="callout"><p>Referral rewards, if switched on, are paid only out of the platform's share and never change the referee's price, units, tier or payout. The feature is off by default and needs legal review before it is enabled.</p></div>`,
    },
    {
      id: "exit", kicker: "07 · Transfers", title: "Transfer market", toc: "Exiting early",
      html: `
<p class="lead">Investors who want to exit early can list units on the platform's on-chain transfer market, where other eligible investors buy them with USDT.</p>
<div class="cards">
  <div class="card"><div class="ic">${icon("swap")}</div><h4>One atomic trade</h4><p>The buyer's USDT and the seller's units change hands in the same transaction; partial fills are allowed.</p></div>
  <div class="card"><div class="ic">${icon("lock")}</div><h4>No custody, no fee</h4><p>The market contract never holds funds or units, charges no fee, and sellers set their own price.</p></div>
  <div class="card"><div class="ic">${icon("users")}</div><h4>Eligible wallets only</h4><p>Buyers must be eligible and the project must be transferable; the unit contract enforces it.</p></div>
</div>
<p>The platform may buy listings like any other buyer, but has no obligation to repurchase and guarantees no price, timing or fill. Units should be treated as illiquid.</p>`,
    },
    {
      id: "trust", kicker: "08 · Trust & security", title: "Rules enforced by contracts", toc: "Evidence, separation of duties, self-custody", page: true,
      html: `
<div class="cards">
  <div class="card"><div class="ic">${icon("doc")}</div><h4>Evidence, not claims</h4><p>Purchase, insurance and operating documents are hashed on-chain. A hash proves a file is unchanged, not that it is genuine, so each change is attested by a named role.</p></div>
  <div class="card"><div class="ic">${icon("users")}</div><h4>Four-eyes rule</h4><p>Reports, payout batches and project verification are submitted by the operator and approved by a reviewer; one key cannot do both.</p></div>
  <div class="card"><div class="ic">${icon("lock")}</div><h4>Multisig governance</h4><p>Admin rights over every contract sit with a 2-of-3 multisig: any admin action needs at least 2 of 3 signers, so no single person can make changes. The deployer keeps no roles.</p></div>
  <div class="card"><div class="ic">${icon("shield")}</div><h4>Bounded powers</h4><p>No role can mint above the cap, divert escrow, rewrite records or move an investor's units. Contracts are built on OpenZeppelin and are not upgradeable.</p></div>
  <div class="card"><div class="ic">${icon("pause")}</div><h4>Emergency pause</h4><p>A separate pauser can halt contracts during an incident; unpausing requires governance.</p></div>
  <div class="card"><div class="ic">${icon("key")}</div><h4>Self-custody</h4><p>Units and payouts live in the investor's own wallet. There is no key recovery and no forced transfer.</p></div>
</div>`,
    },
    {
      id: "tech", kicker: "09 · Technology", title: "Architecture", toc: "BNB Chain contracts and services",
      html: `
<div class="arch">
  <div class="layer"><span class="lab">Apps</span><div><b>Investor site</b><i>Subscribe · portfolio · claim · transfer market · 9 languages</i></div><div><b>Operations console</b><i>Submission and review of projects, reports and payouts</i></div></div>
  <div class="layer"><span class="lab">Services</span><div><b>API and workers</b><i>NestJS · PostgreSQL · Redis</i></div><div><b>Chain indexer</b><i>Confirmed blocks only, reorg-safe, reconciled with contracts</i></div><div><b>Encrypted storage</b><i>Project files stored encrypted, hashes on-chain</i></div></div>
  <div class="layer chain"><span class="lab">BNB Smart Chain</span><div><b>Registries</b><i>AssetRegistry · AuditRegistry · IdentityRegistry</i></div><div><b>Per project</b><i>RwaShareToken · OfferingManager · RevenueDistributor</i></div><div><b>Shared</b><i>ProjectFactory · SubscriptionRouter · ShareMarket</i></div></div>
</div>
<p>Operating data enters through a manual, reviewed reporting flow and does not depend on any manufacturer's data API. Investor funds are never deposited into DeFi protocols automatically.</p>`,
    },
    {
      id: "compliance", kicker: "10 · Compliance", title: "Compliance and identity checks", toc: "Current status and preconditions", page: true,
      html: `
<p>Transfer-restricted tokens or a particular legal entity do not by themselves make the platform compliant. Offering, transfer, custody, tax and data-protection duties depend on jurisdiction and on how the units are characterised legally, and must be settled by counsel before any public offering.</p>
<div class="callout amber"><p><b>Current status:</b> no third-party KYC/AML provider is connected yet. Eligibility is set manually by operators for testing and internal demos only. Real identity verification is a precondition for any public offering and for mainnet.</p></div>`,
    },
    {
      id: "roadmap", kicker: "11 · Roadmap", title: "Roadmap", toc: "Done, in progress, launch gate",
      html: `
<ol class="road">
  <li class="done"><h4>Architecture and product design <small>done</small></h4><p>Rights structure, fees, offering and distribution rules defined.</p></li>
  <li class="done"><h4>Core contracts, backend and apps <small>done</small></h4><p>Unit, offering, distribution and transfer-market contracts; indexer and API; investor site and operations console.</p></li>
  <li class="done"><h4>Security testing and BSC testnet <small>Oct 2026</small></h4><p>All contracts governed by a 2-of-3 multisig; the deployer holds no roles.</p></li>
  <li class="now"><h4>Testnet trial <small>in progress</small></h4><p>End-to-end subscribe, distribute, claim and transfer with test USDT.</p></li>
  <li><h4>Launch readiness</h4><p>External security audit, legal opinion, KYC/AML integration, professional review of translations.</p></li>
  <li><h4>Mainnet</h4><p>Only after all of the above and explicit written approval.</p></li>
</ol>`,
    },
    {
      id: "risks", kicker: "12 · Key risks", title: "Before you invest", toc: "Summary of key risks", page: true,
      html: `
<p>You may lose part or all of your investment. Read the project's Rights Document, offering terms and the investor notes on the website before subscribing.</p>
<div class="risks">
  <div><h4>No guaranteed return</h4><p>Payouts depend on actual profit after costs, reserves and fees; periods without profit pay nothing.</p></div>
  <div><h4>Vehicle and operations</h4><p>Accidents, downtime, maintenance, depreciation, insurance, and changes at third-party autonomy and ride-hailing platforms.</p></div>
  <div><h4>Operator and issuer</h4><p>Reports are submitted by the operator and approved by a reviewer; unless stated, they are not independently audited.</p></div>
  <div><h4>Liquidity</h4><p>A sale needs an eligible buyer; you may not be able to sell at the price or time you want.</p></div>
  <div><h4>Smart contracts and chain</h4><p>Contracts may contain bugs; congestion, wallet faults or phishing sites.</p></div>
  <div><h4>Private keys</h4><p>Losing your key permanently loses your units and payouts; nobody can recover them.</p></div>
  <div><h4>Stablecoin</h4><p>USDT is issued by a third party and may depeg or be frozen; only approve spending on the official site, and revoke at any time.</p></div>
  <div><h4>Regulation and tax</h4><p>Laws may change and restrict or end a project; investors are responsible for their own taxes.</p></div>
</div>`,
    },
    {
      id: "notice", kicker: "13 · Notice", title: "Important notice", toc: "Nature and limits of this document",
      html: `
<div class="legal">
<p>This whitepaper is a draft that describes the design of RoboShare. It is not an offer or solicitation to buy or sell any security or investment product, and it is not investment, legal or tax advice. No public offering is currently open.</p>
<p>It claims no partnership with any vehicle manufacturer or autonomy platform, no approved operating location, vehicle price, historical return, guaranteed yield or regulatory approval. Fee tiers are proposed business rules; example figures only illustrate the calculation.</p>
<p>Each project's Rights Document and offering terms govern; where they differ from this paper, they prevail. This English version is a translation; the Chinese version is the reference text.</p>
</div>`,
    },
  ],
  back: {
    title: "Transparency, from the first unit.",
    text: "RoboShare puts every vehicle's issuance, reports and payouts on-chain, so every holder can check for themselves.",
    end: "ROBOSHARE · BNB SMART CHAIN · USDT",
    note: "Draft v0.2 · October 2026 · Pending legal review · Not an offer",
  },
});

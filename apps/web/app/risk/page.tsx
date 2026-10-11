import Link from "next/link";

/** Investor notes. Draft wording for counsel review; each project's rights document and offering terms prevail. */
const SAFEGUARDS: [string, string][] = [
  ["未成团全额退款", "募集期结束没达到最低份数，USDT 原路全额退回。"],
  ["份额在你自己的钱包", "平台和治理方都无法转走你的份额。"],
  ["账目公开", "每期运营报告记录在链上，审核通过后才会分配收益。"],
  ["规则不能随意改", "项目合约部署后不可升级；平台的管理操作需要多人签名，并提前 24 小时公示。"],
];

const RISKS: [string, string[]][] = [
  ["收益会有波动", ["收益来自车辆实际运营利润，扣除成本、储备和平台分成后分配；没有利润的期间不分配。", "任何预测都只是估计。"]],
  ["份额是什么", ["份额代表项目文件中约定的收益分配权益，不是车辆所有权。"]],
  ["车辆运营", ["事故、维修、停运、折旧、保险变化和监管政策都会影响收益。", "自动驾驶软件和网约车平台由第三方提供。"]],
  ["运营方与报告", ["运营报告由运营方提交、平台审核人批准；除非另有标注，未经外部审计。", "平台分成按持有份数分档，为分配额的 10%–20%。"]],
  ["转让", ["份额只能转给通过认证的钱包，目前没有官方二级市场，可能无法随时卖出。"]],
  ["钱包与私钥", ["请保管好钱包私钥或助记词，丢失后无法恢复，平台不提供任何找回功能。", "只通过官方网址访问，谨防仿冒网站。"]],
  ["USDT 与授权", ["认购和收益使用 BSC 上的 USDT（BEP20）。", "不限额授权在撤销前一直有效，可在“我的资产”随时撤销。"]],
  ["智能合约", ["合约可能存在未发现的缺陷；合约不可升级，修复可能需要迁移。"]],
  ["管理权限", ["治理多签可以暂停合约或调整角色（不能转走份额），这些权限有被滥用或被攻破的可能。"]],
  ["监管与税务", ["相关法律可能变化，并可能限制或终止项目；税务由你自行申报。"]],
  ["身份认证", ["测试阶段尚未接入第三方 KYC/AML 服务，由运营人员手动设置钱包资格；正式开放前会接入。"]],
];

export default function Risk() {
  return (
    <section>
      <div className="wrap">
        <div className="sec-h">
          <h1 className="h2">投资须知</h1>
          <p>认购前花两分钟了解，投资更安心。具体以每个项目的募集条款为准。</p>
        </div>
        <div className="trust" style={{ marginBottom: 24 }}>
          {SAFEGUARDS.map(([h, t]) => (
            <div key={h}>
              <h3>{h}</h3>
              <p>{t}</p>
            </div>
          ))}
        </div>
        <h2 className="h3">需要了解的事项</h2>
        <p className="muted" style={{ marginBottom: 12 }}>投资可能亏损，收益不作保证。</p>
        <div className="risk-list">
          {RISKS.map(([h, l]) => (
            <details key={h}>
              <summary>{h}</summary>
              <ul>{l.map((x) => <li key={x}>{x}</li>)}</ul>
            </details>
          ))}
        </div>
        <p style={{ marginTop: 18 }}>
          <Link className="btn ghost" href="/projects">查看车辆项目</Link>
        </p>
      </div>
    </section>
  );
}

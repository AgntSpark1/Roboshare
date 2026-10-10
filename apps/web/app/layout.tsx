import "@roboshare/ui/styles.css";
import "./web.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Header, Tabs } from "@/components/Header";
import { CHAIN_NAME, isTestChain, walletEnv } from "@/env";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "RoboShare · Robotaxi 份额",
  description: "按份额认购单辆自动驾驶网约车的利润分配权。USDT 结算，规则写在 BNB Chain 合约里。",
};

export const viewport: Viewport = { themeColor: "#050914", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=JetBrains+Mono:wght@400;600&family=Noto+Sans+SC:wght@400;500;700;900&display=swap"
        />
      </head>
      <body>
        <a className="skip" href="#main">跳到正文</a>
        <Providers>
          {isTestChain && (
            <div className="ribbon" role="note">
              <b>测试网络</b> · {CHAIN_NAME[walletEnv.chainId]} · 使用仅供测试的模拟 USDT，页面上的项目与金额来自测试链，不是真实收益，也不构成要约
            </div>
          )}
          <Header />
          <main id="main">{children}</main>
          <footer>
            <div className="wrap">
              <span>RoboShare · 链 ID {walletEnv.chainId}（{CHAIN_NAME[walletEnv.chainId] ?? "未知网络"}）· 结算币种 USDT（BEP20）</span>
              <span>份额代表单车利润分配的合同权益，不是车辆所有权，不保证任何回报。你可能损失全部投资。RoboShare 与 Tesla 不存在任何合作关系。</span>
            </div>
          </footer>
          <Tabs />
        </Providers>
      </body>
    </html>
  );
}

import "@roboshare/ui/styles.css";
import "./admin.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Gate } from "@/components/Gate";
import { CHAIN_NAME, isTestChain, walletEnv } from "@/env";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "RoboShare 运营控制台",
  description: "RoboShare 运营、审核与治理人员使用的控制台。",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=JetBrains+Mono:wght@400;600&family=Noto+Sans+SC:wght@400;500;700;900&display=swap"
        />
      </head>
      <body>
        <a className="skip" href="#main">跳到正文</a>
        {isTestChain && (
          <div className="ribbon" role="note">
            <b>测试网络</b> · {CHAIN_NAME[walletEnv.chainId]} · 运营控制台与投资者 DApp 分开部署 · 测试链上的数据，不是真实资金
          </div>
        )}
        <Providers>
          <Gate>{children}</Gate>
        </Providers>
      </body>
    </html>
  );
}

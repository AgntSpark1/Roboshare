"use client";
import { createContext, useContext, type ReactNode } from "react";
import { STATE_LABEL } from "./format";

/**
 * Text used by the shared components. Chinese is the default, so the ops console (Chinese only) needs no provider;
 * the investor site passes the visitor's language through <UiStringsProvider>.
 */
export interface UiStrings {
  close: string;
  connectWallet: string;
  /** Header button on phones, where the long label would not fit. */
  connectShort: string;
  signIn: string;
  copied: string;
  copyUrl: string;
  noWalletHint: string;
  testWallet: (addr: string) => string;
  browserWallet: string;
  binanceWallet: string;
  confirmConnect: string;
  testOnly: string;
  noWalletDetected: string;
  walletsHint: string;
  switchTo: (chain: string) => string;
  switchNetwork: string;
  disconnectWallet: string;
  disconnect: (addr: string) => string;
  signedIn: (addr: string) => string;
  signOutTitle: string;
  chainNames: Record<number, string>;
  siweStatement: string;
  connectFirst: string;
  progress: { label: string; sold: (sold: number, max: number) => string; min: (min: number) => string; valueText: (sold: number, max: number, min: number) => string };
  txState: { idle: string; signing: string; pending: string; done: string; error: string };
  txRejected: string;
  txReverted: string;
  contractRejected: (reason: string) => string;
  walletErrors: {
    rejected: string;
    noProvider: string;
    pendingRequest: string;
    wrongChain: string;
    switchFailed: string;
    generic: (msg: string) => string;
    retry: string;
  };
  states: Record<string, string>;
  days: (d: number) => string;
}

export const zhUiStrings: UiStrings = {
  close: "关闭",
  connectWallet: "连接钱包",
  connectShort: "连接钱包",
  signIn: "签名登录",
  copied: "已复制",
  copyUrl: "复制网址",
  noWalletHint: "这个浏览器里没有钱包。手机上请用下面的钱包 App 打开本页，再点“连接钱包”。",
  testWallet: (a) => `测试钱包 ${a}`,
  browserWallet: "浏览器钱包",
  binanceWallet: "币安钱包",
  confirmConnect: "请在钱包里确认连接…",
  testOnly: "仅本地测试链（TEST-ONLY）",
  noWalletDetected: "未检测到钱包",
  walletsHint: "MetaMask、币安、OKX、TokenPocket、Bitget、Trust 等",
  switchTo: (c) => `切换到${c}`,
  switchNetwork: "切换网络",
  disconnectWallet: "断开钱包",
  disconnect: (a) => `断开 ${a}`,
  signedIn: (a) => `已登录 ${a}，点击退出`,
  signOutTitle: "退出登录并断开钱包",
  chainNames: { 56: "BNB 智能链", 97: "BSC 测试网", 31337: "本地测试链" },
  siweStatement: "登录 RoboShare。此签名不会发起交易，也不会产生任何费用。",
  connectFirst: "请先连接钱包",
  progress: { label: "募集进度", sold: (s, m) => `已认购 ${s} / ${m} 份`, min: (m) => `最低 ${m} 份`, valueText: (s, m, n) => `已认购 ${s} / ${m} 份，最低 ${n} 份` },
  txState: { idle: "等待", signing: "请在钱包中确认", pending: "等待区块确认", done: "已确认", error: "失败" },
  txRejected: "你在钱包里拒绝了这笔交易",
  txReverted: "交易在链上执行失败（reverted）",
  contractRejected: (r) => `合约拒绝：${r}`,
  walletErrors: {
    rejected: "你在钱包里取消了这次请求",
    noProvider: "没有检测到钱包。请在钱包 App 里打开本页，或在电脑浏览器安装 MetaMask。",
    pendingRequest: "钱包里还有一个待处理的请求，请打开钱包 App 处理后再试",
    wrongChain: "钱包所在的网络不对，请先切换到本站使用的网络",
    switchFailed: "钱包没能切换网络，请在钱包里手动切换后再试",
    generic: (m) => `出错了：${m}`,
    retry: "出错了，请重试",
  },
  states: STATE_LABEL,
  days: (d) => `${d}天`,
};

const Ctx = createContext<UiStrings>(zhUiStrings);

export function UiStringsProvider({ strings, children }: { strings: UiStrings; children: ReactNode }) {
  return <Ctx.Provider value={strings}>{children}</Ctx.Provider>;
}

export function useUiStrings(): UiStrings {
  return useContext(Ctx);
}

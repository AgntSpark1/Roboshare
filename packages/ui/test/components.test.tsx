import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "../src/components/Modal";
import { OfferingProgress } from "../src/components/OfferingProgress";
import { StatePill } from "../src/components/StatePill";
import { TxProgress } from "../src/components/TxProgress";
import { WalletButton } from "../src/components/WalletButton";
import { walletErrorMessage } from "../src/wallet";
import { txErrorMessage } from "../src/tx";
import { ContractFunctionRevertedError, InsufficientFundsError, encodeErrorResult, parseAbi } from "viem";
import { Web3Providers } from "../src/providers";

describe("components", () => {
  it("exposes offering progress to assistive technology", () => {
    render(<OfferingProgress sold={63} min={60} />);
    const bar = screen.getByRole("progressbar", { name: "募集进度" });
    expect(bar).toHaveAttribute("aria-valuenow", "63");
    expect(bar).toHaveAttribute("aria-valuetext", "已认购 63 / 100 份，最低 60 份");
  });

  it("shows the Chinese state label", () => {
    render(<StatePill state="ACTIVE" />);
    expect(screen.getByText("运营中")).toHaveClass("pill", "s-ACTIVE");
  });

  it("reports each wallet step and the failure reason", () => {
    render(
      <TxProgress
        steps={[{ label: "授权 USDT" }, { label: "认购 3 份" }]}
        run={{ states: ["done", "error"], hashes: [`0x${"ab".repeat(32)}`, undefined], error: "你在钱包里拒绝了这笔交易", running: false }}
      />,
    );
    expect(screen.getByText(/授权 USDT · 已确认/)).toBeInTheDocument();
    expect(screen.getByText(/认购 3 份 · 失败/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("拒绝");
  });

  it("is a labelled dialog that closes on Escape and on the close button", async () => {
    const onClose = vi.fn();
    render(<Modal title="连接钱包" onClose={onClose}><p>内容</p></Modal>);
    expect(screen.getByRole("dialog", { name: "连接钱包" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("lists TEST-ONLY wallets only on the local chain", async () => {
    const wallet = "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955" as const;
    const { unmount } = render(
      <Web3Providers env={{ chainId: 31337, testWallets: [wallet] }}>
        <WalletButton />
      </Web3Providers>,
    );
    await userEvent.click(screen.getByRole("button", { name: "连接钱包" }));
    const dialog = screen.getByRole("dialog", { name: "连接钱包" });
    expect(within(dialog).getByRole("button", { name: /测试钱包 0x14dc…9955/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /浏览器钱包/ })).toBeInTheDocument();
    unmount();

    render(
      <Web3Providers env={{ chainId: 97, testWallets: [wallet] }}>
        <WalletButton />
      </Web3Providers>,
    );
    await userEvent.click(screen.getByRole("button", { name: "连接钱包" }));
    expect(screen.queryByRole("button", { name: /测试钱包/ })).not.toBeInTheDocument();
  });

  it("renders the dialog into <body> so a blurred sticky header cannot clip it", () => {
    render(
      <header style={{ backdropFilter: "blur(14px)" }} data-testid="hdr">
        <Modal title="连接钱包" onClose={() => {}}><p>内容</p></Modal>
      </header>,
    );
    const dialog = screen.getByRole("dialog", { name: "连接钱包" });
    expect(screen.getByTestId("hdr")).not.toContainElement(dialog);
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("offers scan-to-connect first when a WalletConnect project ID is set, and hides it otherwise", async () => {
    const { unmount } = render(
      <Web3Providers env={{ chainId: 97, walletConnectProjectId: "0123456789abcdef0123456789abcdef" }}>
        <WalletButton />
      </Web3Providers>,
    );
    await userEvent.click(screen.getByRole("button", { name: "连接钱包" }));
    const dialog = screen.getByRole("dialog", { name: "连接钱包" });
    const entries = within(dialog).getAllByRole("button").filter((b) => b.closest(".wallets"));
    expect(entries[0]).toHaveTextContent("扫码连接");
    expect(entries[0]!.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    unmount();
    render(
      <Web3Providers env={{ chainId: 97 }}>
        <WalletButton />
      </Web3Providers>,
    );
    await userEvent.click(screen.getByRole("button", { name: "连接钱包" }));
    expect(within(screen.getByRole("dialog", { name: "连接钱包" })).queryByText("扫码连接")).not.toBeInTheDocument();
  });

  it("offers to open the page in a wallet app when the browser has no wallet", async () => {
    render(
      <Web3Providers env={{ chainId: 97 }}>
        <WalletButton />
      </Web3Providers>,
    );
    await userEvent.click(screen.getByRole("button", { name: "连接钱包" }));
    const dialog = screen.getByRole("dialog", { name: "连接钱包" });
    expect(within(dialog).getByRole("link", { name: "MetaMask" })).toHaveAttribute("href", expect.stringMatching(/^https:\/\/metamask\.app\.link\/dapp\//));
    expect(within(dialog).getByRole("link", { name: "Trust Wallet" })).toHaveAttribute("href", expect.stringContaining(encodeURIComponent(window.location.href)));
    expect(within(dialog).getByText("未检测到钱包")).toBeInTheDocument();
    for (const name of ["MetaMask", "币安钱包", "OKX Wallet", "TokenPocket", "Bitget Wallet", "Trust Wallet"]) {
      const link = within(dialog).getByRole("link", { name });
      expect(link.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    }
    expect(within(dialog).getByRole("link", { name: "Bitget Wallet" })).toHaveAttribute("href", expect.stringMatching(/^https:\/\/bkcode\.vip\?action=dapp&url=/));
    const tp = within(dialog).getByRole("link", { name: "TokenPocket" }).getAttribute("href")!;
    expect(JSON.parse(decodeURIComponent(tp.replace("tpdapp://open?params=", "")))).toMatchObject({ url: window.location.href, chain: "BSC" });
    const bn = new URL(within(dialog).getByRole("link", { name: "币安钱包" }).getAttribute("href")!);
    const dp = atob(bn.searchParams.get("_dp")!);
    expect(atob(new URL(dp.replace("bnc://", "https://")).searchParams.get("startPageQuery")!)).toBe(`url=${window.location.href}&defaultChainId=97`);
  });

  it("explains wallet failures in Chinese", () => {
    expect(walletErrorMessage(Object.assign(new Error("User rejected the request."), { code: 4001 }))).toBe("你在钱包里取消了这次请求");
    const nested = Object.assign(new Error("Request failed"), { cause: Object.assign(new Error("Already processing"), { code: -32002 }) });
    expect(walletErrorMessage(nested)).toMatch(/待处理的请求/);
    expect(walletErrorMessage(Object.assign(new Error("x"), { name: "ProviderNotFoundError" }))).toMatch(/没有检测到钱包/);
    expect(walletErrorMessage(new Error("boom\nstack"))).toBe("出错了：boom");
  });

  it("turns contract errors and a missing network fee into plain words", () => {
    const abi = parseAbi(["error PerWalletLimit(uint32 requested, uint32 allowed)", "error SomethingNew()"]);
    const revert = (errorName: "PerWalletLimit" | "SomethingNew", args?: readonly unknown[]) =>
      new ContractFunctionRevertedError({ abi, functionName: "subscribe", data: encodeErrorResult({ abi, errorName, args } as never) });
    expect(txErrorMessage(revert("PerWalletLimit", [5, 2]))).toBe("超过了每个钱包的认购上限。资金没有变动。");
    expect(txErrorMessage(revert("SomethingNew"))).toBe("合约拒绝：SomethingNew。资金没有变动。");
    expect(txErrorMessage(new InsufficientFundsError())).toMatch(/BNB/);
  });
});

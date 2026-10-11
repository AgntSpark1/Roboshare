import { BINANCE_SVG, BITGET_SVG, METAMASK_SVG, OKX_SVG, TOKENPOCKET_SVG, TRUST_SVG } from "./walletLogos";

export interface WalletApp {
  name: string;
  /** data: URI of the brand mark, drawn on a white tile so dark marks (OKX) stay visible. */
  logo: string;
  /** Opens this page inside the wallet app's own browser, where the wallet is injected. */
  url: string;
}

const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
/** Called only in the browser (the dialog reads window.location), so btoa is available. */
const b64 = (s: string) => window.btoa(s);

/** Binance's own format (@binance/w3w-utils getDeepLink); the https form falls back to the app download page. */
function binanceLink(href: string, chainId: number) {
  const startPagePath = b64("/pages/browser/index");
  const startPageQuery = b64(`url=${href}&defaultChainId=${chainId}`);
  const bnc = `bnc://app.binance.com/mp/app?appId=yFK5FCqYprrXDiVFbhyRx7&startPagePath=${startPagePath}&startPageQuery=${startPageQuery}`;
  return `https://app.binance.com/en/download?_dp=${b64(bnc)}`;
}

/** Deep links per wallet's developer docs. Order: most used in our market first. */
export function walletApps(href: string, chainId: number): WalletApp[] {
  const bare = href.replace(/^https?:\/\//, "");
  const enc = encodeURIComponent(href);
  return [
    { name: "MetaMask", logo: svgUri(METAMASK_SVG), url: `https://metamask.app.link/dapp/${bare}` },
    { name: "币安钱包", logo: svgUri(BINANCE_SVG), url: binanceLink(href, chainId) },
    { name: "OKX Wallet", logo: svgUri(OKX_SVG), url: `okx://wallet/dapp/url?dappUrl=${enc}` },
    {
      name: "TokenPocket",
      logo: svgUri(TOKENPOCKET_SVG),
      url: `tpdapp://open?params=${encodeURIComponent(JSON.stringify({ url: href, chain: "BSC", source: "RoboShare" }))}`,
    },
    { name: "Bitget Wallet", logo: svgUri(BITGET_SVG), url: `https://bkcode.vip?action=dapp&url=${enc}` },
    { name: "Trust Wallet", logo: svgUri(TRUST_SVG), url: `https://link.trustwallet.com/open_url?coin_id=20000714&url=${enc}` },
  ];
}

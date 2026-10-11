"use client";
import { useMemo } from "react";
import { encode } from "uqr";

/** QR code drawn locally from the text (nothing is sent to a third-party service). */
export function useQrMatrix(text: string): boolean[][] {
  return useMemo(() => (text ? encode(text, { ecc: "M", border: 2 }).data : []), [text]);
}

export function QrCode({ text, label, size = 200 }: { text: string; label: string; size?: number }) {
  const data = useQrMatrix(text);
  const n = data.length;
  const path = useMemo(() => {
    let d = "";
    data.forEach((row, y) => row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }));
    return d;
  }, [data]);
  if (!n) return null;
  return (
    <svg className="qr" role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" data-testid="qr">
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#0A1020" />
    </svg>
  );
}

/** PNG data URL of the same QR code, for saving or sharing as an image. */
export function qrPng(data: boolean[][], scale = 10): string {
  const n = data.length;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0A1020";
  data.forEach((row, y) => row.forEach((on, x) => on && ctx.fillRect(x * scale, y * scale, scale, scale)));
  return canvas.toDataURL("image/png");
}

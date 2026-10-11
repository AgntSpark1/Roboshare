// Shared SVG artwork for the whitepaper (cover background, structure diagram). Units: mm on A4.

const CAR = "M8 21.5c0-3 1.6-5.6 4-6.6l2.2-3.4h6l2.4 3.4c2.4 1 3.9 3.6 3.9 6.6v1.5H8z";

export function mark(size = 30) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 34 34" aria-hidden="true">
    <rect x="1" y="1" width="32" height="32" rx="9" fill="#17223B" stroke="#30406A"/>
    <path d="${CAR}" fill="#F6B53D"/>
    <circle cx="12.3" cy="23.4" r="2.2" fill="#0A1020" stroke="#F6B53D" stroke-width="1.4"/>
    <circle cx="21.7" cy="23.4" r="2.2" fill="#0A1020" stroke="#F6B53D" stroke-width="1.4"/>
    <circle cx="17" cy="9" r="1.8" fill="#4FE3D2"/></svg>`;
}

/** Night-city backdrop: aurora glows, a perspective road grid and the brand car scanning with lidar rings. */
export function coverArt({ grid = true } = {}) {
  const vx = 105, vy = 178; // vanishing point
  let lines = "";
  if (grid) {
    for (let i = -14; i <= 14; i++) {
      const x = vx + i * 22;
      lines += `<line x1="${vx}" y1="${vy}" x2="${x}" y2="297" stroke="url(#gl)" stroke-width="${i === 0 ? 0.35 : 0.22}"/>`;
    }
    for (let k = 1; k <= 12; k++) {
      const y = vy + Math.pow(k / 12, 2.1) * (297 - vy);
      lines += `<line x1="0" y1="${y.toFixed(2)}" x2="210" y2="${y.toFixed(2)}" stroke="#3CF0FF" stroke-opacity="${(0.05 + k * 0.012).toFixed(3)}" stroke-width="0.2"/>`;
    }
  }
  const cx = 105, cy = 236;
  return `<svg class="bg" viewBox="0 0 210 297" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <radialGradient id="g1" cx="85%" cy="4%" r="70%"><stop offset="0" stop-color="#8B7BFF" stop-opacity=".42"/><stop offset="1" stop-color="#8B7BFF" stop-opacity="0"/></radialGradient>
    <radialGradient id="g2" cx="-5%" cy="42%" r="60%"><stop offset="0" stop-color="#3CF0FF" stop-opacity=".18"/><stop offset="1" stop-color="#3CF0FF" stop-opacity="0"/></radialGradient>
    <radialGradient id="g3" cx="50%" cy="80%" r="45%"><stop offset="0" stop-color="#2563EB" stop-opacity=".35"/><stop offset="1" stop-color="#2563EB" stop-opacity="0"/></radialGradient>
    <linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3CF0FF" stop-opacity="0"/><stop offset="1" stop-color="#3CF0FF" stop-opacity=".38"/></linearGradient>
    <linearGradient id="car" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFD27A"/><stop offset="1" stop-color="#F6B53D"/></linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#050914" stop-opacity="0"/><stop offset="1" stop-color="#050914" stop-opacity=".92"/></linearGradient>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
  <rect width="210" height="297" fill="#050914"/>
  <rect width="210" height="297" fill="url(#g1)"/>
  <rect width="210" height="297" fill="url(#g2)"/>
  <rect width="210" height="297" fill="url(#g3)"/>
  ${lines}
  <g fill="none" stroke="#3CF0FF">
    <ellipse cx="${cx}" cy="${cy + 2}" rx="34" ry="7" stroke-opacity=".55" stroke-width=".35"/>
    <ellipse cx="${cx}" cy="${cy + 2}" rx="56" ry="11.5" stroke-opacity=".3" stroke-width=".3"/>
    <ellipse cx="${cx}" cy="${cy + 2}" rx="82" ry="17" stroke-opacity=".16" stroke-width=".3"/>
  </g>
  <path d="M${cx} ${cy - 56} L${cx - 64} ${cy + 4} L${cx + 64} ${cy + 4}Z" fill="#3CF0FF" fill-opacity=".05"/>
  <ellipse cx="${cx}" cy="${cy + 3}" rx="40" ry="5" fill="#3CF0FF" fill-opacity=".22" filter="url(#blur)"/>
  ${robotaxi(cx, cy)}
  <g fill="#3CF0FF">
    <circle cx="38" cy="214" r=".7" opacity=".7"/><circle cx="176" cy="206" r=".6" opacity=".6"/><circle cx="58" cy="262" r=".8" opacity=".5"/>
    <circle cx="160" cy="258" r=".7" opacity=".6"/><circle cx="24" cy="244" r=".5" opacity=".5"/><circle cx="190" cy="236" r=".5" opacity=".5"/>
  </g>
  <rect width="210" height="297" fill="url(#fade)"/>
</svg>`;
}

/** Investor → unit → rights document → issuer → vehicle, left to right. */
export function structure(labels) {
  const w = 128, h = 74, gap = 18, y = 22;
  const colors = ["#0A1020", "#1E3A8A", "#2563EB", "#4C3FD0", "#6D5BEA"];
  let out = "";
  labels.boxes.forEach(([title, sub], i) => {
    const x = i * (w + gap);
    out += `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${colors[i]}"/>
      <text x="${x + w / 2}" y="${y + 30}" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">${title}</text>
      ${sub.map((s, j) => `<text x="${x + w / 2}" y="${y + 50 + j * 14}" text-anchor="middle" font-size="10" fill="#C9D3EA">${s}</text>`).join("")}</g>`;
    if (i < labels.boxes.length - 1) {
      const ax = x + w + 2, bx = x + w + gap - 2, my = y + h / 2;
      out += `<line x1="${ax}" y1="${my}" x2="${bx - 3}" y2="${my}" stroke="#94A3C4" stroke-width="1.4"/>
        <path d="M${bx - 6} ${my - 4} L${bx} ${my} L${bx - 6} ${my + 4}" fill="none" stroke="#94A3C4" stroke-width="1.4"/>
        <text x="${(ax + bx) / 2}" y="${y - 8}" text-anchor="middle" font-size="9" fill="#66728D">${labels.arrows[i]}</text>`;
    }
  });
  const total = labels.boxes.length * w + (labels.boxes.length - 1) * gap;
  return `<svg viewBox="0 0 ${total} ${y + h + 6}" font-family="inherit">${out}</svg>`;
}

/** Side-profile robotaxi with roof lidar; (cx, cy) is the centre of the ground line. */
function robotaxi(cx, cy) {
  const k = 0.74, x0 = cx - 101 * k, y0 = cy - 71 * k;
  return `<g transform="translate(${x0.toFixed(2)} ${y0.toFixed(2)}) scale(${k})">
    <defs>
      <linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A3A66"/><stop offset=".55" stop-color="#141F3C"/><stop offset="1" stop-color="#0B1226"/></linearGradient>
      <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8B7BFF"/><stop offset=".5" stop-color="#3CF0FF"/><stop offset="1" stop-color="#6FA8FF"/></linearGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3CF0FF" stop-opacity=".45"/><stop offset="1" stop-color="#6D5BEA" stop-opacity=".25"/></linearGradient>
      <radialGradient id="beam" cx="50%" cy="0%" r="100%"><stop offset="0" stop-color="#3CF0FF" stop-opacity=".35"/><stop offset="1" stop-color="#3CF0FF" stop-opacity="0"/></radialGradient>
    </defs>
    <path d="M101 14 L-30 70 L232 70Z" fill="url(#beam)" opacity=".5"/>
    <path d="M8 56 C8 47 13 43 24 41 L52 37 C66 24 82 18 104 18 C127 18 142 24 158 35 L180 39 C190 41 194 46 194 52 L194 57 C194 60 192 62 189 62 L174 62 A17 17 0 0 0 140 62 L66 62 A17 17 0 0 0 32 62 L13 62 C10 62 8 60 8 57 Z" fill="url(#body)" stroke="url(#edge)" stroke-width=".9"/>
    <path d="M60 37 C71 27 85 23 101 23 L101 37 Z" fill="url(#glass)"/>
    <path d="M107 23 C124 23 137 27 150 36 L107 37 Z" fill="url(#glass)"/>
    <path d="M22 47 L186 47" stroke="#3CF0FF" stroke-opacity=".35" stroke-width=".5"/>
    <path d="M180 44 L192 46" stroke="#E9FBFF" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M10 48 L16 47" stroke="#FF5D6E" stroke-width="2" stroke-linecap="round"/>
    <rect x="94" y="11" width="15" height="7" rx="3" fill="#17223B" stroke="#4FE3D2" stroke-width=".7"/>
    <circle cx="101.5" cy="14.5" r="1.8" fill="#4FE3D2"/>
    <g><circle cx="49" cy="62" r="13" fill="#070C1A" stroke="#30406A" stroke-width="1.2"/><circle cx="49" cy="62" r="6.5" fill="none" stroke="#F6B53D" stroke-width="1.4"/><circle cx="49" cy="62" r="1.8" fill="#F6B53D"/></g>
    <g><circle cx="157" cy="62" r="13" fill="#070C1A" stroke="#30406A" stroke-width="1.2"/><circle cx="157" cy="62" r="6.5" fill="none" stroke="#F6B53D" stroke-width="1.4"/><circle cx="157" cy="62" r="1.8" fill="#F6B53D"/></g>
    <text x="118" y="56" font-family="Chakra Petch" font-size="6.5" font-weight="700" fill="#F6B53D" letter-spacing=".8">ROBOSHARE</text>
  </g>`;
}

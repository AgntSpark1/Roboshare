/** Stylised robotaxi side view (SVG). Generic vehicle, no brand marks. */
export function hueOf(id: string): number {
  let h = 0;
  for (const c of id.slice(2, 12)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function CarArt({ id, code }: { id: string; code: string }) {
  const h = hueOf(id);
  const c1 = `hsl(${h} 70% 62%)`;
  const glow = `hsl(${h} 90% 65%)`;
  const g = `g${id.slice(2, 10)}`;
  return (
    <svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={g} x1="0" x2="1">
          <stop offset="0" stopColor={glow} stopOpacity="0" />
          <stop offset=".5" stopColor={glow} stopOpacity=".55" />
          <stop offset="1" stopColor={glow} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${g}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2A3757" />
          <stop offset="1" stopColor="#121B31" />
        </linearGradient>
      </defs>
      <g opacity=".35" stroke="#30406A" strokeWidth="1">
        {Array.from({ length: 9 }, (_, i) => <line key={i} x1={i * 50} y1="0" x2={i * 50 - 60} y2="200" />)}
      </g>
      <rect x="0" y="152" width="400" height="48" fill="#0B1222" />
      <g className="lane">
        {Array.from({ length: 10 }, (_, i) => <rect key={i} x={i * 48} y="174" width="24" height="3" rx="1.5" fill="#F6B53D" opacity=".55" />)}
      </g>
      <ellipse cx="200" cy="158" rx="120" ry="9" fill={glow} opacity=".22" />
      <g transform="translate(25 14) scale(.88)">
        <g className="car">
          <path d="M70 146 q-8 0-8-10 v-14 q0-22 18-28 q10-3 22-4 l22-2 q18-26 40-34 q22-8 70-8 q44 0 66 12 q20 11 38 30 l36 6 q22 4 26 22 l2 14 q0 14-12 14 z" fill={`url(#${g}b)`} stroke={c1} strokeWidth="1.5" />
          <path d="M128 96 q16-22 38-30 q20-7 64-7 q38 0 58 10 q16 8 30 27 z" fill="#060A14" stroke="#3A4A70" />
          <path d="M232 60 v36 M180 64 l-6 32" stroke="#2A3757" strokeWidth="2" />
          <rect x="176" y="50" width="56" height="7" rx="2" fill="#0B1222" stroke={c1} />
          <rect x="190" y="38" width="28" height="13" rx="3" fill="#0B1222" stroke={c1} />
          <path d="M192 38 q12-10 24 0" fill="#141E36" stroke={c1} />
          <rect x="190" y="45" width="28" height="2" fill="#4FE3D2">
            <animate attributeName="opacity" values="1;.3;1" dur="1.6s" repeatCount="indefinite" />
          </rect>
          <circle cx="316" cy="96" r="4" fill="#0B1222" stroke={c1} />
          <circle cx="104" cy="94" r="4" fill="#0B1222" stroke={c1} />
          <path d="M342 116 h14" stroke="#F2FDFF" strokeWidth="4" strokeLinecap="round" />
          <path d="M64 108 h12" stroke="#FF5D6E" strokeWidth="4" strokeLinecap="round" />
          <path d="M120 128 h170" stroke="#4FE3D2" strokeWidth="1.5" opacity=".8" />
          {[122, 300].map((cx) => (
            <g key={cx}>
              <circle cx={cx} cy="146" r="19" fill="#0A1020" stroke={c1} strokeWidth="2" />
              <circle cx={cx} cy="146" r="11" fill="#2A3757" />
              <circle cx={cx} cy="146" r="13" fill="none" stroke="#4FE3D2" strokeWidth="1" />
            </g>
          ))}
          <text x="170" y="118" fontFamily="Chakra Petch,sans-serif" fontSize="10" fontWeight="600" fill="#C9D6F0" letterSpacing="1.5">ROBOTAXI</text>
          <text x="238" y="118" fontFamily="JetBrains Mono,monospace" fontSize="9" fill={c1} letterSpacing="1">{code}</text>
        </g>
      </g>
      <rect className="sweep" x="-160" y="20" width="160" height="150" fill={`url(#${g})`} opacity=".5" />
    </svg>
  );
}

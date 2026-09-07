// DAYごとの対象部位を示す人体図（前面・背面）。色は部位ごとに固定。
export const PART_COLOR = {'胸': '#E04A48', '背中': '#E04A48', '僧帽筋': '#E04A48', '肩': '#2F6FD0', '上腕二頭筋': '#2F6FD0', '上腕三頭筋': '#2F6FD0', '脚': '#3E9E5F', '腹筋': '#E0A21F'};
export const PART_LEGEND = {'胸': '胸（大胸筋）', '背中': '背中（広背筋）', '僧帽筋': '僧帽筋', '肩': '肩（三角筋）', '上腕二頭筋': '腕（上腕二頭筋）', '上腕三頭筋': '腕（上腕三頭筋）', '脚': '脚（大腿四頭筋・ハムストリング）', '腹筋': '腹筋（腹直筋）'};
const BACK_PARTS = new Set(['背中', '僧帽筋', '上腕三頭筋']);
const BASE = '#C7C9CE';
const SILHOUETTE = '<ellipse cx="60" cy="19" rx="11.5" ry="13.5"/> <path d="M53 31 h14 v7 h-14 z"/> <path d="M42 38 C34 41 30 47 29 56 L27 84 L25 118 L33 120 L36 88 L38 62          L38 108 L42 132 L46 176 L44 214 L54 216 L57 178 L60 150 L63 178 L66 216 L76 214          L74 176 L78 132 L82 108 L82 62 L84 88 L87 120 L95 118 L93 84 L91 56          C90 47 86 41 78 38 C72 36 68 35 60 35 C52 35 48 36 42 38 Z"/>';
const FRONT_MUSCLES = {'肩': '<ellipse cx="34" cy="46" rx="8" ry="7.5"/><ellipse cx="86" cy="46" rx="8" ry="7.5"/>', '胸': '<path d="M42 46 C50 43 57 44 58.5 47 L58.5 62 C52 64 45 62 42 58 Z"/><path d="M78 46 C70 43 63 44 61.5 47 L61.5 62 C68 64 75 62 78 58 Z"/>', '上腕二頭筋': '<path d="M29 56 C26 64 26 74 28 82 L34 80 C33 72 33 64 35 57 Z"/><path d="M91 56 C94 64 94 74 92 82 L86 80 C87 72 87 64 85 57 Z"/>', '腹筋': '<path d="M50 66 h20 v38 q0 6 -10 8 q-10 -2 -10 -8 z"/>', '脚': '<path d="M43 116 C41 138 44 160 47 176 L57 176 C57 156 56 134 55 116 Z"/><path d="M77 116 C79 138 76 160 73 176 L63 176 C63 156 64 134 65 116 Z"/>'};
const BACK_MUSCLES = {'肩': '<ellipse cx="34" cy="46" rx="8" ry="7.5"/><ellipse cx="86" cy="46" rx="8" ry="7.5"/>', '僧帽筋': '<path d="M60 36 L78 41 L70 60 L60 66 L50 60 L42 41 Z"/>', '背中': '<path d="M44 58 L60 66 L76 58 L80 88 L60 98 L40 88 Z"/>', '上腕三頭筋': '<path d="M29 56 C26 64 26 74 28 82 L34 80 C33 72 33 64 35 57 Z"/><path d="M91 56 C94 64 94 74 92 82 L86 80 C87 72 87 64 85 57 Z"/>', '脚': '<path d="M43 116 C41 138 44 160 47 176 L57 176 C57 156 56 134 55 116 Z"/><path d="M77 116 C79 138 76 160 73 176 L63 176 C63 156 64 134 65 116 Z"/>'};
const TINT = {'#E04A48': '#FDEFEF', '#2F6FD0': '#EEF3FC', '#3E9E5F': '#EEF7F1', '#E0A21F': '#FDF6E7'};

export function bodyFigure(parts, width = 92) {
  const view = parts.some((p) => BACK_PARTS.has(p)) ? 'back' : 'front';
  const muscles = view === 'back' ? BACK_MUSCLES : FRONT_MUSCLES;
  const layers = parts.map((part) => {
    const shape = muscles[part];
    if (!shape) return '';
    return `<g fill="${PART_COLOR[part] || '#888888'}" fill-opacity="0.92">${shape}</g>`;
  }).join('');
  const label = view === 'back' ? '背面' : '前面';
  return `<svg class="body-fig" viewBox="0 0 120 230" width="${width}" xmlns="http://www.w3.org/2000/svg" role="img">`
    + `<g fill="${BASE}">${SILHOUETTE}</g>${layers}`
    + `<text x="60" y="226" text-anchor="middle" font-size="9" fill="#9A9CA2">${label}</text></svg>`;
}

/** 凡例（色 + 部位名）。同じ色の部位はまとめる。 */
export function legend(parts) {
  const seen = new Map();
  for (const part of parts) {
    const color = PART_COLOR[part] || '#888888';
    if (!seen.has(color)) seen.set(color, []);
    seen.get(color).push(PART_LEGEND[part] || part);
  }
  return [...seen].map(([color, names]) => {
    const merged = names.length === 1 ? names[0]
      : `${names[0].split('（')[0]}（${names.map((n) => n.split('（').pop().replace('）', '')).join('・')}）`;
    return { color, label: merged };
  });
}

export const partColor = (part) => PART_COLOR[part] || '#888888';
export const partTint = (part) => TINT[partColor(part)] || '#F7F7F8';

/* 分类配色跟着皮肤走：每套皮肤有自己的色相家族，否则深色底看不清、
   浅纸底上突然冒出一片饱和绿也会很跳。 */
const PALETTES = {
  classic: [
    '#0F6E56', '#378ADD', '#D85A30', '#BA7517', '#7F77DD',
    '#1D9E75', '#993556', '#5F5E5A', '#C2410C', '#185FA5',
    '#639922', '#A32D2D'
  ],
  // 墨韵：墨黑、朱红、赭石、黛青、藤黄，全是低饱和中国色
  ink: [
    '#1A1A18', '#B33A2B', '#8C6A4A', '#4A5A6A', '#A8894A',
    '#6B5A6A', '#3F5C4A', '#7A7468', '#9C5B3D', '#5C6B75'
  ],
  // 纸糖：糖果色，和贴纸图标一路
  pop: [
    '#FF9EC4', '#8FD3FF', '#FFD84D', '#A8E6A1', '#C9B8FF',
    '#FFB27A', '#7ED9C4', '#F5A3C7', '#FFC46B', '#9BE0F0'
  ],
  // 青瓷：竹青、朱砂、黛、赭石、藕荷
  cel: [
    '#6E8B6B', '#C25B4A', '#5B6E7A', '#A8894A', '#8A6A7A',
    '#4F6A4D', '#B08968', '#7C8A76', '#9E5B4A', '#6A7A82'
  ],
  // 幽光：紫青粉，跟它的光晕一路
  aurora: [
    '#9E90FF', '#35E0C5', '#FF8FB4', '#6FB6FF', '#FFD166',
    '#A99BFF', '#7FE9D4', '#FFA07A', '#8EC5FF', '#C6BEFF'
  ],
  // 深色两款共用高亮色板
  dark: [
    '#3DF5A5', '#6FB6FF', '#FF9E4D', '#FFD166', '#A99BFF',
    '#4FD1B0', '#FF8FB4', '#B8C6D6', '#FF7A5C', '#7FB8F0',
    '#A8D96B', '#FF9C9C'
  ]
};

export function palette() {
  const t = document.documentElement.dataset.theme || 'classic';
  if (t === 'term') return PALETTES.dark;
  return PALETTES[t] || PALETTES.classic;
}
/* 兼容旧引用；需要跟随主题时请用 palette() */
export const PALETTE = PALETTES.classic;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* sel = 当前选中的分类名。选中时中心文字换成该分类，其余扇区/图例变淡。 */
export function donut(data, centerLabel, centerValue, sel = '') {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return '<div class="empty" style="padding:24px 0">这个月还没有支出</div>';

  const P = palette();
  const idx = data.findIndex(d => d.label === sel);
  const pick = idx >= 0 ? data[idx] : null;
  const R = 70, SW = 26, C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = data.map((d, i) => {
    const len = (d.value / total) * C;
    const cls = pick ? (i === idx ? 'pie-arc on' : 'pie-arc dim') : 'pie-arc';
    const seg = `<circle class="${cls}" data-cat="${esc(d.label)}" cx="100" cy="100" r="${R}" fill="none"
      stroke="${d.color || P[i % P.length]}"
      stroke-width="${SW}"
      stroke-dasharray="${Math.max(len - 1.5, 0.5)} ${C - Math.max(len - 1.5, 0.5)}"
      stroke-dashoffset="${-offset}"
      transform="rotate(-90 100 100)"
      stroke-linecap="butt"/>`;
    offset += len;
    return seg;
  }).join('');

  const pct = pick ? Math.round(pick.value / total * 100) : 0;
  const legend = data.map((d, i) => {
    const cls = pick ? (i === idx ? 'legend-row on' : 'legend-row dim') : 'legend-row';
    return `<div class="${cls}" data-cat="${esc(d.label)}" role="button" tabindex="0">
      <span class="legend-dot" style="background:${d.color || P[i % P.length]}"></span>
      <span class="legend-name">${esc(d.label)}</span>
      <span class="legend-val">${esc(d.text)}</span>
      <span class="legend-pct">${((d.value / total) * 100).toFixed(0)}%</span>
    </div>`;
  }).join('');

  return `<div class="pie-wrap">
    <svg class="pie-svg" viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="支出构成环形图，点扇区可查看明细">
      <circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--line)" stroke-width="${SW}"/>
      ${arcs}
      <circle cx="100" cy="100" r="52" fill="transparent" class="pie-hole"/>
      <text x="100" y="94" text-anchor="middle" font-size="11" fill="var(--faint)" font-family="var(--font-num)">${esc(pick ? pick.label : centerLabel)}</text>
      <text x="100" y="116" text-anchor="middle" font-size="19" font-weight="500" fill="var(--text)" font-family="var(--font-num)">${esc(pick ? pick.text : centerValue)}</text>
      ${pick ? `<text x="100" y="134" text-anchor="middle" font-size="10.5" fill="var(--faint)" font-family="var(--font-num)">占 ${pct}%</text>` : ''}
    </svg>
    <div class="pie-legend">${legend}</div>
  </div>`;
}

/* 近 12 个月柱状图：固定像素宽度，外层横向滚动
   一屏刚好露出 VISIBLE 个月，剩下的靠手指按住左右滑。
   curMk 是当前选中月，用来高亮那根柱子。 */
export function bars(data, curMk) {
  if (!data.length) return '<div class="empty" style="padding:28px 0">还没有数据</div>';
  const VISIBLE = 6;
  const H = 150, BASE = 118, TOP = 14;
  const slot = 320 / VISIBLE;
  const n = data.length;
  const W = slot * n;
  const max = Math.max(...data.map(d => d.value), 1);
  const bw = Math.min(30, slot * 0.52);

  const cols = data.map((d, i) => {
    const has = d.value > 0;
    const h = has ? Math.max((d.value / max) * (BASE - TOP), 3) : 3;
    const x = slot * i + (slot - bw) / 2;
    const y = BASE - h;
    const isCur = d.mk === curMk;
    const fill = has ? (isCur ? 'var(--brand)' : 'var(--brand-soft)') : 'var(--surface)';
    /* 整列做一个透明热区，手指点哪根都容易命中 */
    return `<g class="bar-col${isCur ? ' cur' : ''}" data-mk="${esc(d.mk || '')}" data-val="${d.value}"
      role="button" tabindex="0" aria-label="${esc(d.label)}，${d.value ? d.text || d.value : '无支出'}">
      <rect x="${(slot * i).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${BASE + 10}" fill="transparent"/>
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"
      rx="${Math.min(5, bw / 2)}" fill="${fill}"/>
      <text x="${(x + bw / 2).toFixed(1)}" y="${BASE + 18}" text-anchor="middle" font-size="10"
        fill="${isCur ? 'var(--brand)' : 'var(--faint)'}" font-family="var(--font-num)">${esc(d.label)}</text>
    </g>`;
  }).join('');

  return `<div class="bars-scroll" id="bars-scroll">
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group"
    aria-label="近 ${n} 个月支出趋势，可左右滑动查看">
    <line x1="0" y1="${BASE}" x2="${W}" y2="${BASE}" stroke="var(--line)" stroke-width="1"/>
    ${cols}
  </svg>
</div>`;
}

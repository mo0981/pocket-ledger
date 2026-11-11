// 生成六套皮肤的启动器图标 + PWA 图标
// 用法：node tools/gen-icons.mjs
//
// 设计稿：v2.19 定稿（无装饰圆点、幽光弧两端渐隐）
// 骨架统一：同心徽章环 + 中央 ¥ + 每套 1~2 处材质差异；主色唯一，不另加点睛色。
//
// 关键：定稿是「含背景整图」，而 Android 8+ 的自适应图标要的是
//   「纯色 background 层 + 透明 foreground 层」，且只有中央 72dp 可见。
// 因此这里把设计拆成两层：
//   BG[skin]   → 背景色（同时写进 values/ic_launcher_background.xml）
//   decor(skin)→ 不含背景的装饰层
//   legacy 整图 = 背景形状 + decor（1:1 复现定稿）
//   adaptive fg = decor 缩放 0.86 居中（r=38 的徽章环 → r≈32.7，落在 66dp 安全区内）
// 若 fg 不缩放，r=38 的环在圆形遮罩下会被各家启动器切掉，所以这一步是适配规范而非改设计。
//
// 输出：
//   android/app/src/main/res/mipmap-<density>/
//       ic_fg_<skin>.png               自适应前景（108dp，透明）
//       ic_launcher_<skin>.png         旧系统方形（48dp）
//       ic_launcher_<skin>_round.png   旧系统圆形
//   android/app/src/main/res/mipmap-anydpi-v26/*.xml
//   android/app/src/main/res/values/ic_launcher_background.xml
//   icons/                              PWA：192 / 512 / maskable / apple-touch
//   ../shots/icons-preview.png          三排预览（含自适应真实合成）
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dir, '..');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const PWA = path.join(ROOT, 'icons');
const SHOTS = path.join(ROOT, '..', 'shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/* 与 js/app.js 的 SKINS、values 颜色资源三处保持一致 */
const BG = {
  classic: '#0F6E56',
  ink: '#FBFAF7',
  aurora: '#0A0D13',
  pop: '#FFF7EC',
  term: '#070B11',
  cel: '#F4F1E8'
};
const META = {
  classic: '标准绿', ink: '墨韵', aurora: '幽光',
  pop: '纸糖', term: '仪表', cel: '青瓷'
};
const SKINS = Object.keys(BG);

/* 统一的人民币符号。默认参数即定稿尺寸：比旧版小一档，留出呼吸感 */
function yen({ cx = 54, cy = 55, h = 44, w = 5.6, color = '#FFFFFF', cap = 'round' } = {}) {
  const t = cy - h / 2, b = cy + h / 2, m = cy - h * 0.1;
  const xl = cx - h * 0.3, xr = cx + h * 0.3;
  const b1 = cy + h * 0.07, b2 = cy + h * 0.24, bw = h * 0.21;
  return `<g fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="${cap}" stroke-linejoin="miter">
    <path d="M${xl},${t} L${cx},${m}"/><path d="M${xr},${t} L${cx},${m}"/>
    <path d="M${cx},${m} L${cx},${b}"/>
    <path d="M${cx - bw},${b1} L${cx + bw},${b1}"/>
    <path d="M${cx - bw},${b2} L${cx + bw},${b2}"/>
  </g>`;
}

/* 同心徽章环：六套共有的家族特征 */
const ring = (c, o, w = 1.2) =>
  `<circle cx="54" cy="54" r="38" fill="none" stroke="${c}" stroke-opacity="${o}" stroke-width="${w}"/>`;

/* 装饰层，不含背景。定稿原样搬过来，只把第一行的背景 rect 抽走 */
function decor(skin) {
  switch (skin) {
    case 'classic':
      return `${ring('#FFFFFF', .24)}
        <circle cx="54" cy="54" r="31" fill="#FFFFFF" fill-opacity=".055"/>
        ${yen({ h: 46, w: 6.2 })}`;
    case 'ink':
      return `${ring('#1A1A18', .9, 1.5)}
        <circle cx="54" cy="54" r="33" fill="none" stroke="#1A1A18" stroke-opacity=".15" stroke-width=".8"/>
        ${yen({ h: 42, w: 3.5, color: '#1A1A18', cap: 'butt' })}`;
    case 'aurora':
      return `<defs>
          <linearGradient id="ag" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stop-color="#35E0C5" stop-opacity="0"/>
            <stop offset=".24" stop-color="#35E0C5" stop-opacity=".5"/>
            <stop offset=".76" stop-color="#8B7BFF" stop-opacity=".58"/>
            <stop offset="1" stop-color="#8B7BFF" stop-opacity="0"/>
          </linearGradient>
          <filter id="gl" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.1" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter></defs>
        ${ring('#EEF2F7', .2)}
        <path d="M20 72 A 40 40 0 0 1 80 24" fill="none" stroke="url(#ag)"
              stroke-width="2.8" stroke-linecap="round"/>
        <g filter="url(#gl)">${yen({ h: 46, w: 5, color: '#EEF2F7' })}</g>`;
    case 'pop':
      return `<rect x="28" y="30" width="60" height="60" rx="16" fill="#FFFFFF"/>
        <rect x="23" y="23" width="60" height="60" rx="16" fill="#FFD84D"
              stroke="#17130F" stroke-width="3.2"/>
        ${yen({ h: 38, w: 4.6, color: '#17130F' })}`;
    case 'term': {
      let ticks = '';
      for (const [x, y] of [[30, 30], [78, 30], [30, 78], [78, 78]])
        ticks += `<path d="M${x - 3},${y} L${x + 3},${y} M${x},${y - 3} L${x},${y + 3}"/>`;
      return `<rect x="23" y="23" width="62" height="62" rx="14" fill="none"
                stroke="#3DF5A5" stroke-opacity=".26" stroke-width="1.2"/>
        <g stroke="#3DF5A5" stroke-opacity=".45" stroke-width="1" fill="none">${ticks}</g>
        ${yen({ h: 46, w: 5.2, color: '#3DF5A5', cap: 'square' })}
        <rect x="40" y="88" width="28" height="2" fill="#3DF5A5" fill-opacity=".5"/>`;
    }
    case 'cel':
      return `${ring('#2C2A26', .18, 1.1)}
        <circle cx="54" cy="54" r="31" fill="#6E8B6B"/>
        <path d="M31 40 L37 48 L33 59 M75 39 L71 49 L76 60" fill="none"
              stroke="#FBFAF7" stroke-opacity=".32" stroke-width=".9" stroke-linecap="round"/>
        ${yen({ h: 40, w: 4.3, color: '#FBFAF7', cap: 'butt' })}`;
    default:
      return '';
  }
}

/* 整图：square=true 给 PWA 用（不透明方版，交给系统裁形状，避开 iOS 透明角发黑）
   scale>1 只给 Android 7 及以下的 legacy 图标用：自适应图标显示时会把 108dp 图层
   裁到中央 72dp（等价于内容放大 1.5 倍），legacy 没有这一步，不补偿的话 ¥ 会小一截。
   1.28 使两者视觉占比对齐（46*1.28/108 ≈ 55%）。背景仍铺满，只放大装饰层。 */
function fullSVG(skin, { round = false, square = false, scale = 1 } = {}) {
  const bg = round
    ? `<circle cx="54" cy="54" r="54" fill="${BG[skin]}"/>`
    : `<rect width="108" height="108" rx="${square ? 0 : 24}" fill="${BG[skin]}"/>`;
  const d = scale === 1
    ? decor(skin)
    : `<g transform="translate(54 54) scale(${scale}) translate(-54 -54)">${decor(skin)}</g>`;
  return bg + d;
}
const LEGACY_SCALE = 1.28;

/* 自适应前景：透明底 + 安全区缩放 */
const FG_SCALE = 0.86;
function fgSVG(skin) {
  return `<g transform="translate(54 54) scale(${FG_SCALE}) translate(-54 -54)">${decor(skin)}</g>`;
}

const wrap = (inner, size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 108 108">${inner}</svg>`;

const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', args: ['--no-sandbox']
});
const page = await browser.newPage();
await page.setContent('<html><body style="margin:0;background:transparent"><div id="h"></div></body></html>');

async function shot(svg, size, out, omitBg = true) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.evaluate((s, n) => {
    const d = document.getElementById('h');
    d.style.width = n + 'px';
    d.style.height = n + 'px';
    d.innerHTML = s;
  }, svg, size);
  const el = await page.$('#h');
  await el.screenshot({ path: out, omitBackground: omitBg });
}

let count = 0;
for (const skin of SKINS) {
  for (const [d, f] of Object.entries(DENS)) {
    const dir = path.join(RES, `mipmap-${d}`);
    fs.mkdirSync(dir, { recursive: true });

    await shot(wrap(fgSVG(skin), Math.round(108 * f)), Math.round(108 * f),
      path.join(dir, `ic_fg_${skin}.png`)); count++;

    // 圆角外必须透明，不能用白色打底，否则深色壁纸上会露出四个白角
    await shot(wrap(fullSVG(skin, { scale: LEGACY_SCALE }), Math.round(48 * f)), Math.round(48 * f),
      path.join(dir, `ic_launcher_${skin}.png`)); count++;

    await shot(wrap(fullSVG(skin, { round: true, scale: LEGACY_SCALE }), Math.round(48 * f)), Math.round(48 * f),
      path.join(dir, `ic_launcher_${skin}_round.png`)); count++;
  }
}

/* 自适应图标 XML（API 26+）：纯色底 + 前景 PNG */
const anydpi = path.join(RES, 'mipmap-anydpi-v26');
fs.mkdirSync(anydpi, { recursive: true });
for (const skin of SKINS) {
  for (const suffix of ['', '_round']) {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_bg_${skin}"/>
    <foreground android:drawable="@mipmap/ic_fg_${skin}"/>
</adaptive-icon>
`;
    fs.writeFileSync(path.join(anydpi, `ic_launcher_${skin}${suffix}.xml`), xml);
  }
}

/* 底色资源：adaptive 的 background 层与整图背景必须同源 */
fs.mkdirSync(path.join(RES, 'values'), { recursive: true });
const colorXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0F6E56</color>
${SKINS.map(s => `    <color name="ic_bg_${s}">${BG[s]}</color>`).join('\n')}
</resources>
`;
fs.writeFileSync(path.join(RES, 'values', 'ic_launcher_background.xml'), colorXml);

/* PWA 图标：统一用「标准绿」定稿，方版不透明，避免透明圆角在 iOS 上四角发黑 */
fs.mkdirSync(PWA, { recursive: true });
await shot(wrap(fullSVG('classic', { square: true }), 192), 192,
  path.join(PWA, 'icon-192.png'), false); count++;
await shot(wrap(fullSVG('classic', { square: true }), 512), 512,
  path.join(PWA, 'icon-512.png'), false); count++;
await shot(wrap(`<rect width="108" height="108" fill="${BG.classic}"/>${fgSVG('classic')}`, 512), 512,
  path.join(PWA, 'icon-maskable-512.png'), false); count++;
await shot(wrap(fullSVG('classic', { square: true }), 180), 180,
  path.join(PWA, 'apple-touch-icon.png'), false); count++;

console.log(`生成 ${count} 张图标 + ${SKINS.length * 2} 个自适应 XML`);

/* 预览：setContent 页面读不了 file://，一律内嵌 data URI */
const b64 = (name) => {
  const buf = fs.readFileSync(path.join(RES, 'mipmap-xxxhdpi', name));
  return 'data:image/png;base64,' + buf.toString('base64');
};

const preview = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:40px 44px 34px;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
       background:#EFEDE7;color:#1B1B19}
  h1{font-size:17px;margin:0 0 4px;font-weight:600;letter-spacing:.01em}
  .sub{font-size:12px;color:#8A867C;margin-bottom:26px}
  .row{display:flex;gap:30px}
  .c{text-align:center;width:104px}
  .mask{position:relative;width:96px;height:96px;border-radius:26px;overflow:hidden;margin:0 auto 11px;
        box-shadow:0 6px 16px rgba(0,0,0,.16),0 1px 3px rgba(0,0,0,.14)}
  .mask.round{border-radius:50%}
  .mask img{display:block;width:100%;height:100%}
  /* 108dp 图层只露中央 72dp：放大 108/72 并居中裁掉四周 */
  .mask img.fg{width:133.334%;height:133.334%;margin:-16.667% 0 0 -16.667%}
  .nm{font-size:12.5px;font-weight:600}
  .ds{font-size:10.5px;color:#94908B;margin-top:2px}
  .cap{font-size:11px;color:#8A867C;margin:24px 0 10px;letter-spacing:.06em}
  .raw{width:48px;height:48px;display:block;margin:0 auto 10px;border-radius:11px}
  .row.small .c{width:96px}
</style></head><body>
<h1>小账本 · 随皮肤变化的启动器图标（v2.19 定稿）</h1>
<div class="sub">同心徽章环 + 中央 ¥，六套成套；无装饰圆点。切换皮肤后桌面图标同步更换</div>
<div class="cap">自适应图标（Android 8+ 真实合成：底色层 + 前景层，按启动器遮罩裁切）</div>
<div class="row">${SKINS.map(s => `
  <div class="c"><div class="mask" style="background:${BG[s]}"><img class="fg" src="${b64(`ic_fg_${s}.png`)}"></div>
  <div class="nm">${META[s]}</div></div>`).join('')}</div>
<div class="cap">旧系统（Android 7 及以下）整图，48px 原始尺寸</div>
<div class="row small">${SKINS.map(s => `
  <div class="c"><img class="raw" src="${b64(`ic_launcher_${s}.png`)}"><div class="nm">${META[s]}</div></div>`).join('')}</div>
<div class="cap">圆形遮罩下的自适应图标（最严苛的情况）</div>
<div class="row">${SKINS.map(s => `
  <div class="c"><div class="mask round" style="background:${BG[s]}"><img class="fg" src="${b64(`ic_fg_${s}.png`)}"></div>
  </div>`).join('')}</div>
</body></html>`;

const pv = await browser.newPage();
await pv.setViewport({ width: 800, height: 340, deviceScaleFactor: 2 });
await pv.setContent(preview, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 300));
const h = await pv.evaluate(() => document.body.scrollHeight);
await pv.setViewport({ width: 800, height: h, deviceScaleFactor: 2 });
await new Promise(r => setTimeout(r, 200));
fs.mkdirSync(SHOTS, { recursive: true });
await pv.screenshot({ path: path.join(SHOTS, 'icons-preview.png') });
console.log('预览图已生成');

await browser.close();

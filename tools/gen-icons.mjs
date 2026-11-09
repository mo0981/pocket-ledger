// 生成六套皮肤的启动器图标
// 用法：node tools/gen-icons.mjs
// 输出到 android/app/src/main/res 下：
//   mipmap-<density>/ic_fg_<skin>.png             自适应图标前景（108dp）
//   mipmap-<density>/ic_launcher_<skin>.png       旧系统（API<26）方形图标（48dp）
//   mipmap-<density>/ic_launcher_<skin>_round.png 旧系统圆形图标
// 以及 ../shots/icons-preview.png 预览图
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(__dir, '..', 'android', 'app', 'src', 'main', 'res');
const SHOTS = path.join(__dir, '..', '..', 'shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const BG = {
  classic: '#0F6E56',
  ink: '#FBFAF7',
  aurora: '#0A0D13',
  pop: '#FFF7EC',
  term: '#070B11',
  cel: '#F4F1E8'
};
const SKINS = Object.keys(BG);

/* 统一的人民币符号，参数化到能适配每套皮肤的线条语言 */
function yen({ cx = 54, cy = 54, h = 56, w = 6.6, color = '#FFFFFF', cap = 'round' } = {}) {
  const t = cy - h / 2;
  const b = cy + h / 2;
  const m = cy - h * 0.1;
  const xl = cx - h * 0.3;
  const xr = cx + h * 0.3;
  const b1 = cy + h * 0.07;
  const b2 = cy + h * 0.24;
  const bw = h * 0.21;
  return `<g fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="${cap}" stroke-linejoin="miter">
    <path d="M${xl},${t} L${cx},${m}"/>
    <path d="M${xr},${t} L${cx},${m}"/>
    <path d="M${cx},${m} L${cx},${b}"/>
    <path d="M${cx - bw},${b1} L${cx + bw},${b1}"/>
    <path d="M${cx - bw},${b2} L${cx + bw},${b2}"/>
  </g>`;
}

/* 每套皮肤的前景内容（108 视口，安全区半径 36） */
function foreground(skin) {
  switch (skin) {
    case 'classic':
      return `${yen({ h: 56, w: 7.2 })}`;
    case 'ink':
      return `
        <circle cx="54" cy="54" r="29.5" fill="none" stroke="#1A1A18" stroke-width="2.2"/>
        <circle cx="74.86" cy="33.14" r="4.2" fill="#B33A2B"/>
        ${yen({ h: 43, w: 4.8, color: '#1A1A18', cap: 'butt' })}`;
    case 'aurora':
      return `
        <defs>
          <radialGradient id="g1"><stop offset="0" stop-color="#8B7BFF" stop-opacity=".8"/>
            <stop offset=".55" stop-color="#6D5BE8" stop-opacity=".35"/>
            <stop offset="1" stop-color="#6D5BE8" stop-opacity="0"/></radialGradient>
          <radialGradient id="g2"><stop offset="0" stop-color="#35E0C5" stop-opacity=".7"/>
            <stop offset="1" stop-color="#35E0C5" stop-opacity="0"/></radialGradient>
          <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.6" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <circle cx="30" cy="26" r="40" fill="url(#g1)"/>
        <circle cx="84" cy="86" r="36" fill="url(#g2)"/>
        <g filter="url(#glow)">${yen({ h: 54, w: 5.4, color: '#FFFFFF', cap: 'round' })}</g>`;
    case 'pop':
      return `
        <rect x="29.5" y="29.5" width="49" height="49" rx="12" fill="#FFD84D"
              stroke="#17130F" stroke-width="4.6"/>
        ${yen({ h: 32, w: 5.2, color: '#17130F', cap: 'round' })}`;
    case 'term': {
      let grid = '';
      for (let i = 0; i <= 8; i++) {
        const p = 13.5 + i * 13.5;
        grid += `<path d="M${p},0 L${p},108"/><path d="M0,${p} L108,${p}"/>`;
      }
      return `
        <g stroke="#16202D" stroke-width="1" fill="none">${grid}</g>
        ${yen({ h: 52, w: 5.4, color: '#3DF5A5', cap: 'butt' })}
        <circle cx="54" cy="54" r="0" fill="none"/>`;
    }
    case 'cel':
      return `
        <circle cx="54" cy="54" r="30" fill="#6E8B6B"/>
        ${yen({ h: 43, w: 5, color: '#FBFAF7', cap: 'butt' })}
        <circle cx="75.2" cy="32.8" r="4" fill="#C25B4A"/>`;
    default:
      return '';
  }
}

/* 旧系统图标：背景铺满 + 内容放大 1.5 倍（因为没有系统遮罩裁切） */
function legacySVG(skin, round) {
  const bgShape = round
    ? `<circle cx="54" cy="54" r="54" fill="${BG[skin]}"/>`
    : `<rect x="0" y="0" width="108" height="108" rx="20" fill="${BG[skin]}"/>`;
  return `${bgShape}<g transform="translate(54 54) scale(1.5) translate(-54 -54)">${foreground(skin)}</g>`;
}

const wrap = (inner, size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 108 108">${inner}</svg>`;

const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', args: ['--no-sandbox']
});
const page = await browser.newPage();
await page.setContent('<html><body style="margin:0;background:transparent"><div id="h"></div></body></html>');

async function shot(svg, size, out) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.evaluate((s, n) => {
    const d = document.getElementById('h');
    d.style.width = n + 'px';
    d.style.height = n + 'px';
    d.innerHTML = s;
  }, svg, size);
  const el = await page.$('#h');
  await el.screenshot({ path: out, omitBackground: true });
}

let count = 0;
for (const skin of SKINS) {
  const fg = foreground(skin);
  for (const [d, f] of Object.entries(DENS)) {
    const dir = path.join(RES, `mipmap-${d}`);
    fs.mkdirSync(dir, { recursive: true });

    // 自适应前景 108dp
    await shot(wrap(fg, Math.round(108 * f)), Math.round(108 * f),
      path.join(dir, `ic_fg_${skin}.png`)); count++;

    // 旧系统 48dp
    await shot(wrap(legacySVG(skin, false), Math.round(48 * f)), Math.round(48 * f),
      path.join(dir, `ic_launcher_${skin}.png`)); count++;
    await shot(wrap(legacySVG(skin, true), Math.round(48 * f)), Math.round(48 * f),
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

/* 底色资源 */
const colorXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0F6E56</color>
${SKINS.map(s => `    <color name="ic_bg_${s}">${BG[s]}</color>`).join('\n')}
</resources>
`;
fs.writeFileSync(path.join(RES, 'values', 'ic_launcher_background.xml'), colorXml);

console.log(`生成 ${count} 张图标 + ${SKINS.length * 2} 个自适应 XML`);

/* 预览图：setContent 建的页面读不了 file://，一律内嵌 data URI */
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
<h1>小账本 · 随皮肤变化的启动器图标</h1>
<div class="sub">切换皮肤后，桌面上的图标同步换成对应风格</div>
<div class="cap">自适应图标（Android 8+ 真实合成：底色层 + 前景层，按启动器遮罩裁切）</div>
<div class="row">${SKINS.map(s => `
  <div class="c"><div class="mask" style="background:${BG[s]}"><img class="fg" src="${b64(`ic_fg_${s}.png`)}"></div>
  <div class="nm">${s}</div></div>`).join('')}</div>
<div class="cap">旧系统（Android 7 及以下）整图，48px 原始尺寸</div>
<div class="row small">${SKINS.map(s => `
  <div class="c"><img class="raw" src="${b64(`ic_launcher_${s}.png`)}"><div class="nm">${s}</div></div>`).join('')}</div>
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
await pv.screenshot({ path: path.join(SHOTS, 'icons-preview.png') });
console.log('预览图已生成');

await browser.close();

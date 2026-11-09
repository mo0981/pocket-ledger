/* 验证：多尺寸手机视口下无横向溢出、不被状态栏/导航条遮挡、小屏不挤压 */
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:5180/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}${x ? ' — ' + x : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`); }
};

const VIEWPORTS = [
  { w: 320, h: 568, name: '320×568 老机器' },
  { w: 360, h: 640, name: '360×640 常见安卓' },
  { w: 375, h: 667, name: '375×667 iPhone SE' },
  { w: 393, h: 851, name: '393×851 Pixel 8' },
  { w: 412, h: 915, name: '412×915 大屏安卓' },
  { w: 430, h: 932, name: '430×932 iPhone Pro Max' }
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

try {
  const page = await browser.newPage();
  page.on('pageerror', e => { fail++; console.log('  ❌ 页面报错：' + e.message); });

  for (const vp of VIEWPORTS) {
    console.log(`\n▸ ${vp.name}`);
    await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(URL, { waitUntil: 'networkidle2' });
    await sleep(400);

    // 1) 横向不溢出
    const scroll = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      iw: window.innerWidth
    }));
    ok('无横向滚动', scroll.sw <= scroll.cw + 1, `scrollWidth ${scroll.sw} / clientWidth ${scroll.cw}`);

    // 2) 所有可见元素都在视口内（宽方向）
    const overflow = await page.evaluate(() => {
      const iw = window.innerWidth;
      const bad = [];
      document.querySelectorAll('body *').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        if (el.hasAttribute('hidden')) return;
        // 允许横向滚动的容器与刻意出画面的装饰
        if (el.classList.contains('pv-thumbs')) return;
        if (el.closest('.pv-thumbs')) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.right > iw + 1 || r.left < -1) {
          bad.push((el.id ? '#' + el.id : el.className || el.tagName) +
            ` [${r.left.toFixed(0)},${r.right.toFixed(0)}]`);
        }
      });
      return bad.slice(0, 6);
    });
    ok('元素未超出屏幕左右边界', overflow.length === 0, overflow.join(' | '));

    // 3) 底部导航完整可见
    const tab = await page.evaluate(() => {
      const t = document.querySelector('.tabbar').getBoundingClientRect();
      return { bottom: t.bottom, h: t.height, vh: window.innerHeight };
    });
    ok('底部导航在视口内', tab.bottom <= tab.vh + 1, `bottom ${tab.bottom.toFixed(0)} / vh ${tab.vh}`);

    // 4) 模拟安卓 15 边到边：注入 insets 后顶部/底部都要让开
    const inset = await page.evaluate(async () => {
      const hero = document.querySelector('.hero');
      const beforeTop = parseFloat(getComputedStyle(hero).paddingTop);
      const beforeTab = document.querySelector('.tabbar').getBoundingClientRect().height;
      document.documentElement.style.setProperty('--sat', '28px');
      document.documentElement.style.setProperty('--sab', '24px');
      await new Promise(r => setTimeout(r, 60));
      const afterTop = parseFloat(getComputedStyle(hero).paddingTop);
      const afterTab = document.querySelector('.tabbar').getBoundingClientRect().height;
      document.documentElement.style.removeProperty('--sat');
      document.documentElement.style.removeProperty('--sab');
      return { beforeTop, afterTop, beforeTab, afterTab };
    });
    ok('注入状态栏高度后 hero 让开', inset.afterTop - inset.beforeTop === 28,
      `${inset.beforeTop} → ${inset.afterTop}`);
    ok('注入手势条高度后 tabbar 长高', inset.afterTab - inset.beforeTab === 24,
      `${inset.beforeTab} → ${inset.afterTab}`);

    // 5) 主金额不换行、不撑破
    const amount = await page.evaluate(() => {
      const el = document.getElementById('home-expense');
      const r = el.getBoundingClientRect();
      return { lines: Math.round(r.height / parseFloat(getComputedStyle(el).lineHeight)), w: r.width };
    });
    ok('主金额单行显示', amount.lines <= 1, `高/行高=${amount.lines}`);

    // 6) 设置页长表单不出界
    await page.evaluate(() => {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById('view-settings').classList.add('active');
    });
    await sleep(200);
    const setOver = await page.evaluate(() => {
      const iw = window.innerWidth;
      const bad = [];
      document.querySelectorAll('#view-settings *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.right > iw + 1) bad.push((el.id ? '#' + el.id : el.className) + ` ${r.right.toFixed(0)}`);
      });
      return bad.slice(0, 5);
    });
    ok('设置页表单未超宽', setOver.length === 0, setOver.join(' | '));

    // 7) 记一笔弹层在视口内
    await page.evaluate(() => {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById('view-home').classList.add('active');
      document.getElementById('sheet-mask').hidden = false;
    });
    await sleep(300);
    const sheet = await page.evaluate(() => {
      const s = document.querySelector('.sheet').getBoundingClientRect();
      const btn = document.getElementById('f-save').getBoundingClientRect();
      return { w: s.width, right: s.right, iw: window.innerWidth, btnBottom: btn.bottom, vh: window.innerHeight };
    });
    ok('弹层宽度贴合屏幕', Math.abs(sheet.w - sheet.iw) <= 1, `${sheet.w} / ${sheet.iw}`);
    ok('弹层保存按钮可点', sheet.btnBottom <= sheet.vh + 1, `${sheet.btnBottom.toFixed(0)} / ${sheet.vh}`);

    if (vp.w === 320) {
      await page.evaluate(() => { document.getElementById('sheet-mask').hidden = true; });
      await page.screenshot({ path: `C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/shots/rwd-320.png` });
    }
    if (vp.w === 393) {
      await page.screenshot({ path: `C:/Users/MO/WorkBuddy/2026-10-30-22-26-29/shots/rwd-393.png` });
    }
  }
} finally {
  await browser.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);

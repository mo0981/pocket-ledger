/* 验证：桌面图标跟随皮肤
 * 分两部分
 *   A. 前端：切换皮肤时是否把皮肤名递给了原生插件；网页端、插件报错时是否安静降级
 *   B. 安卓产物：别名、图标资源、配色、插件注册是否齐全一致（没法真机装，至少静态校验）
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:5180/';
const ROOT = process.cwd();
const RES = path.join(ROOT, 'android/app/src/main/res');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}${x ? ' — ' + x : ''}`); }
  else { fail++; console.log(`  ❌ ${n}${x ? ' — ' + x : ''}`); }
};
const waitFor = async (fn, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
};

const KEYS = ['classic', 'ink', 'aurora', 'pop', 'term', 'cel'];

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

/* ---------- A. 前端行为 ---------- */
console.log('\n[ A ] 前端与原生插件的对接');

const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

// 模拟 Capacitor 原生桥
await page.evaluateOnNewDocument(() => {
  window.__iconCalls = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    registerPlugin: (name) => ({
      set: (o) => {
        window.__iconCalls.push({ plugin: name, skin: o && o.skin });
        return Promise.resolve();
      }
    })
  };
});

await page.goto(URL, { waitUntil: 'networkidle0' });
await sleep(700);

const calls = () => page.evaluate(() => window.__iconCalls.slice());
const goTab = t => page.evaluate(n => document.querySelector(`.tab[data-tab="${n}"]`).click(), t);
const pickSkin = k => page.evaluate(kk => document.querySelector(`[data-skin="${kk}"]`).click(), k);

const first = await calls();
ok('启动时把当前皮肤同步给原生', first.length > 0 && first[0].skin === 'classic',
  JSON.stringify(first.slice(0, 2)));
ok('插件名是 AppIcon', first.length > 0 && first[0].plugin === 'AppIcon');

await goTab('settings');
await sleep(250);

for (const k of KEYS.slice(1)) {
  const before = (await calls()).length;
  await pickSkin(k);
  const grew = await waitFor(async () => (await calls()).length > before, 2000);
  const last = (await calls()).slice(-1)[0];
  ok(`切到「${k}」后通知原生换图标`, grew && last && last.skin === k,
    JSON.stringify(last));
}

// 同一个皮肤再点一次不应该重复调用（pickSkin 内部有短路）
await goTab('settings');
const n0 = (await calls()).length;
await pickSkin('cel');
await sleep(300);
ok('重复点同一皮肤不再调用原生', (await calls()).length === n0);

// 换过皮肤后刷新：开机要重新同步（APK 升级会把别名状态重置，必须能自愈）
await page.evaluate(() => document.querySelector('[data-skin="pop"]').click());
await sleep(400);
await page.evaluate(() => { window.__iconCalls = []; });
await page.reload({ waitUntil: 'networkidle0' });
const back = await waitFor(async () => (await calls()).length > 0, 4000);
const bootSkin = (await calls())[0];
ok('刷新后仍按保存的皮肤换图标', back && bootSkin && bootSkin.skin === 'pop',
  JSON.stringify(bootSkin));

// 原生标记：只在 App 里出现的文案
const nativeFlag = await page.evaluate(() => document.documentElement.classList.contains('native'));
const noteShown = await page.evaluate(() => {
  const el = document.querySelector('.skin-note-app');
  return el ? getComputedStyle(el).display !== 'none' : false;
});
ok('App 内给 html 打上 native 标记', nativeFlag);
ok('App 内才显示「桌面图标会一起换」的说明', noteShown);

ok('全程无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

/* ---------- 网页端 / 出错时降级 ---------- */
console.log('\n[ A2 ] 网页端与异常降级');

const ctx2 = await browser.createBrowserContext();
const web = await ctx2.newPage();
const webErrors = [];
web.on('pageerror', e => webErrors.push(String(e)));
await web.goto(URL, { waitUntil: 'networkidle0' });
await sleep(600);
ok('没有 Capacitor 时不报错', webErrors.length === 0, webErrors.slice(0, 2).join(' | '));
ok('网页端不加 native 标记',
  !(await web.evaluate(() => document.documentElement.classList.contains('native'))));
await web.evaluate(() => document.querySelector('.tab[data-tab="settings"]').click());
await sleep(200);
await web.evaluate(() => document.querySelector('[data-skin="term"]').click());
await sleep(300);
ok('网页端照样能换肤',
  (await web.evaluate(() => document.documentElement.dataset.theme)) === 'term');

const ctx3 = await browser.createBrowserContext();
const bad = await ctx3.newPage();
const badErrors = [];
bad.on('pageerror', e => badErrors.push(String(e)));
bad.on('console', m => { if (m.type() === 'error') badErrors.push(m.text()); });
await bad.evaluateOnNewDocument(() => {
  window.Capacitor = {
    isNativePlatform: () => true,
    registerPlugin: () => ({
      set: () => Promise.reject(new Error('native boom'))
    })
  };
});
await bad.goto(URL, { waitUntil: 'networkidle0' });
await sleep(600);
await bad.evaluate(() => document.querySelector('.tab[data-tab="settings"]').click());
await sleep(200);
await bad.evaluate(() => document.querySelector('[data-skin="ink"]').click());
await sleep(400);
ok('原生换图标失败时不影响换肤',
  (await bad.evaluate(() => document.documentElement.dataset.theme)) === 'ink');
ok('原生失败不产生未捕获错误', badErrors.length === 0, badErrors.slice(0, 2).join(' | '));

await browser.close();

/* ---------- B. 安卓产物静态校验 ---------- */
console.log('\n[ B ] 安卓工程产物');

const manifest = fs.readFileSync(path.join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
const aliases = manifest.match(/<activity-alias[\s\S]*?<\/activity-alias>/g) || [];
ok('清单里有 6 个 activity-alias', aliases.length === 6, `实际 ${aliases.length}`);

const aliasNames = ['IconClassic', 'IconInk', 'IconAurora', 'IconPop', 'IconTerm', 'IconCel'];
for (const name of aliasNames) {
  const block = aliases.find(a => a.includes(`.${name}"`)) || '';
  ok(`别名 ${name} 完整`, block
    && block.includes('android:targetActivity=".MainActivity"')
    && block.includes('ic_launcher_')
    && block.includes('android.intent.category.LAUNCHER')
    && block.includes('android:exported="true"'));
}
ok('只有标准绿默认启用', (aliases[0] || '').includes('android:enabled="true"')
  && aliases.slice(1).every(a => a.includes('android:enabled="false"')));

const mainAct = manifest.match(/<activity\s[\s\S]*?<\/activity>/);
ok('MainActivity 不再挂 LAUNCHER 入口（否则桌面会出现两个图标）',
  !!mainAct && !mainAct[0].includes('android.intent.category.LAUNCHER'));

for (const k of KEYS) {
  const adaptive = path.join(RES, 'mipmap-anydpi-v26', `ic_launcher_${k}.xml`);
  const fg = path.join(RES, 'mipmap-xxxhdpi', `ic_fg_${k}.png`);
  const legacy = path.join(RES, 'mipmap-xxxhdpi', `ic_launcher_${k}.png`);
  ok(`「${k}」图标资源齐全`, fs.existsSync(adaptive) && fs.existsSync(fg) && fs.existsSync(legacy));
}

const colors = fs.readFileSync(path.join(RES, 'values/ic_launcher_background.xml'), 'utf8');
ok('六套底色都已定义', KEYS.every(k => colors.includes(`ic_bg_${k}`)));

const plugin = fs.readFileSync(
  path.join(ROOT, 'android/app/src/main/java/com/mo/pocketledger/AppIconPlugin.java'), 'utf8');
ok('插件名与前端一致', plugin.includes('@CapacitorPlugin(name = "AppIcon")'));
ok('插件里别名顺序与皮肤一致', (() => {
  const block = (plugin.match(/ALIASES = \{([\s\S]*?)\};/) || [])[1] || '';
  let at = -1;
  return aliasNames.every(a => {
    const i = block.indexOf(`"${a}"`);
    if (i <= at) return false;
    at = i;
    return true;
  });
})());
ok('切换用 DONT_KILL_APP（不杀进程）',
  (plugin.match(/DONT_KILL_APP/g) || []).length >= 2);

const mainJava = fs.readFileSync(
  path.join(ROOT, 'android/app/src/main/java/com/mo/pocketledger/MainActivity.java'), 'utf8');
const regIdx = mainJava.indexOf('registerPlugin(AppIconPlugin.class)');
const superIdx = mainJava.indexOf('super.onCreate(savedInstanceState)');
ok('插件在 super.onCreate 之前注册', regIdx > 0 && regIdx < superIdx);

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);

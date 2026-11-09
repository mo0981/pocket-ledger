/**
 * 输入条按钮的语义测试
 * 用户困惑点：「图片和语音不是自动解析吗，这颗按钮干嘛用？」
 * 期望：图片选完即识别、语音说完即提交，按钮只是手动打字的提交口，
 *      空输入时置灰，别让人以为它是个开关。
 */
import puppeteer from 'puppeteer-core';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const ctx = await b.createBrowserContext();
const p = await ctx.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));

// 假的语音识别：点一下麦克风，150ms 后就把「早餐15」当成识别结果抛出来
await p.evaluateOnNewDocument(() => {
  class FakeSR {
    constructor() { this.lang = ''; this.interimResults = false; this.maxAlternatives = 1; }
    start() {
      setTimeout(() => {
        this.onstart && this.onstart();
        setTimeout(() => {
          this.onresult && this.onresult({ results: [[{ transcript: '早餐15' }]] });
          this.onend && this.onend();
        }, 60);
      }, 20);
    }
    stop() { this.onend && this.onend(); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
});

await p.setBypassServiceWorker(true);
await p.goto('http://localhost:5180/', { waitUntil: 'networkidle0' });
await sleep(600);

const btn = () => p.evaluate(() => {
  const el = document.querySelector('#ai-go');
  return { text: el.textContent.trim(), disabled: el.disabled, busy: el.dataset.busy || '' };
});

console.log('\n▸ 空输入时不该是个能点的开关');
const s0 = await btn();
ok(s0.disabled, '输入框为空时按钮置灰', `disabled=${s0.disabled}`);
ok(s0.text === '发送', '按钮文案是「发送」而不是「解析」', s0.text);

console.log('\n▸ 打字后按钮亮起');
await p.type('#ai-input', '早餐15');
await sleep(120);
const s1 = await btn();
ok(!s1.disabled, '有文字后可以点', `disabled=${s1.disabled}`);

await p.evaluate(() => { const i = document.querySelector('#ai-input'); i.value = ''; i.dispatchEvent(new Event('input')); });
await sleep(120);
const s2 = await btn();
ok(s2.disabled, '清空后重新置灰', `disabled=${s2.disabled}`);

console.log('\n▸ 语音：说完就提交，不用补一下按钮');
ok(await p.evaluate(() => document.querySelector('#ai-mic').hidden === false), '识别可用时麦克风露出来');
await p.evaluate(() => {
  const t = document.querySelector('#toast');
  if (t) { t.hidden = true; t.textContent = ''; }
});
await p.click('#ai-mic');
await sleep(900);

const afterVoice = await p.evaluate(() => {
  const t = document.querySelector('#toast');
  return { text: t && !t.hidden ? t.textContent.trim() : '', input: document.querySelector('#ai-input').value };
});
ok(afterVoice.text.includes('API Key'), '识别完自动走了解析流程（未配 Key 的提示直接弹出）', afterVoice.text || '(没有提示)');
// 提交失败（没配 Key）时故意不清空输入框，配好之后还能一键重发
ok(afterVoice.input === '早餐15', '提交失败时保留原文，不逼人重说一遍', `[${afterVoice.input}]`);

console.log('\n▸ 忙碌态文案');
const busy = await p.evaluate(() => {
  const el = document.querySelector('#ai-go');
  return { hasFlag: 'busy' in el.dataset, disabledOnBusy: getComputedStyle(el).opacity };
});
ok(busy.hasFlag, '按钮带 busy 标记');

console.log('\n▸ 控制台');
ok(errs.length === 0, '全程无 JS 报错', errs.join(' | ') || '无');

await b.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} 输入条测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);

/* 百度网盘云备份（开放平台 xpan API）。
 *
 * 与 OneDrive 版的关键差异：
 * - 百度不放行浏览器跨域，所有请求必须走 App 的原生 HTTP 通道
 *   （window.Capacitor.Plugins.CapacitorHttp）。网页版没有这个通道，整卡不可用。
 * - OAuth 是带 client_secret 的授权码模式（无 PKCE），token 30 天有效，
 *   refresh_token 一次性（刷新后拿新的，必须立刻存回）。
 * - 回调地址必须是公网地址（官方 FAQ 明确不支持本地地址），所以授权码
 *   可能没法自动带回 App，提供了「粘贴授权码」的人工兜底。
 * - 上传固定三步：precreate（rtype=3 覆盖同名）→ superfile2 分片（备份只有
 *   一片，手拼 multipart 字符串，避免 FormData 在原生桥上的兼容问题）→ create。
 */
import * as DB from './db.js';

const AUTHORIZE = 'https://openapi.baidu.com/oauth/2.0/authorize';
const TOKEN = 'https://openapi.baidu.com/oauth/2.0/token';
const XPAN = 'https://pan.baidu.com/rest/2.0/xpan';
const PCS_UPLOAD = 'https://d.pcs.baidu.com/rest/2.0/pcs/superfile2';
const SCOPE = 'basic,netdisk';
const SLICE_256K = 262144;

const state = {
  appKey: '',
  secretKey: '',
  appName: '',
  tokens: null,
  auto: false,
  lastAt: 0
};

/* ---------- 基础设施 ---------- */

/* 原生 HTTP：网页版没有 Capacitor 通道，直接抛「仅限 App」 */
async function http(opts) {
  const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
  if (!cap) throw new Error('百度网盘备份只能在 App 里使用（网页版有跨域限制）');
  const r = await cap.request({
    headers: {},
    ...opts
  });
  const raw = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
  let json = null;
  try { json = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; } catch (e) { /* 纯文本响应 */ }
  return { status: r.status, text: raw, json };
}

/* 百度所有接口都用 errno 表达成败，HTTP 状态常是 200 */
function assertOk(res, what) {
  const j = res.json;
  if (!j) throw new Error(`${what}失败：响应不是 JSON`);
  if (j.errno === 0) return j;
  if (j.errno === -6) throw new Error('百度登录已过期，请重新连接');
  throw new Error(`${what}失败：errno ${j.errno}${j.errmsg ? ' ' + j.errmsg : ''}`);
}

function utf8(str) {
  return new TextEncoder().encode(str);
}

/* 标准 MD5（RFC 1321），输入 Uint8Array，输出 32 位小写 hex。
 * 百度要求 MD5 而浏览器 crypto.subtle 不提供，只能自带一份。 */
export function md5(bytes) {
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const K = new Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  const len = bytes.length;
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  const bits = len * 8;
  dv.setUint32(padded.length - 8, bits >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bits / 4294967296), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < padded.length; off += 64) {
    const M = new Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true));
  return Array.from(new Uint8Array(out.buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const md5Hex = str => md5(utf8(str));

/* ---------- 配置 ---------- */

export async function loadSettings() {
  const s = await DB.getAllSettings();
  state.appKey = s.bdAppKey || '';
  state.secretKey = s.bdSecretKey || '';
  state.appName = s.bdAppName || '';
  state.tokens = s.bdTokens || null;
  state.auto = !!s.bdAuto;
  state.lastAt = s.bdLast || 0;
}

export async function setConfig(appKey, secretKey, appName) {
  state.appKey = String(appKey || '').trim();
  state.secretKey = String(secretKey || '').trim();
  state.appName = String(appName || '').trim();
  await DB.setSetting('bdAppKey', state.appKey);
  await DB.setSetting('bdSecretKey', state.secretKey);
  await DB.setSetting('bdAppName', state.appName);
}

export async function setAuto(on) {
  state.auto = !!on;
  await DB.setSetting('bdAuto', state.auto);
}

export function configured() {
  return !!(state.appKey && state.secretKey && state.appName);
}

export function connected() {
  return !!(state.tokens && state.tokens.accessToken);
}

export function accountName() {
  return state.tokens?.account || '';
}

export function lastBackupAt() {
  return state.lastAt || 0;
}

export function autoEnabled() {
  return !!state.auto;
}

export function cloudPath() {
  return `/apps/${state.appName}/backup.json`;
}

/* ---------- 授权 ---------- */

export function authorizeUrl() {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: state.appKey,
    redirect_uri: `${location.origin}/`,
    scope: SCOPE,
    display: 'mobile',
    state: 'pocket-ledger'
  });
  return `${AUTHORIZE}?${q}`;
}

export async function connect() {
  if (!configured()) throw new Error('先填齐 AppKey / SecretKey / 应用名称');
  location.href = authorizeUrl();
}

/* 授权回来两种路：URL 带 ?code=（回调地址恰好配成了本站）自动换；
 * 否则用户从回调页复制授权码，走 exchangeCode 手动换。 */
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  const error = q.get('error');
  const mine = q.get('state') === 'pocket-ledger';
  // 只认自己的回调（OneDrive 也在同一个站点上抢 ?code=）
  if (!mine) return null;
  if (error) {
    history.replaceState(null, '', location.pathname);
    return { ok: false, msg: q.get('error_description') || error };
  }
  if (!code) return null;
  history.replaceState(null, '', location.pathname);
  try {
    await exchangeCode(code);
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

export async function exchangeCode(code) {
  if (!configured()) throw new Error('先填齐 AppKey / SecretKey / 应用名称');
  const res = await http({
    url: TOKEN,
    method: 'GET',
    params: {
      grant_type: 'authorization_code',
      code,
      client_id: state.appKey,
      client_secret: state.secretKey,
      redirect_uri: `${location.origin}/`
    }
  });
  const j = res.json;
  if (!j || !j.access_token) {
    throw new Error('换 token 失败：' + (j?.error_description || j?.error || res.text.slice(0, 120)));
  }
  await saveTokens(j);
  await verifyAccount();
}

async function saveTokens(j) {
  state.tokens = {
    accessToken: j.access_token,
    refreshToken: j.refresh_token || null,
    expiresAt: Date.now() + ((j.expires_in || 2592000) - 600) * 1000
  };
  await DB.setSetting('bdTokens', state.tokens);
}

/* 用 uinfo 验 token 有效性并拿账号名展示（scope 不对在这里就会暴露） */
async function verifyAccount() {
  const res = await http({
    url: `${XPAN}/nas`,
    method: 'GET',
    params: { method: 'uinfo', access_token: state.tokens.accessToken }
  });
  const j = res.json;
  if (j && j.errno === 0) {
    state.tokens.account = j.baidu_name || j.netdisk_name || '';
    await DB.setSetting('bdTokens', state.tokens);
  }
}

async function accessToken() {
  if (!state.tokens) throw new Error('未连接百度网盘');
  if (Date.now() < state.tokens.expiresAt) return state.tokens.accessToken;
  if (!state.tokens.refreshToken) throw new Error('百度登录已过期，请重新连接');
  // refresh_token 是一次性的：刷新成功后百度会返回新的，必须马上存回
  const res = await http({
    url: TOKEN,
    method: 'GET',
    params: {
      grant_type: 'refresh_token',
      refresh_token: state.tokens.refreshToken,
      client_id: state.appKey,
      client_secret: state.secretKey,
      scope: SCOPE
    }
  });
  const j = res.json;
  if (!j || !j.access_token) {
    state.tokens = null;
    await DB.delSetting('bdTokens');
    throw new Error('百度登录已过期，请重新连接');
  }
  await saveTokens(j);
  return state.tokens.accessToken;
}

export async function disconnect() {
  state.tokens = null;
  await DB.delSetting('bdTokens');
}

/* ---------- 上传：precreate → superfile2 → create ---------- */

export async function uploadBackup(json) {
  if (!configured()) throw new Error('先填齐 AppKey / SecretKey / 应用名称');
  const token = await accessToken();
  const bytes = utf8(json);
  const whole = md5(bytes);
  const head = md5(bytes.slice(0, Math.min(SLICE_256K, bytes.length)));
  const path = cloudPath();
  const common = { access_token: token };

  // 1. 预上传，rtype=3：云端同名文件直接覆盖，backup.json 永远只有最新一份
  const pre = assertOk(await http({
    url: `${XPAN}/file`,
    method: 'POST',
    params: { method: 'precreate', ...common },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({
      path, size: String(bytes.length), isdir: '0', autoinit: '1', rtype: '3',
      block_list: JSON.stringify([whole]),
      'content-md5': whole, 'slice-md5': head
    }).toString()
  }), '预上传');

  // 2. 分片上传（备份远小于 4MB，一片搞定）；手拼 multipart，
  //    JSON 是纯文本 UTF-8，字符串拼接字节安全
  if (pre.uploadid) {
    const boundary = 'pocketledger' + Date.now().toString(16);
    const body =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="backup.json"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n` +
      `${json}\r\n` +
      `--${boundary}--\r\n`;
    assertOk(await http({
      url: PCS_UPLOAD,
      method: 'POST',
      params: { ...common, method: 'upload', type: 'tmpfile', path, uploadid: pre.uploadid, partseq: '0' },
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      data: body
    }), '分片上传');
  }

  // 3. 创建文件（入库）
  assertOk(await http({
    url: `${XPAN}/file`,
    method: 'POST',
    params: { method: 'create', ...common },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({
      path, size: String(bytes.length), isdir: '0',
      block_list: JSON.stringify([whole])
    }).toString()
  }), '创建文件');

  state.lastAt = Date.now();
  await DB.setSetting('bdLast', state.lastAt);
  return { path, size: json.length };
}

/* ---------- 恢复：filelist → filemetas → dlink ---------- */

/* 云端没有备份时返回 null */
export async function downloadBackup() {
  const token = await accessToken();
  const list = assertOk(await http({
    url: `${XPAN}/file`,
    method: 'GET',
    params: { method: 'filelist', access_token: token, dir: `/apps/${state.appName}/`, limit: '100' }
  }), '文件列表');
  const hit = (list.list || []).find(f => f.path === cloudPath() && !f.isdir);
  if (!hit) return null;

  const meta = assertOk(await http({
    url: `${XPAN}/multimedia`,
    method: 'GET',
    params: { method: 'filemetas', access_token: token, fsids: `[${hit.fs_id}]`, dlink: '1' }
  }), '文件详情');
  const dlink = meta.list?.[0]?.dlink;
  if (!dlink) return null;

  // dlink 要求 UA 为 pan.baidu.com 才放行下载
  const res = await http({
    url: `${dlink}${dlink.includes('?') ? '&' : '?'}access_token=${token}`,
    method: 'GET',
    headers: { 'User-Agent': 'pan.baidu.com' },
    responseType: 'text'
  });
  return res.text;
}

export async function maybeAutoBackup(buildJson) {
  if (!connected() || !state.auto) return false;
  if (Date.now() - state.lastAt < 20 * 3600 * 1000) return false;
  await uploadBackup(buildJson());
  return true;
}

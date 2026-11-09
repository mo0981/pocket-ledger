/* OneDrive 云备份（Microsoft Graph，PKCE 公共客户端，无后端）。
 *
 * 设计要点：
 * - 用 SPA 重定向授权流（整页跳走再跳回来），网页版和 APK WebView 都适用；
 *   授权前的 verifier/state 存 localStorage，跳回来时页面虽然重载了但它们还在。
 * - redirect_uri 就是「当前站点根路径」，所以用户在 Azure 注册应用时，
 *   要把设置页里显示的那一行原样登记为 SPA 平台的重定向 URI。
 * - scope 用 Files.ReadWrite.AppFolder：备份文件落在 OneDrive 的隐藏应用文件夹
 *   （/Apps/小账本/），用户看不见也删不着，App 也读不了盘上其它任何文件，隐私面最小。
 * - token 存 IndexedDB settings（和 API Key 同级的安全假设）；过期前 60 秒自动用
 *   refresh_token 续期，refresh 失败视为掉线，提示重新连接。
 */
import * as DB from './db.js';

const AUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'Files.ReadWrite.AppFolder offline_access';
const FILE_PATH = '/backup.json';

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sha256B64url(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return b64url(digest);
}

function randomVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes.buffer);
}

export function redirectUri() {
  return `${location.origin}/`;
}

export function connected() {
  return !!(state.tokens && state.tokens.refreshToken);
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

/* 模块级缓存：从 IndexedDB 拉一次，之后写操作同步更新 */
const state = {
  clientId: '',
  tokens: null,
  auto: false,
  lastAt: 0
};

export async function loadSettings() {
  const s = await DB.getAllSettings();
  state.clientId = s.odClientId || '';
  state.tokens = s.odTokens || null;
  state.auto = !!s.odAuto;
  state.lastAt = s.odLast || 0;
}

export async function setClientId(id) {
  state.clientId = String(id || '').trim();
  await DB.setSetting('odClientId', state.clientId);
}

export async function setAuto(on) {
  state.auto = !!on;
  await DB.setSetting('odAuto', state.auto);
}

/* ---------- 授权 ---------- */

export async function connect() {
  if (!state.clientId) throw new Error('先填 Client ID');
  const verifier = randomVerifier();
  const challenge = await sha256B64url(verifier);
  const authState = randomVerifier();
  localStorage.setItem('od_pkce', JSON.stringify({ verifier, state: authState }));
  const q = new URLSearchParams({
    client_id: state.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: authState,
    prompt: 'select_account'
  });
  location.href = `${AUTH_BASE}/authorize?${q}`;
}

export async function disconnect() {
  state.tokens = null;
  await DB.delSetting('odTokens');
  localStorage.removeItem('od_pkce');
}

/* boot 时调用：授权回调带 ?code=xxx&state=xxx 回来，换 token 后清 URL。
 * 返回 'ok' | 'error' | null（不是回调）。 */
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  const error = q.get('error');
  const code = q.get('code');
  const authState = q.get('state');
  if (!error && !code) return null;

  const saved = JSON.parse(localStorage.getItem('od_pkce') || 'null');
  // 同站还有百度网盘等其它云备份也用 ?code= 回调，只认 state 与自己 PKCE 匹配的
  if (!saved || saved.state !== authState) return null;

  history.replaceState(null, '', location.pathname);
  localStorage.removeItem('od_pkce');

  if (error) return { ok: false, msg: q.get('error_description') || error };
  try {
    await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: saved.verifier
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

async function tokenRequest(params) {
  const res = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: state.clientId,
      scope: SCOPE,
      ...params
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `token 接口 ${res.status}`);
  }
  state.tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    account: parseAccount(data.id_token)
  };
  await DB.setSetting('odTokens', state.tokens);
}

/* 只取 id_token 里的邮箱/名字做展示，不验签（Graph 调用本身会验 token） */
function parseAccount(idToken) {
  try {
    const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.preferred_username || payload.name || payload.email || '';
  } catch (e) { return ''; }
}

async function accessToken() {
  if (!state.tokens) throw new Error('未连接 OneDrive');
  if (Date.now() < state.tokens.expiresAt) return state.tokens.accessToken;
  try {
    await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: state.tokens.refreshToken
    });
    return state.tokens.accessToken;
  } catch (e) {
    state.tokens = null;
    await DB.delSetting('odTokens');
    throw new Error('登录已过期，请重新连接 OneDrive');
  }
}

/* ---------- 备份 / 恢复 ---------- */

/* 返回 { ok:true, name, size } 或抛错。json 为完整备份 payload 字符串。 */
export async function uploadBackup(json) {
  const token = await accessToken();
  const res = await fetch(`${GRAPH}/me/drive/special/approot:${FILE_PATH}:/content`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: json
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`上传失败 ${res.status} ${t.slice(0, 120)}`);
  }
  state.lastAt = Date.now();
  await DB.setSetting('odLast', state.lastAt);
  const data = await res.json().catch(() => ({}));
  return { name: data.name || 'backup.json', size: json.length };
}

/* 返回备份文本；不存在（404）返回 null */
export async function downloadBackup() {
  const token = await accessToken();
  const res = await fetch(`${GRAPH}/me/drive/special/approot:${FILE_PATH}:/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`下载失败 ${res.status}`);
  return res.text();
}

/* 静默备份：连着且开了自动、距上次超过 20 小时才动手。返回是否真的备份了。 */
export async function maybeAutoBackup(buildJson) {
  if (!connected() || !state.auto) return false;
  if (Date.now() - state.lastAt < 20 * 3600 * 1000) return false;
  await uploadBackup(buildJson());
  return true;
}

const DB_NAME = 'pocket_ledger';
const DB_VER = 1;
let _db = null;

export function getDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tx')) {
        const s = db.createObjectStore('tx', { keyPath: 'id' });
        s.createIndex('date', 'date');
        s.createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains('cats')) {
        db.createObjectStore('cats', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'k' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function done(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

/* IDBTransaction 只有 oncomplete / onerror / onabort，没有 onsuccess */
function txDone(tx) {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error || new Error('transaction error'));
    tx.onabort = () => rej(tx.error || new Error('transaction aborted'));
  });
}

/* ---------------- transactions ---------------- */

export async function allTx() {
  const db = await getDB();
  const rows = await done(db.transaction('tx').objectStore('tx').getAll());
  return rows.sort((a, b) => (b.date === a.date ? b.ts - a.ts : b.date.localeCompare(a.date)));
}

export async function putTx(t) {
  const db = await getDB();
  return done(db.transaction('tx', 'readwrite').objectStore('tx').put(t));
}

export async function putManyTx(list) {
  const db = await getDB();
  const store = db.transaction('tx', 'readwrite').objectStore('tx');
  list.forEach(t => store.put(t));
  return txDone(store.transaction);
}

export async function delTx(id) {
  const db = await getDB();
  return done(db.transaction('tx', 'readwrite').objectStore('tx').delete(id));
}

export async function clearTx() {
  const db = await getDB();
  return done(db.transaction('tx', 'readwrite').objectStore('tx').clear());
}

/* ---------------- settings ---------------- */

export async function getSetting(k, def = null) {
  const db = await getDB();
  const row = await done(db.transaction('settings').objectStore('settings').get(k));
  return row ? row.v : def;
}

export async function setSetting(k, v) {
  const db = await getDB();
  return done(db.transaction('settings', 'readwrite').objectStore('settings').put({ k, v }));
}

export async function delSetting(k) {
  const db = await getDB();
  return done(db.transaction('settings', 'readwrite').objectStore('settings').delete(k));
}

export async function getAllSettings() {
  const db = await getDB();
  const rows = await done(db.transaction('settings').objectStore('settings').getAll());
  return Object.fromEntries(rows.map(r => [r.k, r.v]));
}

/* ---------------- 分类习惯（商户关键词 → 分类） ---------------- */

export async function getRules() {
  return (await getSetting('catRules', {})) || {};
}

export async function setRule(keyword, cat) {
  const kw = String(keyword || '').trim().slice(0, 12);
  if (!kw || !cat) return getRules();
  const rules = await getRules();
  if (rules[kw] === cat) return rules;
  rules[kw] = cat;
  // 上限 80 条，超了丢最早的
  const keys = Object.keys(rules);
  if (keys.length > 80) delete rules[keys[0]];
  await setSetting('catRules', rules);
  return rules;
}

export async function delRule(keyword) {
  const rules = await getRules();
  delete rules[keyword];
  await setSetting('catRules', rules);
  return rules;
}

/* ---------------- categories ---------------- */

export const DEFAULT_CATS = {
  expense: ['餐饮', '交通', '购物', '居住', '通讯', '娱乐', '医疗', '学习', '人情', '其他'],
  income: ['工资', '奖金', '兼职', '投资', '红包', '其他']
};

export async function allCats() {
  const db = await getDB();
  return done(db.transaction('cats').objectStore('cats').getAll());
}

export async function putCat(c) {
  const db = await getDB();
  return done(db.transaction('cats', 'readwrite').objectStore('cats').put(c));
}

export async function delCat(id) {
  const db = await getDB();
  return done(db.transaction('cats', 'readwrite').objectStore('cats').delete(id));
}

export async function seedCatsIfEmpty() {
  const existing = await allCats();
  if (existing.length) return existing;
  const db = await getDB();
  const store = db.transaction('cats', 'readwrite').objectStore('cats');
  const rows = [];
  for (const type of ['expense', 'income']) {
    DEFAULT_CATS[type].forEach((name, i) => {
      const row = { id: `${type}:${name}`, name, type, order: i };
      rows.push(row);
      store.put(row);
    });
  }
  await txDone(store.transaction);
  return rows;
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

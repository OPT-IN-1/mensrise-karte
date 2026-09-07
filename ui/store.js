// 作業データの保存先。いまはブラウザ内（IndexedDB）に置く。
// Supabaseにつなぐときは、この4つの関数の中身だけを差し替えれば済むようにしている。

const DB_NAME = 'karte';
const DB_VERSION = 1;
const STORES = ['jobs', 'files', 'settings'];

let dbPromise = null;

/**
 * ブラウザにデータを消さないよう頼む。
 * 頼まないと、空き容量が減ったときや長く使わなかったときに消されることがある。
 */
export async function keepData() {
  if (!navigator.storage?.persist) return { supported: false, persisted: false };
  const already = await navigator.storage.persisted();
  const persisted = already || await navigator.storage.persist();
  return { supported: true, persisted };
}

/** いまどれくらい使っているか。 */
export async function usage() {
  if (!navigator.storage?.estimate) return null;
  const { usage: used = 0, quota = 0 } = await navigator.storage.estimate();
  return { used, quota };
}

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function run(storeName, mode, action) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = action(tx.objectStore(storeName));
    tx.onerror = () => reject(tx.error);
    if (request) { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }
    else tx.oncomplete = () => resolve();
  }));
}

export const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const put = (store, key, value) => run(store, 'readwrite', (s) => s.put(value, key));
export const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
export const keys = (store) => run(store, 'readonly', (s) => s.getAllKeys());
export const all = (store) => run(store, 'readonly', (s) => s.getAll());

/** カルテ1件ぶんの作業データ。key は MID。 */
export const loadJob = (mid) => get('jobs', mid);
export const saveJob = (job) => {
  const at = new Date();
  // updated_at は画面用、updated_iso は新旧の比較用（ドライブとの同期で使う）
  return put('jobs', job.mid, {
    ...job,
    updated_at: at.toLocaleString('ja-JP', { hour12: false }),
    updated_iso: at.toISOString(),
  });
};
export const deleteJob = (mid) => del('jobs', mid);
export const listJobs = () => all('jobs');

/** 写真などのファイル。key は `${MID}/${役割}`。値は Blob。 */
export const loadFile = (key) => get('files', key);
export const saveFile = (key, blob) => put('files', key, blob);
export const deleteFile = (key) => del('files', key);
export const listFileKeys = () => keys('files');

/** 共有設定（読み込んだCSVや列マッピングなど）。 */
export const loadSetting = (key) => get('settings', key);
export const saveSetting = (key, value) => put('settings', key, value);

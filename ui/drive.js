// Google ドライブへの保存。カルテの作業データと写真を、決まった1つのフォルダに置く。
//
// 書き込みは drive.file（このツールが作ったファイルだけ）に絞っている。
// 読み取りは drive.readonly も使う（月次フォームの写真を取り込むため）。
// 書き換え・削除ができるのは、このツールが作ったファイルだけ。
// 認証はGoogleの画面で行い、パスワードはこのツールを通らない。

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const PICKER_SRC = 'https://apis.google.com/js/api.js';
// drive.file  … このツールが作ったカルテ・写真の読み書き（保存に使う）
// drive.readonly … フォームに送られてきた写真を読むため。読むだけで、書き換え・削除はできない。
//                  （drive.file だけでは、フォルダを選んでも中のファイルは読めない）
const SCOPE = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');
const FOLDER_NAME = 'メンズライズ カルテツール';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

const state = { clientId: '', apiKey: '', token: '', expiresAt: 0, folderId: '', email: '', parentId: '', placed: null };

/** 共有リンクでもIDでも受け取れるようにする。 */
export function folderIdFrom(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  const match = value.match(/\/folders\/([A-Za-z0-9_-]+)/) || value.match(/[?&]id=([A-Za-z0-9_-]+)/);
  return match ? match[1] : (/^[A-Za-z0-9_-]{20,}$/.test(value) ? value : '');
}

/** カルテのデータを置く親フォルダ（空ならマイドライブの直下）。 */
export function setParent(text) {
  state.parentId = folderIdFrom(text);
  state.folderId = '';
  state.placed = null;
  return state.parentId;
}

/** Googleのログイン用スクリプトを1回だけ読み込む。 */
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) { existing.addEventListener('load', () => resolve()); return; }
    const tag = document.createElement('script');
    tag.src = GIS_SRC;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error('Googleのログイン画面を読み込めませんでした。通信環境を確認してください。'));
    document.head.append(tag);
  });
}

export function configure(clientId, apiKey) {
  state.clientId = String(clientId || '').trim();
  if (apiKey !== undefined) state.apiKey = String(apiKey || '').trim();
}

export function status() {
  return {
    configured: Boolean(state.clientId),
    canPick: Boolean(state.apiKey),
    signedIn: Boolean(state.token) && Date.now() < state.expiresAt,
    email: state.email,
    folderId: state.folderId,
    parentId: state.parentId,
    // 指定した親フォルダの中に置けたか。置けなかった場合は手で移してもらう
    placed: state.placed,
    folderUrl: state.folderId ? `https://drive.google.com/drive/folders/${state.folderId}` : '',
  };
}

/**
 * Googleにログインして、書き込みの許可をもらう。
 * prompt を 'none' にすると、許可済みの場合だけ黙って通す（画面を出さない）。
 */
export function signIn({ silent = false } = {}) {
  if (!state.clientId) return Promise.reject(new Error('先にクライアントIDを設定してください。'));
  return loadGis().then(() => new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: state.clientId,
      scope: SCOPE,
      prompt: silent ? 'none' : '',
      callback: (response) => {
        if (response.error) { reject(new Error(response.error_description || response.error)); return; }
        state.token = response.access_token;
        state.expiresAt = Date.now() + (Number(response.expires_in || 3600) - 60) * 1000;
        resolve(status());
      },
      error_callback: (error) => reject(new Error(error.message || 'ログインできませんでした')),
    });
    client.requestAccessToken();
  }));
}

/**
 * 前回の接続をそのまま使う（有効期限が切れるまで）。
 * アクセス権は1時間で切れる短いもので、このブラウザの中にしか保存されない。
 */
export function useToken(saved) {
  if (!saved || !saved.token || Date.now() >= Number(saved.expiresAt || 0)) return false;
  state.token = saved.token;
  state.expiresAt = Number(saved.expiresAt);
  return true;
}

/** 保存しておく用に、いまの接続を取り出す。 */
export function currentToken() {
  return state.token ? { token: state.token, expiresAt: state.expiresAt } : null;
}

export function signOut() {
  if (state.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(state.token, () => {});
  state.token = '';
  state.expiresAt = 0;
  state.folderId = '';
  state.email = '';
}

function auth() {
  if (!state.token || Date.now() >= state.expiresAt) {
    throw new Error('Googleドライブにログインしていません。「ドライブに接続する」を押してください。');
  }
  return { Authorization: `Bearer ${state.token}` };
}

async function call(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...auth(), ...(options.headers || {}) } });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`ドライブとのやり取りに失敗しました（${response.status}）: ${detail.slice(0, 200)}`);
  }
  return response;
}

// 共有ドライブに置かれたフォルダでも扱えるようにする
const DRIVE_FLAGS = { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' };
const query = (parameters) => new URLSearchParams({ ...DRIVE_FLAGS, ...parameters }).toString();
const quote = (text) => String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/**
 * このツール用のフォルダを用意する（無ければ作る）。
 *
 * 指定された親フォルダの中に作ろうとするが、Googleの権限の仕組み上、
 * このツールが作っていないフォルダの中には作れないことがある。
 * その場合はマイドライブの直下に作り、「1回だけ手で移してください」と伝える。
 */
export async function ensureFolder() {
  if (state.folderId) return state.folderId;

  // すでに作ってあれば、どこに置かれていても名前で見つかる
  const found = await call(`${API}?${query({
    q: `name='${quote(FOLDER_NAME)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name,parents)', pageSize: '10',
  })}`).then((r) => r.json());
  if (found.files.length) {
    state.folderId = found.files[0].id;
    const parents = found.files[0].parents || [];
    state.placed = state.parentId ? parents.includes(state.parentId) : true;
    return state.folderId;
  }

  const body = { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' };
  const create = (meta) => call(`${API}?${query({ fields: 'id,parents' })}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta),
  }).then((r) => r.json());

  let created = null;
  if (state.parentId) {
    try {
      created = await create({ ...body, parents: [state.parentId] });
      state.placed = true;
    } catch {
      created = null;   // 親フォルダに触れないので、マイドライブ直下に作る
    }
  }
  if (!created) {
    created = await create(body);
    state.placed = state.parentId ? false : true;
  }
  state.folderId = created.id;
  return state.folderId;
}

/** フォルダの中身を種類ごとに一覧する。 */
export async function list() {
  const folderId = await ensureFolder();
  const files = [];
  let pageToken = '';
  do {
    const page = await call(`${API}?${query({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id,name,modifiedTime,size,appProperties)',
      pageSize: '200', ...(pageToken ? { pageToken } : {}),
    })}`).then((r) => r.json());
    files.push(...(page.files || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return files;
}

/** 中身を書き込む（同名があれば上書き、無ければ作る）。 */
async function put(name, blob, appProperties, existingId) {
  const folderId = await ensureFolder();
  const meta = existingId
    ? { name, appProperties }
    : { name, parents: [folderId], appProperties };
  const body = new FormData();
  body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  body.append('file', blob);
  const url = existingId
    ? `${UPLOAD}/${existingId}?${query({ uploadType: 'multipart', fields: 'id,modifiedTime' })}`
    : `${UPLOAD}?${query({ uploadType: 'multipart', fields: 'id,modifiedTime' })}`;
  return call(url, { method: existingId ? 'PATCH' : 'POST', body }).then((r) => r.json());
}

export const putJob = (job, existingId) => put(
  `job_${job.mid}.json`,
  new Blob([JSON.stringify(job)], { type: 'application/json' }),
  { kind: 'job', mid: job.mid, updated_at: String(job.updated_at || '') },
  existingId,
);

export const putPhoto = (mid, role, blob, stamp, existingId) => put(
  `photo_${mid}_${role}.jpg`, blob, { kind: 'photo', mid, role, stamp: String(stamp || '') }, existingId,
);

export const getFile = (id) => call(`${API}/${id}?alt=media`);
export const getJson = (id) => getFile(id).then((r) => r.json());
export const getBlob = (id) => getFile(id).then((r) => r.blob());
export const remove = (id) => call(`${API}/${id}`, { method: 'DELETE' });

/* ---------- ドライブの他のフォルダを、担当者に選んでもらう ---------- */
//
// drive.file の権限では、このツールが作っていないファイルは読めない。
// ただしGoogleの「ファイル選択画面（Picker）」で担当者が自分で選んだものだけは、
// 例外的に読めるようになる。月次フォームの写真フォルダはこの方法で受け取る。

/** Googleのファイル選択画面を1回だけ読み込む。 */
function loadPicker() {
  if (window.google?.picker) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const start = () => window.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('ファイル選択画面を読み込めませんでした。')) });
    if (window.gapi) { start(); return; }
    const tag = document.createElement('script');
    tag.src = PICKER_SRC;
    tag.onload = start;
    tag.onerror = () => reject(new Error('ファイル選択画面を読み込めませんでした。通信環境を確認してください。'));
    document.head.append(tag);
  });
}

/**
 * フォルダを選んでもらう。選ばれたフォルダは、このツールから読めるようになる。
 * 返り値は [{id, name}]。選ばずに閉じたら空の配列。
 */
export async function pickFolders() {
  if (!state.apiKey) throw new Error('APIキーが設定されていません。');
  auth();
  await loadPicker();
  return new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder');
    const picker = new google.picker.PickerBuilder()
      .setOAuthToken(state.token)
      .setDeveloperKey(state.apiKey)
      .setOrigin(location.protocol + '//' + location.host)
      .addView(view)
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .setTitle('月次フォームの写真フォルダを選んでください')
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          resolve((data.docs || []).map((doc) => ({ id: doc.id, name: doc.name })));
          picker.dispose();
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve([]);
          picker.dispose();
        }
      })
      .build();
    picker.setVisible(true);
  });
}

/** 選んでもらったフォルダを読むための共通の呼び出し口（formphotos.js から使う）。 */
export const apiCall = (url, options) => call(url, options);

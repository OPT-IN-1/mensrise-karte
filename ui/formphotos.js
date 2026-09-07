// 月次フォームに送られてきた写真を、ドライブから直接取り込む。
//
// Googleフォームは「質問ごとのフォルダ」に写真を保存し、
// ファイル名は「元のファイル名 - 回答者名.拡張子」になる。
// 用途（顔・全身・正面・横・背面）はフォルダ名にしか入っていないため、
// フォルダ名から用途を判定し、ファイル名の回答者名で受講生を特定する。

const API = 'https://www.googleapis.com/drive/v3/files';
const FLAGS = { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' };
const query = (parameters) => new URLSearchParams({ ...FLAGS, ...parameters }).toString();
const quote = (text) => String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// フォルダ名に含まれる語から、カルテの写真枠を決める。上から順に見て最初に当たったものを使う。
const ROLE_RULES = [
  { role: 'face', words: ['顔'] },
  { role: 'overview', words: ['全身'] },
  { role: 'training_front', words: ['正面', '前'] },
  { role: 'training_side', words: ['横', '側面'] },
  { role: 'training_back', words: ['後ろ', '背面', '後方'] },
];

/** フォルダ名から写真の用途を決める。判定できなければ null。 */
export function roleOfFolder(name) {
  const text = String(name || '');
  for (const rule of ROLE_RULES) {
    if (rule.words.some((word) => text.includes(word))) return rule.role;
  }
  return null;
}

/** 「1位胸 - 牧岡哲平.png」から回答者名を取り出す。 */
export function ownerOfFile(name) {
  const base = String(name || '').replace(/\.[A-Za-z0-9]+$/, '');
  const at = base.lastIndexOf(' - ');
  return at < 0 ? '' : base.slice(at + 3).trim();
}

/** フォルダの中身を全部読む（ページをまたいでも取りこぼさない）。 */
export async function listChildren(folderId, call, extraQuery = '') {
  const files = [];
  let pageToken = '';
  do {
    const page = await call(`${API}?${query({
      q: `'${quote(folderId)}' in parents and trashed=false${extraQuery}`,
      fields: 'nextPageToken, files(id,name,mimeType,modifiedTime)',
      pageSize: '200', ...(pageToken ? { pageToken } : {}),
    })}`).then((r) => r.json());
    files.push(...(page.files || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return files;
}

/**
 * 担当者が選んだフォルダを読み、{ 用途: [{id, name, owner}] } の形にして返す。
 *
 * 選ばれたのが「Men's Rise 月次チェック (File responses)」のような親フォルダでも、
 * その中の用途ごとのフォルダ5つでも、どちらでも同じように扱える。
 */
export async function scanResponses(folderIds, call) {
  const targets = new Map();   // フォルダID -> 用途
  for (const entry of [].concat(folderIds || [])) {
    const id = typeof entry === 'string' ? entry : entry.id;
    const name = typeof entry === 'string' ? '' : (entry.name || '');
    if (!id) continue;
    const role = roleOfFolder(name);
    if (role) { targets.set(id, role); continue; }
    // 用途が分からないフォルダは、中のフォルダを見て判定する（親フォルダを選ばれた場合）
    const subs = await listChildren(id, call, " and mimeType='application/vnd.google-apps.folder'");
    for (const sub of subs) {
      const subRole = roleOfFolder(sub.name);
      if (subRole) targets.set(sub.id, subRole);
    }
  }

  const out = {};
  for (const [folderId, role] of targets) {
    const files = await listChildren(folderId, call, " and mimeType contains 'image/'");
    (out[role] ??= []).push(...files.map((file) => ({
      id: file.id, name: file.name, owner: ownerOfFile(file.name),
      at: file.modifiedTime, mimeType: file.mimeType,
    })));
  }
  return out;
}

/**
 * その受講生の写真を、用途ごとに1枚ずつ選ぶ。
 * 同じ人が複数回出していれば、いちばん新しいものを使う。
 */
export function pickFor(scanned, name, normalize) {
  const want = normalize(name);
  const out = {};
  for (const [role, files] of Object.entries(scanned || {})) {
    const mine = files
      .filter((file) => file.owner && normalize(file.owner) === want)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (mine.length) out[role] = mine[0];
  }
  return out;
}

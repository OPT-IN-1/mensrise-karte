// 画面の組み立てと進行。現行ツール（static/app.js）と同じ画面・同じ手順で動く。
// 違うのはサーバーに投げずに、すべてこのブラウザの中で処理する点だけ。

import * as store from './store.js?v=20260908011822';
import * as photosLib from './photos.js?v=20260908011822';
import * as drive from './drive.js?v=20260908011822';
import * as formphotos from './formphotos.js?v=20260908011822';
import { CLIENT_ID, API_KEY } from './config.js?v=20260908011822';
import * as sync from './sync.js?v=20260908011822';
import { makeZip, readZip } from './zip.js?v=20260908011822';
import { buildSheets, loadTemplates, fitPage, printableDocument, PAGE_WIDTH, PAGE_HEIGHT, SHEET_TITLES } from './sheet.js?v=20260908011822';
import { CounselingCsv, decodeCsv, loadJoinMonths, lookupJoinMonth } from '../app/csv.js?v=20260908011822';
import { buildManifest, normalizeJoinMonth } from '../app/manifest.js?v=20260908011822';
import { FIELDS, BY_KEY, SECTION_LABEL, PHOTO_ROLES, OPERATOR_PHOTO_ROLES } from '../app/fields.js?v=20260908011822';
import * as rules from '../app/rules.js?v=20260908011822';
import * as monthly from '../app/monthly.js?v=20260908011822';
import { parseMenu } from '../app/menu.js?v=20260908011822';
import { buildContext } from '../app/context.js?v=20260908011822';
import * as validate from '../app/validate.js?v=20260908011822';
import * as submissions from '../app/submissions.js?v=20260908011822';
import { normalize } from '../app/text.js?v=20260908011822';
import { hasCurrentDelivery, deliveryStatus } from '../app/delivery.js?v=20260908011822';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowText = () => new Date().toLocaleString('ja-JP', { hour12: false });
/** 保存された日時を、どの書き方でも同じ見た目にして返す。 */
function whenText(value) {
  const text = String(value || '').trim();
  if (!text) return '—';
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? text : at.toLocaleString('ja-JP', { hour12: false });
}

let toastTimer = null;
function toast(message, isError) {
  const box = $('toast');
  box.textContent = message;
  box.className = isError ? 'err' : '';
  box.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.style.display = 'none'; }, 4000);
}

const VISUAL_ITEMS = [
  '文字が切れていない', '文字が背景と同化していない', '表・画像が重なっていない',
  '写真が用途どおりで本人である', '内部注記・別人情報がない',
];
const CHECK_LABELS = [
  ['pre', '生成前バリデーション'], ['html', 'HTML検査（残存・混入・クロスチェック）'],
  ['layout', 'レイアウト検査（はみ出し）'], ['body', 'カルテ本文の規則検査'],
];

// 画面の状態
const S = {
  data: {},                 // ナレッジ・商品・テンプレート
  csv: null, mapping: null, joinMonths: {}, csvName: '', csvSha: '',
  job: null, images: [], photo: null, role: 'face',
  submissions: null, monthlyName: '',
  selected: null, downloaded: false, operator: '', sheets: null, context: null,
};

/* ---------- 監査ログ ---------- */
async function audit(event, detail) {
  const log = (await store.loadSetting('audit')) || [];
  const now = new Date();
  // at は画面用、at_iso は並べ替えと重複判定用
  log.push({
    at: now.toLocaleString('ja-JP', { hour12: false }), at_iso: now.toISOString(),
    by: S.operator || '（未設定）', mid: S.job ? S.job.mid : '', event, detail: detail || {},
  });
  await store.saveSetting('audit', log.slice(-5000));
}

/** 監査ログを2つ束ねる。同じ記録は1つにまとめ、古い順に並べる。 */
function mergeAudit(a, b) {
  const seen = new Set();
  const out = [];
  for (const entry of [...(a || []), ...(b || [])]) {
    const key = `${entry.at_iso || entry.at}|${entry.event}|${entry.mid || ''}|${entry.by || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  const time = (entry) => {
    const value = new Date(entry.at_iso || entry.at).getTime();
    return Number.isNaN(value) ? 0 : value;
  };
  return out.sort((x, y) => time(x) - time(y)).slice(-5000);
}

/* ---------- 読み込み ---------- */
async function loadData() {
  const [forbidden, products, hairstyles, assets, program, template] = await Promise.all([
    fetch('data/forbidden.json').then((r) => r.json()),
    fetch('data/products.json').then((r) => r.json()),
    fetch('data/hairstyles.json').then((r) => r.json()),
    fetch('assets/manifest.json').then((r) => r.json()),
    fetch('data/training_program.md').then((r) => r.text()),
    fetch('templates/karte_v2/template.json').then((r) => r.json()),
  ]);
  S.data = { forbidden, products, hairstyles, assets, menuBlocks: parseMenu(program), template };
  await loadTemplates();
  $('templateId').innerHTML = `<option value="karte_v2">${esc(template.label)}</option>`;
}

async function restoreSettings() {
  const saved = await store.loadSetting('source');
  if (saved && saved.counseling_text) {
    S.csv = new CounselingCsv(saved.counseling_text);
    S.mapping = saved.mapping || S.csv.autoMapping();
    S.joinMonths = saved.members_text ? loadJoinMonths(saved.members_text) : {};
    S.csvName = saved.name || '';
    S.csvSha = saved.sha || '';
    S.submissions = saved.monthly_text ? submissions.load(saved.monthly_text) : null;
    S.monthlyName = saved.monthly_name || '';
    if (saved.monthly_name) setPicked('monthlyCsv', saved.monthly_name, true);
    setPicked('counselingCsv', S.csvName, true);
    if (saved.members_name) setPicked('membersCsv', saved.members_name, true);
  }
  const clientId = (await store.loadSetting('drive_client_id')) || CLIENT_ID;
  $('driveClientId').value = clientId;
  drive.configure(clientId, API_KEY);
  S.formFolders = (await store.loadSetting('form_folders')) || [];
  renderFormFolder();
  // 前回の接続をそのまま使う（Googleのアクセス権は1時間もつ）。
  // これで、ページを開き直すたびにボタンを押す必要がなくなる。
  // 1時間を過ぎたら「ドライブに接続する」を1回押してもらう。
  if (drive.useToken(await store.loadSetting('drive_token'))) {
    drive.ensureFolder().then(() => renderDrive()).catch(() => {});
  }
  const parent = (await store.loadSetting('drive_parent')) || '';
  $('driveParent').value = parent;
  drive.setParent(parent);
  renderDrive();
  await renderExportDir();
  await renderAutoBackup();
  S.operator = (await store.loadSetting('operator')) || '';
  $('operatorName').value = S.operator;
  $('visualBy').textContent = S.operator || '（未設定）';
  $('approveBy').textContent = S.operator || '（未設定）';
  renderSettingsState();
}

function setPicked(id, label, ok) {
  const box = $(id + 'Label');
  if (!box) return;
  box.textContent = label || '未選択';
  box.className = 'picked' + (ok ? ' on' : '');
}

function renderSettingsState() {
  if (!S.csv) { $('settingsState').textContent = '（未設定）'; return; }
  const forms = S.submissions ? `／月次フォーム ${Object.keys(S.submissions).length}名ぶん` : '／月次フォーム未設定';
  $('settingsState').textContent = `（${S.csvName}／${S.csv.rows.length}名を読み込み済み${forms}）`;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- 画面切替とステップ進行 ---------- */
const STEPS = ['input', 'photo', 'rules', 'build', 'qa'];

/** 各ステップが完了しているか。未完了なら「次へ」に理由を出す。 */
function stepStatus(step) {
  const job = S.job;
  if (step === 'input') {
    if (!S.csv) return { ok: false, why: '共通設定でカウンセリングCSVを読み込んでください。' };
    return job ? { ok: true } : { ok: false, why: '受講生を選んで「この受講生で作成を開始する」を押してください。' };
  }
  if (!job) return { ok: false, why: '先に受講生を選んでください。' };
  if (step === 'photo') {
    const rest = OPERATOR_PHOTO_ROLES.filter((r) => !(job.photos[r.role] && job.photos[r.role].cropped));
    return rest.length ? { ok: false, why: `写真が未確定：${rest.map((r) => r.label).join('、')}` } : { ok: true };
  }
  if (step === 'rules') {
    const d = job.decisions || {};
    if (!d.training) return { ok: false, why: '「判定する」を押してください。' };
    const un = d.unresolved || [];
    return un.length ? { ok: false, why: un[0] } : { ok: true };
  }
  if (step === 'build') {
    const g = job.generation || {};
    if (!g.built_at) return { ok: false, why: 'カルテを生成してください。' };
    const errors = checkErrors(job);
    if (!errors.length) return { ok: true };
    const head = errors[0];
    const more = errors.length > 1 ? `（ほか${errors.length - 1}件）` : '';
    return { ok: false, why: `${head.message}${more}${head.fix ? ' → ' + head.fix : ''}` };
  }
  if (step === 'qa') {
    const gate = gateOf(job);
    return gate.deliverable ? { ok: true } : { ok: false, why: gate.reasons[0] || '検品が未完了です。' };
  }
  return { ok: true };
}

function currentStep() {
  const active = document.querySelector('nav.steps button.active');
  return active ? active.dataset.screen : 'input';
}

function goStep(name) {
  document.querySelectorAll('nav.steps button').forEach((b) => b.classList.toggle('active', b.dataset.screen === name));
  document.querySelectorAll('section.screen').forEach((s) => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  window.scrollTo(0, 0);
  if (name === 'audit') loadAudit();
  if (name === 'home') renderHome();
  if (name === 'input') { renderRoster(); renderMapping(); }
  if (name === 'photo') renderRoles();
  if (name === 'qa') renderQA();
  renderStepBar();
}

function renderStepBar() {
  const step = currentStep();
  const index = STEPS.indexOf(step);
  document.querySelectorAll('nav.steps button').forEach((b) => {
    const s = b.dataset.screen;
    b.classList.toggle('done', STEPS.includes(s) && stepStatus(s).ok);
  });
  if (index < 0) {
    $('stepbar').style.display = 'none';
    document.body.classList.add('no-stepbar');
    return;
  }
  $('stepbar').style.display = 'flex';
  document.body.classList.remove('no-stepbar');
  const status = stepStatus(step);
  const last = index === STEPS.length - 1;
  $('stepPrev').style.visibility = index === 0 ? 'hidden' : 'visible';
  $('stepNext').textContent = last ? (S.downloaded ? '次のカルテを作成 →' : 'PDFにする（印刷）') : '次へ →';
  $('stepNext').disabled = !status.ok;
  $('stepMsg').innerHTML = status.ok
    ? (last ? (S.downloaded ? '<b>納品済みです。</b>次のカルテを作成できます。' : '<b>納品できます。</b>')
      : `<b>ステップ ${index + 1} 完了。</b>次のステップへ進めます。`)
    : `<span class="ng">ステップ ${index + 1}：${esc(status.why)}</span>`;
}

$('stepPrev').onclick = () => {
  const index = STEPS.indexOf(currentStep());
  if (index > 0) goStep(STEPS[index - 1]);
};
$('stepNext').onclick = () => {
  const index = STEPS.indexOf(currentStep());
  if (index === STEPS.length - 1) {
    if (S.downloaded) { startNextMember(); return; }
    $('downloadBtn').click();
    return;
  }
  goStep(STEPS[index + 1]);
};
document.querySelectorAll('nav.steps button').forEach((button) => {
  button.onclick = () => goStep(button.dataset.screen);
});

/* ---------- 共通設定 ---------- */
/**
 * 読み込んだCSVは、その場で保存する。
 * 「保存」を押し忘れて、次に開いたときに消えている、という事故を防ぐため。
 */
async function saveSource(patch) {
  const saved = (await store.loadSetting('source')) || {};
  const next = { ...saved, ...patch };
  if (!next.counseling_text) throw new Error('カウンセリングCSVがありません');
  const csv = new CounselingCsv(next.counseling_text);
  if (patch.counseling_text) next.mapping = csv.autoMapping();   // CSVを入れ替えたら対応づけも取り直す
  next.mapping = next.mapping || csv.autoMapping();
  next.sha = await sha256(next.counseling_text);
  await store.saveSetting('source', next);
  await restoreSettings();
  renderRoster();
  renderMapping();
  refreshCandidate();
  return csv;
}

$('counselingCsv').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const csv = await saveSource({ counseling_text: decodeCsv(await file.arrayBuffer()), name: file.name });
    await audit('counseling_loaded', { file: file.name, rows: csv.rows.length });
    toast(`${file.name} を読み込みました（${csv.rows.length}名）。保存済みです。`);
  } catch (error) {
    setPicked('counselingCsv', `読み込めませんでした：${error.message}`, false);
    toast(`読み込めませんでした：${error.message}`, true);
  }
};

$('membersCsv').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (!S.csv) { toast('先にカウンセリングCSVを読み込んでください', true); return; }
  try {
    await saveSource({ members_text: decodeCsv(await file.arrayBuffer()), members_name: file.name });
    await audit('members_loaded', { file: file.name });
    toast(`${file.name} を読み込みました。入会月を照合します。`);
  } catch (error) {
    toast(`読み込めませんでした：${error.message}`, true);
  }
};

$('monthlyCsv').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (!S.csv) { toast('先にカウンセリングCSVを読み込んでください', true); return; }
  try {
    await saveSource({ monthly_text: decodeCsv(await file.arrayBuffer()), monthly_name: file.name });
    await audit('monthly_loaded', { file: file.name, members: Object.keys(S.submissions || {}).length });
    renderHome();
    toast(`${file.name} を読み込みました（${Object.keys(S.submissions || {}).length}名ぶんの回答）。`);
  } catch (error) {
    toast(`読み込めませんでした：${error.message}`, true);
  }
};

/* ---------- データの保存先（Googleドライブ） ---------- */
function renderDrive() {
  const info = drive.status();
  $('driveState').textContent = info.signedIn ? '（接続中）' : (info.configured ? '（未接続）' : '（クライアントID未設定）');
  $('driveConnect').disabled = !info.configured || info.signedIn;
  $('driveSync').disabled = !info.signedIn;
  $('driveDisconnect').disabled = !info.signedIn;
  $('driveOrigin').textContent = `いまのURLなら： ${location.origin}`;
  $('pickFormFolder').disabled = !(info.signedIn && info.canPick);
  $('checkFormFolder').disabled = !(info.signedIn && (S.formFolders || []).length);
  renderFormPhotoWarn();
  if (!info.signedIn || !info.folderUrl) return;

  // どこに置かれたかを必ず見せる。指定の場所に置けなかったときは移し方を出す
  const link = `<a href="${esc(info.folderUrl)}" target="_blank" rel="noopener">保存先フォルダを開く</a>`;
  $('driveResult').innerHTML = info.placed === false
    ? `<span class="badge warn">1回だけ手作業が必要です</span> Googleの権限の仕組み上、指定のフォルダの中に直接は作れませんでした。`
      + `マイドライブの直下に「メンズライズ カルテツール」を作ってあるので、${link} から<b>指定のフォルダへドラッグして移してください</b>（1回だけ。移したあとも今までどおり動きます）。`
    : `<span class="badge ok">接続中</span> ${link}`;
}

$('saveDriveParent').onclick = async () => {
  const value = $('driveParent').value.trim();
  const id = drive.setParent(value);
  if (value && !id) { toast('フォルダのURLとして読み取れませんでした。ドライブでフォルダを開いたときのURLを貼ってください。', true); return; }
  await store.saveSetting('drive_parent', value);
  if (drive.status().signedIn) await drive.ensureFolder();
  renderDrive();
  toast(id ? '保存先フォルダを設定しました' : '保存先の指定を解除しました（マイドライブ直下になります）');
};

$('saveClientId').onclick = async () => {
  const value = $('driveClientId').value.trim();
  await store.saveSetting('drive_client_id', value);
  drive.configure(value || CLIENT_ID, API_KEY);
  if (!value) $('driveClientId').value = CLIENT_ID;
  renderDrive();
  toast(value ? 'クライアントIDを保存しました' : '同梱のクライアントIDに戻しました');
};

/* ---------- 月次フォームの写真フォルダ ---------- */
function renderFormFolder() {
  const list = S.formFolders || [];
  setPicked('formFolder', list.length ? list.map((f) => f.name).join('、') : '未選択', list.length > 0);
}

$('pickFormFolder').onclick = async () => {
  try {
    const picked = await drive.pickFolders();
    if (!picked.length) return;
    S.formFolders = picked;
    await store.saveSetting('form_folders', picked);
    renderFormFolder();
    await audit('form_folder_selected', { folders: picked.map((f) => f.name) });
    toast(`${picked.length}個のフォルダを覚えました。中身を確認します…`);
    renderDrive();
    $('checkFormFolder').onclick();
  } catch (error) {
    toast(`フォルダを選べませんでした：${error.message}`, true);
  }
};

$('checkFormFolder').onclick = async () => {
  $('checkFormFolder').disabled = true;
  $('formFolderResult').innerHTML = '確認しています…';
  const lines = [];
  try {
    // 選んだフォルダそれぞれについて、中が読めているかを1つずつ見せる
    for (const folder of S.formFolders || []) {
      try {
        const subs = await formphotos.listChildren(
          folder.id, drive.apiCall, " and mimeType='application/vnd.google-apps.folder'");
        const files = await formphotos.listChildren(
          folder.id, drive.apiCall, " and mimeType contains 'image/'");
        lines.push(`「${esc(folder.name)}」→ 中のフォルダ ${subs.length}個／写真 ${files.length}枚`);
      } catch (error) {
        lines.push(`「${esc(folder.name)}」→ <b>読めません</b>（${esc(error.message)}）`);
      }
    }
    const scanned = await formphotos.scanResponses(S.formFolders || [], drive.apiCall);
    const roles = OPERATOR_PHOTO_ROLES.filter((r) => scanned[r.role]);
    // 誰の写真として読めているかを見せる（氏名が取れていないと自動で入らないため）
    const owners = [...new Set(Object.values(scanned).flat().map((f) => f.owner || '（名前なし）'))];
    if (owners.length) lines.push(`届いている人：${owners.map(esc).join('、')}`);
    const detail = `<div class="small" style="margin-top:4px">${lines.join('<br>')}</div>`;
    $('formFolderResult').innerHTML = roles.length
      ? `<span class="badge ok">読めています</span> `
        + roles.map((r) => `${esc(r.label.replace(/（.*/, ''))}：${scanned[r.role].length}枚`).join('／')
        + detail
      : '<span class="badge ng">読めませんでした</span> 用途ごとのフォルダが見つかりません。'
        + '「フォルダを選ぶ」から、<b>中にある5つのフォルダをまとめて</b>選び直してください。' + detail;
  } catch (error) {
    $('formFolderResult').innerHTML = `<span class="badge ng">読めませんでした</span> ${esc(error.message)}`;
  }
  renderDrive();
};

$('clearFormFolder').onclick = async () => {
  S.formFolders = [];
  await store.saveSetting('form_folders', []);
  renderFormFolder();
  $('formFolderResult').textContent = '';
  renderDrive();
  toast('写真フォルダの指定を解除しました（写真は手で読み込む形に戻ります）');
};

/**
 * フォームに送られてきた写真を、その受講生ぶんだけ取り込んで各枠に当てはめる。
 * 切り抜きは中央の既定値で行う。おかしければ2番の画面で担当者が直せる。
 */
async function importFormPhotos(job) {
  const folders = S.formFolders || [];
  if (!folders.length || !drive.status().signedIn) return null;
  const scanned = await formphotos.scanResponses(folders, drive.apiCall);
  const mine = formphotos.pickFor(scanned, job.name, normalize);
  const done = [];
  const failed = [];
  for (const roleInfo of OPERATOR_PHOTO_ROLES) {
    const found = mine[roleInfo.role];
    if (!found) continue;
    try {
      const blob = await drive.getBlob(found.id);
      const file = new File([blob], found.name, { type: found.mimeType || blob.type || 'image/jpeg' });
      const bitmap = await photosLib.loadImage(file);
      const result = await photosLib.cropForRole(bitmap, roleInfo.ratio, { rotate: 0, zoom: 1, offsetX: 0, offsetY: 0 });
      await store.saveFile(`${job.mid}/${roleInfo.role}`, result.blob);
      job.photos[roleInfo.role] = {
        cropped: `${roleInfo.role}.jpg`, source_name: found.name, ratio: roleInfo.ratio,
        rotate: result.rotate, zoom: result.zoom, offset_x: result.offset_x, offset_y: result.offset_y,
        // 担当者の確認待ちは作らない（手で入れたときと同じく自動で確定にする）
        identity_confirmed: true, usage_confirmed: true, crop_confirmed: true,
        from_form: true, at: nowText(),
      };
      if (roleInfo.role === 'face') {
        job.measured = await photosLib.measureFace(bitmap);
        const hairRole = PHOTO_ROLES.find((r) => r.role === 'hair');
        const derived = await photosLib.cropForRole(bitmap, hairRole.ratio, { rotate: 0, zoom: 1, offsetX: 0, offsetY: 0 });
        await store.saveFile(`${job.mid}/hair`, derived.blob);
        job.photos.hair = { ...job.photos.face, cropped: 'hair.jpg', ratio: hairRole.ratio, derived_from: 'face' };
      }
      done.push(roleInfo.label);
    } catch (error) {
      // 1枚が開けなくても（iPhoneのHEICなど）、残りの取り込みは続ける
      failed.push(`${roleInfo.label}（${error.message}）`);
    }
  }
  const missing = OPERATOR_PHOTO_ROLES
    .filter((r) => !mine[r.role]).map((r) => r.label).concat(failed);
  return { done, missing };
}

$('driveConnect').onclick = async () => {
  try {
    await drive.signIn();
    await drive.ensureFolder();
    await store.saveSetting('drive_token', drive.currentToken());
    renderDrive();
    await audit('drive_connected', {});
    toast('ドライブに接続しました。');
    // フォルダを覚えてある場合は、写真が読めるかをその場で確かめて見せる
    if ((S.formFolders || []).length) $('checkFormFolder').onclick();
  } catch (error) {
    $('driveResult').innerHTML = `<span class="badge ng">接続できません</span> ${esc(error.message)}`;
  }
};

$('driveDisconnect').onclick = async () => {
  drive.signOut();
  await store.saveSetting('drive_token', null);
  renderDrive();
  $('formFolderResult').textContent = '';
  toast('ドライブとの接続を切りました（このブラウザのデータは残ります）');
};

$('driveSync').onclick = async () => {
  $('driveSync').disabled = true;
  $('driveResult').textContent = '';
  try {
    const report = await sync.syncAll((message) => { $('driveProgress').textContent = message; });
    $('driveProgress').textContent = '';
    $('driveResult').innerHTML = '<span class="badge ok">同期しました</span> '
      + `ドライブから ${report.downloaded}名（写真${report.photosDown}枚）／ドライブへ ${report.uploaded}名（写真${report.photosUp}枚）／変更なし ${report.same}名`;
    await audit('drive_synced', report);
    renderHome();
    toast('ドライブと同期しました');
  } catch (error) {
    $('driveProgress').textContent = '';
    $('driveResult').innerHTML = `<span class="badge ng">同期できません</span> ${esc(error.message)}`;
  }
  $('driveSync').disabled = false;
};

/** 保存のたびにドライブへ送る（接続しているときだけ。まとめて少し待ってから送る）。 */
let pushTimer = null;
function schedulePush(job) {
  if (!drive.status().signedIn) return;
  clearTimeout(pushTimer);
  const target = { ...job };
  pushTimer = setTimeout(() => {
    sync.pushJob(target).catch((error) => toast(`ドライブへの保存に失敗しました：${error.message}`, true));
  }, 1500);
}

/* ---------- バックアップ（書き出し・取り込み） ---------- */
const stamp = () => {
  const now = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
};

/** 書き出しに入っていたツール設定を戻す（担当者名と書き出し先は端末ごとなので触らない）。 */
async function applyConfig(config) {
  if (!config) return;
  if (config.drive_client_id) {
    await store.saveSetting('drive_client_id', config.drive_client_id);
    $('driveClientId').value = config.drive_client_id;
    drive.configure(config.drive_client_id);
  }
  if (config.drive_parent) {
    await store.saveSetting('drive_parent', config.drive_parent);
    $('driveParent').value = config.drive_parent;
    drive.setParent(config.drive_parent);
  }
  renderDrive();
}

/** 書き出し先フォルダ（選んでおくと、以降そこへ直接書き出す）。 */
async function exportDir() {
  const saved = await store.loadSetting('export_dir');
  if (!saved) return null;
  return saved.handle ? saved : { handle: saved, name: saved.name || '選んだ' };
}

async function renderExportDir() {
  const target = await exportDir();
  $('exportDirLabel').textContent = target
    ? `${target.name} フォルダに直接書き出します` : '未選択（ダウンロードフォルダに保存されます）';
  $('exportDirLabel').className = 'picked' + (target ? ' on' : '');
  $('pickExportDir').style.display = window.showDirectoryPicker ? '' : 'none';
  $('clearExportDir').style.display = target ? '' : 'none';
}

$('pickExportDir').onclick = async () => {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'karte-export' });
    await store.saveSetting('export_dir', { handle, name: handle.name || '選んだ' });
    await renderExportDir();
    await renderAutoBackup();
    await checkStorage(true);
    toast(`${handle.name} を書き出し先にしました。以降は変更のたびに自動で書き出します。`);
  } catch (error) {
    if (error.name !== 'AbortError') toast(`選べませんでした：${error.message}`, true);
  }
};

$('clearExportDir').onclick = async () => {
  await store.saveSetting('export_dir', null);
  await renderExportDir();
  await renderAutoBackup();
  await checkStorage(false);
  toast('ダウンロードフォルダに保存する設定に戻しました');
};

/** 書き出したZIPを、選んだフォルダかダウンロードフォルダに保存する。 */
async function saveZip(zip, filename) {
  const target = await exportDir();
  if (target) {
    const { handle, name } = target;
    let permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') permission = await handle.requestPermission({ mode: 'readwrite' });
    if (permission === 'granted') {
      const file = await handle.getFileHandle(filename, { create: true });
      const writer = await file.createWritable();
      await writer.write(zip);
      await writer.close();
      return `${name} フォルダ`;
    }
    toast('フォルダへの書き込みが許可されなかったため、ダウンロードフォルダに保存します', true);
  }
  const url = URL.createObjectURL(zip);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'ダウンロードフォルダ';
}

/** 書き出すZIPを組み立てる（手動でも自動でも同じ中身）。 */
async function buildBackup() {
  const jobs = await store.listJobs();
  const files = [{ name: 'jobs.json', blob: new Blob([JSON.stringify(jobs, null, 1)], { type: 'application/json' }) }];
  const settings = await store.loadSetting('source');
  if (settings) files.push({ name: 'settings.json', blob: new Blob([JSON.stringify(settings)], { type: 'application/json' }) });
  const log = (await store.loadSetting('audit')) || [];
  files.push({ name: 'audit.json', blob: new Blob([JSON.stringify(log)], { type: 'application/json' }) });
  files.push({ name: 'config.json', blob: new Blob([JSON.stringify({
    drive_client_id: (await store.loadSetting('drive_client_id')) || '',
    drive_parent: (await store.loadSetting('drive_parent')) || '',
  })], { type: 'application/json' }) });
  let photos = 0;
  for (const job of jobs) {
    for (const { role } of PHOTO_ROLES) {
      const blob = await store.loadFile(`${job.mid}/${role}`);
      if (!blob) continue;
      files.push({ name: `photos/${job.mid}/${role}.jpg`, blob });
      photos += 1;
    }
  }
  return { zip: await makeZip(files), filename: `カルテデータ_${stamp()}.zip`, members: jobs.length, photos };
}

$('runExport').onclick = async () => {
  $('runExport').disabled = true;
  $('exportState').textContent = 'まとめています…';
  try {
    const { zip, filename, members, photos } = await buildBackup();
    const where = await saveZip(zip, filename);
    $('exportState').textContent = `${members}名・写真${photos}枚（${(zip.size / 1024 / 1024).toFixed(1)}MB）を ${where} に書き出しました`;
    await store.saveSetting('last_backup', { at: nowText(), where, members, photos });
    await renderAutoBackup();
    await audit('exported', { members, photos, bytes: zip.size, where });
    toast(`${where} に ${filename} を書き出しました`);
  } catch (error) {
    $('exportState').innerHTML = `<span class="badge ng">書き出せませんでした</span> ${esc(error.message)}`;
    toast(`書き出せませんでした：${error.message}`, true);
  }
  $('runExport').disabled = false;
};

let zipFile = null;
$('importZip').onchange = (event) => {
  zipFile = event.target.files[0] || null;
  setPicked('importZip', zipFile ? zipFile.name : '', Boolean(zipFile));
  $('runImportZip').disabled = !zipFile;
};

$('runImportZip').onclick = async () => {
  if (!zipFile) return;
  $('runImportZip').disabled = true;
  $('importZipResult').textContent = '取り込んでいます…';
  try {
    const entries = await readZip(zipFile);
    const named = (want) => entries.find((e) => e.name.replace(/^.*\//, '') === want);
    const jobsEntry = named('jobs.json');
    if (!jobsEntry) throw new Error('jobs.json が入っていません。このツールで書き出したファイルを選んでください。');
    const jobs = JSON.parse(await jobsEntry.blob.text());
    const photos = entries.filter((e) => e.name.includes('photos/'));

    // 監査ログは、いまある記録と束ねる（取り込みで履歴が消えないように）
    let auditCount = 0;
    const auditEntry = named('audit.json');
    if (auditEntry) {
      const incoming = JSON.parse(await auditEntry.blob.text());
      await store.saveSetting('audit', mergeAudit(await store.loadSetting('audit'), incoming));
      auditCount = incoming.length;
    }
    const configEntry = named('config.json');
    if (configEntry) await applyConfig(JSON.parse(await configEntry.blob.text()));

    // 共通設定が入っていれば先に戻す（受講生一覧と行番号の照合に必要）
    let restoredSettings = false;
    const settingsEntry = named('settings.json');
    if (settingsEntry) {
      const settings = JSON.parse(await settingsEntry.blob.text());
      if (settings && settings.counseling_text) {
        await store.saveSetting('source', settings);
        await restoreSettings();
        renderRoster();
        renderMapping();
        restoredSettings = true;
      }
    }

    let saved = 0, photoCount = 0;
    const notFound = [];
    for (const job of jobs) {
      // 行番号は取り込み先のCSVで引き直す（列や並びが違っていても合うように）
      const hit = S.csv
        ? (S.csv.findCandidates(job.mid, '', S.mapping)[0] || S.csv.findCandidates('', job.name, S.mapping)[0])
        : null;
      if (S.csv && !hit) notFound.push(`${job.mid} ${job.name}`);
      const existing = await store.loadJob(job.mid);
      await store.saveJob({
        ...job,
        row_index: hit ? hit.row_index : (existing ? existing.row_index : job.row_index),
        nickname: job.nickname || (hit ? hit.nickname : ''),
      });
      saved += 1;
    }
    for (const entry of photos) {
      const parts = entry.name.split('/');
      const role = parts.pop().replace(/\.jpg$/i, '');
      const mid = parts.pop();
      await store.saveFile(`${mid}/${role}`, entry.blob);
      photoCount += 1;
    }
    await audit('imported_backup', { members: saved, photos: photoCount, file: zipFile.name, not_found: notFound });
    $('importZipResult').innerHTML = `<span class="badge ok">取り込み完了</span> ${saved}名（写真 ${photoCount}枚）`
      + (restoredSettings ? '<div class="hint">カウンセリングCSVと列の対応づけも一緒に読み込みました。</div>' : '')
      + (auditCount ? `<div class="hint">監査ログ ${auditCount}件を取り込みました（もとからあった記録は残ります）。</div>` : '')
      + (notFound.length ? `<div class="hint">いまのCSVに見つからなかった人：${esc(notFound.join('、'))}（写真と履歴は取り込み済みです）</div>` : '');
    renderHome();
    toast(`${saved}名ぶんを取り込みました`);
  } catch (error) {
    $('importZipResult').innerHTML = `<span class="badge ng">失敗</span> ${esc(error.message)}`;
  }
  $('runImportZip').disabled = false;
};

/* ---------- フォルダから取り込む ---------- */
// 書き出したファイルを展開してしまった場合や、現行ツールの past_import フォルダから取り込む場合。
let importFiles = null;

$('importFolder').onchange = (event) => {
  const files = [...event.target.files];
  const jobsFile = files.find((f) => f.webkitRelativePath.endsWith('/jobs.json') || f.name === 'jobs.json');
  if (!jobsFile) {
    setPicked('importFolder', 'jobs.json が見つかりません（書き出したフォルダを選んでください）', false);
    $('runImport').disabled = true;
    importFiles = null;
    return;
  }
  importFiles = {
    jobsFile,
    settingsFile: files.find((f) => f.name === 'settings.json'),
    auditFile: files.find((f) => f.name === 'audit.json'),
    configFile: files.find((f) => f.name === 'config.json'),
    photos: files.filter((f) => f.webkitRelativePath.includes('/photos/')),
  };
  setPicked('importFolder', `${files.length}ファイル（写真 ${importFiles.photos.length}枚）`, true);
  $('runImport').disabled = false;
};

$('runImport').onclick = async () => {
  if (!importFiles) return;
  if (!S.csv && !importFiles.settingsFile) { toast('先にカウンセリングCSVを読み込んでください', true); return; }
  $('runImport').disabled = true;
  $('importResult').textContent = '取り込んでいます…';
  try {
    const jobs = JSON.parse(await importFiles.jobsFile.text());

    // 監査ログは、いまある記録と束ねる（取り込みで履歴が消えないように）
    let auditCount = 0;
    if (importFiles.auditFile) {
      const incoming = JSON.parse(await importFiles.auditFile.text());
      await store.saveSetting('audit', mergeAudit(await store.loadSetting('audit'), incoming));
      auditCount = incoming.length;
    }
    if (importFiles.configFile) await applyConfig(JSON.parse(await importFiles.configFile.text()));

    // 共通設定が入っていれば先に戻す（受講生一覧と行番号の照合に必要）
    let restoredSettings = false;
    if (importFiles.settingsFile) {
      const settings = JSON.parse(await importFiles.settingsFile.text());
      if (settings && settings.counseling_text) {
        await store.saveSetting('source', settings);
        await restoreSettings();
        renderRoster();
        renderMapping();
        restoredSettings = true;
      }
    }

    // 写真は photos/<MID>/<用途>.jpg の形で入っている
    const byMid = {};
    for (const file of importFiles.photos) {
      const parts = file.webkitRelativePath.split('/');
      const mid = parts[parts.length - 2];
      (byMid[mid] ??= []).push(file);
    }
    let saved = 0, photoCount = 0;
    const notFound = [];
    for (const job of jobs) {
      const hit = S.csv
        ? (S.csv.findCandidates(job.mid, '', S.mapping)[0] || S.csv.findCandidates('', job.name, S.mapping)[0])
        : null;
      if (S.csv && !hit) notFound.push(`${job.mid} ${job.name}`);
      const existing = await store.loadJob(job.mid);
      await store.saveJob({
        ...job,
        row_index: hit ? hit.row_index : (existing ? existing.row_index : job.row_index),
        nickname: job.nickname || (hit ? hit.nickname : ''),
        imported_at: nowText(),
      });
      for (const file of byMid[job.mid] || []) {
        const role = file.name.replace(/\.jpg$/i, '');
        await store.saveFile(`${job.mid}/${role}`, file);
        photoCount += 1;
      }
      saved += 1;
    }
    await audit('past_imported', { count: saved, photos: photoCount, not_found: notFound });
    $('importResult').innerHTML = `<span class="badge ok">取り込み完了</span> ${saved}名（写真 ${photoCount}枚）`
      + (restoredSettings ? '<div class="hint">カウンセリングCSVと列の対応づけも一緒に読み込みました。</div>' : '')
      + (auditCount ? `<div class="hint">監査ログ ${auditCount}件を取り込みました（もとからあった記録は残ります）。</div>` : '')
      + (notFound.length ? `<div class="hint">いまのCSVに見つからなかった人：${esc(notFound.join('、'))}（写真と履歴は取り込み済みです）</div>` : '');
    renderHome();
    toast(`${saved}名ぶんの過去カルテを取り込みました`);
  } catch (error) {
    $('importResult').innerHTML = `<span class="badge ng">失敗</span> ${esc(error.message)}`;
  }
  $('runImport').disabled = false;
};

/* ---------- ホーム ---------- */
async function renderHome() {
  const jobs = (await store.listJobs()).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  $('jobsCount').textContent = jobs.length ? `（${jobs.length}件）` : '（まだありません）';
  if (!jobs.length) {
    $('jobsTable').innerHTML = '<tr><td class="small">作成したカルテはまだありません。</td></tr>';
    return;
  }
  $('jobsTable').innerHTML = '<tr><th>受講生</th><th>状態</th><th>最終更新</th><th></th></tr>'
    + jobs.map((job) => {
      const delivered = hasCurrentDelivery(job) && !job.generation?.needs_redelivery;
      const status = deliveryStatus(job);
      const month = job.current_month ? `<span class="small">${esc(job.current_month)} 分</span>` : '<span class="small">初回</span>';

      // 月次フォームを設定してある場合だけ、提出済みの人しか更新できないようにする
      const sub = S.submissions ? submissions.statusFor(S.submissions, job.mid, '', job.name) : null;
      const subBadge = !S.submissions
        ? '<span class="small">フォーム未設定</span>'
        : (sub.submitted
          ? `<span class="badge ok">フォーム記入済み（${esc(sub.month)}）</span>`
            + (sub.matched_by === 'name' ? '<span class="small">（氏名で照合）</span>' : '')
          : `<span class="badge ng">${esc(sub.month)} 未提出</span>`);
      const gated = Boolean(S.submissions) && !sub.submitted;
      const why = !delivered ? '納品が済んでから使えます' : (gated ? 'フォームの提出待ちです' : '');

      return `<tr>
        <td><b>${esc(job.mid)}</b> ${esc(job.name)}${job.nickname ? `<span class="small">（${esc(job.nickname)}）</span>` : ''}<br>${month}</td>
        <td><span class="badge ${delivered ? 'ok' : 'info'}">${esc(status)}</span><br>${subBadge}</td>
        <td class="small">${esc(whenText(job.updated_at || job.created_at))}</td>
        <td><button class="act mini" data-open="${esc(job.mid)}">開いて修正</button>
            <button class="act mini" data-month="${esc(job.mid)}" ${delivered && !gated ? '' : `disabled title="${esc(why)}"`}>今月分に更新</button>
            <button class="act ghost mini" data-del="${esc(job.mid)}">削除</button></td>
      </tr>`;
    }).join('');

  $('jobsTable').querySelectorAll('[data-open]').forEach((button) => {
    button.onclick = async () => {
      const job = await store.loadJob(button.dataset.open);
      if (!job) { toast('作業データが見つかりません', true); return; }
      S.job = job;
      S.downloaded = false;
      await afterJob();
      goStep(job.generation && job.generation.built_at ? 'qa' : 'input');
      toast(`${job.mid} ${job.name} を開きました`);
    };
  });
  $('jobsTable').querySelectorAll('[data-month]').forEach((button) => {
    button.onclick = async () => {
      const job = await store.loadJob(button.dataset.month);
      if (!job) return;
      S.job = job;
      await startMonthUpdate();
    };
  });
  $('jobsTable').querySelectorAll('[data-del]').forEach((button) => {
    button.onclick = async () => {
      const mid = button.dataset.del;
      if (!confirm(`${mid} のカルテを削除しますか？\n作業データ・写真がすべて消え、元に戻せません。`)) return;
      for (const { role } of PHOTO_ROLES) await store.deleteFile(`${mid}/${role}`);
      await store.deleteJob(mid);
      if (drive.status().signedIn) {
        try { await sync.removeJob(mid); } catch (error) { toast(`ドライブ側を消せませんでした：${error.message}`, true); }
      }
      if (S.job && S.job.mid === mid) { S.job = null; await afterJob(); }
      renderHome();
      toast(`${mid} を削除しました`);
    };
  });
}
$('homeCreate').onclick = () => goStep('input');

/* ---------- 2回目以降：今月の体重を入れて、写真を差し替えるところから再開する ---------- */
async function startMonthUpdate() {
  const suggested = monthly.monthKey();
  const sub = S.submissions ? submissions.statusFor(S.submissions, S.job.mid, '', S.job.name) : null;
  // フォームの回答があれば、その内容を初期値にする（手で打ち直さなくて済むように）
  const month = prompt('何月分の更新ですか？（例 2026-09）', (sub && sub.month) || suggested);
  if (!month) return;
  const fromForm = S.submissions ? submissions.statusFor(S.submissions, S.job.mid, month, S.job.name) : null;
  const weight = prompt(`${month} の体重（kg）を入れてください`, (fromForm && fromForm.weight_kg) || '');
  if (weight === null) return;
  const bodyFat = prompt('体脂肪率（%）※計測していなければ空のままでOK', (fromForm && fromForm.body_fat_pct) || '');
  if (bodyFat === null) return;

  const job = S.job;
  const manifest = buildJobManifest(job);
  const entry = ((job.progress ??= {})[month] ??= {});
  if (weight.trim()) entry.weight_kg = weight.trim();
  if (bodyFat.trim()) entry.body_fat_pct = bodyFat.trim();
  entry.at = nowText();
  if (entry.weight_kg) job.field_corrections.weight_kg = entry.weight_kg;
  if (entry.body_fat_pct) job.field_corrections.body_fat_pct = entry.body_fat_pct;

  const joinMonth = manifest.member.join_month || '';
  const elapsed = monthly.monthsBetween(joinMonth, month);
  const notes = [];
  // 髪の長さ：最初に目視判定した長さから、累計の経過月数ぶん伸ばす（1ヶ月＝約1cm）
  let base = job.hair_length_base;
  if (!base || !base.label) {
    base = { label: monthly.KEY_TO_LENGTH[job.hair_length_key] || '', month: job.current_month || joinMonth };
    job.hair_length_base = base;
  }
  const step = base.label ? monthly.monthsBetween(base.month || '', month) : 0;
  if (base.label && step > 0) {
    const [grown, why] = monthly.grownLength(base.label, step);
    if (why) notes.push(why);
    job.hair_length_key = monthly.LENGTH_KEYS[grown] || job.hair_length_key;
  }
  // 筋トレのPhase：3ヶ月ごとに1段階
  const basePhase = ((job.decisions || {}).training || {}).value?.phase || '';
  if (basePhase) {
    job.base_phase ??= basePhase;
    const [phase, why] = monthly.nextPhase(job.base_phase, elapsed);
    job.phase_override = phase;
    notes.push(why);
  }
  job.current_month = month;
  job.round = Number(job.round || 1) + 1;
  job.visual = {};
  job.approval = {};
  job.generation = {};
  await saveJob();
  await audit('month_update_started', { month, elapsed_months: elapsed, weight_kg: weight, body_fat_pct: bodyFat, notes });

  // フォームの写真フォルダを設定してあれば、その人の5枚をここで取り込む
  let photoNote = '写真を差し替えてください。';
  if ((S.formFolders || []).length && drive.status().signedIn) {
    toast(`${job.name} さんの写真をフォームから探しています…`);
    try {
      const got = await importFormPhotos(job);
      await saveJob();
      await audit('form_photos_imported', { month, imported: got.done, missing: got.missing });
      photoNote = got.done.length
        ? (got.missing.length
          ? `写真を${got.done.length}枚取り込みました。届いていない ${got.missing.join('、')} は手で入れてください。`
          : '写真5枚をフォームから取り込みました。そのままで良ければ次へ進んでください。')
        : 'フォームにこの方の写真が見つかりませんでした。手で入れてください。';
    } catch (error) {
      photoNote = `フォームの写真を取り込めませんでした（${error.message}）。手で入れてください。`;
    }
  }

  S.downloaded = false;
  await afterJob();
  goStep('photo');
  toast(`${month} 分の更新を開始しました。${photoNote}${notes.length ? '（' + notes.join(' ／ ') + '）' : ''}`);
}

/* ---------- 1. 受講生を選ぶ ---------- */
function renderRoster() {
  if (!S.csv) {
    // まだ何も入っていないブラウザ。どうすれば使えるようになるかをその場で示す
    $('rosterTable').innerHTML = `<tr><td>
      <b>このブラウザにはまだデータがありません。</b>
      <div class="hint" style="margin:6px 0 8px">
        いつも使っているパソコンなら、書き出したバックアップを取り込むのが確実です。
        新しく始める場合は、カウンセリングCSVを読み込んでください。
      </div>
      <button class="act mini" id="rosterGoImport">バックアップを取り込む</button>
      <button class="act ghost mini" id="rosterGoCsv">カウンセリングCSVを読み込む</button>
    </td></tr>`;
    $('rosterGoImport').onclick = () => $('importZip').scrollIntoView({ block: 'center' });
    $('rosterGoCsv').onclick = () => $('counselingCsv').scrollIntoView({ block: 'center' });
    return;
  }
  const query = normalize($('rosterSearch').value);
  const roster = S.csv.roster(S.mapping).filter((entry) => !query
    || [entry.mid, entry.name, entry.nickname].some((v) => normalize(v).includes(query)));
  const rows = ['<tr><th style="width:90px">MID</th><th>氏名</th><th>呼び名</th><th style="width:110px">入会月</th><th style="width:110px"></th></tr>'];
  roster.slice(0, 300).forEach((entry) => {
    const join = lookupJoinMonth(S.joinMonths, entry.name) || normalizeJoinMonth(entry.join_month) || '—';
    const sel = S.selected && S.selected.row_index === entry.row_index ? ' class="sel"' : '';
    rows.push(`<tr${sel}><td><b>${esc(entry.mid)}</b></td><td>${esc(entry.name)}</td>
      <td>${esc(entry.nickname)}</td><td class="small">${esc(join)}</td>
      <td><button class="act ghost mini" data-row="${entry.row_index}">選ぶ</button></td></tr>`);
  });
  if (roster.length === 0) {
    rows.push(`<tr><td colspan="5" class="small">「${esc($('rosterSearch').value)}」に一致する受講生がいません。`
      + `MIDで探すか、共通設定で最新のカウンセリングCSVを読み込み直してください。</td></tr>`);
  }
  $('rosterTable').innerHTML = rows.join('');
  $('rosterTable').querySelectorAll('[data-row]').forEach((button) => {
    button.onclick = () => {
      S.selected = roster.find((e) => e.row_index === Number(button.dataset.row));
      renderRoster();
      refreshCandidate();
    };
  });
}
$('rosterSearch').oninput = () => renderRoster();
$('reloadRoster').onclick = () => { renderRoster(); toast('一覧を更新しました'); };

function refreshCandidate() {
  const box = $('candidateState');
  if (!S.selected) { box.innerHTML = '<span class="small">受講生を選んでください。</span>'; $('createJob').disabled = true; return; }
  const hits = S.csv.findCandidates(S.selected.mid, S.selected.name, S.mapping);
  if (hits.length === 1) {
    box.innerHTML = `<span class="badge ok">1件に特定</span> <b>${esc(S.selected.mid)}</b> ${esc(S.selected.name)}`;
    $('createJob').disabled = false;
  } else {
    box.innerHTML = `<span class="badge ng">${hits.length}件</span> MIDと氏名で1件に絞れません。CSVを確認してください。`;
    $('createJob').disabled = true;
  }
}

$('createJob').onclick = async () => {
  const entry = S.selected;
  const existing = await store.loadJob(entry.mid);
  if (existing && !confirm(`${entry.mid} ${entry.name} の作業データがすでにあります。続きから開きますか？\n（「キャンセル」で作り直します）`)) {
    for (const { role } of PHOTO_ROLES) await store.deleteFile(`${entry.mid}/${role}`);
    await store.deleteJob(entry.mid);
  }
  S.job = (await store.loadJob(entry.mid)) || {
    mid: entry.mid, name: entry.name, nickname: entry.nickname, row_index: entry.row_index,
    created_at: nowText(), operator_values: {}, field_corrections: {}, text_corrections: [],
    corrections: [], photos: {}, hair_length_key: '', maintenance_kcal: '', direction_hint: '',
    program_track: 'weight', program_track_set: false, overrides: {}, measured: null,
    round: 1, deliveries: [], progress: {}, visual: {}, approval: {}, generation: {},
    template_id: 'karte_v2', min_scale: 0.80,
  };
  S.job.row_index = entry.row_index;
  S.downloaded = false;
  await saveJob();
  await audit('job_created', { mid: entry.mid, name: entry.name });
  await afterJob();
  toast(`${entry.mid} ${entry.name} の作成を開始しました`);
};

$('discardJob').onclick = async () => {
  if (!S.job) return;
  if (!confirm(`${S.job.mid} ${S.job.name} の作業を閉じます（データは残ります）。`)) return;
  S.job = null; S.selected = null; S.downloaded = false;
  await afterJob();
  goStep('home');
};

async function saveJob() {
  await store.saveJob(S.job);
  schedulePush(S.job);
  scheduleBackup();
}

/**
 * 書き出し先フォルダを決めてある場合、変更のあとに自動で書き出す。
 * 担当者が「書き出す」を押し忘れても、最新がフォルダに残るようにするため。
 */
let backupTimer = null;
function scheduleBackup() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => { runAutoBackup().catch(() => {}); }, 90000);
}

async function runAutoBackup() {
  const target = await exportDir();
  if (!target) return;
  // 許可を聞き直すと画面が出てしまうので、すでに許可されているときだけ書く
  if (await target.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') return;
  const { zip, filename, members, photos } = await buildBackup();
  const file = await target.handle.getFileHandle(filename, { create: true });
  const writer = await file.createWritable();
  await writer.write(zip);
  await writer.close();
  await store.saveSetting('last_backup', { at: nowText(), where: target.name, members, photos });
  await renderAutoBackup();
}

async function renderAutoBackup() {
  const target = await exportDir();
  const last = await store.loadSetting('last_backup');
  if (!target) {
    $('autoBackupState').textContent = '書き出し先フォルダを決めておくと、変更のたびに自動で書き出します。';
    return;
  }
  $('autoBackupState').innerHTML = last
    ? `自動バックアップは有効です。最終書き出し：<b>${esc(last.at)}</b>（${esc(last.where)} フォルダ）`
    : '自動バックアップは有効です。変更してから少しすると、自動で書き出されます。';
}

async function afterJob() {
  // 前に開いていた人のカルテが残っていると、その人の内容が出てしまう
  const key = S.job ? `${S.job.mid}#${S.job.round || 1}#${S.job.regenerate_count || 0}` : '';
  if (S.printedFor !== key) { S.printedHtml = ''; S.printedFor = ''; }
  $('targetBox').innerHTML = S.job
    ? `対象者：<b>${esc(S.job.mid)} ${esc(S.job.name)}</b><br><span class="small">${esc(S.job.current_month || '初回')}／第${S.job.round || 1}ヶ月目</span>`
    : '対象者：未選択';
  const on = Boolean(S.job);
  $('mappingCard').style.display = S.csv ? '' : 'none';
  $('operatorCard').style.display = on ? '' : 'none';
  $('manifestCard').style.display = on ? '' : 'none';
  if (on) {
    $('programTrack').value = effectiveTrack();
    $('hairLength').value = S.job.hair_length_key || '';
    $('maintenanceKcal').value = S.job.maintenance_kcal || '';
    renderOperatorFields();
    renderManifest();
    renderRoles();
    renderDecisions();
    // 生成済みなのに組み上げたHTMLが無い＝開き直した直後。白紙にならないよう作り直す
    if ((S.job.generation || {}).built_at && !S.printedHtml && S.job.decisions) {
      try {
        await rebuildPrintable(S.job);
        renderQA();
      } catch (error) {
        toast(`前回のカルテを表示できませんでした：${error.message}`, true);
      }
    }
  }
  renderStepBar();
}

/* 列マッピング */
function renderMapping() {
  if (!S.csv) return;
  const rows = ['<tr><th style="width:220px">カルテの項目</th><th>CSVの列</th><th style="width:120px"></th></tr>'];
  FIELDS.forEach((field) => {
    const options = ['<option value="">（使わない）</option>'].concat(S.csv.header.map((head, i) =>
      `<option value="${i}" ${S.mapping[field.key] === i ? 'selected' : ''}>${i + 1}. ${esc(head.slice(0, 46))}</option>`));
    rows.push(`<tr><td>${esc(field.label)}</td>
      <td><select data-map="${esc(field.key)}" style="min-width:320px">${options.join('')}</select></td>
      <td class="small">${field.input_mode === 'operator' ? '画面入力で補える' : ''}</td></tr>`);
  });
  $('mappingTable').innerHTML = rows.join('');
}
$('saveMapping').onclick = async () => {
  document.querySelectorAll('[data-map]').forEach((select) => {
    S.mapping[select.dataset.map] = select.value === '' ? null : Number(select.value);
  });
  const saved = await store.loadSetting('source');
  await store.saveSetting('source', { ...saved, mapping: S.mapping });
  await audit('mapping_saved', {});
  if (S.job) { renderOperatorFields(); renderManifest(); }
  toast('マッピングを保存しました');
};

/* 不足分の入力 */
function buildJobManifest(job = S.job) {
  return buildManifest(S.csv, job.row_index, S.mapping, {
    operatorValues: job.operator_values, corrections: job.field_corrections,
    joinMonths: S.joinMonths, sourceName: S.csvName, sourceSha256: S.csvSha,
    menuCsv: 'トレーニングプログラム.md', now: nowText(),
  });
}

function renderOperatorFields() {
  const manifest = buildJobManifest();
  const missing = FIELDS.filter((field) => {
    const info = manifest.fields[field.key];
    return field.input_mode === 'operator' && (!info.mapped || info.origin !== 'csv');
  });
  if (!missing.length) {
    $('operatorFields').innerHTML = '<span class="small">カウンセリングの回答ですべて埋まっています。</span>';
    return;
  }
  $('operatorFields').innerHTML = missing.map((field) => {
    const value = esc(S.job.operator_values[field.key] || '');
    const input = field.multiline
      ? `<textarea data-op="${esc(field.key)}">${value}</textarea>`
      : `<input type="text" class="wide" data-op="${esc(field.key)}" value="${value}">`;
    return `<label class="row"><span class="lbl">${esc(field.label)}</span>${input}</label>`;
  }).join('');
}
$('saveOperator').onclick = async () => {
  document.querySelectorAll('[data-op]').forEach((node) => {
    S.job.operator_values[node.dataset.op] = node.value.trim();
  });
  await saveJob();
  await audit('operator_values_saved', {});
  renderManifest();
  renderStepBar();
  toast('保存しました');
};

/* 読み込んだ内容の確認 */
function renderManifest() {
  const manifest = buildJobManifest();
  const groups = {};
  FIELDS.forEach((field) => { (groups[field.section] ??= []).push(field); });
  let html = '';
  Object.keys(groups).forEach((section) => {
    html += `<h3>${esc(SECTION_LABEL[section] || section)}</h3><table class="grid">
      <tr><th style="width:170px">項目</th><th>原本（回答そのまま）</th><th style="width:180px">カルテへの表示値</th><th style="width:150px">出所</th></tr>`;
    groups[section].forEach((field) => {
      const info = manifest.fields[field.key] || {};
      const blank = info.blank_in_source;
      const origin = info.origin === 'operator' ? '<span class="badge warn">担当者入力</span>'
        : info.origin === 'correction' ? '<span class="badge warn">修正</span>'
        : (info.source_column ? esc(String(info.source_column).slice(0, 26)) : '<span class="small">—</span>');
      html += `<tr><td>${esc(field.label)}</td>
        <td class="${blank ? 'blank' : ''}">${blank ? '（空欄）' : esc(info.raw)}</td>
        <td>${esc(info.display)}</td><td class="small">${origin}</td></tr>`;
    });
    html += '</table>';
  });
  const src = manifest.source;
  html += `<h3>原本の特定</h3><table class="grid">
    <tr><th style="width:170px">カウンセリングデータ</th><td>${esc(src.counseling_csv)}</td></tr>
    <tr><th>SHA-256</th><td class="small">${esc(src.counseling_csv_sha256)}</td></tr>
    <tr><th>行特定キー</th><td>${esc(src.row_identity)}（行 ${src.row_index}）</td></tr>
    <tr><th>筋トレメニュー</th><td>${esc(src.menu_csv)}</td></tr></table>`;
  $('manifestBody').innerHTML = html;
}

/* ---------- 2. 写真 ---------- */
function renderRoles() {
  const tabs = $('roleTabs');
  tabs.innerHTML = '';
  OPERATOR_PHOTO_ROLES.forEach((role) => {
    const done = S.job && S.job.photos[role.role];
    const button = document.createElement('button');
    button.innerHTML = `${esc(role.label)}<span class="st">${done && done.cropped ? '✅' : '未'}</span>`;
    button.className = S.role === role.role ? 'active' : '';
    button.onclick = () => { S.role = role.role; renderRoles(); renderPreview(); };
    tabs.appendChild(button);
  });
  const state = ['<table class="grid"><tr><th>用途</th><th>元ファイル</th><th>比率</th><th>状態</th></tr>'];
  PHOTO_ROLES.forEach((role) => {
    const info = (S.job && S.job.photos[role.role]) || {};
    state.push(`<tr><td>${esc(role.label)}</td><td>${esc(info.source_name || '—')}</td>
      <td class="small">${esc(role.ratio)}</td>
      <td>${info.cropped ? '<span class="badge ok">確定</span>' : '<span class="badge ng">未</span>'}</td></tr>`);
  });
  $('photoState').innerHTML = state.join('') + '</table>';
  renderStepBar();
}

$('photoInput').onchange = async (event) => {
  const files = [...event.target.files];
  if (!files.length) return;
  S.images = [];
  const box = $('thumbs');
  box.innerHTML = '';
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const image = { name: file.name, file, url };
    S.images.push(image);
    const card = document.createElement('div');
    card.className = 'thumb';
    card.innerHTML = `<img src="${url}"><div class="nm">${esc(file.name)}</div>`;
    card.onclick = () => {
      S.photo = image;
      document.querySelectorAll('.thumb').forEach((t) => t.classList.remove('sel'));
      card.classList.add('sel');
      renderPreview();
    };
    box.appendChild(card);
  }
  setPicked('photoInput', `${files.length}枚を読み込みました`, true);
  toast(`${files.length}枚を読み込みました`);
};

const cropValues = () => ({
  rotate: Number($('cropRotate').value), zoom: Number($('cropZoom').value),
  offsetX: Number($('cropX').value), offsetY: Number($('cropY').value),
});

async function renderPreview() {
  const ok = S.role && S.photo && S.job;
  $('assignPhoto').disabled = !ok;
  if (!ok) { $('cropPreview').textContent = '用途タブと写真を選択してください'; return; }
  const role = PHOTO_ROLES.find((r) => r.role === S.role);
  try {
    const bitmap = S.photo.bitmap || (S.photo.bitmap = await photosLib.loadImage(S.photo.file));
    const result = await photosLib.cropForRole(bitmap, role.ratio, { ...cropValues(), outWidth: 420 });
    if (S.previewUrl) URL.revokeObjectURL(S.previewUrl);
    S.previewUrl = URL.createObjectURL(result.blob);
    $('cropPreview').innerHTML = `<img src="${S.previewUrl}">`;
  } catch (error) {
    $('cropPreview').textContent = error.message;
  }
}
['cropRotate', 'cropZoom', 'cropX', 'cropY'].forEach((id) => {
  $(id).oninput = () => { $('zoomVal').textContent = Number($('cropZoom').value).toFixed(2); renderPreview(); };
});

$('assignPhoto').onclick = async () => {
  const role = PHOTO_ROLES.find((r) => r.role === S.role);
  const bitmap = S.photo.bitmap || (S.photo.bitmap = await photosLib.loadImage(S.photo.file));
  const result = await photosLib.cropForRole(bitmap, role.ratio, cropValues());
  await store.saveFile(`${S.job.mid}/${role.role}`, result.blob);
  S.job.photos[role.role] = {
    cropped: `${role.role}.jpg`, source_name: S.photo.name, ratio: role.ratio,
    rotate: result.rotate, zoom: result.zoom, offset_x: result.offset_x, offset_y: result.offset_y,
    // 担当者の確認待ちは作らない（現行ツールと同じく自動で確定にする）
    identity_confirmed: true, usage_confirmed: true, crop_confirmed: true, at: nowText(),
  };
  if (role.role === 'face') {
    // 顔とヘアは同じ写真を使う。顔型の記入が無いときの推定にも使う
    S.job.measured = await photosLib.measureFace(bitmap);
    const hairRole = PHOTO_ROLES.find((r) => r.role === 'hair');
    const derived = await photosLib.cropForRole(bitmap, hairRole.ratio, cropValues());
    await store.saveFile(`${S.job.mid}/hair`, derived.blob);
    S.job.photos.hair = { ...S.job.photos.face, cropped: 'hair.jpg', ratio: hairRole.ratio, derived_from: 'face' };
  }
  await saveJob();
  await audit('photo_assigned', { role: role.role, source: S.photo.name });
  renderRoles();
  renderPreview();
  toast('写真を確定しました');
};

/* ---------- 3. ルール ---------- */
/** 自宅・週2回の人は自重メニューにする（担当者が選び直した場合はそれを優先）。 */
function effectiveTrack() {
  if (S.job.program_track_set) return S.job.program_track;
  const manifest = buildJobManifest();
  const place = manifest.training.current_location || '';
  const decided = rules.decideTraining(
    (manifest.fields.current_status || {}).raw || '', (manifest.fields.current_frequency || {}).raw || '');
  return /自宅|家|宅トレ|自重|在宅/.test(place) && Number((decided.value || {}).frequency) === 2
    ? 'bodyweight' : 'weight';
}

$('applyRules').onclick = async () => {
  S.job.hair_length_key = $('hairLength').value;
  S.job.maintenance_kcal = $('maintenanceKcal').value.trim();
  if ($('programTrack').value !== effectiveTrack()) {
    S.job.program_track = $('programTrack').value;
    S.job.program_track_set = true;
  }
  const manifest = buildJobManifest();
  S.job.decisions = rules.decideAll(manifest, {
    hairstyleConfig: S.data.hairstyles,
    hairLengthKey: S.job.hair_length_key,
    maintenanceKcal: S.job.maintenance_kcal,
    overrides: S.job.overrides,
    directionHint: S.job.direction_hint,
    measured: S.job.measured,
    phaseOverride: S.job.phase_override || '',
    now: nowText(),
  });
  await saveJob();
  await audit('decided', Object.fromEntries(Object.entries(S.job.decisions)
    .filter(([, v]) => v && v.rule_id).map(([k, v]) => [k, v.rule_id])));
  renderDecisions();
  toast('判定しました');
};

const DECISION_LABEL = {
  training: 'トレーニングPhase・週回数', goals: '体重・体脂肪率の目標',
  nutrition: 'カロリー・PFC', eyebrow: '眉ケア', hairstyle: '目標ヘアスタイル', hair: 'ヘア日数',
};

function renderDecisions() {
  const decisions = (S.job && S.job.decisions) || {};
  let html = '';
  Object.keys(DECISION_LABEL).forEach((key) => {
    const decision = decisions[key];
    if (!decision) return;
    const value = decision.value
      ? JSON.stringify(decision.value, null, 0).replace(/[{}"]/g, '').replace(/,/g, '　') : '未確定';
    html += `<div class="decision ${decision.resolved ? 'locked' : 'unres'}">
      <div><b>${esc(DECISION_LABEL[key])}</b> <span class="badge ${decision.source === 'override' ? 'warn' : 'info'}">${esc(decision.rule_id)}</span>
      ${decision.resolved ? '' : '<span class="badge ng">未確定</span>'}</div>
      <div class="v">${esc(value)}</div>
      <div class="ev">${esc(decision.evidence)}</div>
      <button class="act ghost mini" data-ovr="${key}" style="margin-top:6px">ルールと異なる値にする</button>
      <div class="override" id="ovr-${key}">
        <label class="row"><span class="lbl">確定値（JSON）</span><input type="text" class="wide" id="ovrval-${key}" value='${esc(JSON.stringify(decision.value))}'></label>
        <label class="row"><span class="lbl">理由（必須）</span><input type="text" class="wide" id="ovrreason-${key}"></label>
        <label class="row"><span class="lbl">承認者（必須）</span><input type="text" id="ovrapprover-${key}" value="${esc(S.operator)}"></label>
        <button class="act mini" data-ovrsave="${key}">承認付きで確定する</button>
      </div></div>`;
  });
  $('decisionList').innerHTML = html || '<span class="small">判定するとここに表示されます。</span>';
  renderStepBar();
  document.querySelectorAll('[data-ovr]').forEach((button) => {
    button.onclick = () => $('ovr-' + button.dataset.ovr).classList.toggle('open');
  });
  document.querySelectorAll('[data-ovrsave]').forEach((button) => {
    button.onclick = async () => {
      const key = button.dataset.ovrsave;
      let value;
      try { value = JSON.parse($('ovrval-' + key).value); } catch { return toast('確定値がJSONとして不正です', true); }
      const reason = $('ovrreason-' + key).value.trim(), approver = $('ovrapprover-' + key).value.trim();
      if (!reason || !approver) return toast('理由と承認者は必須です', true);
      S.job.overrides[key] = { value, reason, approver, at: nowText() };
      await saveJob();
      $('applyRules').click();
      await audit('rule_overridden', { key, reason, approver });
      toast('承認付きで確定しました（監査ログに記録）');
    };
  });
}

/* ---------- 4. 生成 ---------- */
function issueList(issues) {
  if (!issues || !issues.length) return '<span class="badge ok">問題なし</span>';
  return '<ul class="issues">' + issues.map((i) => {
    const fix = i.fix ? `<div class="fix">→ ${esc(i.fix)}</div>` : '';
    return `<li class="${i.level}">[${i.level}] ${esc(i.message)}${fix}</li>`;
  }).join('') + '</ul>';
}

/* 不合格のときに、その場で押せる対処ボタンを出す */
function fixActionsHtml(job) {
  const errors = checkErrors(job);
  if (!errors.length) return '';
  const overflow = errors.some((i) => i.code === 'LAYOUT_OVERFLOW');
  const list = errors.map((i) => `<li>${esc(i.message)}${i.fix ? `<div class="fix">→ ${esc(i.fix)}</div>` : ''}</li>`).join('');
  return `<div class="fixbox">
    <b class="ng">検査で${errors.length}件の問題が見つかりました</b>
    <ul class="issues">${list}</ul>
    <div class="fixactions">
      <button class="act mini" id="fixRegen">同じ内容で作り直す</button>
      ${overflow ? '<button class="act mini" id="fixShrink">本文をさらに縮めて作り直す</button>' : ''}
      <button class="act mini ghost" id="fixBackInput">入力に戻って直す</button>
    </div></div>`;
}

function checkErrors(job) {
  const checks = ((job || {}).generation || {}).checks || {};
  const out = [];
  Object.values(checks).forEach((entry) => {
    if (!entry || String(entry.result || '').startsWith('合格')) return;
    (entry.issues || []).filter((i) => i.level === 'ERROR').forEach((i) => out.push(i));
  });
  return out;
}

function preGenerationCheck() {
  const manifest = buildJobManifest();
  const decisions = S.job.decisions || {};
  const candidates = S.csv.findCandidates(S.job.mid, S.job.name, S.mapping).length;
  const issues = validate.preGeneration(manifest, decisions, S.job.photos, candidates);
  return validate.summarize(issues);
}

$('runPrecheck').onclick = async () => {
  if (!S.job) { toast('先に受講生を選んでください', true); return; }
  const check = preGenerationCheck();
  (S.job.generation ??= {}).checks = { ...(S.job.generation.checks || {}),
    pre: { result: check.passed ? '合格' : '不合格', issues: check.issues, at: nowText() } };
  await saveJob();
  $('precheckResult').innerHTML = (check.passed ? '<span class="badge ok">合格</span>' : '<span class="badge ng">不合格</span>')
    + issueList(check.issues);
  $('runGenerate').disabled = !check.passed;
  renderStepBar();
};

/** カルテ5枚を組み上げ、検査までを行う。 */
async function generate(minScale) {
  const job = S.job;
  // 納品済みでも、対象月・回数・過去の納品履歴を保ったまま修正できる。
  const round = Number(job.round || 1);
  if (minScale) job.min_scale = minScale;

  // 作り直すたびに最新のナレッジ・判定ルールで判定し直す
  const manifest = buildJobManifest();
  job.decisions = rules.decideAll(manifest, {
    hairstyleConfig: S.data.hairstyles, hairLengthKey: job.hair_length_key,
    maintenanceKcal: job.maintenance_kcal, overrides: job.overrides,
    directionHint: job.direction_hint, measured: job.measured,
    phaseOverride: job.phase_override || '', now: nowText(),
  });
  const pre = preGenerationCheck();
  if (!pre.passed) throw new Error('生成前バリデーションに不合格です。' + pre.errors.slice(0, 5).map((i) => i.message).join(' / '));

  const photoUrls = {};
  for (const { role } of PHOTO_ROLES) {
    const blob = await store.loadFile(`${job.mid}/${role}`);
    if (blob) photoUrls[role] = URL.createObjectURL(blob);
  }
  const context = buildContext({
    manifest, decisions: job.decisions, menuBlocks: S.data.menuBlocks,
    track: effectiveTrack(), progress: job.progress || {}, photos: photoUrls,
    hairstyleConfig: S.data.hairstyles, productMaster: S.data.products, assets: S.data.assets,
  });
  context.acne_notice = rules.ACNE_NOTICE;
  context.morning_routine = rules.MORNING_ROUTINE;

  const sheets = await buildSheets(context, job.text_corrections);
  S.sheets = sheets;
  S.context = context;
  S.manifest = manifest;

  // 版面に合わせて本文を伸縮させ、はみ出しを測る
  const metrics = await measureSheets(sheets, job.min_scale || 0.80);

  const checks = (job.generation ??= {}).checks ??= {};
  checks.pre = { result: pre.passed ? '合格' : '不合格', issues: pre.issues, at: nowText() };
  const htmlIssues = validate.inspectHtml(sheets, manifest, context, S.data.forbidden, S.data.products);
  checks.html = { result: htmlIssues.some((i) => i.level === 'ERROR') ? '不合格' : '合格', issues: htmlIssues, at: nowText() };
  const layoutIssues = validate.checkOverflow(metrics);
  checks.layout = { result: layoutIssues.some((i) => i.level === 'ERROR') ? '不合格' : '合格', issues: layoutIssues, at: nowText() };
  const bodyIssues = validate.inspectSheets(sheets, manifest, job.decisions, context, S.data.forbidden, S.data.products);
  checks.body = { result: bodyIssues.some((i) => i.level === 'ERROR') ? '不合格' : '合格', issues: bodyIssues, at: nowText() };

  job.generation.built_at = nowText();
  job.generation.pdf_name = `${job.mid}_${job.name}.pdf`;
  job.generation.scales = metrics.map((m) => (m ? m.scale : null));
  job.generation.needs_redelivery = hasCurrentDelivery(job);
  job.regenerate_count = Number(job.regenerate_count || 0) + 1;
  job.visual = {};           // 目視確認と承認はやり直す
  job.approval = {};
  S.downloaded = false;
  await saveJob();
  await audit('generated', { round, scales: job.generation.scales, errors: checkErrors(job).length });
  return job;
}

/**
 * 生成済みのカルテを、保存してある判定のまま画面に出し直す。
 * ブラウザを閉じて開き直すと、組み上げたHTMLはメモリから消えるため、
 * これをやらないとプレビューが白紙になり、PDFも出せなくなる。
 * 判定はやり直さない（納品済みの内容が変わらないようにするため）。
 */
async function rebuildPrintable(job) {
  const manifest = buildJobManifest(job);
  const photoUrls = {};
  for (const { role } of PHOTO_ROLES) {
    const blob = await store.loadFile(`${job.mid}/${role}`);
    if (blob) photoUrls[role] = URL.createObjectURL(blob);
  }
  const context = buildContext({
    manifest, decisions: job.decisions, menuBlocks: S.data.menuBlocks,
    track: effectiveTrack(), progress: job.progress || {}, photos: photoUrls,
    hairstyleConfig: S.data.hairstyles, productMaster: S.data.products, assets: S.data.assets,
  });
  context.acne_notice = rules.ACNE_NOTICE;
  context.morning_routine = rules.MORNING_ROUTINE;
  const sheets = await buildSheets(context, job.text_corrections);
  S.sheets = sheets;
  S.context = context;
  S.manifest = manifest;
  await measureSheets(sheets, job.min_scale || 0.80);   // S.printedHtml を作り直す
}

/** 画面外の枠で1枚ずつ組み、A4に収まるかを測る。 */
function measureSheets(sheets, minScale) {
  return new Promise((resolve) => {
    const frame = $('printFrame');
    frame.onload = () => {
      const inner = frame.contentDocument;
      const out = [...inner.querySelectorAll('.sheet')].map((section) => {
        section.style.width = `${PAGE_WIDTH}px`;
        section.style.height = `${PAGE_HEIGHT}px`;
        return fitPage(section, minScale);
      });
      // 伸縮を反映したHTMLを、目視確認と印刷にそのまま使う
      S.printedHtml = '<!doctype html>' + inner.documentElement.outerHTML;
      S.printedFor = S.job ? `${S.job.mid}#${S.job.round || 1}#${S.job.regenerate_count || 0}` : '';
      resolve(out);
    };
    frame.srcdoc = printableDocument(sheets, S.data.cssCache);
  });
}

$('runGenerate').onclick = async () => {
  $('runGenerate').disabled = true;
  $('generateResult').innerHTML = 'カルテを組み上げています…';
  try {
    await generate();
    $('generateResult').innerHTML = `<div>${esc(S.job.generation.pdf_name)} の内容を組み上げました（作り直し ${S.job.regenerate_count} 回目）</div>`
      + fixActionsHtml(S.job) + issueList(Object.values(S.job.generation.checks).flatMap((c) => c.issues || []));
    bindFixActions();
    renderQA();
    toast('生成しました。検品・納品の画面で検査結果と5ページの目視確認を行ってください。');
  } catch (error) {
    $('generateResult').innerHTML = `<span class="badge ng">失敗</span> ${esc(error.message)}`;
  }
  $('runGenerate').disabled = false;
  renderStepBar();
};

async function regenerate(minScale) {
  toast('作り直しています…');
  try {
    await generate(minScale);
    renderQA();
    renderStepBar();
    const left = checkErrors(S.job).length;
    toast(left ? `まだ${left}件の問題が残っています` : '検査に合格しました');
  } catch (error) {
    toast(`失敗しました：${error.message}`, true);
  }
}

function bindFixActions() {
  if ($('fixRegen')) $('fixRegen').onclick = () => regenerate();
  if ($('fixShrink')) $('fixShrink').onclick = () => regenerate(0.70);
  if ($('fixBackInput')) $('fixBackInput').onclick = () => goStep('input');
}

/* ---------- 5. 検品・納品 ---------- */
function gateOf(job) {
  const reasons = [];
  const generation = job.generation || {};
  const checks = generation.checks || {};
  if (!generation.built_at) reasons.push('カルテが未生成です');
  CHECK_LABELS.forEach(([key, label]) => {
    const entry = checks[key];
    if (!entry) reasons.push(`${label}が未実施です`);
    else if (!String(entry.result || '').startsWith('合格')) reasons.push(`${label}が不合格です`);
  });
  for (let page = 1; page <= 5; page += 1) {
    const entry = (job.visual || {})[String(page)];
    if (!entry || !entry.confirmed) reasons.push(`${page}ページ目の目視確認が未完了です`);
  }
  // 担当者名が無いと最終承認できない。押しても無反応に見えるので、理由として先に出す
  if (!S.operator) reasons.push('あなたの名前が未設定です（監査ログの画面で保存してください）');
  if (!(job.approval || {}).by) reasons.push('最終承認が未実施です');
  return { deliverable: !reasons.length, reasons };
}

function renderQA() {
  const job = S.job;
  if (!job || !(job.generation || {}).built_at) {
    $('autoChecks').innerHTML = '<span class="small">未生成です。</span>';
    $('pageCards').innerHTML = '';
    renderGate();
    return;
  }
  const checks = job.generation.checks || {};
  let html = fixActionsHtml(job);
  html += '<table class="grid"><tr><th>検査</th><th>結果</th><th>内容</th></tr>';
  CHECK_LABELS.forEach(([key, label]) => {
    const entry = checks[key] || {};
    const pass = String(entry.result || '').startsWith('合格');
    html += `<tr><td>${label}</td><td>${entry.result ? `<span class="badge ${pass ? 'ok' : 'ng'}">${esc(entry.result)}</span>` : '未実施'}</td>
      <td>${issueList(entry.issues)}</td></tr>`;
  });
  const scales = (job.generation.scales || []).map((s, i) => `${i + 1}枚目 ${Math.round((s || 1) * 100)}%`).join(' / ');
  html += `</table><p class="small">出力名: ${esc(job.generation.pdf_name)} ／ 本文の倍率: ${esc(scales)}</p>`;
  $('autoChecks').innerHTML = html;
  bindFixActions();

  const cards = [];
  for (let page = 1; page <= 5; page += 1) {
    const entry = (job.visual || {})[String(page)] || {};
    const items = VISUAL_ITEMS.map((item) =>
      `<label><input type="checkbox" data-page="${page}" data-item="${esc(item)}" ${entry.items && entry.items[item] ? 'checked' : ''}> ${esc(item)}</label>`).join('');
    cards.push(`<div class="pagecard">
      <div><iframe data-sheet="${page}" title="${esc(SHEET_TITLES[page - 1])}"></iframe>
        <div class="small shot-caption" style="text-align:center; cursor:pointer">写真をクリックで拡大・縮小</div></div>
      <div><b>${page}ページ目</b>（${esc(SHEET_TITLES[page - 1])}）
      ${entry.confirmed ? `<span class="badge ok">確認済（${esc(entry.by)} ${esc(entry.at)}）</span>` : '<span class="badge ng">未確認</span>'}
      <div class="checkitems" style="margin:8px 0">${items}</div>
      <div class="small" data-count="${page}" style="margin-bottom:6px"></div>
      <button class="act mini" data-checkall="${page}">すべて確認した</button>
      <button class="act ghost mini" data-confirm="${page}">チェックした内容で記録する</button>
      <div class="small" data-why="${page}" style="color:var(--ng); margin-top:6px"></div></div></div>`);
  }
  $('pageCards').innerHTML = cards.join('');
  fillPageFrames();

  const boxesOf = (page) => [...document.querySelectorAll(`[data-page="${page}"]`)];
  const renderCount = (page) => {
    const boxes = boxesOf(page);
    const done = boxes.filter((b) => b.checked).length;
    const node = document.querySelector(`[data-count="${page}"]`);
    if (node) node.textContent = `${boxes.length}項目中 ${done}項目に印`;
  };
  const confirmPage = async (page, checkAll) => {
    const boxes = boxesOf(page);
    if (checkAll) boxes.forEach((box) => { box.checked = true; });
    const items = {};
    boxes.forEach((box) => { items[box.dataset.item] = box.checked; });
    const missing = VISUAL_ITEMS.filter((item) => !items[item]);
    (S.job.visual ??= {})[String(page)] = {
      confirmed: !missing.length, items, by: S.operator || '（未設定）', at: nowText(),
    };
    await saveJob();
    await audit('visual_checked', { page, confirmed: !missing.length });
    renderQA();
    if (missing.length) {
      // 理由は消えるトーストではなく、その場に残す
      const why = document.querySelector(`[data-why="${page}"]`);
      if (why) {
        why.textContent = `印が付いていない項目があります：${missing.join('、')}。`
          + 'すべて見て問題なければ「すべて確認した」を押してください。';
      }
    }
  };

  for (let page = 1; page <= 5; page += 1) renderCount(page);
  document.querySelectorAll('[data-page]').forEach((box) => {
    box.onchange = () => renderCount(box.dataset.page);
  });
  document.querySelectorAll('[data-confirm]').forEach((button) => {
    button.onclick = () => confirmPage(Number(button.dataset.confirm), false);
  });
  document.querySelectorAll('[data-checkall]').forEach((button) => {
    button.onclick = () => confirmPage(Number(button.dataset.checkall), true);
  });
  renderFixPanel();
  renderGate();
  renderStepBar();
}

/** 目視確認の各ページに、印刷されるものと同じ中身を表示する。 */
function fillPageFrames() {
  if (!S.printedHtml) return;
  document.querySelectorAll('iframe[data-sheet]').forEach((frame) => {
    const page = Number(frame.dataset.sheet);
    frame.onload = () => {
      const doc = frame.contentDocument;
      [...doc.querySelectorAll('.sheet')].forEach((section, i) => {
        if (i !== page - 1) section.remove();
      });
      doc.body.style.margin = '0';
      doc.body.style.background = '#fff';
      const only = doc.querySelector('.sheet');
      if (only) {
        only.style.margin = '0';
        only.style.transformOrigin = 'top left';
        only.style.boxShadow = 'none';
      }
      const fit = () => {
        if (!only) return;
        const scale = frame.clientWidth / PAGE_WIDTH;
        only.style.transform = `scale(${scale})`;
        frame.style.height = `${PAGE_HEIGHT * scale + 4}px`;
        doc.body.style.cursor = frame.closest('.pagecard').classList.contains('zoom') ? 'zoom-out' : 'zoom-in';
      };
      fit();

      // 拡大・縮小は「写真をクリックしたとき」だけ。
      // カード全体に付けると、右側のチェック欄を押しただけで拡大してしまう。
      const toggle = () => {
        frame.closest('.pagecard').classList.toggle('zoom');
        setTimeout(fit, 30);
      };
      doc.body.style.cursor = 'zoom-in';
      doc.addEventListener('click', toggle);
      const caption = frame.parentElement.querySelector('.shot-caption');
      if (caption) caption.onclick = toggle;
    };
    frame.srcdoc = S.printedHtml;
  });
}

/* 検品で見つかった不備を、項目単位で直して作り直す */
function renderFixPanel() {
  const job = S.job;
  const select = $('fixField');
  if (!job) { select.innerHTML = ''; $('fixList').innerHTML = ''; return; }
  const manifest = buildJobManifest();
  const targets = FIELDS.filter((f) => f.key !== 'mid');
  if (select.dataset.filled !== String(targets.length)) {
    select.innerHTML = targets.map((f) => `<option value="${esc(f.key)}">${esc(f.label)}</option>`).join('');
    select.dataset.filled = String(targets.length);
  }
  const showCurrent = () => {
    const info = manifest.fields[select.value] || {};
    $('fixCurrent').textContent = info.raw || '（未記入）';
    $('fixValue').value = (job.field_corrections || {})[select.value] || '';
  };
  select.onchange = showCurrent;
  showCurrent();
  const rows = Object.entries(job.field_corrections || {}).map(([key, value]) =>
    `<li>${esc((BY_KEY[key] || {}).label || key)}：${esc(value)} <button class="act ghost mini" data-undo="${esc(key)}">元に戻す</button></li>`)
    .concat((job.text_corrections || []).map((rule) =>
      `<li>文言「${esc(rule.find)}」→「${esc(rule.replace)}」 <button class="act ghost mini" data-undotext="${esc(rule.find)}">元に戻す</button></li>`));
  $('fixList').innerHTML = rows.length ? '<b>修正中の内容</b><ul class="issues">' + rows.join('') + '</ul>' : '';
  $('fixList').querySelectorAll('[data-undo]').forEach((button) => {
    button.onclick = () => applyFix(button.dataset.undo, '', '修正を取り消し', 'field', '');
  });
  $('fixList').querySelectorAll('[data-undotext]').forEach((button) => {
    button.onclick = () => applyFix('', '', '修正を取り消し', 'text', button.dataset.undotext);
  });
}

async function applyFix(field, value, note, mode, find) {
  toast('修正して作り直しています…');
  try {
    const job = S.job;
    if (mode === 'text') {
      // 同じ文言への指示は1つだけ持つ。値を空にすると指示を取り消して元に戻す。
      job.text_corrections = (job.text_corrections || []).filter((r) => r.find !== find);
      if (find && String(value || '').trim()) job.text_corrections.push({ find, replace: String(value).trim() });
    } else if (field) {
      if (String(value || '').trim()) job.field_corrections[field] = String(value).trim();
      else delete job.field_corrections[field];
    }
    job.corrections = [...(job.corrections || []),
      { at: nowText(), by: S.operator || '（未設定）', mode, field, find, value, note }];
    await saveJob();
    await audit('correction_applied', { mode, field, find, value, note });
    await generate();
    renderManifest();
    renderQA();
    renderStepBar();
    const left = checkErrors(S.job).length;
    toast(left ? `作り直しました（検査の問題は残り${left}件）` : '修正して作り直しました。検査は合格です');
  } catch (error) {
    toast(`失敗しました：${error.message}`, true);
  }
}

$('applyFix').onclick = () => {
  const mode = $('fixMode').value;
  if (mode === 'text') {
    if (!$('fixFind').value.trim()) { toast('置き換えたい文言を入れてください', true); return; }
    applyFix('', $('fixValue').value, $('fixNote').value, 'text', $('fixFind').value.trim());
  } else {
    applyFix($('fixField').value, $('fixValue').value, $('fixNote').value, 'field', '');
  }
};
$('fixMode').onchange = () => {
  const text = $('fixMode').value === 'text';
  $('fixFieldBox').style.display = text ? 'none' : '';
  $('fixTextBox').style.display = text ? '' : 'none';
};
$('rerunChecks').onclick = async () => {
  if (!S.job || !(S.job.generation || {}).built_at) { toast('先に生成してください', true); return; }
  await regenerate();
  toast('検査をやり直しました');
};
$('addCorrection').onclick = async () => {
  if (!S.job) return;
  S.job.corrections = [...(S.job.corrections || []),
    { at: nowText(), by: S.operator || '（未設定）', mode: 'note', note: $('correctionNote').value }];
  await saveJob();
  await audit('correction_note', { note: $('correctionNote').value });
  $('correctionNote').value = '';
  toast('修正履歴に追加しました');
};

function renderGate() {
  const gate = S.job ? gateOf(S.job) : { deliverable: false, reasons: ['対象者が未選択です'] };
  const box = $('gateBox');
  box.className = 'gate' + (gate.deliverable ? ' ok' : '');
  box.innerHTML = gate.deliverable
    ? '<b>納品可能です。</b> 自動検査・目視確認・最終承認がすべて完了しています。'
    : '<b>納品できません。</b><ul class="issues">' + gate.reasons.map((r) => `<li class="ERROR">${esc(r)}</li>`).join('') + '</ul>';
  $('downloadBtn').disabled = !gate.deliverable;
  $('nextMemberBtn').style.display = gate.deliverable ? '' : 'none';
  $('deliveredHint').style.display = gate.deliverable ? '' : 'none';
}

$('approveBtn').onclick = async () => {
  if (!S.job) return;
  if (!S.operator) {
    toast('先に「あなたの名前」を保存してください', true);
    goStep('audit');
    $('operatorName').focus();
    $('operatorName').classList.add('flash');
    setTimeout(() => $('operatorName').classList.remove('flash'), 4000);
    return;
  }
  const blockers = gateOf(S.job).reasons.filter((r) => r !== '最終承認が未実施です');
  if (blockers.length) { toast(blockers[0], true); return; }
  S.job.approval = { by: S.operator, at: nowText() };
  await saveJob();
  await audit('approved', { by: S.operator });
  renderQA();
  toast('最終承認しました');
};

$('downloadBtn').onclick = async () => {
  if (!S.printedHtml) { toast('先に生成してください', true); return; }
  S.job.deliveries = [...(S.job.deliveries || []), { round: Number(S.job.round || 1), at: nowText(), by: S.operator }];
  S.job.generation.needs_redelivery = false;
  await saveJob();
  await audit('delivered', { round: S.job.round, name: S.job.generation.pdf_name });
  S.downloaded = true;
  $('printFrame').contentWindow.focus();
  $('printFrame').contentWindow.print();
  renderStepBar();
  toast(`送信先で「PDFに保存」を選び、${S.job.generation.pdf_name} の名前で保存してください`);
};

async function startNextMember() {
  const current = S.job ? `${S.job.mid} ${S.job.name}` : '';
  if (!confirm(`${current} の納品を終えて、次のカルテを作成しますか？\n（このカルテのデータと監査ログは残ります）`)) return;
  S.job = null; S.selected = null; S.downloaded = false; S.printedHtml = null;
  await afterJob();
  $('rosterSearch').value = '';
  renderRoster();
  refreshCandidate();
  goStep('home');
  toast(current ? `${current} を完了しました。次のカルテを作成してください。` : '次のカルテを作成してください。');
}
$('nextMemberBtn').onclick = () => startNextMember();

/* ---------- 監査ログ ---------- */
async function loadAudit() {
  const log = (await store.loadSetting('audit')) || [];
  $('auditLog').textContent = log.slice(-300).reverse()
    .map((e) => `${e.at}  ${e.by}  ${e.mid || '—'}  ${e.event}\n    ${JSON.stringify(e.detail)}`).join('\n')
    || '（まだ記録はありません）';
}
$('loadAudit').onclick = () => loadAudit();
$('saveOperatorName').onclick = async () => {
  S.operator = $('operatorName').value.trim();
  await store.saveSetting('operator', S.operator);
  $('visualBy').textContent = S.operator || '（未設定）';
  $('approveBy').textContent = S.operator || '（未設定）';
  toast('保存しました');
};

/* ---------- 起動 ---------- */
// データが失われる危険が本当にあるときだけ警告する。
// ブラウザの保存保証（Chromeはよく使うサイトにだけ自動で与える）か、
// 書き出し先フォルダによる自動バックアップか、どちらかがあれば安全とみなす。
async function checkStorage(announce) {
  const kept = await store.keepData();
  const target = await exportDir();
  const safe = kept.persisted || Boolean(target);

  $('storageWarn').style.display = safe ? 'none' : '';
  if (announce && safe) {
    $('storageOkText').textContent = kept.persisted
      ? 'このブラウザはデータを勝手に消しません。'
      : '自動バックアップが有効になりました。変更のたびに書き出されます。';
    $('storageOk').style.display = '';
  } else if (!announce) {
    $('storageOk').style.display = 'none';
  }

  $('storageState').innerHTML = kept.persisted
    ? 'このブラウザはデータの保存を保証しています（消されません）。'
    : 'このブラウザはデータの保存を保証していません。'
      + '<b>アプリとしてインストール</b>すると保証されます（Chromeのメニュー →「アプリとしてインストール」）。'
      + 'そのままでも、上の書き出し先を決めておけば自動バックアップで元に戻せます。';
  return safe;
}
$('storageWarnGo').onclick = () => {
  goStep('input');
  $('pickExportDir').scrollIntoView({ block: 'center' });
};
$('storageWarnClose').onclick = () => { $('storageWarn').style.display = 'none'; };

/** 写真の自動取り込みが未設定なら、画面の上に出して気づけるようにする。 */
let formPhotoWarnHidden = false;
function renderFormPhotoWarn() {
  const ready = drive.status().signedIn && (S.formFolders || []).length > 0;
  $('formPhotoWarn').style.display = (ready || formPhotoWarnHidden) ? 'none' : '';
}
$('formPhotoWarnGo').onclick = () => {
  goStep('input');
  $('driveCard').open = true;
  // どこを押せばいいか分かるように、次に押すボタンまで送って光らせる
  const next = drive.status().signedIn ? $('pickFormFolder') : $('driveConnect');
  next.scrollIntoView({ block: 'center' });
  next.classList.add('flash');
  setTimeout(() => next.classList.remove('flash'), 4000);
};
$('formPhotoWarnClose').onclick = () => { formPhotoWarnHidden = true; renderFormPhotoWarn(); };
$('storageOkClose').onclick = () => { $('storageOk').style.display = 'none'; };
await checkStorage(false);

await loadData();
S.data.cssCache = (await loadTemplates()).css;
await restoreSettings();
renderRoster();
renderMapping();
refreshCandidate();
await afterJob();
goStep('home');

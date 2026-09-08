// 月次フォームの提出状況（現行ツール app/submissions.py と同じ判定）。
//
// 毎月、受講生に「体重・体脂肪率・写真5枚」をフォームで出してもらう。
// その回答シート（CSV）を読み、受講生ごとに「今月ぶんを出したか」を判定する。
// 提出があるまで月次更新を始められないようにするため、
// 画面の一覧はここが返す状態を見て「フォーム記入済み／未提出」を出す。

import { parseCsv } from './csv.js?v=20260908145508';
import { normalize, stripReading } from './text.js?v=20260908145508';

const MID_HEADERS = ['受講生id', '受講生ID', 'mid', '会員id'];
const NAME_HEADERS = ['氏名', 'お名前', '名前'];
const DATE_HEADERS = ['タイムスタンプ', '回答日時', '送信日時'];
const WEIGHT_HEADERS = ['体重'];
const BODYFAT_HEADERS = ['体脂肪率', '体脂肪'];
const PHOTO_HINTS = ['写真', '画像', 'アップロード'];

function column(header, names) {
  const heads = header.map(normalize);
  for (const name of names) {
    const target = normalize(name);
    const at = heads.indexOf(target);
    if (at >= 0) return at;
  }
  for (const name of names) {
    const target = normalize(name);
    if (!target) continue;
    const at = heads.findIndex((head) => head.includes(target));
    if (at >= 0) return at;
  }
  return -1;
}

function monthOf(text) {
  const match = String(text ?? '').match(/(20\d{2})\s*[-/年]\s*(\d{1,2})/);
  return match ? `${match[1]}-${String(Number(match[2])).padStart(2, '0')}` : '';
}

/** 回答CSVを読み、{MID: {月: 回答}} にする。 */
export function load(text) {
  const rows = parseCsv(text || '');
  if (rows.length < 2) return {};
  const header = rows[0];
  const colMid = column(header, MID_HEADERS);
  const colName = column(header, NAME_HEADERS);
  const colDate = column(header, DATE_HEADERS);
  const colWeight = column(header, WEIGHT_HEADERS);
  const colFat = column(header, BODYFAT_HEADERS);
  const photoCols = header.map((h, i) => (PHOTO_HINTS.some((w) => h.includes(w)) ? i : -1)).filter((i) => i >= 0);

  const out = {};
  for (const row of rows.slice(1)) {
    const cell = (index) => (index >= 0 && index < row.length ? (row[index] || '').trim() : '');
    // 受講生IDは事前入力リンクで入る想定。消されていた場合に備えて氏名でも引けるようにする
    const mid = cell(colMid).toUpperCase().trim();
    const name = stripReading(cell(colName));
    if (!mid && !name) continue;
    const month = monthOf(cell(colDate));
    const entry = {
      mid, name, month, at: cell(colDate),
      weight_kg: cell(colWeight), body_fat_pct: cell(colFat),
      photos: photoCols.map(cell).filter(Boolean),
    };
    // 同じ月に複数回答があれば、最後の回答を採用する
    if (mid) (out[mid] ??= {})[month] = entry;
    if (name) (out[`名前:${normalize(name)}`] ??= {})[month] = entry;
  }
  return out;
}

export function currentMonth(when) {
  const now = when || new Date();
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * その受講生の、指定月の提出状況。
 * 受講生IDで見つからない場合は氏名でも探す（IDを消して出されたときの保険）。
 */
export function statusFor(submissions, mid, month, name = '') {
  const key = month || currentMonth();
  const table = submissions || {};
  const entry = ((table[String(mid || '').toUpperCase().trim()] || {})[key])
    || (name ? (table[`名前:${normalize(stripReading(name))}`] || {})[key] : null);
  if (!entry) return { submitted: false, month: key };
  return {
    submitted: true, month: key, at: entry.at,
    matched_by: entry.mid ? 'id' : 'name',
    weight_kg: entry.weight_kg, body_fat_pct: entry.body_fat_pct,
    photos: (entry.photos || []).length,
  };
}

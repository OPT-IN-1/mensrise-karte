// カウンセリングCSVの読み込みと列マッピング（現行ツール app/csvmap.py と同じ規則）。
// CSVの見出しは運用で変わりうるため、別名辞書で自動マッピングし、画面で確定させる。
// 確定したマッピングは、見出しの署名ごとに保存して次回から使い回す。

import { FIELDS, BY_KEY } from './fields.js?v=20260908145508';
import { normalize, stripReading } from './text.js?v=20260908145508';

/** RFC4180のCSVを行列に分解する（引用符の中の改行・カンマも正しく読む）。 */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const source = String(text).replace(/^﻿/, '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch !== '"') { cell += ch; continue; }
      if (source[i + 1] === '"') { cell += '"'; i += 1; continue; }
      quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** 文字コードを判定して読む。Excel由来のCP932も開けるようにする。 */
export function decodeCsv(buffer) {
  const bytes = new Uint8Array(buffer);
  for (const encoding of ['utf-8', 'shift_jis']) {
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      return text;
    } catch { /* 次の文字コードで試す */ }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/** 見出しの並びから、マッピング保存用の署名を作る。 */
export async function signatureOf(header) {
  const data = new TextEncoder().encode(header.join(''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export class CounselingCsv {
  constructor(text) {
    const rows = parseCsv(text);
    if (!rows.length) throw new Error('CSVが空です');
    this.header = rows[0].map((c) => c.trim());
    this.rows = rows.slice(1).filter((r) => r.some((c) => (c || '').trim()));
  }

  /** 別名辞書で列を推定する。値は列番号、見つからない項目は null。 */
  autoMapping() {
    const used = new Set();
    const mapping = {};
    const heads = this.header.map(normalize);
    for (const field of FIELDS) {
      let found = null;
      for (const alias of field.aliases) {
        const want = normalize(alias);
        // 完全一致を優先し、次に部分一致
        for (let i = 0; i < heads.length && found === null; i += 1) {
          if (used.has(i) || !heads[i]) continue;
          if (heads[i] === want) found = i;
        }
        if (found !== null) break;
        for (let i = 0; i < heads.length && found === null; i += 1) {
          if (used.has(i) || !heads[i]) continue;
          if (want && heads[i].includes(want)) found = i;
        }
        if (found !== null) break;
      }
      if (found !== null) used.add(found);
      mapping[field.key] = found;
    }
    return mapping;
  }

  /** 保存済みマッピングを重ねた、実際に使うマッピング。 */
  effectiveMapping(saved) {
    const mapping = this.autoMapping();
    for (const [key, value] of Object.entries(saved || {})) {
      if (key in BY_KEY) mapping[key] = value;
    }
    return mapping;
  }

  cell(rowIndex, key, mapping) {
    const col = (mapping || {})[key];
    if (col === null || col === undefined) return '';
    const row = this.rows[rowIndex] || [];
    return col >= row.length ? '' : (row[col] || '').trim();
  }

  columnName(key, mapping) {
    const col = (mapping || {})[key];
    if (col === null || col === undefined || col >= this.header.length) return '';
    return this.header[col];
  }

  /** 対象者一覧（MID・氏名・呼び名・入会月）。 */
  roster(mapping) {
    return this.rows.map((_row, index) => ({
      row_index: index,
      mid: this.cell(index, 'mid', mapping),
      name: this.cell(index, 'name', mapping),
      nickname: this.cell(index, 'nickname', mapping),
      join_month: this.cell(index, 'join_month', mapping),
    }));
  }

  /**
   * MIDと氏名で候補行を探す。0件・複数件は呼び出し側でブロックする。
   * 氏名に「井上颯人（イノウエハヤト）」のようなふりがなが付くことがあるため、
   * 括弧書きを除いた形でも突き合わせる。
   */
  findCandidates(mid, name, mapping) {
    const midN = normalize(mid), nameN = normalize(name);
    const bareName = stripReading(nameN);
    return this.roster(mapping).filter((entry) => {
      if (midN && normalize(entry.mid) !== midN) return false;
      if (nameN) {
        const entryName = normalize(entry.name);
        if (entryName !== nameN && stripReading(entryName) !== bareName) return false;
      }
      return true;
    });
  }
}

// --- 入会月の照合（サブスク購入者シート） ------------------------------------
// カウンセリングフォームには入会日が無いため、購入者シートの「登録日時」を
// 氏名で突き合わせて入会月とする。見つからない場合は回答日時（タイムスタンプ）を使う。
const NAME_HEADERS = ['お名前', '氏名', '名前'];
const DATE_HEADERS = ['登録日時', '入会日', '購入日', '配信基準日時'];

function pickColumn(header, candidates) {
  for (const want of candidates) {
    const at = header.findIndex((cell) => normalize(want) === normalize(cell));
    if (at >= 0) return at;
  }
  for (const want of candidates) {
    const at = header.findIndex((cell) => normalize(cell).includes(normalize(want)));
    if (at >= 0) return at;
  }
  return null;
}

/** 氏名（正規化）→ 入会月「YYYY年M月」の対応表を作る。 */
export function loadJoinMonths(text) {
  const rows = parseCsv(text);
  if (!rows.length) return {};
  const header = rows[0].map((c) => c.trim());
  const nameCol = pickColumn(header, NAME_HEADERS);
  const dateCol = pickColumn(header, DATE_HEADERS);
  if (nameCol === null || dateCol === null) return {};

  const found = {};
  for (const row of rows.slice(1)) {
    if (row.length <= Math.max(nameCol, dateCol)) continue;
    const name = normalize(row[nameCol]);
    const raw = (row[dateCol] || '').trim();
    const match = raw.match(/(20\d{2})\D{1,2}(\d{1,2})/);
    if (!name || !match) continue;
    const month = `${Number(match[1])}年${Number(match[2])}月`;
    // 同じ人が複数回購入している場合は、いちばん古い日付を入会月とする
    if (!(name in found) || raw < found[name][1]) found[name] = [month, raw];
  }
  return Object.fromEntries(Object.entries(found).map(([name, v]) => [name, v[0]]));
}

export function lookupJoinMonth(joinMonths, name) {
  return (joinMonths || {})[normalize(name)] || '';
}

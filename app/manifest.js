// 個人別マニフェストの生成（現行ツール app/manifest.py と同じ）。
// 表示値のほかに fields（原本値・空欄フラグ・元列名）と isolation（他受講生の識別子）を
// 併記する。fields と isolation はカルテには出さず、検品にだけ使う。

import { BLANK_DISPLAY, FIELDS, SECTIONS } from './fields.js?v=20260908011822';
import { lookupJoinMonth } from './csv.js?v=20260908011822';
import { normalize } from './text.js?v=20260908011822';

const TIMESTAMP_RE = /^(20\d{2})[/\-年](\d{1,2})/;

/** フォームのタイムスタンプ（2026/07/05 21:10:24）を「2026年7月」にする。 */
export function normalizeJoinMonth(raw) {
  const text = String(raw ?? '').trim();
  const match = text.match(TIMESTAMP_RE);
  if (match && (!text.includes('年') || text.includes(':'))) {
    return `${Number(match[1])}年${Number(match[2])}月`;
  }
  return raw;
}

export function displayValue(raw, policy) {
  const text = String(raw ?? '');
  return text.trim() ? text.trim() : (BLANK_DISPLAY[policy] ?? '');
}

/**
 * 対象1行から個人別マニフェストを作る。
 * CSVに列が無い項目（ロードマップ・外見イメージング等）は operatorValues で受け取り、
 * 原本ではなく「担当者入力」として区別して記録する。
 */
export function buildManifest(csvFile, rowIndex, mapping, options = {}) {
  const { menuCsv = '', benefitCsv = '', photoFolder = '', operatorValues = {},
    joinMonths = null, corrections = {}, sourceName = '', sourceSha256 = '', now = '' } = options;

  const sections = Object.fromEntries(SECTIONS.map((s) => [s, {}]));
  const detail = {};

  for (const field of FIELDS) {
    let raw = csvFile.cell(rowIndex, field.key, mapping);
    let origin = 'csv';
    if (!raw && field.input_mode === 'operator') {
      raw = String(operatorValues[field.key] ?? '').trim();
      if (raw) origin = 'operator';
    }
    // 検品で見つかった不備の手直し。CSVの値より優先する（監査ログに残す）
    const fixed = String(corrections[field.key] ?? '').trim();
    if (fixed) { raw = fixed; origin = 'correction'; }
    if (field.key === 'join_month') {
      // 購入者シートの登録日時があればそれを入会月にする
      const matched = joinMonths ? lookupJoinMonth(joinMonths, sections.member.name || '') : '';
      if (matched) { raw = matched; origin = 'members_sheet'; }
      else raw = normalizeJoinMonth(raw);
    }
    const shown = displayValue(raw, field.policy);
    sections[field.section][field.key] = shown;
    detail[field.key] = {
      label: field.label, section: field.section, raw, display: shown,
      blank_in_source: !String(raw ?? '').trim(),
      policy: field.policy, required: field.required,
      source_column: csvFile.columnName(field.key, mapping) || null,
      mapped: (mapping || {})[field.key] !== null && (mapping || {})[field.key] !== undefined,
      input_mode: field.input_mode, multiline: field.multiline, origin,
    };
  }

  return {
    member: sections.member, goals: sections.goals, roadmap: sections.roadmap,
    vision: sections.vision, beauty: sections.beauty, training: sections.training, hair: sections.hair,
    photos: {},
    source: {
      counseling_csv: sourceName,
      counseling_csv_sha256: sourceSha256,
      row_key: 'MID + 氏名',
      row_index: rowIndex,
      row_identity: `${sections.member.mid || ''} / ${sections.member.name || ''}`,
      menu_csv: menuCsv, benefit_csv: benefitCsv, photo_folder: photoFolder,
      generated_at: now,
    },
    fields: detail,
    isolation: otherMembers(csvFile, rowIndex, mapping),
  };
}

/**
 * 対象者以外の識別子。生成物に現れたら混入として扱う。
 * ただし対象者自身の氏名・呼び名と文字列として重なるものは除外する。
 * （例：対象者「ゆうと」に対し、別受講生の「ゆう」は区別できないため検査しない）
 */
export function otherMembers(csvFile, rowIndex, mapping) {
  const roster = csvFile.roster(mapping);
  const target = roster[rowIndex] || {};
  const own = ['mid', 'name', 'nickname']
    .filter((k) => String(target[k] ?? '').trim()).map((k) => normalize(target[k]));
  const mids = [], names = [], nicknames = [];
  for (const entry of roster) {
    if (entry.row_index === rowIndex) continue;
    for (const [value, bucket] of [[entry.mid, mids], [entry.name, names], [entry.nickname, nicknames]]) {
      const text = String(value ?? '').trim();
      if (!text) continue;
      const key = normalize(text);
      if (own.some((mine) => key.includes(mine) || mine.includes(key))) continue;
      bucket.push(text);
    }
  }
  const uniq = (list) => [...new Set(list)].sort();
  return { other_mids: uniq(mids), other_names: uniq(names), other_nicknames: uniq(nicknames) };
}

/** 必須項目のうち、原本が空欄・未マッピングのもの。 */
export function missingRequired(manifest) {
  const out = [];
  for (const info of Object.values(manifest.fields || {})) {
    if (!info.required || info.origin === 'operator') continue;
    if (!info.mapped) out.push(`${info.label}：CSVの列が未マッピングです`);
    else if (info.blank_in_source) out.push(`${info.label}：原本が空欄です`);
  }
  return out;
}

/** テンプレートへ差し込む表示値の平坦な辞書。 */
export function targetValues(manifest) {
  const flat = {};
  for (const section of SECTIONS) Object.assign(flat, manifest[section] || {});
  return flat;
}

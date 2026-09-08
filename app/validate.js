// バリデーションと機械検査（現行ツール app/validate.py と同じ判定・同じ文面）。
//
// 段階:
//   1. 生成前バリデーション   preGeneration()
//   2. HTML検査（残存・混入）  inspectHtml()
//   3. 中身の規則検査          inspectSheets()（現行のPDFテキスト検査に相当）
//   4. クロスチェック          crossCheckHtml()
//   5. レイアウトのはみ出し    checkOverflow()
//
// いずれも「目視検査の代替ではない」。ERRORが0件でも、ページの目視確認と
// 最終承認が済むまで納品させない。

import { PHOTO_ROLES } from './fields.js?v=20260908145508';
import { missingRequired } from './manifest.js?v=20260908145508';
import { normalize } from './text.js?v=20260908145508';

const MEASURE_RE = /(\d+(?:\.\d+)?)\s*(kcal|kg|cm|%|歳|g)/gi;
const HAIR_RANGE_RE = /(?<!\d)\d+\s*〜\s*\d+\s*日/g;
const XCHECK_RE = /data-xcheck="(\w+)"[^>]*>([\s\S]*?)</g;
const PRICE_RE = /[¥￥]\s*([\d,]+)/g;
const CONFIRM_KEYS = ['identity_confirmed', 'usage_confirmed', 'crop_confirmed'];
const CONFIRM_LABEL = {
  identity_confirmed: '本人であることを確認した',
  usage_confirmed: '用途と構図を確認した',
  crop_confirmed: 'クロップ後の写真を確認した',
};

// 不合格になったとき、担当者がその場で何をすればよいかを示す。
export const REMEDY = {
  TARGET_NONE: 'MIDと氏名を確認してください。カウンセリング未提出の可能性もあります。',
  TARGET_MULTI: '同姓同名が複数います。MIDで一意になるよう指定してください。',
  FIELD_MISSING: 'ステップ2の入力欄に値を入れてください（CSVに無い項目は画面で入力できます）。',
  RULE_UNRESOLVED: 'ステップ3で該当項目を選び直すか、上書き入力で確定してください。',
  PHOTO_MISSING: 'ステップ1に戻り、その用途の写真を選んで確定してください。',
  PHOTO_UNCONFIRMED: 'ステップ1に戻り、その写真をもう一度確定してください。',
  IDENTITY_MISSING: 'カルテに氏名が入っていません。氏名の入力を確認して作り直してください。',
  LAYOUT_OVERFLOW: '文章量が1ページに収まりません。「本文をさらに縮めて作り直す」を押すか、長い自由記述（悩み・ゴール）を短くしてください。',
  LAYOUT: 'テンプレートの構造が壊れています。テンプレートを選び直して作り直してください。',
  FORBIDDEN: 'その語がカルテに出ています。商品マスタ（data/products.json）に無い商品名・価格・購入先か、URL・内部メモの残りです。入力を直して作り直してください。',
  RESIDUAL_TERM: '対象者の回答に無い語が出ています。入力欄に他の人の情報が混ざっていないか確認してください。',
  OTHER_MEMBER: '別の受講生の名前・IDがカルテに入っています。すぐに作り直し、入力元を確認してください。',
  MEASURE_INTRUDER: '入力に無い身体数値が出ています。身長・体重・年齢の入力を確認してください。',
  CROSS_MISMATCH: 'シート間で値が食い違っています。作り直しても直らない場合は連絡してください。',
  DAY_RULE: 'トレーニング回数とDAY数が合っていません。ステップ3の週回数を確認してください。',
  HAIR_DAYS: '育毛日数がシート間で食い違っています。ステップ3の髪の長さを選び直してください。',
  PAGE_COUNT: '5ページになっていません。もう一度生成してください。',
  NO_TEXT: 'カルテ本文を読み取れません。もう一度生成してください。',
  FILENAME: 'ファイル名が規則と違います。もう一度生成してください。',
  FILENAME_KANJI: '氏名が漢字で入っていません。氏名の入力を確認してください。',
  FILENAME_SUFFIX: 'ファイル名に版番号が付いています。もう一度生成してください。',
  TEMPLATE_LITERAL: 'テンプレートに個人の数値・症状語が直書きされています。テンプレートの修正が必要です。',
  TEMPLATE_STRUCTURE: 'テンプレートのページ構造が壊れています。テンプレートの修正が必要です。',
  TEMPLATE_MISSING: 'テンプレートのファイルがありません。テンプレートを選び直してください。',
  LAYOUT_SHRINK: '収めるために本文を縮小しました。読みにくければ自由記述を短くしてください。',
  ROADMAP_DATE: '受講生が書いた日付が入会月と合わないため、期限の列を正としています。',
  RULE_TIEBREAK: '既定値で確定しました。変えたい場合は該当の入力欄に直接書いてください。',
};

export function issue(level, code, message) {
  return { level, code, message, fix: REMEDY[code] || '' };
}

const compactOf = (text) => String(text).replace(/\s+/g, '');
const visibleOf = (html) => String(html).replace(/<[^>]+>/g, ' ');
const hasKanji = (value) => [...String(value ?? '')].some((ch) => ch >= '一' && ch <= '鿿');

// --- 1. 生成前バリデーション --------------------------------------------------
export function preGeneration(manifest, decisions, photos, candidates, templateIssues = []) {
  const issues = [];
  if (candidates === 0) {
    issues.push(issue('ERROR', 'TARGET_NONE', 'MIDと氏名に一致する行がCSVにありません。対象者を特定できません。'));
  } else if (candidates > 1) {
    issues.push(issue('ERROR', 'TARGET_MULTI', `MIDと氏名に一致する行が${candidates}件あります。最新の1行に絞ってください。`));
  }
  for (const message of missingRequired(manifest)) issues.push(issue('ERROR', 'FIELD_MISSING', message));
  for (const message of decisions.unresolved || []) issues.push(issue('ERROR', 'RULE_UNRESOLVED', message));
  for (const entry of Object.values(decisions)) {
    if (entry && typeof entry === 'object' && entry.tiebreak) {
      issues.push(issue('WARN', 'RULE_TIEBREAK', `判定が競合したため自動で選びました。目視で確認してください：${entry.evidence}`));
    }
  }
  for (const { role, label } of PHOTO_ROLES) {
    const entry = (photos || {})[role] || {};
    if (!entry.cropped) { issues.push(issue('ERROR', 'PHOTO_MISSING', `写真が未確定です：${label}`)); continue; }
    for (const key of CONFIRM_KEYS) {
      if (!entry[key]) issues.push(issue('ERROR', 'PHOTO_UNCONFIRMED', `${label}：「${CONFIRM_LABEL[key]}」が未確認です`));
    }
  }
  return issues.concat(templateIssues);
}

/** テンプレートに人物固有リテラルが混ざっていないかを検査する。 */
export function templatePurity(sheets) {
  const issues = [];
  const config = sheets.forbidden || {};
  for (const { name, html } of sheets.files || []) {
    const stripped = String(html).replace(/\{\{[^}]*\}\}/g, '');
    for (const match of stripped.matchAll(MEASURE_RE)) {
      const measure = match[1], unit = match[2].toLowerCase();
      const before = stripped.slice(Math.max(0, match.index - 14), match.index);
      const suspicious = ['kg', 'kcal', '歳'].includes(unit)
        || (unit === 'cm' && Number(measure) >= 100)     // 身長域だけを疑う
        || (unit === '%' && before.includes('体脂肪'));
      if (!suspicious) continue;
      issues.push(issue('ERROR', 'TEMPLATE_LITERAL', `${name} に人物固有らしい数値が直書きされています: ${measure}${unit}`));
    }
    for (const term of config.person_specific_terms || []) {
      if (stripped.includes(term)) issues.push(issue('ERROR', 'TEMPLATE_LITERAL', `${name} に症状語が直書きされています: ${term}`));
    }
    if (/MS\d{3,}/.test(stripped)) issues.push(issue('ERROR', 'TEMPLATE_LITERAL', `${name} にMIDらしい文字列が直書きされています`));
  }
  return issues.concat(templateStructure(sheets.files || []));
}

/** テンプレート差し替え後も崩せない構造上の固定要件を検査する。 */
export function templateStructure(files) {
  const issues = [];
  const byName = Object.fromEntries(files.map((f) => [f.name, f.html]));
  if (byName['sheet2.html']) {
    // 最初の丸数字①の直後（クラス名に依存せず120文字以内）に「眉ケア」があること
    if (!/①<\/span>[\s\S]{0,120}?眉ケア/.test(compactOf(byName['sheet2.html']))) {
      issues.push(issue('ERROR', 'TEMPLATE_STRUCTURE', 'sheet2.html の①の見出しが「眉ケア」ではありません'));
    }
  }
  if (byName['sheet4.html']) {
    const match = byName['sheet4.html'].match(/<div class="(?:col-left|side)">([\s\S]*?)<div class="(?:col-main|main)/);
    if (match && match[1].includes('髪の悩み')) {
      issues.push(issue('ERROR', 'TEMPLATE_STRUCTURE', 'sheet4.html の左カラムに「髪の悩み」欄があります'));
    }
  }
  for (let index = 1; index <= 5; index += 1) {
    const html = byName[`sheet${index}.html`];
    if (!html) { issues.push(issue('ERROR', 'TEMPLATE_STRUCTURE', `sheet${index}.html がありません`)); continue; }
    if (!html.includes(`data-sheet="${index}"`)) {
      issues.push(issue('ERROR', 'TEMPLATE_STRUCTURE', `sheet${index}.html に data-sheet="${index}" のページ枠がありません`));
    }
    if (!html.includes(`${index} / 5`)) {
      issues.push(issue('ERROR', 'TEMPLATE_STRUCTURE', `sheet${index}.html のページ番号が「${index} / 5」ではありません`));
    }
  }
  return issues;
}

// --- 共通の禁止語検査 ---------------------------------------------------------
/** 商品マスタ（福利厚生シート由来のカタログを含む）の価格と購入先を集める。 */
export function productMasterStrings(master) {
  const prices = new Set(), channels = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (['price', 'list_price'].includes(key) && typeof item === 'string') {
        for (const hit of item.matchAll(PRICE_RE)) prices.add(hit[1].replace(/,/g, ''));
      } else if (key === 'channel' && typeof item === 'string') channels.add(item);
      else if (key !== 'link') walk(item);   // 発注用リンクは検査対象外
    }
  };
  walk(master);
  for (const value of Object.values(master.channel_labels || {})) channels.add(value);
  return { prices, channels };
}

/** 商品マスタに載っている商品名をひとつなぎにしたもの（ブランド照合用）。 */
export function masterLabels(master) {
  const parts = [];
  const walk = (value) => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (['label', 'name'].includes(key) && typeof item === 'string') parts.push(item);
      else if (key !== 'link') walk(item);
    }
  };
  walk(master);
  return parts.join(' ');
}

/** 対象者本人がカウンセリングに書いた原文をひとつなぎにする。 */
export function memberRawText(manifest) {
  return Object.values((manifest || {}).fields || {}).map((info) => info.raw || '').join(' ');
}

/**
 * 商品名の扱いは data/products.json の show_products で切り替わる。
 *   false … 商品名・価格・購入先そのものを禁止（ナレッジ既定の非表示運用）
 *   true  … 商品マスタに載っている商品・価格だけを許可し、
 *           マスタ外のブランドと、マスタに無い価格を残存として弾く
 */
export function scanForbidden(text, where, raws, config, master) {
  const issues = [];
  const compact = compactOf(text);
  const patterns = { ...(config.patterns || {}) };
  const showProducts = Boolean(master.show_products);
  if (!showProducts) Object.assign(patterns, config.product_patterns || {});
  for (const [pattern, label] of Object.entries(patterns)) {
    const re = new RegExp(pattern, 'i');
    const match = text.match(re) || compact.match(re);
    if (match) issues.push(issue('ERROR', 'FORBIDDEN', `${where}：${label}を検出しました（${match[0].slice(0, 24)}／${pattern}）`));
  }
  if (!showProducts) return issues;

  const listed = masterLabels(master);
  for (const brand of config.unlisted_brands || []) {
    if (listed.includes(brand)) continue;              // 商品マスタで実際に使っているブランドは正当
    if (String(raws).includes(brand)) continue;        // 本人が「現在のスキンケア」等に書いたブランドはそのまま載せてよい
    if (text.includes(brand) || compact.includes(brand)) {
      issues.push(issue('ERROR', 'FORBIDDEN', `${where}：商品マスタに無いブランド「${brand}」が出力されています（旧版・別人向けの残存）`));
    }
  }
  const { prices, channels } = productMasterStrings(master);
  for (const match of compact.matchAll(PRICE_RE)) {
    if (!prices.has(match[1].replace(/,/g, ''))) {
      issues.push(issue('ERROR', 'FORBIDDEN', `${where}：商品マスタに無い価格「${match[0]}」が出力されています`));
    }
  }
  const allowed = [...(config.purchase_channels || []), ...channels];
  for (const word of ['楽天市場', 'ヨドバシ', 'Amazon']) {
    if ((text.includes(word) || compact.includes(word)) && !allowed.some((c) => String(c).includes(word))) {
      issues.push(issue('ERROR', 'FORBIDDEN', `${where}：商品マスタに無い購入先「${word}」が出力されています`));
    }
  }
  return issues;
}

/**
 * 対象者のCSV原文にない症状語・未確定表記が出力に現れていないか。
 * 「未定」のように受講生本人の回答としてあり得る語は、原本に同じ語があれば通す。
 */
export function scanPersonSpecific(text, manifest, where, config) {
  const issues = [];
  const raws = memberRawText(manifest);
  for (const term of config.person_specific_terms || []) {
    if (text.includes(term) && !raws.includes(term)) {
      issues.push(issue('ERROR', 'RESIDUAL_TERM',
        `${where}：対象者のCSVに無い症状語「${term}」が出力されています（テンプレート／別人由来の残存）`));
    }
  }
  for (const [pattern, label] of Object.entries(config.conditional_patterns || {})) {
    const re = new RegExp(pattern);
    const match = text.match(re);
    if (match && !re.test(raws)) {
      issues.push(issue('ERROR', 'RESIDUAL_TERM',
        `${where}：${label}を検出しました（${match[0].slice(0, 20)}）。対象者の回答には含まれていません。`));
    }
  }
  return issues;
}

/**
 * 別受講生の情報が混ざっていないか。
 * 「とも」「あきら」のような短いひらがなの呼び名は「〜とともに」「あきらめる」など
 * 普通の日本語の一部として現れる。本文の全文照合はMIDと氏名（および十分に長い呼び名）
 * に限り、呼び名そのものは氏名欄の値で突き合わせる。
 */
export function scanOtherMembers(text, manifest, where) {
  const issues = [];
  const isolation = manifest.isolation || {};
  const compact = normalize(text);
  const raws = normalize(memberRawText(manifest));
  for (const [label, key] of [['MID', 'other_mids'], ['氏名', 'other_names']]) {
    for (const value of isolation[key] || []) {
      const token = normalize(value);
      if (token.length < 2 || raws.includes(token)) continue;
      if (compact.includes(token)) {
        issues.push(issue('ERROR', 'OTHER_MEMBER', `${where}：別受講生の${label}「${value}」が出力に含まれています`));
      }
    }
  }
  for (const value of isolation.other_nicknames || []) {
    const token = normalize(value);
    // 4文字未満の呼び名は普通の語に埋もれるため、全文照合の対象外にする
    if (token.length < 4 || raws.includes(token)) continue;
    if (compact.includes(token)) {
      issues.push(issue('ERROR', 'OTHER_MEMBER', `${where}：別受講生の呼び名「${value}」が出力に含まれています`));
    }
  }
  return issues;
}

/** カルテに刷り込まれた氏名・呼び名が、対象者本人のものか。 */
export function checkIdentityValues(context, manifest) {
  const issues = [];
  const member = manifest.member || {};
  const isolation = manifest.isolation || {};
  const checks = [
    ['氏名', context.name, member.name, isolation.other_names || []],
    ['呼び名', context.nickname, member.nickname, isolation.other_nicknames || []],
  ];
  for (const [label, printed, expected, others] of checks) {
    const printedN = normalize(printed || ''), expectedN = normalize(expected || '');
    if (!printedN || !expectedN || printedN === expectedN) continue;
    if (others.map(normalize).includes(printedN)) {
      issues.push(issue('ERROR', 'OTHER_MEMBER',
        `カルテの${label}が別受講生の値「${printed}」になっています（対象者は「${expected}」）`));
    } else {
      issues.push(issue('ERROR', 'IDENTITY_MISSING',
        `カルテの${label}「${printed}」が対象者の「${expected}」と一致しません`));
    }
  }
  return issues;
}

/** 差し込んだ値に由来する数値の集合。これ以外の身体数値は混入とみなす。 */
export function allowedMeasures(context) {
  const allowed = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value && typeof value === 'object') { Object.values(value).forEach(walk); return; }
    if (value === null || value === undefined) return;
    for (const number of String(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []) allowed.add(number);
  };
  walk(context);
  return allowed;
}

/**
 * 身体数値の混入検査。対象は kg / kcal / 歳、身長域の cm（100以上）、
 * 体脂肪率に隣接する % に限る（「1ヶ月に約1cm伸びる」等の誤検出を避けるため）。
 */
export function scanMeasures(text, context, where) {
  const allowed = allowedMeasures(context);
  const issues = [];
  const seen = new Set();
  const compact = String(text).replace(/,/g, '');
  for (const match of compact.matchAll(MEASURE_RE)) {
    const number = match[1], unit = match[2].toLowerCase();
    if (unit === 'cm' && Number(number) < 100) continue;
    if (unit === '%' && !compact.slice(Math.max(0, match.index - 14), match.index).includes('体脂肪')) continue;
    if (unit === 'g' && Number(number) < 10) continue;
    const token = `${number}|${unit}`;
    if (allowed.has(number) || seen.has(token)) continue;
    seen.add(token);
    issues.push(issue('ERROR', 'MEASURE_INTRUDER',
      `${where}：マニフェスト由来でない数値「${number}${unit}」が出力されています（別人の数値の可能性）`));
  }
  return issues;
}

// --- 2. HTML検査 --------------------------------------------------------------
export function inspectHtml(sheets, manifest, context, config, master) {
  const issues = [];
  const raws = memberRawText(manifest);
  for (const { name, html } of sheets) {
    const visible = visibleOf(html);
    issues.push(...scanForbidden(visible, name, raws, config, master));
    issues.push(...scanPersonSpecific(visible, manifest, name, config));
    issues.push(...scanOtherMembers(visible, manifest, name));
    issues.push(...scanMeasures(visible, context, name));
  }
  for (const note of context.roadmap_removed || []) {
    issues.push(issue('WARN', 'ROADMAP_DATE', `ロードマップの時系列を修正しました：${note}`));
  }
  issues.push(...checkIdentityValues(context, manifest));
  issues.push(...crossCheckHtml(sheets));
  return issues;
}

/** Sheet1を正として、data-xcheck属性の値が全シートで一致するかを見る。 */
export function crossCheckHtml(sheets) {
  const values = {};
  for (const { name, html } of sheets) {
    for (const match of String(html).matchAll(XCHECK_RE)) {
      const value = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, '');
      if (!value) continue;
      values[match[1] ] ??= {};
      (values[match[1]][value] ??= []).push(name);
    }
  }
  const issues = [];
  for (const [key, variants] of Object.entries(values)) {
    if (Object.keys(variants).length <= 1) continue;
    const detail = Object.entries(variants)
      .map(([value, names]) => `${value}（${[...new Set(names)].sort().join('、')}）`).join(' / ');
    issues.push(issue('ERROR', 'CROSS_MISMATCH', `シート間で「${key}」の値が一致しません: ${detail}`));
  }
  return issues;
}

// --- 3. 中身の規則検査（現行のPDFテキスト検査に相当） --------------------------
// ブラウザ版はPDFを印刷機能で作るため、検査は組み上がったカルテ本文に対して行う。
export function inspectSheets(sheets, manifest, decisions, context, config, master) {
  const issues = [];
  const mid = manifest.member.mid, name = manifest.member.name;
  const pageTexts = sheets.map(({ html }) => visibleOf(html));

  if (!hasKanji(name)) {
    issues.push(issue('ERROR', 'FILENAME_KANJI', `氏名に漢字が含まれていません（英字名だけのPDF名は不可）: ${name}`));
  }
  if (pageTexts.length !== 5) {
    issues.push(issue('ERROR', 'PAGE_COUNT', `ページ数が5ではありません: ${pageTexts.length}`));
  }

  const text = pageTexts.join('\n');
  const compact = compactOf(text);
  if (!text.trim()) issues.push(issue('ERROR', 'NO_TEXT', 'カルテ本文を読み取れません。目視検査を強化してください。'));
  for (const [label, value] of [['MID', mid], ['氏名', name]]) {
    if (value && !compact.includes(compactOf(value))) {
      issues.push(issue('ERROR', 'IDENTITY_MISSING', `対象者の${label}がカルテ本文に見つかりません: ${value}`));
    }
  }
  issues.push(...scanForbidden(text, 'カルテ', memberRawText(manifest), config, master));
  issues.push(...scanPersonSpecific(text, manifest, 'カルテ', config));
  issues.push(...scanOtherMembers(text, manifest, 'カルテ'));
  issues.push(...scanMeasures(text, context, 'カルテ'));

  // 週回数に連動する規則（Sheet3とSheet5を別々に見る）
  const frequency = Number(decisions.training.value.frequency);
  const pages = pageTexts.length >= 5 ? [[3, pageTexts[2]], [5, pageTexts[4]]] : [];
  for (const [sheetNo, sheetText] of pages) {
    const normalized = compactOf(sheetText.toUpperCase());
    if (frequency === 2) {
      for (const day of ['DAY3', 'DAY4']) {
        if (normalized.includes(day)) issues.push(issue('ERROR', 'DAY_RULE', `週2回のカルテのSheet${sheetNo}に${day}が残っています`));
      }
    } else {
      for (const day of ['DAY1', 'DAY2', 'DAY3', 'DAY4']) {
        if (!normalized.includes(day)) issues.push(issue('ERROR', 'DAY_RULE', `週4回のカルテのSheet${sheetNo}に${day}がありません`));
      }
    }
  }

  issues.push(...checkHairDays(pageTexts, decisions));
  return issues;
}

export function checkHairDays(pageTexts, decisions) {
  if (pageTexts.length < 5) return [];
  const label = decisions.hair.value.days_label;
  const raw4 = pageTexts[3], raw5 = pageTexts[4];
  const sheet4 = compactOf(raw4), sheet5 = compactOf(raw5);
  const issues = [];
  // 範囲表記の抽出は生テキストで行う（空白を詰めるとページ番号と連結してしまう）
  const found4 = new Set((raw4.match(HAIR_RANGE_RE) || []).map(compactOf));
  const found5 = new Set((raw5.match(HAIR_RANGE_RE) || []).map(compactOf));
  if (label === '維持') {
    for (const [index, page] of [[4, sheet4], [5, sheet5]]) {
      if (!page.includes('維持')) issues.push(issue('ERROR', 'HAIR_DAYS', `Sheet${index}にヘアの方針「維持」がありません`));
    }
    for (const [index, found] of [[4, found4], [5, found5]]) {
      if (found.size) {
        issues.push(issue('ERROR', 'HAIR_DAYS', `Sheet${index}に維持方針と矛盾する日数が残っています: ${[...found].sort().join('、')}`));
      }
    }
    return issues;
  }
  for (const [index, page, found] of [[4, sheet4, found4], [5, sheet5, found5]]) {
    if (!page.includes(label.replace(/ /g, ''))) {
      issues.push(issue('ERROR', 'HAIR_DAYS', `Sheet${index}に確定したヘア日数「${label}」がありません`));
    }
    const extra = [...found].filter((f) => f !== label);
    if (extra.length) {
      issues.push(issue('ERROR', 'HAIR_DAYS', `Sheet${index}に別の日数が残っています: ${extra.sort().join('、')}`));
    }
  }
  const a = [...found4].sort(), b = [...found5].sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    issues.push(issue('ERROR', 'HAIR_DAYS', `Sheet4とSheet5のヘア日数が一致しません: ${JSON.stringify(a)} / ${JSON.stringify(b)}`));
  }
  return issues;
}

// --- レイアウトのはみ出し ------------------------------------------------------
export function checkOverflow(metricsList) {
  const issues = [];
  metricsList.forEach((metrics, i) => {
    const index = i + 1;
    if (metrics && (metrics.scale ?? 1) < 1) {
      issues.push(issue('WARN', 'LAYOUT_SHRINK',
        `Sheet${index}: 内容が多いため本文を${Math.trunc(metrics.scale * 100)}%に縮小して収めました。文字の読みやすさを目視で確認してください。`));
    }
    if (!metrics) { issues.push(issue('ERROR', 'LAYOUT', `Sheet${index}: .page 要素が見つかりません`)); return; }
    if (metrics.scrollHeight > metrics.clientHeight + 1 || metrics.bodyScrollHeight > metrics.bodyClientHeight + 1) {
      issues.push(issue('ERROR', 'LAYOUT_OVERFLOW',
        `Sheet${index}: 内容がA4縦1ページに収まっていません（${metrics.bodyScrollHeight}px > ${metrics.bodyClientHeight}px）。文字切れの原因になります。`));
    }
    if (metrics.scrollWidth > metrics.clientWidth + 1) {
      issues.push(issue('ERROR', 'LAYOUT_OVERFLOW', `Sheet${index}: 内容が横幅からはみ出しています`));
    }
  });
  return issues;
}

export function summarize(issues) {
  const errors = issues.filter((i) => i.level === 'ERROR');
  const warnings = issues.filter((i) => i.level === 'WARN');
  return { passed: !errors.length, errors, warnings, issues };
}

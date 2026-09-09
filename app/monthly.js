// 2回目以降（月次）のカルテ更新（現行ツール app/monthly.py と同じ規則）。
//
// 初回は カウンセリング＋写真 でカルテを作る。
// 2回目以降は「写真」と「体重（と体脂肪率）」だけを受け取り、次の月のカルテに更新する。
//   ・体重／体脂肪率 … 毎月の実測を履歴に積み、成長推移のグリッドに反映する
//   ・髪の長さ       … 前回の判定から経過月数ぶん（1ヶ月＝約1cm）進める
//   ・筋トレのPhase  … 開始から3ヶ月ごとに1段階上げる（Phase 3で打ち止め）
//   ・そのほかの提案 … 目標スタイル・スキンケア・眉は初回のまま据え置く

import * as plan from './plan.js?v=20260909131224';

export const PHASE_MONTHS = 3;   // 何ヶ月継続したらPhaseを1つ上げるか
export const PHASE_MAX = 3;
export const LENGTH_ORDER = ['ショート', 'ミディアムショート', 'ミディアム', 'ミディアムロング以上'];
export const LENGTH_KEYS = {
  'ショート': 'short', 'ミディアムショート': 'medium_short',
  'ミディアム': 'medium', 'ミディアムロング以上': 'medium_long_plus',
};
export const KEY_TO_LENGTH = Object.fromEntries(Object.entries(LENGTH_KEYS).map(([k, v]) => [v, k]));

/** 「2026-09」の形。月次の管理キー。 */
export function monthKey(when) {
  const now = when || new Date();
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function parseMonth(text) {
  const match = String(text ?? '').match(/(20\d{2})\s*[-年/.]\s*(\d{1,2})/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** 入会月から対象月までの経過月数。分からなければ0。 */
export function monthsBetween(start, end) {
  const a = parseMonth(start), b = parseMonth(end);
  if (!a || !b) return 0;
  return Math.max(0, (b[0] * 12 + b[1]) - (a[0] * 12 + a[1]));
}

/** 継続month数からPhaseを進める。戻り値は [Phase表記, 根拠]。 */
export function nextPhase(basePhase, elapsedMonths) {
  const match = String(basePhase || '1').match(/\d+/);
  const base = match ? Number(match[0]) : 1;
  const phase = Math.min(PHASE_MAX, base + Math.floor(elapsedMonths / PHASE_MONTHS));
  if (phase === base) return [`Phase ${phase}`, `開始から${elapsedMonths}ヶ月のため据え置き`];
  return [`Phase ${phase}`,
    `開始から${elapsedMonths}ヶ月（${PHASE_MONTHS}ヶ月ごとに1段階）のため Phase ${base} → ${phase}`];
}

const ladderCm = (name) => plan.LENGTH_LADDER[name === 'ミディアムロング以上' ? 'ミディアムロング' : name] ?? 0;

/**
 * 髪は1ヶ月に約1cm伸びる。前回の長さから段階を進める。
 * 段階の幅は plan.LENGTH_LADDER（ショート0／ミディアムショート2／ミディアム4／ミディアムロング6cm）。
 */
export function grownLength(lengthLabel, elapsedMonths) {
  if (!LENGTH_ORDER.includes(lengthLabel) || elapsedMonths <= 0) return [lengthLabel, ''];
  const grownCm = ladderCm(lengthLabel) + elapsedMonths;
  let best = lengthLabel;
  for (const name of LENGTH_ORDER) if (ladderCm(name) <= grownCm) best = name;
  if (best === lengthLabel) {
    return [lengthLabel, `${elapsedMonths}ヶ月で約${elapsedMonths}cm伸びたが、段階は「${lengthLabel}」のまま`];
  }
  return [best, `${elapsedMonths}ヶ月で約${elapsedMonths}cm伸びたため「${lengthLabel}」→「${best}」`];
}

/** 成長推移のグリッド1行分。履歴にある月は実測値を入れる。 */
export function progressRows(joinMonth, history, key, months) {
  const parsed = parseMonth(joinMonth);
  return months.map((month) => {
    let label = '';
    if (parsed) {
      const [year, mon] = plan.addMonths(parsed[0], parsed[1], month.index);
      label = `${String(year).padStart(4, '0')}-${String(mon).padStart(2, '0')}`;
    }
    const entry = (history || {})[label] || {};
    const value = String(entry[key] ?? '').trim();
    return { v: value ? plan.fmt(plan.num(value), 1) : '', hi: value ? 'hi' : '', month: label };
  });
}

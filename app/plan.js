// カルテが必要とする派生値（カロリー・PFC・期限・育毛スケジュール）。
// 数式は配布済みカルテから逆算したものをそのまま使う。
//   基礎代謝BMR = 10×体重 + 6.25×身長 - 5×年齢 + 5
//   維持カロリー = BMR × 活動係数（週2回=1.375 / 週4回=1.55）
//   目標カロリー = 維持 ± 300
//   たんぱく質 = 体重×2g、脂質 = 45g固定、炭水化物 = 残り
//   髪は1ヶ月に約1cm伸びる

export const ACTIVITY_FACTOR = { 2: 1.375, 4: 1.55 };
export const FAT_G_PER_DAY = 45;
export const PROTEIN_G_PER_KG = 2;

export const LENGTH_LADDER = {
  'ショート': 0, 'ミディアムショート': 2, 'ミディアム': 4,
  'ミディアムロング': 6, 'ミディアムロング以上': 6,
};
export const LENGTH_LABEL = {
  'ショート': 'ショート（耳が出る長さ）',
  'ミディアムショート': 'ミディアムショート（耳が半分隠れる長さ）',
  'ミディアム': 'ミディアム（耳が隠れる長さ）',
  'ミディアムロング': 'ミディアムロング（耳下〜顎ライン）',
  'ミディアムロング以上': 'ミディアムロング（耳下〜顎ライン）',
};
export const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
export const TRAINING_DAYS = { 2: [0, 3], 4: [0, 1, 3, 4] };

/** 0.5は切り上げる（配布済みカルテの丸め方に合わせる）。 */
export function roundHalfUp(value) {
  return Math.floor(value + 0.5);
}

export function num(value) {
  // Pythonの \d と float() は全角数字も受け取るため、NFKCで半角に揃えてから読む（例:「６７」→67）
  const text = String(value ?? '').normalize('NFKC').replace(/,/g, '');
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function fmt(value, digits = 0) {
  if (value === null || value === undefined) return '—';
  if (digits === 0) return roundHalfUp(value).toLocaleString('en-US');
  return String(Number(value.toFixed(digits)));
}

/** 「2026年7月入会」「2026-07」などから [年, 月] を取る。 */
export function parseJoinMonth(value) {
  const match = String(value ?? '').match(/(20\d{2})\s*[年\-/.]\s*(\d{1,2})/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function addMonths(year, month, delta) {
  const total = year * 12 + (month - 1) + delta;
  return [Math.floor(total / 12), (total % 12) + 1];
}

export function monthLabel(year, month) {
  return `${year}年${month}月`;
}

/** ロードマップの期限。入会月 +1 / +3 / +6 / +12ヶ月の月末。 */
export function deadlines(joinMonth) {
  const parsed = parseJoinMonth(joinMonth);
  if (!parsed) return { m1: '—', m3: '—', m6: '—', y1: '—', final: '—' };
  const out = { final: '—' };
  for (const [key, delta] of [['m1', 1], ['m3', 3], ['m6', 6], ['y1', 12]]) {
    const [y, m] = addMonths(parsed[0], parsed[1], delta);
    out[key] = `${monthLabel(y, m)}末`;
  }
  return out;
}

/** 成長推移グリッドの列（入会月から7ヶ月分）。 */
export function progressMonths(joinMonth, count = 7) {
  const parsed = parseJoinMonth(joinMonth);
  const out = [];
  for (let index = 0; index < count; index += 1) {
    if (!parsed) { out.push({ label: '—', mark: '', index, key: '' }); continue; }
    const [y, m] = addMonths(parsed[0], parsed[1], index);
    const mark = index === 0 ? '入会' : (index === 3 ? '★3ヶ月' : (index === 6 ? '★半年' : ''));
    out.push({ label: `${m}月`, full: monthLabel(y, m), mark, index, key: `${y}-${String(m).padStart(2, '0')}` });
  }
  return out;
}

/** カロリーとPFC。 */
export function nutrition(weightKg, heightCm, age, frequency, calorieDelta, maintenanceOverride = '') {
  const weight = num(weightKg), height = num(heightCm), years = num(age);
  if (weight === null || height === null || years === null) return null;

  const bmr = roundHalfUp(10 * weight + 6.25 * height - 5 * years + 5);
  const factor = ACTIVITY_FACTOR[Number(frequency)] ?? 1.375;
  let tdee = roundHalfUp(bmr * factor);
  const override = num(maintenanceOverride);
  if (override) tdee = Math.trunc(override);
  const target = tdee + (calorieDelta || 0);

  const proteinG = weight * PROTEIN_G_PER_KG;
  const proteinKcal = proteinG * 4;
  const fatKcal = FAT_G_PER_DAY * 9;
  const carbKcal = Math.max(0, target - proteinKcal - fatKcal);
  const carbG = carbKcal / 4;
  const total = proteinKcal + fatKcal + carbKcal || 1;

  const delta = calorieDelta || 0;
  const sign = delta > 0 ? '+' : '-';
  const direction = delta > 0 ? '増量' : (delta < 0 ? '減量' : '維持');

  return {
    bmr: fmt(bmr), tdee: fmt(tdee), target_kcal: fmt(target), per_meal_kcal: fmt(target / 3),
    delta_text: delta === 0 ? `TDEE ${fmt(tdee)}（維持）` : `TDEE ${fmt(tdee)} ${sign} ${Math.abs(delta)}（${direction}）`,
    activity_factor: factor,
    protein_g: fmt(proteinG, 1), protein_kcal: fmt(proteinKcal), protein_kcal_meal: fmt(proteinKcal / 3),
    protein_pct: Math.round(proteinKcal / total * 100),
    protein_note: `${fmt(proteinG, 1)}g（${fmt(weight, 1)}kg×2g）。毎食必ず摂る。`,
    fat_g: fmt(FAT_G_PER_DAY), fat_kcal: fmt(fatKcal), fat_kcal_meal: fmt(fatKcal / 3),
    fat_pct: Math.round(fatKcal / total * 100),
    fat_note: `${fmt(FAT_G_PER_DAY)}g（1食${fmt(FAT_G_PER_DAY / 3)}g以内）。超えないよう管理。`,
    carb_g: fmt(carbG), carb_kcal: fmt(carbKcal), carb_kcal_meal: fmt(carbKcal / 3),
    carb_pct: Math.round(carbKcal / total * 100),
    carb_note: `${fmt(carbG)}g。残りカロリーを炭水化物で補う。`,
  };
}

/** 「150〜180日」から、必要な伸び(cm)・期間(ヶ月)・タイムラインを作る。 */
export function hairSchedule(daysLabel, joinMonth) {
  const parsed = parseJoinMonth(joinMonth);
  const now = parsed ? monthLabel(parsed[0], parsed[1]) : '—';
  if (daysLabel === '維持') {
    return {
      grow: false, days_label: '維持', cm_label: '—', months_label: '—',
      headline: '維持', headline_unit: '', note: '現在の長さを維持してください',
      timeline: [{ t: '現在', v: now }, { t: '2ヶ月後', v: '維持' }, { t: '4ヶ月後', v: '維持' }, { t: '目標', v: now }],
      policy: '基本方針：現在の長さを維持する。毛先とシルエットが崩れた部分だけを整える。',
      cut_rule: '全体カットはせず、毛先のみ整える',
    };
  }
  const numbers = (String(daysLabel).match(/\d+/g) || []).map(Number);
  const [low, high] = [numbers[0] ?? 0, numbers[1] ?? numbers[0] ?? 0];
  const monthsLow = Math.round(low / 30), monthsHigh = Math.round(high / 30);
  let targetMonth = '—';
  if (parsed) {
    const [y, m] = addMonths(parsed[0], parsed[1], monthsHigh);
    targetMonth = monthLabel(y, m);
  }
  return {
    grow: true, days_label: daysLabel,
    cm_label: `約${monthsLow}〜${monthsHigh}cm`, months_label: `約${monthsLow}〜${monthsHigh}ヶ月`,
    headline: String(daysLabel).replace('日', ''), headline_unit: '日間',
    note: 'カットせずに伸ばしてください',
    timeline: [{ t: '現在', v: now }, { t: '2ヶ月後', v: '+2cm' }, { t: '4ヶ月後', v: '+4cm' }, { t: '目標', v: targetMonth }],
    policy: '基本方針：カットせずに伸ばす。仕事の関係などでどうしても必要な場合は、毛先を整えるのみ（全体カットはしない）。',
    cut_rule: `カットは${daysLabel}控える`,
  };
}

/** 現在の長さと目標スタイルの長さから育毛期間を出す。 */
export function growPlan(current, target) {
  const now = LENGTH_LADDER[current];
  const goal = LENGTH_LADDER[target];
  if (now === undefined || goal === undefined) {
    return { grow: null, days_label: '', needed_label: LENGTH_LABEL[target] || target || '—' };
  }
  if (goal <= now) return { grow: false, days_label: '維持', needed_label: LENGTH_LABEL[target] || target };
  const diff = goal - now;
  return { grow: true, days_label: `${(diff - 1) * 30}〜${diff * 30}日`, needed_label: LENGTH_LABEL[target] || target };
}

/** 1週間のルーティン表。トレーニング日は週2＝月木、週4＝月火木金。 */
export function weeklySchedule(days, frequency) {
  const slots = TRAINING_DAYS[Number(frequency)] || TRAINING_DAYS[2];
  const cells = WEEKDAYS.map((label, index) => {
    const position = slots.indexOf(index);
    const day = position >= 0 ? days[position] : null;
    return { day: label, training: Boolean(day), label: day ? day.day_label : 'REST', parts: day ? day.parts_text : '' };
  });
  return { weekdays: WEEKDAYS, cells };
}

export function dayOfWeekFor(index, frequency) {
  const slots = TRAINING_DAYS[Number(frequency)] || TRAINING_DAYS[2];
  return WEEKDAYS[slots[index] ?? 0];
}

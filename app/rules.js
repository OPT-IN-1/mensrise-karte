// 判定ルールエンジン。決定表をそのまま実装する。
// すべての判定は「値＋根拠＋ルールID」を返し、画面では編集不可で表示する。
// 担当者の確認待ちは作らない（既定値を使った場合も根拠に残すだけ）。

import * as plan from './plan.js?v=20260909131224';
import { normalize, meaningful } from './text.js?v=20260909131224';
import { styleEntryFor } from './products.js?v=20260909131224';

const STATUS_BEGINNER = ['少しだけ', '少し', 'なし', 'していない', 'してない', '未経験', 'ほとんどしていない'];
const STATUS_CONTINUING = ['継続中', '継続', '続けている', '習慣', '継続的'];

const EYEBROW_ARTMAKE = {
  eyebrow_shape: ['ボサボサ', 'ぼさぼさ'],
  eyebrow_amount: ['少ない'],
  eyebrow_density: ['薄い', 'まばら'],
};
const EYEBROW_SALON = {
  eyebrow_shape: ['整ってる', '整っている'],
  eyebrow_amount: ['多い'],
  eyebrow_density: ['濃い', '硬い'],
};
const ARTMAKE_GUIDE = '美容予約を利用し、福利厚生シートの公式LINEから予約する';
const SALON_GUIDE = '福利厚生からADDICTを予約する（初回無料）';

const HAIR_LENGTHS = [
  ['short', 'ショート', '150〜180日'],
  ['medium_short', 'ミディアムショート', '90〜120日'],
  ['medium', 'ミディアム', '30〜60日'],
  ['medium_long_plus', 'ミディアムロング以上', '維持'],
];
export const HAIR_BY_KEY = Object.fromEntries(HAIR_LENGTHS.map(([k, label, days]) => [k, [label, days]]));

const CUT_WORDS = ['減量', '痩せ', 'やせ', '絞', '細く', '落とす', '引き締', '脂肪を減ら', 'ダイエット', 'シェイプ'];
const BULK_WORDS = ['増量', '太り', '太る', '筋量', 'バルク', '大きく', '厚み', 'ガタイ', '体重を増や'];

export const ACNE_NOTICE =
  'ニキビ・ニキビ跡にご心配の方は、スキンケアだけでは改善が難しい場合があります。専門医による治療が最短ルートです。';
export const MORNING_ROUTINE = '洗顔 → 化粧水 → 日焼け止め';
export const NIGHT_ROUTINE = 'クレンジング → 洗顔 → 化粧水 → 美容液 → 乳液';

function contains(text, words) {
  const t = normalize(text);
  return words.some((w) => t.includes(normalize(w)));
}

/** 判定文に出す数値。整数なら整数、端数があれば小数1桁（Python版 _fmt と同じ）。 */
function fmtNum(value) {
  if (value === null || value === undefined) return '';
  if (Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value));
  return value.toFixed(1);
}

function decision(value, ruleId, evidence, extra = {}) {
  return { value, rule_id: ruleId, evidence, resolved: extra.ok !== false, source: 'rule', ...extra };
}

// --- 1. 筋トレフェーズと回数 -------------------------------------------------
export function decideTraining(status, frequency) {
  const beginner = contains(status, STATUS_BEGINNER);
  const continuing = contains(status, STATUS_CONTINUING);
  const numbers = (normalize(frequency).match(/\d+/g) || []).map(Number);
  const max = numbers.length ? Math.max(...numbers) : null;
  const low = max !== null && max <= 2;
  const high = max !== null && max >= 3 && max <= 4;
  const veryHigh = max !== null && max >= 5;
  const base = `現状「${status || '未記入'}」／頻度「${frequency || '未記入'}」`;

  if (continuing && high) {
    return decision({ phase: 'Phase 2', frequency: 4 }, 'TR-2',
      `${base} → 継続中かつ週3〜4回のため Phase 2・週4回`, { heading: 'Phase 2 トレーニングメニュー（週4回）' });
  }
  if (continuing && low) {
    return decision({ phase: 'Phase 2', frequency: 2 }, 'TR-3',
      `${base} → 継続中かつ週1〜2回のため Phase 2・週2回`, { heading: 'Phase 2 トレーニングメニュー（週2回）' });
  }
  if (beginner && low) {
    return decision({ phase: 'Phase 1', frequency: 2 }, 'TR-1',
      `${base} → 少しだけ／なし かつ週1〜2回のため Phase 1・週2回`, { heading: 'Phase 1 トレーニングメニュー（週2回）' });
  }
  if (continuing && veryHigh) {
    // メニューは週4回までしか用意がないため、週5以上の希望も週4回で組む
    return decision({ phase: 'Phase 2', frequency: 4 }, 'TR-4',
      `${base} → 継続中かつ週5回以上の希望。メニューの上限に合わせて Phase 2・週4回`,
      { heading: 'Phase 2 トレーニングメニュー（週4回）' });
  }
  if (beginner && (high || veryHigh)) {
    // 未経験・少しだけの人は、時間が取れてもまず週2回で習慣化から入る
    return decision({ phase: 'Phase 1', frequency: 2 }, 'TR-5',
      `${base} → 少しだけ／なし。時間は取れるが、まず習慣化のため Phase 1・週2回`,
      { heading: 'Phase 1 トレーニングメニュー（週2回）' });
  }
  if (continuing) {
    return decision({ phase: 'Phase 2', frequency: 2 }, 'TR-6',
      `${base} → 継続中だが頻度が読み取れないため、Phase 2・週2回を既定にします`,
      { heading: 'Phase 2 トレーニングメニュー（週2回）' });
  }
  return decision({ phase: 'Phase 1', frequency: 2 }, 'TR-7',
    `${base} → 判定表のどれにも当てはまらないため、Phase 1・週2回を既定にします`,
    { heading: 'Phase 1 トレーニングメニュー（週2回）' });
}

// --- 2. 体重・体脂肪率・カロリー目標 ----------------------------------------
/** 減量か増量かを必ずどちらかに決める（維持は作らない）。 */
export function inferDirection(weight, height, bodyFat, goalText) {
  const text = goalText || '';
  const written = [...text.matchAll(/体重\s*(?:を)?\s*(\d{2,3}(?:\.\d)?)\s*(?:kg|キロ|㎏)/g)].map((m) => Number(m[1]));
  if (weight !== null && written.length) {
    // 向きは「一番遠い先の目標」で決め、その向きでまだ届いていない目標を今回の目標にする
    const final = written[written.length - 1];
    if (Math.abs(final - weight) >= 0.5) {
      const up = final > weight;
      const pending = up ? written.filter((w) => w > weight + 0.5) : written.filter((w) => w < weight - 0.5);
      const target = pending.length ? (up ? Math.min(...pending) : Math.max(...pending)) : final;
      const passed = up ? written.filter((w) => w <= weight + 0.5) : [];
      const note = passed.length ? `（${plan.fmt(Math.max(...passed))}kgは達成済み）` : '';
      const word = up ? '増量' : '減量';
      return [word, `最終目標${plan.fmt(final)}kgに向けて、次の目標${plan.fmt(target)}kgが現在の${plan.fmt(weight)}kgより${up ? '重い' : '軽い'}ため${word}${note}`];
    }
  }
  const fatMatch = text.match(/体脂肪率?\s*(?:を)?\s*(\d{1,2}(?:\.\d)?)\s*[%％]/);
  if (fatMatch && bodyFat !== null && Number(fatMatch[1]) < bodyFat) {
    return ['減量', `本人が書いた体脂肪率の目標${fatMatch[1]}%が現在の${plan.fmt(bodyFat)}%より低いため減量`];
  }
  if (fatMatch && bodyFat === null) {
    return ['減量', `本人が体脂肪率${fatMatch[1]}%を目標にしているため減量`];
  }
  if (contains(text, CUT_WORDS)) return ['減量', '本人の目標に減量の意思（痩せる・絞る等）があるため減量'];
  if (contains(text, BULK_WORDS)) return ['増量', '本人の目標に増量の意思（増量・筋量を増やす等）があるため増量'];
  if (weight && height) {
    const bmi = weight / ((height / 100) ** 2);
    return bmi < 20 ? ['増量', `BMI ${bmi.toFixed(1)}（20未満）のため増量`] : ['減量', `BMI ${bmi.toFixed(1)}（20以上）のため減量`];
  }
  return ['減量', '手掛かりが無いため既定の減量'];
}

export function decideGoals(weightKg, bodyFatPct, csvWeight, csvFat, csvOther, directionHint = '', goalText = '', heightCm = '') {
  const weight = plan.num(weightKg), height = plan.num(heightCm), bodyFat = plan.num(bodyFatPct);
  const csvW = (csvWeight || '').trim(), csvB = (csvFat || '').trim(), csvO = (csvOther || '').trim();

  if (csvW || csvB || csvO) {
    let direction = null;
    const target = plan.num(csvW);
    if (target !== null && weight !== null && Math.abs(target - weight) >= 0.5) {
      direction = target < weight ? '減量' : '増量';
    }
    let reason = 'CSVに数値目標の記載があるため、その数値をそのまま使用します。';
    if (!direction) {
      const [dir, why] = inferDirection(weight, height, bodyFat, `${csvW} ${csvB} ${csvO} ${goalText}`);
      direction = dir;
      reason += `カロリーの増減は${why}。`;
    }
    return decision({
      weight_goal: csvW || '—', body_fat_goal: csvB || '—', other_goal: csvO || '',
      direction, calorie_delta: direction === '減量' ? -300 : 300, from_csv: true,
    }, 'GL-1', reason);
  }

  if (weight === null) return decision(null, 'GL-0', '体重を読み取れないため目標を算出できません。', { ok: false });

  if (bodyFat === null) {
    if (directionHint === '減量' || directionHint === '増量') {
      const cut = directionHint === '減量';
      return decision({
        weight_goal: `約${fmtNum(cut ? weight - 3 : weight + 3)}kg（約${cut ? '-' : '+'}3kg）`,
        body_fat_goal: '—', other_goal: '', direction: directionHint,
        calorie_delta: cut ? -300 : 300, from_csv: false,
      }, 'GL-4', `体脂肪率が未記入のため、担当者が選んだ方針「${directionHint}」を使用。体脂肪率の目標は「—」で出力します。`);
    }
    const [direction, why] = inferDirection(weight, height, null, goalText);
    return decision({
      weight_goal: '—', body_fat_goal: '—', other_goal: '', direction,
      calorie_delta: direction === '減量' ? -300 : 300, from_csv: false,
    }, 'GL-5',
      `体脂肪率が未記入のため、体重・体脂肪率の数値目標は出しません。カロリーは${why}のため${direction === '減量' ? '-' : '+'}300kcalにしています。`);
  }

  if (bodyFat > 20) {
    return decision({
      weight_goal: `約${fmtNum(weight - 3)}kg（約-3kg）`, body_fat_goal: `約${fmtNum(bodyFat - 3)}%（約-3pt）`,
      other_goal: '', direction: '減量', calorie_delta: -300, from_csv: false,
    }, 'GL-2', `CSVに数値目標なし。体脂肪率${fmtNum(bodyFat)}%は20%超のため減量（-3kg／-3pt／-300kcal）。`);
  }
  return decision({
    weight_goal: `約${fmtNum(weight + 3)}kg（約+3kg）`, body_fat_goal: `約${fmtNum(bodyFat - 3)}%（約-3pt）`,
    other_goal: '', direction: '増量', calorie_delta: 300, from_csv: false,
  }, 'GL-3', `CSVに数値目標なし。体脂肪率${fmtNum(bodyFat)}%は20%以下のため増量（+3kg／-3pt／+300kcal）。`);
}

// --- 3. 眉ケアの分岐 ---------------------------------------------------------
export function decideEyebrow(shape, amount, density) {
  const values = { eyebrow_shape: shape, eyebrow_amount: amount, eyebrow_density: density };
  const label = { eyebrow_shape: '形', eyebrow_amount: '量', eyebrow_density: '濃さ' };
  const artHits = Object.keys(EYEBROW_ARTMAKE).filter((k) => contains(values[k], EYEBROW_ARTMAKE[k]));
  const salonHits = Object.keys(EYEBROW_SALON).filter((k) => contains(values[k], EYEBROW_SALON[k]));
  const detail = `形「${shape || '未記入'}」／量「${amount || '未記入'}」／濃さ「${density || '未記入'}」`;

  if (artHits.length && !salonHits.length) {
    return decision({ care: 'アートメイク', guide: ARTMAKE_GUIDE }, 'EB-1',
      `${detail} → アートメイクの条件（${artHits.map((k) => label[k]).join('・')}）だけが成立。`);
  }
  if (salonHits.length && !artHits.length) {
    return decision({ care: '眉毛サロン', guide: SALON_GUIDE }, 'EB-2',
      `${detail} → 眉毛サロンの条件（${salonHits.map((k) => label[k]).join('・')}）だけが成立。`);
  }
  if (artHits.length && salonHits.length) {
    const salonWins = salonHits.length > artHits.length;
    return decision({ care: salonWins ? '眉毛サロン' : 'アートメイク', guide: salonWins ? SALON_GUIDE : ARTMAKE_GUIDE },
      'EB-3',
      `${detail} → 両方の条件が成立（アートメイク${artHits.length}項目／眉毛サロン${salonHits.length}項目）。該当数の多い方を採用しました。`,
      { tiebreak: true });
  }
  return decision({ care: 'アートメイク', guide: ARTMAKE_GUIDE }, 'EB-0',
    `${detail} → どちらの条件にも当てはまらないため、アートメイクを既定にします。`);
}

// --- 4. 髪の長さと育毛計画 ---------------------------------------------------
export function decideHair(lengthKey, targetLength = '') {
  if (!HAIR_BY_KEY[lengthKey]) {
    return decision(null, 'HR-0', 'ヘア写真を目視して現在の長さを選択してください。', { ok: false });
  }
  const [label, defaultDays] = HAIR_BY_KEY[lengthKey];
  const ruleByKey = { short: 'HR-1', medium_short: 'HR-2', medium: 'HR-3' };

  if (targetLength) {
    const current = label === 'ミディアムロング以上' ? 'ミディアムロング' : label;
    const computed = plan.growPlan(current, targetLength);
    if (computed.grow === true) {
      return decision({
        length: label, days_label: computed.days_label, plan: `${computed.days_label}かけて伸ばす`,
        grow: true, needed_label: computed.needed_label, target_length: targetLength,
      }, ruleByKey[lengthKey] || 'HR-3',
        `現在「${label}」→ 目標スタイルに必要な長さ「${targetLength}」。伸ばす目安 ${computed.days_label}。`);
    }
    if (computed.grow === false) {
      return decision({
        length: label, days_label: '維持', plan: '今の長さのままカットできる', grow: false,
        needed_label: computed.needed_label, target_length: targetLength,
      }, 'HR-5',
        `現在「${label}」は目標スタイルに必要な長さ「${targetLength}」に足りているため、伸ばさずにカットで作ります。`);
    }
  }

  if (lengthKey === 'medium_long_plus') {
    return decision({
      length: label, days_label: '維持', plan: '現在の長さを維持する', grow: false,
      needed_label: plan.LENGTH_LABEL['ミディアムロング'], target_length: 'ミディアムロング',
    }, 'HR-4', `ヘア写真の目視判定「${label}」→ 維持。追加で伸ばす期間は設定しません。`);
  }
  return decision({
    length: label, days_label: defaultDays, plan: `${defaultDays}かけて伸ばす`, grow: true,
    needed_label: plan.LENGTH_LABEL['ミディアムロング'], target_length: 'ミディアムロング',
  }, ruleByKey[lengthKey], `ヘア写真の目視判定「${label}」→ 伸ばす目安 ${defaultDays}。`);
}

// --- 5. 目標ヘアスタイル（顔型 × 印象） --------------------------------------
function matchKey(table, text, fallback = '') {
  for (const [key, words] of Object.entries(table || {})) {
    if ((words || []).some((w) => w && text.includes(w))) return key;
  }
  return fallback;
}

export function decideHairstyle(config, faceShape, impressionRaw, heightCm = '', hairConcerns = '', measured = null) {
  const shapes = config.face_shapes || {};
  const answer = faceShape || '';
  let matched = Object.keys(shapes).filter((key) =>
    (shapes[key].aliases || [key]).some((alias) => alias && answer.includes(alias)));
  let assumed = '';

  if (!matched.length) {
    const estimate = estimateShapeFromMeasure(config, measured);
    if (estimate.shape) { matched = [estimate.shape]; assumed = estimate.why; }
    else { matched = ['たまご型']; assumed = '顔型の記入が無く、顔写真からも測れなかったため、たまご型として提案'; }
  }
  const shapeKey = matched[0];
  const entry = shapes[shapeKey];

  let mixed = null;
  if (matched.length > 1) {
    mixed = (config.mixed_shapes || []).find((rule) =>
      rule.shapes.length === 2 && rule.shapes.every((s) => matched.slice(0, 2).includes(s))) || null;
  }

  const impression = meaningful(impressionRaw);
  const impressionKey = matchKey(config.impressions, impression, 'かっこいい');
  const impressionWhy = impression ? `希望する印象「${impression}」` : '希望する印象が未記入のため既定のかっこいい系';

  const byShape = (config.face_age_by_shape || {})[shapeKey] || {};
  const fromWords = matchKey(config.face_ages, impression, '');
  let faceAgeKey, ageWhy;
  if (fromWords) { faceAgeKey = fromWords; ageWhy = `希望する印象の言葉から${fromWords}向け`; }
  else if (byShape.key) { faceAgeKey = byShape.key; ageWhy = `${shapeKey}は${byShape.why}${byShape.key}向け`; }
  else { faceAgeKey = config.face_age_default || '大人顔'; ageWhy = `手掛かりが無いため${faceAgeKey}向け`; }

  const combo = `${impressionKey}×${faceAgeKey}`;
  const ngWords = String(entry.ng || '').split(/[、,・]/).map((w) => w.trim()).filter(Boolean);
  const avoidLengths = (mixed || {}).avoid_lengths || [];
  const usable = (styles) => (styles || []).filter((style) =>
    !style.avoid && !avoidLengths.includes(style.length) && !ngWords.some((w) => w && style.name.includes(w)));

  let candidates = usable((entry.styles || {})[combo]);
  if (!candidates.length) {
    for (const [other, styles] of Object.entries(entry.styles || {})) {
      if (other.startsWith(impressionKey) && usable(styles).length) { candidates = usable(styles); break; }
    }
  }
  if (!candidates.length) {
    for (const styles of Object.values(entry.styles || {})) {
      if (usable(styles).length) { candidates = usable(styles); break; }
    }
  }
  if (!candidates.length) {
    return decision(null, 'HS-0', `${shapeKey}で提案できるスタイルが知識ベースにありません。`, { ok: false });
  }

  const style = candidates[0];
  const alternates = candidates.slice(1).map((x) => x.name);
  const suffix = (config.label_suffix || {})[combo] || combo;

  const cautions = [entry.point || '', entry.ng ? `避けたいスタイル：${entry.ng}` : '', style.caution || ''];
  if (mixed) cautions.unshift(mixed.caution);
  const height = plan.num(heightCm);
  const heightRule = config.height_rule || {};
  if (height && heightRule.max_cm && height <= heightRule.max_cm) {
    const noTop = cautions.some((x) => x && (x.includes('高さを出さない') || x.includes('高さを出しすぎ')));
    cautions.push(noTop ? heightRule.caution_no_top : heightRule.caution);
  }

  let perm = '';
  if (!contains(hairConcerns || '', ['くせ毛', '癖毛', 'うねり', 'パーマ', '縮毛'])) {
    for (const rule of config.perm_guide || []) {
      if (rule.shape !== shapeKey) continue;
      const words = (rule.style_words || []).filter(Boolean);
      if (!words.length || words.some((w) => style.name.includes(w))) { perm = rule.perm || ''; break; }
    }
  }

  const values = {
    face_shape: shapeKey, face_shapes_matched: matched, impression: impressionKey, face_age: faceAgeKey,
    style: style.name, point: entry.policy || '', order: style.order || '',
    caution: cautions.filter(Boolean).join('　'), perm, alternates,
    label: `${shapeKey}×${impressionKey}系（${suffix}）`,
    photo: style.photo || '', photo_borrowed: Boolean(style.photo_borrowed),
    length: style.length || '', figure: entry.figure || '', photo_measure: measured,
  };
  let reason = `顔型「${shapeKey}」${mixed ? `（${matched.join('×')}のミックス）` : ''}／${impressionWhy}→${impressionKey}系／${ageWhy} → 「${style.name}」（必要な長さ：${style.length || '—'}）を選定。`;
  if (assumed) reason += `${assumed}。`;
  if (alternates.length) reason += `同じタイプの別案：${alternates.join('・')}。`;
  return decision(values, style.id, reason);
}

/** 顔型の記入が無いとき、顔写真の実測（縦÷横）から顔型を推定する。 */
export function estimateShapeFromMeasure(config, measured) {
  const setting = config.photo_estimate || {};
  if (!setting.enabled || !measured || !measured.ok || measured.ratio == null) return { shape: '', why: '' };
  const ratio = measured.ratio;
  if (ratio >= (setting.long_min ?? 1.55)) return { shape: '面長', why: `顔写真の実測（縦÷横=${ratio}）が面長の範囲` };
  if (ratio <= (setting.round_max ?? 1.28)) return { shape: '丸顔', why: `顔写真の実測（縦÷横=${ratio}）が丸顔の範囲` };
  return { shape: setting.fallback || 'たまご型', why: `顔写真の実測（縦÷横=${ratio}）は中間のため、何でも似合うたまご型として扱う` };
}

// --- 6. カロリー・PFC --------------------------------------------------------
export function decideNutrition(maintenanceKcal, weightKg, heightCm, age, frequency, calorieDelta) {
  const values = plan.nutrition(weightKg, heightCm, age, frequency, calorieDelta, maintenanceKcal);
  if (!values) {
    return decision(null, 'NT-0', '体重・身長・年齢のいずれかが読み取れないため、目標カロリーを算出できません。', { ok: false });
  }
  const override = plan.num(maintenanceKcal) ? ' ※維持カロリーは手入力値で上書き' : '';
  return decision({
    maintenance_kcal: values.tdee, target_kcal: values.target_kcal, bmr: values.bmr, delta: calorieDelta,
    pfc: { protein_g: values.protein_g, fat_g: values.fat_g, carb_g: values.carb_g },
  }, 'NT-1',
    `基礎代謝${values.bmr}kcal（Mifflin-St Jeor）× 活動係数${values.activity_factor}`
    + ` = 維持${values.tdee}kcal。方針の${calorieDelta > 0 ? '+' : '-'}${Math.abs(calorieDelta)}kcalを適用し目標${values.target_kcal}kcal。`
    + `P ${values.protein_g}g／F ${values.fat_g}g／C ${values.carb_g}g。${override}`);
}

// --- まとめ ------------------------------------------------------------------
/** 担当者が書いたスタイル名から、必要な長さをナレッジで引く。 */
export function styleLengthFor(config, styleName) {
  return (styleEntryFor(config, styleName) || {}).length || '';
}

/**
 * カルテ1件ぶんの判定をまとめて出す（Python版 decide_all と同じ順序・同じ入力）。
 * overrides は担当者の承認付き上書き。phaseOverride は月次更新で進めたPhase。
 */
export function decideAll(manifest, options = {}) {
  const { hairstyleConfig, hairLengthKey = '', maintenanceKcal = '', overrides = {},
    directionHint = '', measured = null, phaseOverride = '', now = '' } = options;
  const member = manifest.member || {};
  const fields = manifest.fields || {};
  const raw = (key) => ((fields[key] || {}).raw) || '';

  const training = decideTraining(raw('current_status'), raw('current_frequency'));
  if (phaseOverride && (training.value || {}).phase && phaseOverride !== training.value.phase) {
    const before = training.value.phase;
    training.value = { ...training.value, phase: phaseOverride };
    training.heading = `${phaseOverride} トレーニングメニュー（週${training.value.frequency}回）`;
    training.evidence += `　月次更新で ${before} → ${phaseOverride} に進めています。`;
  }

  const result = {
    training,
    eyebrow: decideEyebrow(raw('eyebrow_shape'), raw('eyebrow_amount'), raw('eyebrow_density')),
  };
  result.hairstyle = decideHairstyle(hairstyleConfig, raw('hair_face_shape'),
    raw('hair_desired_impression'), member.height_cm || '', raw('hair_concerns'), measured);

  let styleLength = ((result.hairstyle.value || {}).length) || '';
  const operatorStyle = (manifest.hair || {}).hair_target_style || '';
  // 担当者がスタイル名を書いた場合は、そのスタイルに必要な長さを優先する
  if (meaningful(operatorStyle)) styleLength = styleLengthFor(hairstyleConfig, operatorStyle) || styleLength;
  result.hair = decideHair(hairLengthKey, styleLength);

  const goalText = ['qualitative_goal', 'roadmap_1m', 'roadmap_3m', 'roadmap_6m', 'roadmap_1y',
    'roadmap_final', 'vision_training', 'concerns_training'].map(raw).join(' ');
  result.goals = decideGoals(member.weight_kg || '', member.body_fat_pct || '',
    raw('weight_goal_from_csv'), raw('body_fat_goal_from_csv'), raw('other_goal_from_csv'),
    directionHint, goalText, member.height_cm || '');

  const delta = (result.goals.value || {}).calorie_delta || 0;
  const frequency = ((result.training.value || {}).frequency) || 2;
  result.nutrition = decideNutrition(maintenanceKcal, member.weight_kg || '',
    member.height_cm || '', member.age || '', frequency, delta);

  for (const [key, override] of Object.entries(overrides || {})) {
    if (!result[key] || !override) continue;
    if (!(override.reason && override.approver && override.value)) continue;
    result[key] = {
      value: override.value, rule_id: `${result[key].rule_id}-OVR`,
      evidence: `ルール判定を承認付きで上書き：${override.reason}`,
      resolved: true, source: 'override',
      override: { reason: override.reason, approver: override.approver,
        at: override.at || now, replaced: result[key].value },
    };
    if (key === 'training' && override.value && typeof override.value === 'object') {
      result[key].heading = `${override.value.phase} トレーニングメニュー（週${override.value.frequency}回）`;
    }
  }

  result.unresolved = ['training', 'goals', 'eyebrow', 'hair', 'nutrition']
    .filter((name) => !result[name].resolved)
    .map((name) => `${name}：${result[name].evidence}`);
  return result;
}

// カルテ5枚に差し込む値をすべて組み立てる。
// 判定結果（rules.js）と本人の回答（manifest）から、テンプレートの190項目を作る。

import * as plan from './plan.js?v=20260908145508';
import * as fig from './figure.js?v=20260908145508';
import * as menuMod from './menu.js?v=20260908145508';
import { productContext, styleEntryFor, looksLikeStyle } from './products.js?v=20260908145508';
import { meaningful } from './text.js?v=20260908145508';

const NAV_ITEMS = [
  ['1', '基本情報 & ゴール設定'], ['2', '美容カルテ'], ['3', '筋トレカルテ'],
  ['4', 'ヘアスタイルカルテ'], ['5', 'ルーティン & タスク管理'],
];
const HAIR_MORNING = [['1', '根元からしっかり濡らす'], ['2', 'オイル'], ['3', 'アイロン（低温）'], ['4', 'スタイリング']];
const HAIR_NIGHT = [['1', 'シャンプー'], ['2', 'トリートメント'], ['3', 'ドライヤー']];

const SKIN_POINT = {
  '普通肌': '皮脂と水分のバランスは良好。季節の変わり目の乾燥に注意する。',
  '乾燥肌': '粉吹き・つっぱりが出やすい。保湿を重ねて水分を閉じ込める。',
  '脂性肌': 'テカり・毛穴が気になる。皮脂を落としすぎず、water分を保つ。',
  '混合肌': 'Tゾーンは皮脂、Uゾーンは乾燥。部位でケアを変える。',
};
const DEFAULT_SKIN_POINT = '肌の状態に合わせて、落とす・入れる・閉じ込めるの順で整える。';

// 3ヶ月目標サマリーの各分野に、本人が書いた目標のうち関係する文だけを拾うための語。
const DOMAIN_WORDS = {
  training: ['体重', '体脂肪', '筋トレ', 'トレーニング', 'ジム', '筋肉', '腹筋', 'ベンチプレス', 'スクワット',
    'デッドリフト', '懸垂', '体型', 'マッチョ', '細く', '痩せ', '減量', '増量', 'kg', 'ｋｇ'],
  beauty: ['肌', 'スキンケア', '眉', 'ニキビ', '髭', 'ヒゲ', '日焼け', '清潔感', '毛穴', '洗顔', '爪', '美容'],
  hair: ['髪', 'ヘア', '美容室', '美容院', '髪型', 'スタイリング', 'パーマ', 'カット', '白髪'],
  meal: ['食事', 'カロリー', 'PFC', 'たんぱく質', 'タンパク質', '糖質', '自炊', '間食', '飲酒', 'お酒', '食生活'],
};
// 「、」区切りだけの箇条書き（例「体脂肪率10%、TOEIC800点、スタクラ生徒3人」）も
// 1件ずつに分ける。分けないと、分野に関係ない内容まで丸ごと入ってしまう。
const CLAUSE_SPLIT = /[。、，,\n／/]+|[\s　]+/;
const WEIGHT_GOAL_RE = /体重\s*(?:を)?\s*(\d{2,3}(?:\.\d)?)\s*(?:kg|キロ|㎏)/;
const BODYFAT_GOAL_RE = /体脂肪率?\s*(?:を)?\s*(\d{1,2}(?:\.\d)?)\s*[%％]|体脂肪率?\s*(?:を)?\s*(\d{1,2})\s*パーセント/;
const ROADMAP_HORIZONS = [['roadmap_1m', '1ヶ月後'], ['roadmap_3m', '3ヶ月後'], ['roadmap_6m', '半年後'], ['roadmap_1y', '1年後']];
const D = '[0-9０-９]';
const TRAILING_DATE_RE = new RegExp(`[\\s/／、,]*20${D}{2}\\s*年\\s*${D}{1,2}\\s*月(?:\\s*(?:末|初|中旬|下旬|上旬|頃))?\\s*$`);
const HORIZON_INDEX = { '1ヶ月後': 1, '3ヶ月後': 3, '半年後': 6 };

/** 単位の二重表示を防ぐ。空欄は「—」のまま返す。 */
export function withUnit(value, unit) {
  const text = String(value ?? '').trim();
  if (!text || text === '—' || text === '特になし') return text || '—';
  const normalized = text.replace('％', '%');
  if (unit && normalized.toLowerCase().trimEnd().endsWith(unit.toLowerCase())) return normalized;
  if (unit === '%' && normalized.includes('%')) return normalized;
  return `${normalized}${unit}`;
}

/** 受講生が本文に書いた期日を取り除く（期限の列と食い違うため）。 */
function cleanRoadmap(text) {
  const original = String(text ?? '').trim();
  const cleaned = original.replace(TRAILING_DATE_RE, '').replace(/[　\s/／、,]+$/, '');
  const removed = cleaned !== original ? original.slice(cleaned.length).trim() : '';
  return [cleaned || original, removed];
}

function raw(manifest, key) {
  return ((manifest.fields || {})[key] || {}).raw || '';
}

/** 本人が書いた目標から、その分野に関係する文だけを取り出す。 */
export function pickClauses(text, domain) {
  const words = DOMAIN_WORDS[domain] || [];
  return String(text || '').split(CLAUSE_SPLIT)
    .map((c) => c.replace(/^[、\s　]+|[、\s　]+$/g, ''))
    .filter((c) => c && words.some((w) => c.includes(w)))
    .join('。');
}

/** 本人が書いた目標から、体重・体脂肪率の数値を拾う。 */
export function memberWrittenGoals(manifest) {
  const found = { weight: null, body_fat: null, m3_text: '' };
  const sources = [
    [raw(manifest, 'weight_goal_from_csv'), ''],
    [raw(manifest, 'body_fat_goal_from_csv'), ''],
    [raw(manifest, 'other_goal_from_csv'), ''],
  ];
  for (const [key, horizon] of ROADMAP_HORIZONS) {
    const [text] = cleanRoadmap(raw(manifest, key));
    sources.push([text, horizon]);
    if (key === 'roadmap_3m') found.m3_text = text;
  }
  for (const [text, horizon] of sources) {
    if (!text) continue;
    if (!found.weight) {
      const hit = text.match(WEIGHT_GOAL_RE);
      if (hit) found.weight = { value: `${hit[1]}kg`, horizon };
    }
    if (!found.body_fat) {
      const hit = text.match(BODYFAT_GOAL_RE);
      if (hit) found.body_fat = { value: `${hit[1] || hit[2]}%`, horizon };
    }
  }
  return found;
}

function shortGoal(value) {
  const head = String(value ?? '').split('（')[0].trim();
  return head && head !== '—' ? `目標 ${head}` : '—';
}

/** 「1行1件」の悩みを {title, detail} に分解する。 */
function concernList(rawText, fallback) {
  const lines = String(rawText || '').replace(/／/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [{ title: fallback, detail: '' }];
  return lines.map((line) => {
    for (const sep of ['｜', '|', '：', ':']) {
      const at = line.indexOf(sep);
      if (at >= 0) return { title: line.slice(0, at).trim(), detail: line.slice(at + 1).trim() };
    }
    return { title: line, detail: '' };
  });
}

/** 成長推移グリッド1行分。履歴にある月は実測値を入れる。 */
function progressRow(months, history, key) {
  return months.map((month) => {
    const entry = (history || {})[month.key] || {};
    const value = String(entry[key] ?? '').trim();
    return value ? plan.fmt(plan.num(value), 1) : '';
  });
}

export function buildContext(input) {
  const { manifest, decisions, menuBlocks, photos, track = 'weight', progress = {},
    hairstyleConfig, productMaster, assets = { hairstyles: [], faceshapes: [] } } = input;

  const member = manifest.member, beauty = manifest.beauty;
  const trainingSrc = manifest.training, hairSrc = manifest.hair;
  const goalsSrc = manifest.goals || {}, roadmapSrc = manifest.roadmap || {}, visionSrc = manifest.vision || {};

  const training = decisions.training.value;
  const goals = decisions.goals.value;
  const eyebrow = decisions.eyebrow.value;
  const hair = decisions.hair.value;
  const hairstyle = (decisions.hairstyle || {}).value || {};
  const frequency = Number(training.frequency);
  const joinMonth = member.join_month;

  // --- 目標の数値（本人が書いたものを優先する） ---
  const written = memberWrittenGoals(manifest);
  const currentBf = String(member.body_fat_pct ?? '').trim();
  const hasCurrentBf = Boolean(currentBf) && currentBf !== '—';
  const goalValue = (decided, fallback) => {
    const text = String(decided ?? '').trim();
    if (text && text !== '—') return text;
    if (fallback) return fallback.horizon ? `${fallback.value}（${fallback.horizon}）` : fallback.value;
    return '';
  };
  const goalWeightText = goalValue(goals.weight_goal, written.weight);
  const goalBfText = goalValue(goals.body_fat_goal, written.body_fat);
  const fromWrittenWeight = Boolean(written.weight) && ['', '—'].includes(String(goals.weight_goal || '—').trim());
  const weightGoalIndex = fromWrittenWeight ? HORIZON_INDEX[written.weight.horizon] ?? null : 3;
  const fromWrittenBf = Boolean(written.body_fat) && ['', '—'].includes(String(goals.body_fat_goal || '—').trim());
  const bfGoalIndex = fromWrittenBf ? HORIZON_INDEX[written.body_fat.horizon] ?? null : 3;
  const hasBodyFat = Boolean(hasCurrentBf || goalBfText);

  const pair = (weightText, bfText) => {
    const parts = [weightText ? `体重 ${weightText}` : ''];
    if (hasBodyFat && bfText) parts.push(`体脂肪率 ${bfText}`);
    return parts.filter(Boolean).join('・') || '—';
  };
  const currentBodyLine = pair(withUnit(member.weight_kg, 'kg'), hasCurrentBf ? withUnit(currentBf, '%') : '');

  // 定量的ゴール：本人が書いた3ヶ月目標（数値を含むもの）＋体重・体脂肪率の目標
  const m3Text = written.m3_text;
  const m3IsWeightGoal = Boolean(written.weight) && written.weight.horizon === '3ヶ月後';
  const m3Training = pickClauses(m3Text, 'training');
  const ownNumeric = Boolean(m3Training && /\d/.test(m3Training)) && !m3IsWeightGoal;
  const quantParts = [];
  if (ownNumeric) quantParts.push(m3Training);
  if (goalWeightText && !(ownNumeric && m3Training.includes('体重'))) quantParts.push(`体重 ${goalWeightText}`);
  if (hasBodyFat && goalBfText && !(ownNumeric && m3Training.includes('体脂肪'))) quantParts.push(`体脂肪率 ${goalBfText}`);
  const goalBodyLine = quantParts.join('・') || '—';
  const m3ByDomain = Object.fromEntries(Object.keys(DOMAIN_WORDS).map((k) => [k, pickClauses(m3Text, k)]));

  // --- 栄養 ---
  const nutrition = plan.nutrition(member.weight_kg, member.height_cm, member.age, frequency, goals.calorie_delta || 0) || {};

  // --- DAYカード ---
  const days = menuMod.dayPlan(menuBlocks, training.phase, frequency, track).map((day, index) => ({
    day: day.day, day_label: day.day_label, weekday: plan.dayOfWeekFor(index, frequency),
    title: day.title, parts_text: day.parts.join('・'),
    figure_svg: fig.bodyFigure(day.parts, 44), legend: fig.legend(day.parts),
    exercises: day.exercises.map((e) => {
      const [name, reps] = menuMod.splitReps(e.name);
      return { name, reps, color: fig.partColor(e.part), tint: fig.partTint(e.part) };
    }),
  }));

  // --- 期限・推移 ---
  const due = plan.deadlines(joinMonth);
  const roadmap = [], removedDates = [];
  for (const [scene, key, deadline, hi] of [
    ['1ヶ月後', 'roadmap_1m', due.m1, 'hi'],
    ['3ヶ月後 ★最重要', 'roadmap_3m', due.m3, 'hi'],
    ['半年後', 'roadmap_6m', due.m6, ''],
    ['1年後', 'roadmap_1y', due.y1, ''],
    ['最終ゴール', 'roadmap_final', '—', ''],
  ]) {
    const [text, removed] = cleanRoadmap(roadmapSrc[key] || '');
    if (removed) removedDates.push(`${scene}：本文の日付「${removed}」を削除（期限は${deadline}）`);
    roadmap.push({ scene, text, deadline, hi });
  }

  const months = plan.progressMonths(joinMonth, 7);
  const measuredW = progressRow(months, progress, 'weight_kg');
  const measuredB = progressRow(months, progress, 'body_fat_pct');
  const weightRow = [], bfRow = [];
  months.forEach((month, index) => {
    if (index === 0) {
      weightRow.push({ v: plan.fmt(plan.num(member.weight_kg), 1), hi: 'hi' });
      bfRow.push({ v: plan.fmt(plan.num(member.body_fat_pct), 1), hi: 'hi' });
      return;
    }
    const hitW = index === weightGoalIndex, hitB = index === bfGoalIndex;
    weightRow.push({ v: measuredW[index] || (hitW ? shortGoal(goalWeightText) : ''), hi: (measuredW[index] || hitW) ? 'hi' : '' });
    bfRow.push({ v: measuredB[index] || (hitB ? shortGoal(goalBfText) : ''), hi: (measuredB[index] || hitB) ? 'hi' : '' });
  });

  // --- ヘア ---
  const schedule = plan.hairSchedule(hair.days_label, joinMonth);
  const timeline = schedule.timeline.map((step) => ({ ...step, on: ['現在', '目標'].includes(step.t) ? 'on' : '' }));

  const operatorInput = meaningful(hairSrc.hair_target_style || '');
  const operatorStyle = looksLikeStyle(hairstyleConfig, operatorInput) ? operatorInput : '';
  const styleName = operatorStyle || hairstyle.style || '—';
  const matched = operatorStyle ? styleEntryFor(hairstyleConfig, operatorStyle) : {};
  const photoFile = matched.photo || hairstyle.photo || '';
  const stylePhoto = photoFile && assets.hairstyles.includes(photoFile) ? `assets/hairstyles/${photoFile}` : '';
  const impression = meaningful(hairSrc.hair_desired_impression || '');
  const orderText = operatorStyle
    ? (matched.order || [operatorStyle, impression].filter(Boolean).join('。'))
    : (hairstyle.order || [styleName, impression].filter(Boolean).join('。') || '—');

  const rawCutPlace = hairSrc.hair_cut_place || '—';
  const cutPlace = (rawCutPlace.includes('理容') || rawCutPlace.includes('床屋') || ['—', ''].includes(rawCutPlace))
    ? '美容室' : rawCutPlace;

  const products = productContext(productMaster, beauty.skin_type, styleName,
    hairSrc.hair_desired_impression || '', hairSrc.hair_concerns || '');

  // ヘアの「今すぐやること」。伸ばしている期間に「今すぐ美容室を予約」は矛盾するため出し分ける。
  const taskConfig = hairstyleConfig.tasks || {};
  const hairTasks = [...(taskConfig.common || []), ...(taskConfig[hair.grow ? 'growing' : 'ready'] || [])]
    .map((r) => ({ t: String(r.title).replace('{buy}', products.hair_buy_task), note: r.note || '' }));

  const steps = products.hair_steps || {};
  const buildSteps = (key, fallback, gold) => {
    const rows = products.show_products ? steps[key] : null;
    const list = rows
      ? rows.map((r) => ({ n: r[0], t: r[1], note: r[2] || '', gold: gold.includes(r[0]) ? 'gold' : '' }))
      : fallback.map(([n, t]) => ({ n, t, note: '', gold: gold.includes(n) ? 'gold' : '' }));
    return list.map((s) => ({ ...s, note: s.note.replace('{styling}', products.styling_item.name) }));
  };
  const hairMorning = buildSteps('morning', HAIR_MORNING, ['1', '4']);
  const hairNight = buildSteps('night', HAIR_NIGHT, ['1']);

  // --- ルーティン ---
  const proteinMealG = nutrition.protein_g ? plan.fmt(plan.num(nutrition.protein_g) / 3, 1) : '—';
  const dailyMorning = [
    { t: '洗顔（洗顔）', tag: '美容' }, { t: '化粧水・乳液', tag: '美容' },
    { t: '日焼け止めを塗る', tag: '美容' }, { t: '髪を濡らして乾かす → スタイリング', tag: 'ヘア' },
    { t: hasBodyFat ? '体重・体脂肪率を記録する' : '体重を記録する', tag: '筋トレ' },
    { t: `高たんぱく朝食（たんぱく質${proteinMealG}g以上）`, tag: '食事' },
  ];
  const dailyNight = [
    { t: 'クレンジング', tag: '美容' }, { t: '洗顔 → 化粧水 → 美容液 → 乳液', tag: '美容' },
    { t: 'シャンプー → トリートメント → ドライヤー', tag: 'ヘア' },
    { t: '食事記録（カロリー・PFC）', tag: '食事' }, { t: '23時就寝（夜更かし禁止）', tag: '習慣' },
  ];

  // 自宅トレの人は、まずジム契約を最初のタスクにする
  const gymContract = track === 'bodyweight';
  const onetime = [
    ...(gymContract ? [{ t: 'ジムに契約する', tag: '筋トレ' }] : []),
    { t: products.skincare_buy_task, tag: '美容' },
    { t: products.sunscreen_task, tag: '美容' },
    { t: products.nail_task, tag: '美容' },
    { t: products.hair_buy_task, tag: 'ヘア' },
    { t: 'カロリー管理アプリを導入する', tag: '筋トレ' },
    { t: `${gymContract ? '自宅' : 'ジム'}でのトレーニングを週${frequency}回に設定する`, tag: '筋トレ' },
  ];

  const weekly = plan.weeklySchedule(days, frequency);
  const isArtmake = eyebrow.care === 'アートメイク';
  const venue = gymContract ? '自宅' : 'ジム';
  const nameDisplay = !['', '—'].includes(member.nickname) ? `${member.name}（${member.nickname}）` : member.name;
  const age = withUnit(member.age, '歳'), height = withUnit(member.height_cm, 'cm'), weight = withUnit(member.weight_kg, 'kg');

  return {
    // 本人特定・見出し
    mid: member.mid, name: member.name, nickname: member.nickname, join_month: joinMonth,
    name_display: nameDisplay,
    join_month_text: !['', '—'].includes(joinMonth) ? `${joinMonth}入会` : '—',
    age, height_cm: height, weight_kg: weight, body_fat_pct: withUnit(member.body_fat_pct, '%'),
    body_line: `${age} / ${height} / ${weight}`, body_line3: `${weight} / ${height} / ${age}`,
    occupation: member.occupation, reason_for_joining: member.reason_for_joining,
    things_to_stop: member.things_to_stop, qualitative_goal: goalsSrc.qualitative_goal,
    nav: NAV_ITEMS.map(([no, label]) => ({ no, label, on: '' })),
    // ゴール
    roadmap, roadmap_removed: removedDates, deadline_3m: due.m3,
    vision: [
      { icon: '💪', title: '筋トレ・食事', text: visionSrc.vision_training || '' },
      { icon: '✨', title: '美容（清潔感・スキンケア）', text: visionSrc.vision_beauty || '' },
      { icon: '💈', title: 'ヘアスタイル', text: visionSrc.vision_hair || '' },
      { icon: '👔', title: 'ファッション', text: visionSrc.vision_fashion || '' },
    ],
    vision_impression: visionSrc.vision_impression || '',
    progress_months: months, weight_row: weightRow, bf_row: bfRow,
    has_body_fat: hasBodyFat, current_body_line: currentBodyLine, goal_body_line: goalBodyLine,
    goal_weight: goalWeightText || '—', goal_body_fat: goalBfText || '—',
    goal_direction: goals.direction,
    summary3m: [
      { icon: '💪', title: '筋トレ', text: m3ByDomain.training || goalBodyLine, freq: `毎日：体重を記録${hasBodyFat ? '・体脂肪率も記録' : ''}` },
      { icon: '✨', title: '美容', text: m3ByDomain.beauty || '正しいスキンケア習慣を確立する', freq: '毎朝夜：洗顔→化粧水→乳液' },
      { icon: '💈', title: 'ヘアスタイル', text: m3ByDomain.hair || hair.plan, freq: '毎日：朝のセットを習慣化' },
      { icon: '🥗', title: '食事', text: m3ByDomain.meal || `1日 ${nutrition.target_kcal || '—'}kcal・PFC記録を習慣化する`, freq: '毎食：PFCをアプリで記録' },
    ],
    // 美容
    skin_type: beauty.skin_type, current_skincare: beauty.current_skincare,
    procedure_routine: beauty.procedure_routine,
    eyebrow_shape: beauty.eyebrow_shape, eyebrow_amount: beauty.eyebrow_amount, eyebrow_density: beauty.eyebrow_density,
    eyebrow_care: eyebrow.care, eyebrow_guide: eyebrow.guide,
    skin_point: products.skin_point_master || SKIN_POINT[String(beauty.skin_type).trim()] || DEFAULT_SKIN_POINT,
    acne_notice: '',   // 呼び出し側で rules.ACNE_NOTICE を入れる
    morning_routine: '', night_routine: products.night_routine,
    artmake_class: isArtmake ? 'on' : 'off', salon_class: isArtmake ? 'off' : 'on',
    artmake_badge: isArtmake ? '✓ 該当' : '参考', salon_badge: isArtmake ? '参考' : '✓ 該当',
    artmake_reason: '眉が薄い・少ない・形が整っていないため、プロに形を作ってもらうことが最優先。自己処理は一旦ストップ。',
    salon_reason: '眉が多く・濃いため、プロに形を作ってもらうことが最優先。自己処理は一旦ストップ。',
    artmake_cta: isArtmake ? eyebrow.guide : '（今回は対象外）',
    salon_cta: isArtmake ? '（今回は対象外）' : eyebrow.guide,
    concerns_beauty_list: concernList(raw(manifest, 'concerns_beauty'), beauty.beauty_concerns || '特になし'),
    ...products,
    // 筋トレ
    current_location: trainingSrc.current_location, current_frequency: trainingSrc.current_frequency,
    current_status: trainingSrc.current_status,
    current_location_note: `現在：${trainingSrc.current_location}（${trainingSrc.current_frequency}）`,
    exercise_time_weekday: trainingSrc.exercise_time_weekday, exercise_time_holiday: trainingSrc.exercise_time_holiday,
    injury_or_condition: trainingSrc.injury_or_condition,
    injury_caution: !['特になし', '—', ''].includes(trainingSrc.injury_or_condition)
      ? `ケガ・持病あり：${trainingSrc.injury_or_condition}。痛みが出る種目は無理をしない。`
      : 'フォームを動画で確認してから行う。',
    frequency, phase: training.phase, days, venue, venue_note: `${venue}で実施する`,
    menu_heading: decisions.training.heading || `${training.phase} トレーニングメニュー（週${frequency}回）`,
    goal_policy: !goals.calorie_delta ? goals.direction
      : `${goals.direction}（${goals.calorie_delta > 0 ? '+' : '-'}${Math.abs(goals.calorie_delta)} kcal）`,
    goal_summary: goalBodyLine, gym_contract: gymContract,
    bmr: nutrition.bmr || '—', target_kcal: nutrition.target_kcal || '—',
    per_meal_kcal: nutrition.per_meal_kcal || '—', calorie_basis: nutrition.delta_text || '—',
    protein_g: nutrition.protein_g || '—', fat_g: nutrition.fat_g || '—', carb_g: nutrition.carb_g || '—',
    protein_kcal: nutrition.protein_kcal || '—', fat_kcal: nutrition.fat_kcal || '—', carb_kcal: nutrition.carb_kcal || '—',
    protein_kcal_meal: nutrition.protein_kcal_meal || '—', fat_kcal_meal: nutrition.fat_kcal_meal || '—',
    carb_kcal_meal: nutrition.carb_kcal_meal || '—',
    protein_pct: nutrition.protein_pct || 0, fat_pct: nutrition.fat_pct || 0, carb_pct: nutrition.carb_pct || 0,
    protein_note: nutrition.protein_note || '—', fat_note: nutrition.fat_note || '—', carb_note: nutrition.carb_note || '—',
    protein_meal_g: proteinMealG,
    concerns_training_list: concernList(raw(manifest, 'concerns_training'), trainingSrc.training_concerns || '特になし'),
    // ヘア
    hair_face_shape: hairSrc.hair_face_shape || '—',
    hair_desired_impression: hairSrc.hair_desired_impression || '—',
    hair_target_style: styleName, hair_style_label: hairstyle.label || '',
    style_photo: stylePhoto,
    style_photo_note: (hairstyle.photo_borrowed && !operatorStyle) ? '参考写真（同系統スタイル）' : '',
    face_figure: hairstyle.figure && assets.faceshapes.includes(hairstyle.figure) ? `assets/faceshapes/${hairstyle.figure}` : '',
    hair_style_point: operatorStyle ? '' : (hairstyle.point || ''),
    hair_style_caution: hairstyle.caution || '', hair_style_perm: hairstyle.perm || '',
    hair_style_alt: (hairstyle.alternates || []).join('・'),
    hair_cut_place: cutPlace, hair_order_text: orderText,
    hair_length: hair.length, hair_needed_length: hair.needed_label || '—',
    hair_days_label: hair.days_label, hair_plan: hair.plan,
    hair_cm_label: schedule.cm_label, hair_headline: schedule.headline,
    hair_headline_unit: schedule.headline_unit, hair_note: schedule.note,
    hair_months_label: schedule.months_label, hair_timeline: timeline,
    hair_policy: schedule.policy, hair_cut_rule: schedule.cut_rule,
    hair_target_month: timeline[timeline.length - 1].v,
    hair_tasks: hairTasks, hair_morning: hairMorning, hair_night: hairNight,
    hair_morning_flow: hairMorning.map((x) => x.t).join(' → '),
    hair_night_flow: hairNight.map((x) => x.t).join(' → '),
    styling_frequency: hairSrc.styling_frequency || '—',
    concerns_hair_list: concernList(raw(manifest, 'concerns_hair'), hairSrc.hair_concerns || '特になし'),
    // ルーティン
    daily_morning: dailyMorning, daily_night: dailyNight, onetime,
    weekdays: weekly.weekdays,
    week_training: weekly.cells.map((c) => ({ v: c.training ? c.label : 'REST', hi: c.training ? 'hi' : '' })),
    week_morning: Array(7).fill('洗顔 / スキンケア / UV'),
    week_night: Array(7).fill('クレンジング / 洗顔 / スキンケア'),
    goal3m: [
      { icon: '💪', title: '筋トレ・食事', lines: [
        m3ByDomain.training || (goalWeightText ? `体重 ${goalWeightText}` : ''),
        (hasBodyFat && goalBfText) ? `体脂肪率 ${goalBfText}` : '',
        `週${frequency}回の${gymContract ? '自重トレ' : 'ジム'}習慣化`, '毎食たんぱく質を意識',
      ].filter(Boolean) },
      { icon: '✨', title: '美容・清潔感', lines: ['朝夜のスキンケア習慣の確立', `${eyebrow.care}で眉を整える`, '毎朝の日焼け止めを習慣化', '爪・肌・ニオイを整える'] },
      { icon: '💈', title: 'ヘアスタイル', lines: [hair.plan, '毎朝スタイリングの習慣化', 'ケア方法を習得', '毎月ヘアの状態を確認'] },
    ],
    progress_months6: months.slice(0, 6), weight_row6: weightRow.slice(0, 6), bf_row6: bfRow.slice(0, 6),
    freq_row6: months.slice(0, 6).map((m, i) => ({ v: i === 0 ? `週${frequency}` : '', hi: i === 0 ? 'hi' : '' })),
    // 写真
    photo_overview: photos.overview || '', photo_face: photos.face || '', photo_hair: photos.hair || '',
    photo_training_front: photos.training_front || '', photo_training_side: photos.training_side || '',
    photo_training_back: photos.training_back || '',
  };
}

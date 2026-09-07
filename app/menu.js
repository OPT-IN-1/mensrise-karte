// トレーニングプログラム（Markdown）の読み込み。
//   ## 週２自重トレーニングプラン / ## 週２ウエイトトレーニングプラン /
//   ## 週3〜4ウエイトトレーニングプラン の3系統を
//   (track, frequency, phase, day) で引けるようにする。
// 種目・順序・回数は原本どおりに採用し、個人の回答で変更しない。

// 種目名から対象部位を判定する（Markdownには部位列が無いため）。
// 上から順に判定する。「レッグエクステンション」を腕と誤判定しないよう脚を先に置く。
const PART_KEYWORDS = [
  ['腹筋', ['シットアップ', 'クランチ', 'レッグレイズ', 'ロシアンツイスト', 'アブローラー',
    'ドラゴンフラッグ', 'vシット', 'トゥータッチ', 'ハンギング', 'バイシクル']],
  ['脚', ['スクワット', 'ヒップリフト', 'レッグエクステンション', 'レッグカール',
    'スティフデッドリフト', 'シシー', 'ランジ', 'レッグプレス']],
  ['肩', ['ショルダープレス', 'サイドレイズ', 'フロントレイズ', 'アップライトローイング',
    'リアデルト', 'リアレイズ', 'フェイスプル', 'パイクプッシュアップ']],
  ['上腕二頭筋', ['カール']],
  ['上腕三頭筋', ['プレスダウン', 'エクステンション', 'フレンチプレス', 'ナロープッシュアップ',
    'リバースプッシュアップ', 'ダイヤモンドプッシュアップ', 'ナロープレス', 'ディップス']],
  ['背中', ['ラットプルダウン', 'ラッドプルダウン', 'ローイング', 'チンニング', 'デッドリフト',
    'tバー', 'ベントオーバー', 'プルオーバー']],
  ['胸', ['ベンチプレス', 'チェストプレス', 'ペックフライ', 'ダンベルフライ', 'プッシュアップ',
    'インクラインプレス', 'インクラインダンベルプレス', 'フライ']],
];

export const TRACK_LABEL = { weight: 'ウエイト（ジム）', bodyweight: '自重（自宅）' };

export function guessPart(name) {
  const text = String(name).normalize('NFKC').toLowerCase();
  for (const [part, words] of PART_KEYWORDS) {
    if (words.some((w) => text.includes(w))) return part;
  }
  return '胸';
}

export function parseMenu(markdown) {
  const blocks = new Map();          // "track|freq|phase|day" -> {title, exercises}
  let track = null, frequency = null, phase = null, key = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.normalize('NFKC').replace(/\\&/g, '&').trim();
    if (!line) continue;

    if (line.startsWith('#')) {
      const heading = line.replace(/^#+/, '').replace(/\*/g, '').trim();
      if (heading.includes('自重') && heading.includes('プラン')) { track = 'bodyweight'; frequency = 2; }
      else if (heading.includes('ウエイト') && heading.includes('プラン')) {
        track = 'weight';
        frequency = (heading.includes('3') && heading.includes('4')) ? 4 : 2;
      }
      phase = null; key = null;
      continue;
    }
    const phaseMatch = line.match(/^【\s*Phase\s*(\d+)\s*】/i);
    if (phaseMatch) { phase = Number(phaseMatch[1]); key = null; continue; }

    const dayMatch = line.match(/^【\s*DAY\s*(\d+)\s*(.*?)\s*】/i);
    if (dayMatch && track && phase) {
      const day = Number(dayMatch[1]);
      key = `${track}|${frequency}|${phase}|${day}`;
      blocks.set(key, { day, day_label: `DAY${day}`, title: `DAY${day} ${dayMatch[2]}`.trim(), exercises: [] });
      continue;
    }
    if (key && line.startsWith('・')) {
      const name = line.replace(/^・/, '').trim();
      if (name) blocks.get(key).exercises.push({ name, part: guessPart(name) });
    }
  }
  return blocks;
}

export function dayPlan(blocks, phase, frequency, track = 'weight') {
  const phaseNo = Number(String(phase).match(/\d+/)?.[0] ?? 1);
  const days = [];
  for (let day = 1; day <= Number(frequency); day += 1) {
    const block = blocks.get(`${track}|${Number(frequency)}|${phaseNo}|${day}`);
    if (!block) {
      throw new Error(`プログラムに ${TRACK_LABEL[track] || track}・週${frequency}回・Phase${phaseNo}・DAY${day} がありません`);
    }
    const parts = [];
    for (const e of block.exercises) if (!parts.includes(e.part)) parts.push(e.part);
    days.push({ ...block, parts });
  }
  return days;
}

export function availableTracks(blocks) {
  const seen = new Set();
  for (const key of blocks.keys()) {
    const [track, frequency] = key.split('|');
    seen.add(`${track}|${frequency}`);
  }
  return [...seen].map((s) => s.split('|')).map(([t, f]) => [t, Number(f)]);
}

/** 「スミスベンチプレス　10rep×3set」→ ["スミスベンチプレス", "10×3"] */
const REPS_RE = /(\d+)\s*rep\s*[×xX]\s*(\d+)\s*set/;
export function splitReps(name) {
  const match = String(name).match(REPS_RE);
  if (!match) return [String(name).trim(), ''];
  return [String(name).replace(REPS_RE, '').trim(), `${match[1]}×${match[2]}`];
}

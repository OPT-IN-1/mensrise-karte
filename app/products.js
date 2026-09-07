// 商品マスタ（data/products.json）から、テンプレートに差し込む値を組み立てる。
// カタログ（福利厚生シートの取り込み）を参照して価格を引くので、
// 価格改定は catalog を直すだけでカルテ全体に反映される。

function catalogIndex(master) {
  return Object.fromEntries((master.catalog || []).map((c) => [c.name || '', c]));
}

/** 商品1件をカード表示用に整える。 */
function item(entry, index = {}, labels = {}) {
  const source = index[entry.catalog || ''] || {};
  const price = entry.price || source.price || '';
  let listed = entry.list_price || source.list_price || '';
  if (listed === price) listed = '';               // 定価と同額なら出さない
  const isMr = Boolean(entry.catalog);
  const channel = isMr ? (labels.mr || 'Men\'s Rise経由') : (labels[entry.channel || ''] || entry.channel || '');
  const meta = [price, listed ? `（定価${listed}）` : '', channel].filter(Boolean).join(' ');
  const name = entry.label || entry.name || source.name || '';
  return {
    icon: entry.icon || '🛒', name, desc: entry.desc || '', meta,
    image: entry.image || '', price, list_price: listed,
    badge: isMr ? channel : '', channel: isMr ? '' : channel,
    buy_line: `${name}：${isMr ? `MR限定価格 ${price}` : channel}${isMr && listed ? `（定価${listed}）` : ''}`,
  };
}

/** 目標スタイル・希望印象・髪の悩みから、スタイリング剤を1点選ぶ。 */
function pickStyling(master, index, labels, hints) {
  const styling = master.styling || {};
  const text = hints.filter(Boolean).join(' ');
  for (const rule of styling.rules || []) {
    if ((rule.match || []).some((w) => w && text.includes(w))) {
      return { ...item(rule, index, labels), rule_id: rule.id || '' };
    }
  }
  const fallback = styling.default || {};
  return { ...item(fallback, index, labels), rule_id: fallback.id || 'ST-0' };
}

/** 購入タスクの内訳。限定価格のある商品が含まれるときだけ案内文を先頭に置く。 */
function buyLines(items, buyNote) {
  const lines = items.map((x) => ({ t: x.buy_line }));
  if (buyNote && items.some((x) => x.badge)) lines.unshift({ t: buyNote });
  return lines;
}

export function productContext(master, skinType = '', ...styleHints) {
  if (!master.show_products) {
    return {
      show_products: false, skincare_items: [], hair_items: [],
      sunscreen_item: { icon: '☀️', name: '推奨の日焼け止め', desc: '', meta: '' },
      nail_item: { icon: '💅', name: '爪ケア用品（推奨）', desc: '', meta: '' },
      skincare_buy_lines: [], hair_buy_lines: [],
      morning_note: '皮脂を落とし、化粧水で保湿、最後に日焼け止めを塗る',
      night_note: 'メイクや日焼け止めを落とし、肌を整えて保湿する',
      skincare_cautions: [], skincare_cautions_text: '',
      night_routine: 'クレンジング → 洗顔 → 化粧水 → 美容液 → 乳液',
      skin_point_master: '',
      styling_item: { icon: '✋', name: 'スタイリング剤（推奨）', desc: '', meta: '', rule_id: '' },
      skincare_buy_task: '推奨スキンケアを購入する', hair_buy_task: 'ヘアケア・セット用品（推奨）を購入する',
      sunscreen_task: '推奨の日焼け止めを購入する', nail_task: '爪ケア用品（推奨）を購入する',
      hair_steps: {},
    };
  }
  const index = catalogIndex(master);
  const labels = master.channel_labels || {};
  const skincare = master.skincare || {};
  const chosen = skincare[(skinType || '').trim()] || skincare.default || [];
  const styling = pickStyling(master, index, labels, styleHints);
  const tasks = master.tasks || {};
  const buyNote = tasks.buy_note || '';
  const suffix = tasks.buy_task_suffix || 'を購入する';
  const cautions = (master.skincare_cautions || []).map((t) => ({ t }));
  const lastRole = (chosen.length ? chosen[chosen.length - 1].role : '') || '乳液';
  const hairItems = (master.hair || []).map((x) => item(x, index, labels));
  const skincareItems = chosen.map((x) => item(x, index, labels));
  const sunscreen = item(master.sunscreen || {}, index, labels);
  const nail = item(master.nail || {}, index, labels);

  return {
    show_products: true,
    skincare_items: skincareItems,
    hair_items: [...hairItems, styling],
    styling_item: styling,
    sunscreen_item: sunscreen,
    nail_item: nail,
    skincare_buy_lines: buyLines(skincareItems, buyNote),
    hair_buy_lines: buyLines([...hairItems, styling], buyNote),
    morning_note: (master.routine_notes || {}).morning || '',
    night_note: (master.routine_notes || {}).night || '',
    skincare_cautions: cautions,
    skincare_cautions_text: cautions.map((x) => x.t).join('　・'),
    night_routine: `クレンジング → 洗顔 → 化粧水 → 美容液 → ${lastRole}`,
    skin_point_master: (master.skin_points || {})[(skinType || '').trim()] || '',
    skincare_buy_task: tasks.skincare_buy || 'おすすめスキンケア商品を購入する',
    hair_buy_task: tasks.hair_buy || 'おすすめヘアケア・セット商品を購入する',
    sunscreen_task: sunscreen.name + suffix,
    nail_task: nail.name + suffix,
    hair_steps: master.hair_steps || {},
  };
}

/** 担当者が書いたスタイル名から、髪型ナレッジの同系統スタイルを探す。 */
export function styleEntryFor(config, styleName) {
  const target = String(styleName || '').replace(/[\s　]/g, '');
  if (!target) return {};
  for (const shape of Object.values(config.face_shapes || {})) {
    for (const candidates of Object.values(shape.styles || {})) {
      for (const style of candidates) {
        const name = String(style.name || '').replace(/\s/g, '');
        if (name && (target.includes(name) || name.includes(target))) return style;
      }
    }
  }
  return {};
}

/** 「目標スタイル」欄の記入が、髪型の名前として成立しているか。 */
export function looksLikeStyle(config, text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if ((config.style_words || []).some((w) => w && value.includes(w))) return true;
  return Boolean(styleEntryFor(config, value).name);
}

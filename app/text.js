// 文字の正規化と、実質空欄の扱い。
const EMPTY_ANSWERS = new Set(['', '—', '-', 'ー', '特になし', '特に無し', 'なし', '無し', '未定', 'わからない', '分からない', '不明']);

/** 全角/半角・空白差を吸収した比較用の正規化。 */
export function normalize(value) {
  if (value === null || value === undefined) return '';
  return String(value).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

/** 「特になし」等の実質空欄の回答を空として扱う。 */
export function meaningful(text) {
  const value = String(text ?? '').trim().replace(/[。.]+$/, '');
  return EMPTY_ANSWERS.has(value) ? '' : value;
}

/** 氏名の括弧書き（ふりがな）を落とす。 */
export function stripReading(value) {
  return String(value ?? '').replace(/[（(][^）)]*[）)]/g, '').trim();
}

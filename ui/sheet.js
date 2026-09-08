// カルテ5枚をブラウザ上で組み上げ、A4縦1ページに収める。
// 現行ツールがPlaywrightの中でやっていた「本文の自動リサイズ」をそのまま持ってきている。
// PDFはブラウザの印刷（⌘P →「PDFに保存」）で作る。

import { render, applyTextCorrections } from '../app/template.js?v=20260908145508';

export const PAGE_WIDTH = 794;    // A4縦 96dpi
export const PAGE_HEIGHT = 1123;
export const SHEET_TITLES = ['基本情報 & ゴール設定', '美容部門カルテ', '筋トレ部門カルテ',
  'ヘアスタイルカルテ', 'ルーティン & タスク管理'];

const TEMPLATE_DIR = 'templates/karte_v2';
let cache = null;

/** テンプレート5枚と共通CSSを読み込む（初回だけ）。 */
export async function loadTemplates() {
  if (cache) return cache;
  const files = await Promise.all([1, 2, 3, 4, 5].map(async (i) => ({
    name: `sheet${i}.html`,
    html: await (await fetch(`${TEMPLATE_DIR}/sheet${i}.html`)).text(),
  })));
  const css = await (await fetch(`${TEMPLATE_DIR}/shared.css`)).text();
  cache = { files, css };
  return cache;
}

/** テンプレート内の相対パスを、このアプリの置き場所に合わせて書き換える。 */
function resolveAssets(html) {
  return html
    .replace(/src="products\//g, 'src="assets/products/')
    .replace(/src="logo\.png"/g, `src="${TEMPLATE_DIR}/logo.png"`)
    .replace(/href="shared\.css"/g, `href="${TEMPLATE_DIR}/shared.css"`);
}

/** カルテ5枚のHTMLを作る。戻り値は [{name, html}]。 */
export async function buildSheets(context, textCorrections = []) {
  const { files } = await loadTemplates();
  return files.map((file, i) => {
    const sheetContext = {
      ...context, sheet_title: SHEET_TITLES[i], sheet_no: i + 1,
      nav: (context.nav || []).map((n) => ({ ...n, on: n.no === String(i + 1) ? 'on' : '' })),
    };
    const html = applyTextCorrections(render(file.html, sheetContext, file.name), textCorrections);
    return { name: file.name, html: resolveAssets(html) };
  });
}

/**
 * 受講生ごとに文章量が違うため、本文の倍率をページに合わせる。
 * 溢れるときは縮小（下限は minScale）、余るときは拡大（上限1.20）して、
 * ページ下部に大きな余白が残らないようにする。
 */
export function fitPage(doc, minScale = 0.80) {
  const el = doc.querySelector('.page');
  if (!el) return null;
  const body = el.querySelector('.body') || el.querySelector('.wrap');
  const targets = [...el.querySelectorAll('.side, .main, .col-left, .col-main, .col-full')];
  // 拡大は本文カラムだけ。左カラム（写真＋基本データ）は余白が出てよい。
  const mains = [...el.querySelectorAll('.main, .col-main, .col-full')];
  const apply = (list, s) => list.forEach((t) => { t.style.zoom = s; });
  const over = () => el.scrollHeight > el.clientHeight + 1
    || (body && body.scrollHeight > body.clientHeight + 1)
    || targets.some((t) => t.scrollHeight > t.clientHeight + 1);

  let scale = 1;
  if (over()) {
    while (over() && scale > minScale) { scale = Math.round((scale - 0.02) * 100) / 100; apply(targets, scale); }
  } else {
    while (scale < 1.20) {
      const next = Math.round((scale + 0.02) * 100) / 100;
      apply(mains, next);
      if (over()) { apply(mains, scale); break; }
      scale = next;
    }
  }
  return {
    scrollHeight: el.scrollHeight, scrollWidth: el.scrollWidth,
    clientHeight: el.clientHeight, clientWidth: el.clientWidth,
    bodyScrollHeight: body ? body.scrollHeight : 0,
    bodyClientHeight: body ? body.clientHeight : 0,
    scale,
  };
}

/** 5枚を1つの印刷用ドキュメントにまとめる。⌘Pで5ページのPDFになる。 */
export function printableDocument(sheets, css) {
  const pages = sheets.map(({ html }) => {
    const body = html.replace(/[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*/i, '');
    return `<section class="sheet">${body}</section>`;
  }).join('\n');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>カルテ</title>
<style>${css}
  @page { size: A4 portrait; margin: 0; }
  html, body { margin: 0; padding: 0; background: #f3f4f6; }
  .sheet { width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px; overflow: hidden;
           margin: 0 auto 16px; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.18); }
  .sheet .page { width: 100%; height: 100%; }
  @media print {
    body { background: #fff; }
    .sheet { margin: 0; box-shadow: none; break-after: page; }
    .sheet:last-child { break-after: auto; }
  }
</style></head><body>${pages}</body></html>`;
}

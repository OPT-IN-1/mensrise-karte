// 月次フォームの回答シートを、Googleドライブから直接読む。
//
// 受講生がフォームを送ると、回答はスプレッドシートの「月次フォーム」タブに1行ずつ入る。
// 「今月分に更新」を押したときにここを読み、体重・体脂肪率を自動で入れる。
// （以前はCSVを書き出して読み込ませる必要があった）

import { readSheets } from './xlsx.js?v=20260930224008';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 月次フォームのタブらしいか：名前に「月次」、または体重と写真の列がある */
function looksMonthly(name, rows) {
  const header = (rows[0] || []).join(' ');
  if (/月次/.test(name)) return true;
  return /体重/.test(header) && /写真/.test(header) && !/カウンセリング|サロンに入った理由/.test(header);
}

/** Googleの日付（1899-12-30 からの日数）→ "2026/09/12 19:58:09" */
function serialToText(value) {
  const days = Number(value);
  const ms = Math.round((days - 25569) * 86400000);   // 25569 = 1970-01-01
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** 数字のセルは "66.700000000000003" のような表記になることがあるので整える */
function tidy(value) {
  const text = String(value ?? '').trim();
  return /^-?\d+\.\d{6,}$/.test(text) ? String(Number(text)) : text;
}

/** 行の配列を、日付と数字を整えたうえで返す */
export function normalizeRows(rows) {
  const header = rows[0] || [];
  const dateCol = header.findIndex((h) => /タイムスタンプ|回答日時|送信日時/.test(h));
  return rows.map((row, i) => row.map((cell, c) => {
    if (i > 0 && c === dateCol && /^\d{5}(\.\d+)?$/.test(String(cell).trim())) return serialToText(cell);
    return tidy(cell);
  }));
}

export function rowsToCsv(rows) {
  const quote = (cell) => (/[",\n\r]/.test(cell) ? `"${String(cell).replace(/"/g, '""')}"` : String(cell));
  return rows.map((row) => row.map(quote).join(',')).join('\n');
}

/**
 * 回答シートを読み、月次フォームのタブをCSVの文字列にして返す。
 * drive は drive.js（exportFile / fileName を持つもの）。
 */
export async function loadMonthly(fileId, drive) {
  const [blob, fileName] = await Promise.all([drive.exportFile(fileId, XLSX), drive.fileName(fileId)]);
  const sheets = await readSheets(blob);
  const found = Object.entries(sheets).find(([name, rows]) => looksMonthly(name, rows));
  if (!found) throw new Error(`「${fileName}」に月次フォームのタブが見つかりません（タブ：${Object.keys(sheets).join('、')}）`);
  const [sheetName, rows] = found;
  const clean = normalizeRows(rows.filter((row) => row.some((cell) => String(cell).trim())));
  return { text: rowsToCsv(clean), fileName, sheetName, answers: Math.max(0, clean.length - 1) };
}

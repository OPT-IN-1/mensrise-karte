// Excel（.xlsx）からシートの中身を取り出す（読み取りだけ）。
//
// Googleスプレッドシートは、Drive API で CSV にすると先頭のタブしか出てこない。
// 月次フォームの回答は2つ目以降のタブにあるので、ブックごと .xlsx で受け取り、
// 目当てのタブをここで読む。外部ライブラリは使わない。

import { readZip } from './zip.js?v=20260930211257';

const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');
const byTag = (node, tag) => [...node.getElementsByTagName(tag)];

/** "B12" → 列番号 1（0始まり） */
function columnIndex(ref) {
  const letters = String(ref || '').replace(/[0-9]/g, '');
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

/** 文字の入ったセル（<si> や <is>）の文字列。ふりがな（<rPh>）は除く。 */
function textOf(node) {
  return byTag(node, 't').filter((t) => !t.closest('rPh')).map((t) => t.textContent).join('');
}

/** blob（.xlsx）→ { シート名: [[セル, …], …] } */
export async function readSheets(blob) {
  const entries = await readZip(blob);
  const read = async (name) => {
    const entry = entries.find((e) => e.name === name);
    return entry ? entry.blob.text() : '';
  };

  const shared = byTag(parseXml(await read('xl/sharedStrings.xml') || '<sst/>'), 'si').map(textOf);
  const rels = {};
  for (const rel of byTag(parseXml(await read('xl/_rels/workbook.xml.rels')), 'Relationship')) {
    const target = rel.getAttribute('Target') || '';
    rels[rel.getAttribute('Id')] = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  }

  const out = {};
  for (const sheet of byTag(parseXml(await read('xl/workbook.xml')), 'sheet')) {
    const rid = sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const xml = await read(rels[rid] || '');
    if (!xml) continue;
    const rows = [];
    for (const row of byTag(parseXml(xml), 'row')) {
      const cells = [];
      for (const cell of byTag(row, 'c')) {
        const type = cell.getAttribute('t') || '';
        const v = byTag(cell, 'v')[0];
        let value = '';
        if (type === 's') value = shared[Number(v ? v.textContent : -1)] ?? '';
        else if (type === 'inlineStr') value = textOf(cell);
        else value = v ? v.textContent : '';
        cells[columnIndex(cell.getAttribute('r'))] = value;
      }
      rows[Number(row.getAttribute('r')) - 1] = Array.from(cells, (c) => c ?? '');
    }
    out[sheet.getAttribute('name')] = Array.from(rows, (r) => r || []);
  }
  return out;
}

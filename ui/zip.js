// ZIPの読み書き（保存のみ・圧縮なし）。
// 写真はJPEGで既に圧縮済みなので、そのまま束ねるだけで十分に小さい。
// 外部ライブラリを使わずに済むよう、必要な部分だけを自前で持つ。

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) value = CRC_TABLE[(value ^ bytes[i]) & 0xFF] ^ (value >>> 8);
  return (value ^ 0xFFFFFFFF) >>> 0;
}

/** MS-DOS形式の日時（ZIPの仕様）。 */
function dosTime(date) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
  const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}

/** files は [{name, blob}]。戻り値はZIPのBlob。 */
export async function makeZip(files, when = new Date()) {
  const { time, day } = dosTime(when);
  const encoder = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const sum = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);   // ファイル名はUTF-8
    local.setUint16(8, 0, true);        // 圧縮なし
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, sum, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, day, true);
    entry.setUint32(16, sum, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

/** ZIPのBlobを [{name, blob}] に開く。 */
export async function readZip(blob) {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buffer.buffer);
  const decoder = new TextDecoder();

  // 末尾から中央ディレクトリの位置を探す
  let end = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 66000; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('ZIPとして読めませんでした。書き出したファイルをそのまま選んでください。');

  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true);
    const size = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localAt = view.getUint32(cursor + 42, true);
    const name = decoder.decode(buffer.subarray(cursor + 46, cursor + 46 + nameLength));

    const localNameLength = view.getUint16(localAt + 26, true);
    const localExtraLength = view.getUint16(localAt + 28, true);
    const start = localAt + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + size);

    let content = raw;
    if (method === 8) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      content = new Uint8Array(await new Response(stream).arrayBuffer());
    } else if (method !== 0) {
      throw new Error(`対応していない圧縮方式のファイルが入っています（${name}）`);
    }
    out.push({ name, blob: new Blob([content]) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

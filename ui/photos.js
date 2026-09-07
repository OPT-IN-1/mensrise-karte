// 写真の読み込みとクロップ。現行ツールの app/photos.py と同じ切り出し方をブラウザで行う。
// 写真はこの端末（ブラウザ）の外に出さない。

export const RATIOS = { '4:5': [4, 5], '3:4': [3, 4], '2:3': [2, 3] };
export const IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/*';

/** ファイルを、向き（EXIF）を直した状態で読み込む。 */
export async function loadImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // HEICなどブラウザが直接開けない形式
    throw new Error(`この形式の画像は開けません：${file.name}。JPEGかPNGで書き出してから選んでください。`);
  }
}

/**
 * 指定の回転・拡大・位置でクロップする。
 * offsetX / offsetY は中心からのずれ（-0.5〜0.5、画像サイズ比）。
 */
export async function cropForRole(bitmap, ratio, { rotate = 0, zoom = 1, offsetX = 0, offsetY = 0, outWidth = 900 } = {}) {
  const [ratioW, ratioH] = RATIOS[ratio] || RATIOS['3:4'];
  const target = ratioW / ratioH;
  const turn = ((Math.round(rotate) % 360) + 360) % 360;

  // 回転後の画像を一度キャンバスに描く
  const swap = turn === 90 || turn === 270;
  const rw = swap ? bitmap.height : bitmap.width;
  const rh = swap ? bitmap.width : bitmap.height;
  const rotated = new OffscreenCanvas(rw, rh);
  const rctx = rotated.getContext('2d');
  rctx.translate(rw / 2, rh / 2);
  rctx.rotate((turn * Math.PI) / 180);
  rctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);

  const z = Math.max(1, Number(zoom) || 1);
  let cropW, cropH;
  if (rw / rh > target) { cropH = rh / z; cropW = cropH * target; }
  else { cropW = rw / z; cropH = cropW / target; }

  const centerX = rw * (0.5 + Number(offsetX || 0));
  const centerY = rh * (0.5 + Number(offsetY || 0));
  const left = Math.min(Math.max(centerX - cropW / 2, 0), rw - cropW);
  const top = Math.min(Math.max(centerY - cropH / 2, 0), rh - cropH);

  const outHeight = Math.round(outWidth * ratioH / ratioW);
  const out = new OffscreenCanvas(outWidth, outHeight);
  out.getContext('2d').drawImage(rotated,
    Math.round(left), Math.round(top), Math.round(cropW), Math.round(cropH),
    0, 0, outWidth, outHeight);
  const blob = await out.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return { blob, ratio, rotate: turn, zoom: z, offset_x: offsetX, offset_y: offsetY,
    box: [Math.round(left), Math.round(top), Math.round(left + cropW), Math.round(top + cropH)] };
}

/**
 * 顔写真の縦横比を測る（顔型の推定に使う）。
 * ブラウザに顔検出があれば使い、無ければ測れなかったものとして扱う。
 * 現行ツール（macOSのVision）と同じく、測れた場合だけ縦÷横を返す。
 */
export async function measureFace(bitmap) {
  if (typeof FaceDetector === 'undefined') {
    return { ok: false, error: 'この端末のブラウザでは顔を測れないため、顔型の記入を使います' };
  }
  try {
    const faces = await new FaceDetector({ fastMode: false, maxDetectedFaces: 1 }).detect(bitmap);
    if (!faces.length) return { ok: false, error: '顔写真から顔を検出できませんでした' };
    const box = faces[0].boundingBox;
    return { ok: true, ratio: Number((box.height / box.width).toFixed(3)), faces: faces.length };
  } catch (error) {
    return { ok: false, error: `顔を測れませんでした（${error.message}）` };
  }
}

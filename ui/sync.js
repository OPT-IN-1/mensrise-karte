// このブラウザ（IndexedDB）と Google ドライブの間で、作業データと写真を合わせる。
// 新しいほうを正とする。両方が変わっていた場合は、更新時刻が後のほうを採用する。

import * as store from './store.js?v=20260909131224';
import * as realDrive from './drive.js?v=20260909131224';
import { PHOTO_ROLES } from '../app/fields.js?v=20260909131224';

const ROLES = PHOTO_ROLES.map((r) => r.role);
const stampOf = (job, role) => String(((job.photos || {})[role] || {}).at || '');
const isoOf = (job) => String(job.updated_iso || job.updated_at || '');

/** ドライブの中身を、種類ごとに引きやすい形に整える。 */
async function indexDrive(drive) {
  const files = await drive.list();
  const jobs = {}, photos = {};
  for (const file of files) {
    const props = file.appProperties || {};
    if (props.kind === 'job' && props.mid) jobs[props.mid] = file;
    else if (props.kind === 'photo' && props.mid && props.role) photos[`${props.mid}/${props.role}`] = file;
  }
  return { jobs, photos };
}

/**
 * ドライブとこのブラウザを合わせる。
 * 戻り値は、何をいくつ動かしたかの内訳。
 */
export async function syncAll(onProgress = () => {}, drive = realDrive) {
  const remote = await indexDrive(drive);
  const localJobs = Object.fromEntries((await store.listJobs()).map((j) => [j.mid, j]));
  const mids = [...new Set([...Object.keys(remote.jobs), ...Object.keys(localJobs)])].sort();
  const report = { downloaded: 0, uploaded: 0, photosDown: 0, photosUp: 0, same: 0 };

  for (const [index, mid] of mids.entries()) {
    onProgress(`${index + 1} / ${mids.length}：${mid}`);
    const local = localJobs[mid];
    const file = remote.jobs[mid];
    const remoteIso = file ? String((file.appProperties || {}).updated_at || file.modifiedTime || '') : '';

    let winner = local;
    let fromDrive = false;
    if (file && (!local || remoteIso > isoOf(local))) {
      // ドライブのほうが新しい → こちらに取り込む
      winner = await drive.getJson(file.id);
      await store.saveJob({ ...winner, updated_at: winner.updated_at, updated_iso: winner.updated_iso });
      report.downloaded += 1;
      fromDrive = true;
    } else if (local && (!file || isoOf(local) > remoteIso)) {
      // こちらのほうが新しい → ドライブへ送る
      await drive.putJob(local, file ? file.id : '');
      report.uploaded += 1;
    } else {
      report.same += 1;
    }
    if (!winner) continue;

    // 写真は、作業データで勝ったほうを正としてやり取りする。
    // 同じかどうかは、その写真を確定した時刻（stamp）で見る。
    for (const role of ROLES) {
      const key = `${mid}/${role}`;
      const remoteFile = remote.photos[key];
      const localBlob = await store.loadFile(key);
      const stamp = stampOf(winner, role);
      const remoteStamp = remoteFile ? String((remoteFile.appProperties || {}).stamp || '') : '';

      if (fromDrive) {
        if (remoteFile && (!localBlob || remoteStamp !== stamp)) {
          await store.saveFile(key, await drive.getBlob(remoteFile.id));
          report.photosDown += 1;
        } else if (localBlob && !remoteFile) {
          await drive.putPhoto(mid, role, localBlob, stamp, '');
          report.photosUp += 1;
        }
      } else if (localBlob && (!remoteFile || remoteStamp !== stamp)) {
        await drive.putPhoto(mid, role, localBlob, stamp, remoteFile ? remoteFile.id : '');
        report.photosUp += 1;
      } else if (!localBlob && remoteFile) {
        await store.saveFile(key, await drive.getBlob(remoteFile.id));
        report.photosDown += 1;
      }
    }
  }
  return report;
}

/** 1名ぶんだけ、いますぐドライブへ送る（保存のたびに呼ぶ）。 */
export async function pushJob(job, drive = realDrive) {
  const remote = await indexDrive(drive);
  const file = remote.jobs[job.mid];
  await drive.putJob(job, file ? file.id : '');
  for (const role of ROLES) {
    const key = `${job.mid}/${role}`;
    const blob = await store.loadFile(key);
    if (!blob) continue;
    const photo = remote.photos[key];
    const stamp = stampOf(job, role);
    if (!photo || String((photo.appProperties || {}).stamp || '') !== stamp) {
      await drive.putPhoto(job.mid, role, blob, stamp, photo ? photo.id : '');
    }
  }
}

/** ドライブ側からも消す。 */
export async function removeJob(mid, drive = realDrive) {
  const remote = await indexDrive(drive);
  const targets = [remote.jobs[mid], ...ROLES.map((role) => remote.photos[`${mid}/${role}`])].filter(Boolean);
  for (const file of targets) await drive.remove(file.id);
  return targets.length;
}

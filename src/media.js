import { HttpError, json, readJson, str, int, now, hmacHex, linkSecret, safeEqual } from './util.js';

const KIND = {
  video: { col: 'video_key', ext: 'mp4', type: 'video/mp4' },
  note: { col: 'note_key', ext: 'pdf', type: 'application/pdf' },
  practice: { col: 'practice_key', ext: 'pdf', type: 'application/pdf' },
  thumb: { col: 'thumb_key', ext: 'jpg', type: 'image/jpeg' },
  subtitle: { col: 'subtitle_key', ext: 'vtt', type: 'text/vtt; charset=utf-8' },
};

export function kindInfo(kind) {
  const k = KIND[kind];
  if (!k) throw new HttpError(400, '파일 종류가 올바르지 않아요.');
  return k;
}

function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start, end;
  if (m[1] === '' && m[2] === '') return null;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

// 로그인 쿠키가 없는 곳(휴대폰 앱에서 연 PDF 창 등)에서도 열리도록 시간 제한이 있는 서명 주소를 만들어요
export async function signLink(env, lectureId, kind, { ttl = 12 * 3600, download = false } = {}) {
  const e = now() + ttl;
  const s = (await hmacHex(await linkSecret(env), `${lectureId}.${kind}.${e}`)).slice(0, 40);
  return `/media/lecture/${lectureId}/${kind}?e=${e}&s=${s}${download ? '&dl=1' : ''}`;
}

export async function verifyLink(env, lectureId, kind, url) {
  const e = int(url.searchParams.get('e'));
  const s = url.searchParams.get('s') || '';
  if (!e || e < now()) return false;
  const want = (await hmacHex(await linkSecret(env), `${lectureId}.${kind}.${e}`)).slice(0, 40);
  return safeEqual(s, want);
}

export async function lectureLinks(env, l, kinds = ['note', 'practice']) {
  const out = {};
  for (const k of kinds) {
    const col = KIND[k].col;
    out[k] = l[col] ? await signLink(env, l.id, k, { download: k === 'video' }) : null;
  }
  return out;
}

export async function serveObject(request, env, key, { type, filename, cache = 'private, max-age=600', download = false } = {}) {
  const head = await env.BUCKET.head(key);
  if (!head) throw new HttpError(404, '파일을 찾을 수 없어요.');
  const size = head.size;
  const ct = type || head.httpMetadata?.contentType || 'application/octet-stream';
  const base = {
    'Content-Type': ct,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
    ETag: head.httpEtag,
  };
  if (filename) base['Content-Disposition'] = `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(filename)}`;
  const range = parseRange(request.headers.get('Range'), size);
  if (range === 'invalid') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  if (request.method === 'HEAD') return new Response(null, { headers: { ...base, 'Content-Length': String(size) } });
  if (range) {
    const len = range.end - range.start + 1;
    const obj = await env.BUCKET.get(key, { range: { offset: range.start, length: len } });
    return new Response(obj.body, {
      status: 206,
      headers: { ...base, 'Content-Length': String(len), 'Content-Range': `bytes ${range.start}-${range.end}/${size}` },
    });
  }
  const obj = await env.BUCKET.get(key);
  return new Response(obj.body, { headers: { ...base, 'Content-Length': String(size) } });
}

// 큰 파일은 여러 조각으로 나눠 올려요 (R2 멀티파트)
export async function handleUpload(request, env, path, lectureCheck) {
  if (path === '/api/up/start' && request.method === 'POST') {
    const body = await readJson(request);
    const lecture_id = int(body.lecture_id);
    const k = kindInfo(body.kind);
    await lectureCheck(lecture_id);
    const key = `lectures/${lecture_id}/${body.kind}-${Date.now()}.${k.ext}`;
    const up = await env.BUCKET.createMultipartUpload(key, { httpMetadata: { contentType: k.type } });
    return json({ key, uploadId: up.uploadId });
  }
  if (path === '/api/up/part' && request.method === 'PUT') {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    const uploadId = url.searchParams.get('uploadId');
    const n = int(url.searchParams.get('n'));
    if (!key || !uploadId || !n || !key.startsWith('lectures/')) throw new HttpError(400, '조각 정보가 올바르지 않아요.');
    await lectureCheck(int(key.split('/')[1]));
    const up = env.BUCKET.resumeMultipartUpload(key, uploadId);
    const part = await up.uploadPart(n, request.body);
    return json({ partNumber: part.partNumber, etag: part.etag });
  }
  if (path === '/api/up/complete' && request.method === 'POST') {
    const body = await readJson(request);
    const key = str(body.key, 300);
    const lecture_id = int(key.split('/')[1]);
    await lectureCheck(lecture_id);
    const k = kindInfo(body.kind);
    const up = env.BUCKET.resumeMultipartUpload(key, str(body.uploadId, 500));
    const obj = await up.complete((body.parts || []).map((p) => ({ partNumber: int(p.partNumber), etag: str(p.etag, 200) })));
    const old = await env.DB.prepare(`SELECT ${k.col} AS k FROM lectures WHERE id = ?`).bind(lecture_id).first();
    const sets = [`${k.col} = ?`, 'updated_at = ?'];
    const vals = [key, now()];
    if (body.kind === 'video') {
      sets.push('video_bytes = ?');
      vals.push(obj.size);
      if (body.duration) {
        sets.push('duration = ?');
        vals.push(Number(body.duration));
      }
    }
    await env.DB.prepare(`UPDATE lectures SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, lecture_id).run();
    if (old && old.k && old.k !== key) await env.BUCKET.delete(old.k);
    return json({ ok: true, key, size: obj.size });
  }
  if (path === '/api/up/abort' && request.method === 'POST') {
    const body = await readJson(request);
    try {
      await env.BUCKET.resumeMultipartUpload(str(body.key, 300), str(body.uploadId, 500)).abort();
    } catch {
      /* 이미 끝난 업로드 */
    }
    return json({ ok: true });
  }
  return null;
}

export async function deleteLectureFiles(env, lec) {
  const keys = [lec.video_key, lec.note_key, lec.practice_key, lec.thumb_key, lec.subtitle_key].filter(Boolean);
  if (keys.length) await env.BUCKET.delete(keys);
}

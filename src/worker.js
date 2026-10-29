import { HttpError, json, int, getSettings } from './util.js';
import { currentUser, handleAuth, requireRole } from './auth.js';
import { handleAdmin } from './api_admin.js';
import { handleStudent, canSeeLecture } from './api_student.js';
import { handleEngine, engineAuth, voiceOf } from './api_engine.js';
import { handleBankAdmin, handleBankStudent } from './api_bank.js';
import { handleLtPublic, handleLtAdmin } from './api_lt.js';
import { handleExamAdmin, handleExamStudent } from './api_exam.js';
import { handleUpload, serveObject, kindInfo, verifyLink } from './media.js';
import { ensureDb } from './db.js';

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = request.method;

  // ---------------------------------------------------------------- 제작 엔진 설치·자동 업데이트 파일 (연결 코드가 있어야 받을 수 있어요)
  if (path.startsWith('/_engine/')) {
    await ensureDb(env);
    if (!(await engineAuth(request, env))) throw new HttpError(401, '엔진 연결 코드가 맞지 않아요.', 'engine_auth');
    if (m !== 'GET' && m !== 'HEAD') throw new HttpError(405, '받기만 할 수 있어요.');
    const types = { '/_engine/manifest.json': 'application/json', '/_engine/bundle.json': 'application/json', '/_engine/install.ps1': 'application/octet-stream' };
    if (!types[path]) throw new HttpError(404, '엔진 파일이 없어요.');
    const res = await env.ASSETS.fetch(new Request(new URL(path, url).toString(), { method: m }));
    if (!res.ok || (res.headers.get('Content-Type') || '').startsWith('text/html')) throw new HttpError(404, '엔진 파일이 아직 없어요. 사이트를 다시 올려 주세요.');
    return new Response(res.body, { headers: { 'Content-Type': types[path], 'Cache-Control': 'no-store' } });
  }

  await ensureDb(env);

  // ---------------------------------------------------------------- 앱 설치 정보 (학원 이름이 홈 화면 아이콘 이름이 돼요)
  if (path === '/manifest.webmanifest') {
    const s = await getSettings(env);
    const short = [s.app_name, s.academy_name].find((x) => x && x.length <= 8) || s.app_name.slice(0, 8);
    return new Response(
      JSON.stringify({
        name: s.app_name,
        short_name: short,
        description: `${s.academy_name} 온라인 강의실`,
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#1e3a2f',
        theme_color: '#1e3a2f',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      }),
      { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=300' } },
    );
  }

  // ---------------------------------------------------------------- 미디어
  if (path === '/media/logo') {
    const s = await getSettings(env);
    if (!s.logo_key) throw new HttpError(404, '로고가 없어요.');
    return serveObject(request, env, s.logo_key, { cache: 'public, max-age=300' });
  }
  let mm;
  if ((mm = path.match(/^\/media\/name\/(\d+)$/))) {
    // 학생 이름을 부르는 짧은 목소리 (그 강의를 만든 목소리로)
    const user = await currentUser(request, env);
    requireRole(user);
    const lid = int(mm[1]);
    let uid = user.id;
    if (user.role === 'admin') uid = int(url.searchParams.get('as')) || 0;
    else if (!(await canSeeLecture(env, user, lid))) throw new HttpError(404, '볼 수 없는 강의예요.');
    const l = await env.DB.prepare('SELECT voice FROM lectures WHERE id = ?').bind(lid).first();
    const v = l ? voiceOf(l.voice) : null;
    const clip = v ? await env.DB.prepare('SELECT key FROM name_clips WHERE user_id = ? AND voice = ?').bind(uid, v.k).first() : null;
    if (!clip) throw new HttpError(404, '이름 목소리가 아직 없어요.');
    return serveObject(request, env, clip.key, { cache: 'private, max-age=86400' });
  }
  if ((mm = path.match(/^\/media\/lecture\/(\d+)\/(video|note|practice|thumb|subtitle)$/))) {
    const id = int(mm[1]);
    if (!(url.searchParams.get('s') && (await verifyLink(env, id, mm[2], url)))) {
      const user = await currentUser(request, env);
      requireRole(user);
      if (!(await canSeeLecture(env, user, id))) throw new HttpError(404, '볼 수 없는 강의예요.');
    }
    const k = kindInfo(mm[2]);
    const l = await env.DB.prepare(`SELECT title, ${k.col} AS key FROM lectures WHERE id = ?`).bind(id).first();
    if (!l || !l.key) throw new HttpError(404, '파일이 아직 없어요.');
    const names = { video: `${l.title}.mp4`, note: `${l.title}_판서노트.pdf`, practice: `${l.title}_연습지.pdf`, subtitle: `${l.title}.vtt` };
    return serveObject(request, env, l.key, { type: k.type, filename: names[mm[2]], download: url.searchParams.get('dl') === '1' });
  }

  if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

  // ---------------------------------------------------------------- 엔진 (토큰 인증)
  const isEngine = path.startsWith('/api/engine/') || ((path.startsWith('/api/up/')) && (request.headers.get('Authorization') || '').startsWith('Bearer '));
  if (isEngine) {
    if (!(await engineAuth(request, env))) throw new HttpError(401, '엔진 연결 코드가 맞지 않아요.', 'engine_auth');
    if (path.startsWith('/api/up/')) {
      const r = await handleUpload(request, env, path, async (id) => {
        const l = await env.DB.prepare('SELECT 1 FROM lectures WHERE id = ?').bind(id).first();
        if (!l) throw new HttpError(404, '강의가 없어요.', 'gone');
      });
      if (r) return r;
    }
    const r = await handleEngine(request, env, path);
    if (r) return r;
    throw new HttpError(404, '없는 주소예요.');
  }

  // ---------------------------------------------------------------- 브라우저 요청
  if (m !== 'GET' && m !== 'HEAD' && request.headers.get('X-Ivy') !== '1') {
    throw new HttpError(403, '잘못된 요청이에요.', 'csrf');
  }
  const user = await currentUser(request, env);

  const auth = await handleAuth(request, env, path, user);
  if (auth) return auth;

  // 레벨테스트 (링크로 들어온 학생은 로그인하지 않아요)
  if (path.startsWith('/api/lt/')) {
    const r = await handleLtPublic(request, env, path, user);
    if (r) return r;
    throw new HttpError(404, '없는 주소예요.');
  }

  if (path.startsWith('/api/up/')) {
    requireRole(user, 'admin');
    const r = await handleUpload(request, env, path, async (id) => {
      const l = await env.DB.prepare('SELECT 1 FROM lectures WHERE id = ?').bind(id).first();
      if (!l) throw new HttpError(404, '강의가 없어요.');
    });
    if (r) return r;
  }
  if (path.startsWith('/api/admin/')) {
    requireRole(user, 'admin');
    const r = (await handleAdmin(request, env, path, user)) || (await handleBankAdmin(request, env, path, user)) || (await handleExamAdmin(request, env, path)) || (await handleLtAdmin(request, env, path));
    if (r) return r;
  }
  if (path.startsWith('/api/student/')) {
    requireRole(user);
    const r = (await handleStudent(request, env, path, user)) || (await handleBankStudent(request, env, path, user)) || (await handleExamStudent(request, env, path, user));
    if (r) return r;
  }
  throw new HttpError(404, '없는 주소예요.');
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
      console.error(e && e.stack ? e.stack : e);
      return json({ error: '서버에서 문제가 생겼어요. 잠시 뒤 다시 해 주세요.', code: 'server' }, 500);
    }
  },
};

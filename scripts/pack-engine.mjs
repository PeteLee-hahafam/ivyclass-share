// 학원 PC 제작 엔진 파일을 사이트에 함께 올릴 묶음으로 만들어요.
// 엔진은 이 묶음을 보고 스스로 새 버전으로 바꿔요 (자동 업데이트). wrangler deploy / dev 때마다 자동으로 실행돼요.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cloud = join(here, '..');
// 원본 저장소는 cloud/ 옆에 engine/ 이 있고, 원장님들께 나눠 주는 공개판은 사이트 폴더 안에 engine/ 이 있어요
const engine = existsSync(join(cloud, 'engine', 'ivy_engine')) ? join(cloud, 'engine') : join(cloud, '..', 'engine');
const out = join(cloud, 'public', '_engine');

const INCLUDE_TOP = ['requirements.txt', 'run_engine.bat', 'setup_engine.bat', 'setup_engine.ps1', 'icon.ico'];
const SKIP_DIR = new Set(['__pycache__', '.venv', '.git', 'work', 'cache']);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIR.has(name)) walk(p, acc);
    } else if (/\.(py|html|json|txt|css|js)$/.test(name)) acc.push(p);
  }
  return acc;
}

// 윈도우 배치·파워셸 파일은 줄바꿈(CRLF)과 한글 표시(BOM)를 맞춰요
function normalize(rel, buf) {
  if (/\.(bat|cmd|ps1)$/i.test(rel)) {
    let t = buf.toString('utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    if (/\.ps1$/i.test(rel)) t = '﻿' + t;
    return Buffer.from(t, 'utf8');
  }
  return buf;
}

const sha = (b) => createHash('sha256').update(b).digest('hex');

if (!existsSync(join(engine, 'ivy_engine'))) {
  console.warn('[pack-engine] engine 폴더가 없어서 엔진 묶음을 건너뛰어요.');
  process.exit(0);
}

const files = [];
for (const name of INCLUDE_TOP) {
  const p = join(engine, name);
  if (existsSync(p)) files.push(p);
}
files.push(...walk(join(engine, 'ivy_engine')));

const list = [];
const bundle = {};
for (const p of files) {
  const rel = relative(engine, p).split(sep).join('/');
  const buf = normalize(rel, readFileSync(p));
  list.push({ p: rel, h: sha(buf), s: buf.length });
  bundle[rel] = buf.toString('base64');
}
const init = readFileSync(join(engine, 'ivy_engine', '__init__.py'), 'utf8');
const version = (init.match(/VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1] || '0';
const build = sha(list.map((f) => `${f.p}:${f.h}`).join('\n')).slice(0, 16);
const req = list.find((f) => f.p === 'requirements.txt');
const manifest = { version, build, req: req ? req.h : '', files: list };

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));
writeFileSync(join(out, 'bundle.json'), JSON.stringify({ version, build, files: bundle }));
const inst = join(engine, 'install.ps1');
if (existsSync(inst)) writeFileSync(join(out, 'install.ps1'), normalize('install.ps1', readFileSync(inst)));
console.log(`[pack-engine] 엔진 ${version} (${build}) 파일 ${list.length}개를 묶었어요.`);

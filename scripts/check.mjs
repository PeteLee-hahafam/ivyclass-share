// 올리기 전에 자바스크립트 파일에 문법 오류가 없는지 확인해요: npm run check
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['src', 'scripts', 'public/assets', 'public'];
let bad = 0;
let n = 0;
for (const d of dirs) {
  for (const name of readdirSync(join(root, d))) {
    const p = join(root, d, name);
    if (!statSync(p).isFile() || !/\.(m?js)$/.test(name)) continue;
    n++;
    try {
      execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
    } catch (e) {
      bad++;
      console.error(`✗ ${d}/${name}\n${String(e.stderr || e.message)}`);
    }
  }
}
console.log(bad ? `문법 오류 ${bad}개 (${n}개 파일 확인)` : `문법 확인 끝: ${n}개 파일 이상 없음`);
process.exit(bad ? 1 : 0);

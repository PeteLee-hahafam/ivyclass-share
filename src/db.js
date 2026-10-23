// 데이터베이스 표 준비: 사이트가 처음 요청을 받을 때 아직 안 만든 표를 스스로 만들어요.
// 새 버전에서 표가 바뀌면 migrations/ 에 파일을 하나 더 두고 아래 목록에 이어 붙이면 돼요.
// wrangler 의 d1 migrations 와 같은 기록표(d1_migrations)를 써서 둘을 섞어 써도 괜찮아요.
import m0001 from '../migrations/0001_init.sql';

const MIGRATIONS = [['0001_init.sql', m0001]];

function statements(sql) {
  return String(sql)
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function applied(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)',
  ).run();
  const { results } = await env.DB.prepare('SELECT name FROM d1_migrations').all();
  return new Set(results.map((r) => r.name));
}

// 1.0 버전(schema.sql)으로 먼저 설치한 사이트에도 새 칸을 더해 줘요
const COLUMNS = {
  users: [['call_name', 'TEXT']],
  lectures: [
    ['voice', 'TEXT'],
    ['name_slots', 'TEXT'],
    ['edit', 'TEXT'],
    ['subtitle_key', 'TEXT'],
    ['transcript', 'TEXT'],
    ['summary', 'TEXT'],
  ],
};

async function addColumns(env) {
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    const have = new Set(results.map((r) => r.name));
    for (const [col, type] of cols) {
      if (have.has(col)) continue;
      try {
        await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
      } catch (e) {
        if (!/duplicate column/i.test(String(e && e.message))) throw e;
      }
    }
  }
}

async function migrate(env) {
  let done = await applied(env);
  for (const [name, sql] of MIGRATIONS) {
    if (done.has(name)) continue;
    try {
      await env.DB.batch([...statements(sql).map((s) => env.DB.prepare(s)), env.DB.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name)]);
    } catch (e) {
      // 다른 요청이 같은 순간에 먼저 만들었으면 괜찮아요
      done = await applied(env);
      if (!done.has(name)) throw e;
    }
  }
  await addColumns(env);
}

let ready = null;
export function ensureDb(env) {
  if (!ready) {
    ready = migrate(env).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

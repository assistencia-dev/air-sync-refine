const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');

function load(file, imports) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, {
    exports, require: name => {
      assert.ok(name in imports, `Unexpected dependency: ${name}`);
      return imports[name];
    },
    Headers, Request, fetch, console,
    // Simulate deployment settings that differ from the browser build.
    process: { env: { SUPABASE_URL: 'https://different-project.supabase.co', SUPABASE_ANON_KEY: 'different-key' } },
  });
  return exports;
}
const config = load('src/integrations/supabase/project-config.ts', {});
function boundary(token, createClient) {
  let handler;
  load('src/integrations/supabase/auth-middleware.ts', {
    '@tanstack/react-start': { createMiddleware: () => ({ server: fn => { handler = fn; return fn; } }) },
    '@tanstack/react-start/server': { getRequest: () => ({ headers: new Headers(token ? { authorization: 'Bearer ' + token } : {}) }) },
    '@supabase/supabase-js': { createClient }, './project-config': config,
  });
  return handler({ next: ({ context }) => context });
}
function profile(context) {
  let handler;
  const chain = { middleware() { return this; }, handler(fn) { handler = fn; return fn; } };
  load('src/lib/admin-profile.functions.ts', {
    '@tanstack/react-start': { createServerFn: () => chain },
    '@/integrations/supabase/auth-middleware': { requireSupabaseAuth: {} },
  });
  return handler({ context });
}
function database(row) {
  return { from(table) {
    assert.equal(table, 'users');
    return { select() { return this; }, eq(column, userId) {
      assert.equal(column, 'auth_id'); assert.equal(userId, 'verified-user'); return this;
    }, maybeSingle: async () => ({ data: row, error: null }) };
  } };
}
(async () => {
  let validated = 0;
  const context = await boundary('valid.session.token', (url, key, options) => {
    assert.equal(url, config.DBS_SUPABASE_URL);
    assert.equal(key, config.DBS_SUPABASE_PUBLISHABLE_KEY);
    assert.equal(options.global.headers.Authorization, 'Bearer valid.session.token');
    return { auth: { getUser: async token => {
      assert.equal(token, 'valid.session.token'); validated++;
      return { data: { user: { id: 'verified-user', user_metadata: { role_key: 'SUPER_ADMIN' } } }, error: null };
    } }, ...database({ id: 'profile-1', role_key: 'CLIENTE_PF', status: 'ativo' }) };
  });
  assert.equal(context.userId, 'verified-user');
  assert.equal(validated, 1);
  const result = await profile(context);
  assert.equal(result.role_key, 'CLIENTE_PF', 'Use the database role, never editable Auth metadata');
  await assert.rejects(boundary(null, () => { throw Error('must not create client'); }), /No authorization header/);
  await assert.rejects(boundary('not-a-jwt', () => { throw Error('must not create client'); }), /Invalid token/);
  await assert.rejects(boundary('forged.session.token', () => ({ auth: { getUser: async () => ({ data: { user: null }, error: Error('invalid signature') }) } })), /Supabase oficial/);
  await assert.rejects(profile({ userId: 'verified-user', supabase: database({ role_key: 'SUPER_ADMIN', status: 'bloqueado' }) }), /Acesso suspenso/);
  assert.equal(await profile({ userId: 'verified-user', supabase: database(null) }), null);
  console.log('Auth boundary: canonical project, remote token validation, forged-token rejection, self-profile RLS and inactive-account guard passed.');

  // Optional integration check: only a transient token is read; no credentials are saved.
  if (process.env.DBS_TEST_ACCESS_TOKEN) {
    const live = await boundary(process.env.DBS_TEST_ACCESS_TOKEN, require('@supabase/supabase-js').createClient);
    const me = await profile(live);
    assert.ok(me?.id && me.status === 'ativo');
    console.log('Live official Supabase: server identity and active profile verified; role:', me.role_key);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

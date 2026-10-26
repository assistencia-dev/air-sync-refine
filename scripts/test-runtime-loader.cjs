const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

async function workerTests() {
  const handlers = {};
  let responsePromise;
  let staleReads = 0;
  const fresh = { ok: true, type: 'basic', clone() { return this; } };
  const cache = {
    put: async () => { throw Error('QuotaExceededError'); },
    match: async () => { staleReads++; return { stale: true }; },
  };
  const context = {
    URL,
    self: { location: { origin: 'https://dbs.example' }, addEventListener: (name, fn) => { handlers[name] = fn; } },
    caches: { open: async () => cache }, fetch: async () => fresh,
  };
  vm.runInNewContext(fs.readFileSync('public/sw.js', 'utf8'), context);
  for (const path of ['/node_modules/@tanstack/react-router/dist/esm/ScriptOnce.js?v=old', '/src/router.tsx', '/@vite/client', '/@id/virtual.js']) {
    responsePromise = undefined;
    handlers.fetch({ request: { method: 'GET', url: 'https://dbs.example' + path }, respondWith: value => { responsePromise = value; } });
    assert.equal(responsePromise, undefined, `PWA must not intercept ${path}`);
  }
  function requestAsset() {
    handlers.fetch({ request: { method: 'GET', url: 'https://dbs.example/assets/module.js' }, respondWith: value => { responsePromise = value; } });
    return responsePromise;
  }
  assert.equal(await requestAsset(), fresh, 'Cache quota must not replace fresh JS with stale JS');
  assert.equal(staleReads, 0);
  context.caches.open = async () => { throw Error('SecurityError'); };
  assert.equal(await requestAsset(), fresh, 'Denied cache access must still permit downloading JS');
}

function bootstrap(preview, storageThrows = false) {
  const handlers = {};
  const deleted = [];
  const unregistered = [];
  const replacements = [];
  const session = new Map();
  const context = {
    URL, Promise, setTimeout: fn => { fn(); },
    document: { currentScript: { dataset: { preview: String(preview) } } },
    location: { origin: 'https://dbs.example', href: 'https://dbs.example/admin?tab=passage', replace: url => replacements.push(url) },
    window: { addEventListener: (name, fn) => { handlers[name] = fn; } },
    sessionStorage: {
      getItem: key => { if (storageThrows) throw Error('denied'); return session.get(key); },
      setItem: (key, value) => { if (storageThrows) throw Error('denied'); session.set(key, value); },
    },
    caches: { keys: async () => ['dbs-air-static-v3', 'unrelated-cache'], delete: async name => deleted.push(name) },
    navigator: { serviceWorker: { getRegistrations: async () => ['/sw.js', '/other-worker.js'].map(path => ({
      active: { scriptURL: 'https://dbs.example' + path }, unregister: async () => unregistered.push(path),
    })) } },
  };
  vm.runInNewContext(fs.readFileSync('public/module-recovery.js', 'utf8'), context);
  return { handlers, deleted, unregistered, replacements, session, context };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
async function bootstrapTests() {
  let app = bootstrap(true);
  await flush();
  assert.deepEqual(app.deleted, ['dbs-air-static-v3']);
  assert.deepEqual(app.unregistered, ['/sw.js']);
  const event = { reason: new TypeError('error loading dynamically imported module: ScriptOnce.js'), preventDefault() {} };
  app.handlers.unhandledrejection(event);
  await flush();
  assert.deepEqual(app.replacements, ['https://dbs.example/admin?tab=passage']);
  app.handlers.unhandledrejection(event);
  await flush();
  assert.equal(app.replacements.length, 1, 'Never loop on a persistent missing module');
  // A second page load in the same tab must honor the persisted recovery limit.
  vm.runInNewContext(fs.readFileSync('public/module-recovery.js', 'utf8'), app.context);
  app.handlers.unhandledrejection(event);
  await flush();
  assert.equal(app.replacements.length, 1);

  app = bootstrap(true);
  app.handlers['dbs:app-ready']();
  app.handlers.unhandledrejection(event);
  await flush();
  assert.equal(app.replacements.length, 0, 'Do not discard an already-open form');
  app = bootstrap(false);
  await flush();
  assert.deepEqual(app.unregistered, [], 'Keep production PWA registrations');
  assert.deepEqual(app.deleted, [], 'Keep production asset caches');
  app.handlers.unhandledrejection({ reason: Error('Database unavailable') });
  await flush();
  assert.equal(app.replacements.length, 0, 'Database errors must not trigger module recovery');
  app = bootstrap(true, true);
  app.handlers.unhandledrejection(event);
  await flush();
  assert.equal(new URL(app.replacements[0]).searchParams.get('dbs_module_retry'), '1');
  assert.equal(new URL(app.replacements[0]).searchParams.get('tab'), 'passage');
}

(async () => {
  await workerTests();
  await bootstrapTests();
  console.log('Runtime loader: live Vite modules bypass PWA, cache errors preserve fresh JS, preview cleanup is scoped and startup recovery never loops or discards open forms.');
})().catch(error => { console.error(error); process.exitCode = 1; });

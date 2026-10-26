const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');

function routeConfig(file) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  let config;
  vm.runInNewContext(source, {
    exports: {},
    require: (name) => name === '@tanstack/react-router' ? {
      createFileRoute: () => value => { config = value; return value; },
      redirect: value => value,
    } : {},
    Set,
  });
  return config;
}

const aliases = {
  rh: { to: '/admin', search: { tab: 'passage' }, replace: true },
  financeiro: { to: '/treasury', replace: true },
  users: { to: '/admin', search: { tab: 'users' }, replace: true },
  chamados: { to: '/admin', search: { tab: 'tickets' }, replace: true },
};
for (const [name, expected] of Object.entries(aliases)) {
  const config = routeConfig(`src/routes/_authenticated/${name}.tsx`);
  assert.throws(() => config.beforeLoad(), result => JSON.stringify(result) === JSON.stringify(expected), `${name} must open the actual module`);
}
const admin = routeConfig('src/routes/_authenticated/admin.tsx');
for (const tab of ['tickets', 'users', 'passage']) assert.equal(admin.validateSearch({ tab }).tab, tab);
assert.equal(admin.validateSearch({ tab: 'invalid' }).tab, undefined);

function scripts(file) {
  return [...fs.readFileSync(file, 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(match => match[1]);
}
const treasury = scripts('public/treasury.html').find(source => source.includes('function normalizeTreasuryState'));
const tree = ts.createSourceFile('treasury.js', treasury, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = tree.statements.filter(node => ts.isFunctionDeclaration(node) && ['init', 'save', 'normalizeTreasuryState'].includes(node.name?.text)).map(node => node.getText(tree)).join('\n');
function treasurySession(storage) {
  const messages = [];
  const context = vm.createContext({
    localStorage: storage,
    TREASURY_STATE_KEY: 'state', TREASURY_SNAPSHOT_KEY: 'snapshot', TREASURY_PREVIOUS_KEY: 'previous', TREASURY_VERSION: 5,
    STATE: {}, PRESERVE_UNREADABLE_TREASURY_CACHE: false, window: {},
    document: { getElementById: () => ({ value: '' }) },
    console: { warn() {}, error() {} },
    treasuryPost: (type, data) => messages.push({ type, ...data }),
    logAuditoria() {}, populateAllBankSelects() {}, render() {}, showToast() {},
  });
  vm.runInContext(functions, context);
  return { context, messages };
}

// A damaged browser cache must still request cloud hydration and remain untouched.
const writes = [];
let session = treasurySession({ getItem: () => '{broken', setItem: (...args) => writes.push(args) });
vm.runInContext('init()', session.context);
assert.equal(session.messages.at(-1).type, 'DBS_TREASURY_READY');
assert.equal(session.messages.at(-1).state, null);
assert.equal(session.context.PRESERVE_UNREADABLE_TREASURY_CACHE, true);
assert.ok(!writes.some(([key]) => key === 'state'));
vm.runInContext('STATE = { bancos: [{ id: "new" }] }; save()', session.context);
assert.equal(session.messages.at(-1).type, 'DBS_TREASURY_SAVE');
assert.ok(!writes.some(([key]) => key === 'state'));

// Browsers that deny storage must still reach the authenticated cloud bridge.
session = treasurySession({ getItem() { throw Error('SecurityError'); }, setItem() { throw Error('QuotaExceededError'); } });
vm.runInContext('init()', session.context);
assert.equal(session.messages.at(-1).type, 'DBS_TREASURY_READY');
vm.runInContext('STATE = { bancos: [{ id: "bank-1" }] }; save()', session.context);
assert.equal(session.messages.at(-1).type, 'DBS_TREASURY_SAVE');
assert.equal(session.messages.at(-1).state.bancos[0].id, 'bank-1');

// A full cache must not prevent restoring a valid local state or sending it to the cloud.
session = treasurySession({ getItem: () => JSON.stringify({ bancos: [{ id: 'retained' }] }), setItem() { throw Error('QuotaExceededError'); } });
vm.runInContext('init()', session.context);
assert.equal(session.messages.at(-1).type, 'DBS_TREASURY_READY');
assert.equal(session.messages.at(-1).state.bancos[0].id, 'retained');
const normalized = vm.runInContext('normalizeTreasuryState({ bancos: [{id:"legacy"}], custom: "keep", _meta: { custom: "keep" } })', session.context);
assert.equal(normalized.bancos[0].id, 'legacy');
assert.equal(normalized.custom, 'keep');
assert.equal(normalized._meta.custom, 'keep');
assert.ok(Array.isArray(normalized.recebimentos) && Array.isArray(normalized._meta.fechamentos));

// Receiving valid DBS Control cloud data must render even when the local cache is full.
const dbsSource = scripts('public/dbs-control.html').find(source => source.includes('let ERP_STATE = loadState()'));
const dbsTree = ts.createSourceFile('dbs.js', dbsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let hydrationHandler;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(dbsTree) === 'window.addEventListener' && node.arguments[0]?.text === 'message' && ts.isFunctionExpression(node.arguments[1]) && node.arguments[1].getText(dbsTree).includes('countStateRecords')) hydrationHandler = node.arguments[1].getText(dbsTree);
  ts.forEachChild(node, visit);
}
visit(dbsTree);
assert.ok(hydrationHandler);
let renderCount = 0;
const parent = {};
const context = vm.createContext({
  window: { parent, location: { search: '', origin: 'https://dbs.example' } }, URLSearchParams,
  ERP_STATE: { ordens: [] }, DBS_CONTROL_HAS_PENDING_SAVE: false,
  DBS_CONTROL_STATE_VERSION: 6, DBS_CONTROL_LOCAL_RECOVERY_MODE: true, DBS_CONTROL_CLOUD_READY: false,
  DBS_CONTROL_DB_AUDIT_REQUESTED: true,
  getPersistableState: () => ({ ordens: [] }), criarSnapshotHistoricoOS: () => ({}),
  renderizarTudo: () => renderCount++, localStorage: { setItem() { throw Error('QuotaExceededError'); } },
  console: { warn() {} },
});
const hydrate = vm.runInContext(`(${hydrationHandler})`, context);
hydrate({ source: parent, origin: 'https://dbs.example', data: { type: 'DBS_CONTROL_CLOUD_STATE', state: { ordens: [{ id: 'os-1' }] } } });
assert.equal(renderCount, 1);
assert.equal(context.ERP_STATE.ordens[0].id, 'os-1');
assert.equal(context.DBS_CONTROL_CLOUD_READY, true);
console.log('Module recovery: canonical routes, legacy financial state, corrupt/blocked/full caches and DBS Control cloud hydration passed.');

#!/usr/bin/env node
// scripts/test-concurrent-save.cjs
// Usage: SUPABASE_URL=https://xyz.supabase.co SUPABASE_SERVICE_ROLE_KEY=... TEST_ENV=staging CONCURRENT=5 node scripts/test-concurrent-save.cjs
// This improved script issues multiple concurrent RPC calls to dbs_control_save_snapshot_safe_v2
// against the SAME scope and SAME work order to exercise true contention and then verifies
// the audit records in dbs_control_sync_runs. It refuses to run unless TEST_ENV is set to a non-production value.

const fetch = globalThis.fetch || require('node-fetch');
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Env SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(2);
}

const TEST_ENV = process.env.TEST_ENV || 'development';
if (!/dev|staging|test|qa/i.test(TEST_ENV)) {
  console.error('Refusing to run: TEST_ENV must be one of dev/staging/test/qa (prevent accidental run in production). Current:', TEST_ENV);
  process.exit(2);
}

const url = process.env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/dbs_control_save_snapshot_safe_v2';
const restTableUrl = process.env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/dbs_control_sync_runs';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function makePayload(commonScope, orderId, instance) {
  const now = new Date().toISOString();
  return {
    p_payload: {
      scope_key: commonScope,
      company_id: null,
      owner_user_id: null,
      state: {
        ordens: [
          { id: orderId, protocolo: `TEST-${orderId}`, status: 'Em Atendimento', version: 1, observacao: `concurrent run ${instance} at ${now}` }
        ]
      },
      state_version: 1,
      updated_by: 'tester',
      updated_at: now,
      base_updated_at: null
    }
  };
}

async function callOnce(commonScope, orderId, i) {
  const payload = makePayload(commonScope, orderId, i);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch (e) {}
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function fetchAuditRecords(commonScope) {
  const filter = encodeURIComponent(`scope_key=eq.${commonScope}`);
  const q = `${restTableUrl}?scope_key=eq.${encodeURIComponent(commonScope)}&order=started_at.desc`;
  try {
    const res = await fetch(q, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) {
      const t = await res.text();
      return { error: `Audit fetch failed: ${res.status} ${t}` };
    }
    const data = await res.json();
    return { data };
  } catch (err) {
    return { error: String(err) };
  }
}

(async () => {
  const concurrent = parseInt(process.env.CONCURRENT || '5', 10);
  const commonScope = process.env.SCOPE_KEY || `test:concurrency`;
  const orderId = process.env.ORDER_ID || `concurrent-order-1`;

  console.log('TEST_ENV=', TEST_ENV);
  console.log('Will issue', concurrent, 'concurrent RPC calls to', url, 'using scope', commonScope, 'and orderId', orderId);

  const promises = [];
  for (let i = 0; i < concurrent; i++) promises.push(callOnce(commonScope, orderId, i + 1));
  const results = await Promise.all(promises);

  for (let i = 0; i < results.length; i++) {
    console.log('--- RPC result', i + 1, '---');
    const r = results[i];
    if (r.error) console.error('ERROR:', r.error);
    else console.log('ok=', r.ok, 'status=', r.status, 'body=', JSON.stringify(r.body));
  }

  console.log('Querying audit records for scope', commonScope);
  const audit = await fetchAuditRecords(commonScope);
  if (audit.error) {
    console.error('Failed to fetch audit records:', audit.error);
    process.exit(4);
  }

  const records = audit.data || [];
  console.log('Audit records count for scope', commonScope, ':', records.length);
  // Summarize statuses
  const summary = records.reduce((acc, rec) => {
    const st = (rec.status || 'unknown');
    acc[st] = (acc[st] || 0) + 1;
    return acc;
  }, {});
  console.log('Audit status summary:', summary);

  // Look for retries/errors/success
  const hasSuccess = records.some(r => r.status === 'success');
  const hasRetry = records.some(r => r.status === 'retry');
  const hasError = records.some(r => r.status === 'error');

  console.log('hasSuccess=', hasSuccess, 'hasRetry=', hasRetry, 'hasError=', hasError);

  if (!hasSuccess) {
    console.error('No successful snapshot save found in audit records for this scope. Test failed.');
    process.exit(3);
  }

  console.log('Concurrent save smoke test completed. Check the audit records and the saved snapshot in the database for verification.');
})();

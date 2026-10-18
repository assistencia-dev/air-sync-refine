#!/usr/bin/env node
// scripts/test-concurrent-save.cjs
// Usage: SUPABASE_URL=https://xyz.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/test-concurrent-save.cjs
// This script issues multiple concurrent RPC calls to dbs_control_save_snapshot_safe_v2 to exercise locking/retry.

const fetch = globalThis.fetch || require('node-fetch');
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Env SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(2);
}

const url = process.env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/dbs_control_save_snapshot_safe_v2';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function makePayload(instance) {
  const now = new Date().toISOString();
  return {
    p_payload: {
      scope_key: `test:concurrency:${instance}`,
      company_id: null,
      owner_user_id: null,
      state: {
        ordens: [
          { id: `test-${instance}`, protocolo: `TEST-${instance}`, status: 'Em Atendimento', version: 1, observacao: `concurrent run ${instance} at ${now}` }
        ]
      },
      state_version: 1,
      updated_by: 'tester',
      updated_at: now,
      base_updated_at: null
    }
  };
}

async function callOnce(i) {
  const payload = makePayload(i);
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

(async () => {
  const concurrent = parseInt(process.env.CONCURRENT || '5', 10);
  console.log('Will issue', concurrent, 'concurrent RPC calls to', url);
  const promises = [];
  for (let i = 0; i < concurrent; i++) promises.push(callOnce(i + 1));
  const results = await Promise.all(promises);
  for (let i = 0; i < results.length; i++) {
    console.log('--- result', i + 1, '---');
    const r = results[i];
    if (r.error) console.error('ERROR:', r.error);
    else console.log('ok=', r.ok, 'status=', r.status, 'body=', JSON.stringify(r.body));
  }
  const failures = results.filter(r => !r.ok);
  if (failures.length) process.exit(3);
  console.log('All requests completed (some may indicate retries/conflicts in response body).');
})();

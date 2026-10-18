Fix branch: reinstate missing runtime checks, add concurrency test and CI check script.

What to run locally / in CI

1) Create DB dump (mandatory before applying migrations):
   pg_dump -Fc --no-acl --no-owner "$DATABASE_URL" -f db-current-backup.dump

2) Run the automated checks (in the repository root):
   chmod +x scripts/run-ci-checks.sh
   ./scripts/run-ci-checks.sh

3) Run the concurrent save smoke test against the target Supabase project using a service role key:
   SUPABASE_URL=https://<proj>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role_key> CONCURRENT=5 node scripts/test-concurrent-save.cjs

Notes
- The concurrent RPC test calls the PostgREST RPC endpoint /rpc/dbs_control_save_snapshot_safe_v2 and requires a valid service role key (use with caution).
- Do NOT run migrations until missing migration files are restored and the migration failures investigated.

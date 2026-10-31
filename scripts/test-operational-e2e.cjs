const { spawnSync } = require("node:child_process");

const checks = [
  "scripts/test-module-recovery.cjs",
  "scripts/test-auth-boundary.cjs",
  "scripts/test-runtime-loader.cjs",
  "scripts/test-preview-imports.mjs",
  "scripts/test-dbs-control.cjs",
  "scripts/test-performance-contracts.cjs",
  "scripts/test-dbs-control-resilience.cjs",
  "scripts/test-dbs-control-50-sessions.cjs",
  "scripts/test-rh-point-integrity.cjs",
  "scripts/test-rh-collaborator-scale.cjs",
  "scripts/test-data-protection.cjs",
  "scripts/test-treasury-ledger.cjs",
  "scripts/test-inventory-financial-bridge.cjs",
];

for (const script of checks) {
  console.log(`\n=== operational check: ${script} ===`);
  const result = spawnSync(process.execPath, [script], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    throw new Error(`Falha no teste operacional: ${script}`);
  }
}

console.log(`\nOperational E2E: ${checks.length} checks passed.`);

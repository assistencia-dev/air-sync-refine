const fs = require("node:fs");
const assert = require("node:assert/strict");

const migration = fs.readFileSync("supabase/migrations/20261104100000_rh_ponto_geocoding_evidence.sql", "utf8");
const types = fs.readFileSync("src/integrations/supabase/types.ts", "utf8");

for (const column of [
  "address_text", "address_components", "address_provider", "address_resolved_at",
  "address_status", "risk_flags", "review_status", "review_note", "reviewed_by", "reviewed_at",
]) {
  assert.match(migration, new RegExp("ADD COLUMN IF NOT EXISTS " + column), `Migration deve adicionar ${column} de forma idempotente.`);
  assert.match(types, new RegExp("\\b" + column + "\\??:"), `Tipos Supabase devem declarar ${column}.`);
}

assert.match(migration, /address_status IN \('ok', 'pendente', 'falha', 'sem_localizacao'\)/);
assert.match(migration, /review_status IN \('nao_requerida', 'pendente', 'aprovada', 'ajustada'\)/);
assert.match(migration, /FOREIGN KEY \(reviewed_by\) REFERENCES public\.users\(id\)/);
assert.match(migration, /WHERE review_status = 'pendente'/);
assert.match(migration, /OLD\.punched_at IS DISTINCT FROM NEW\.punched_at/);
for (const evidence of ["latitude", "longitude", "gps_accuracy_m", "address_text", "address_components", "address_provider", "address_resolved_at"]) {
  assert.match(migration, new RegExp(`OLD\\.${evidence} IS DISTINCT FROM NEW\\.${evidence}`), `Trigger deve proteger ${evidence}.`);
}
assert.match(migration, /request_role.*service_role/);
assert.match(migration, /current_user <> 'service_role'/);
assert.match(migration, /CREATE TRIGGER rh_ponto_evidence_immutable/);
assert.match(migration, /IF NOT EXISTS \([\s\S]*?tgname = 'rh_ponto_evidence_immutable'/);
assert.doesNotMatch(migration, /\b(DROP TABLE|TRUNCATE|DROP COLUMN|RENAME COLUMN)\b/i);
assert.doesNotMatch(migration, /CREATE POLICY|ALTER POLICY|ENABLE ROW LEVEL SECURITY/i);
assert.doesNotMatch(migration, /photo_data\s*=/i);

console.log("PASS: 10 campos aditivos, constraints idempotentes, FK, índice parcial e proteção imutável das evidências.");
console.log("PASS: RLS e photo_data não foram alterados; nenhuma operação destrutiva detectada.");

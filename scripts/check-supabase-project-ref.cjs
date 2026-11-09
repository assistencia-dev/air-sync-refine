const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const OFFICIAL_REF = "gdglototcrehvhkvcqsq";
const OFFICIAL_URL = `https://${OFFICIAL_REF}.supabase.co`;
const RETIRED_REF = "vtwzsuwxjrryagpjfmty";
const files = [
  ".env",
  "supabase/config.toml",
  "src/integrations/supabase/project-config.ts",
];
const errors = [];
for (const relative of files) {
  const full = path.join(ROOT, relative);
  if (!fs.existsSync(full)) {
    errors.push(`Arquivo obrigatório ausente: ${relative}`);
    continue;
  }
  const content = fs.readFileSync(full, "utf8");
  if (content.includes(RETIRED_REF)) errors.push(`${relative} ainda referencia o projeto Supabase antigo.`);
  if (!content.includes(OFFICIAL_REF)) errors.push(`${relative} não fixa o projeto oficial ${OFFICIAL_REF}.`);
  if (relative !== "supabase/config.toml" && !content.includes(OFFICIAL_URL)) {
    errors.push(`${relative} não contém a URL oficial ${OFFICIAL_URL}.`);
  }
}
if (errors.length) {
  console.error("\n[DBS AIR] BUILD BLOQUEADO: configuração Supabase divergente.\n" + errors.map((e) => ` - ${e}`).join("\n"));
  process.exit(1);
}
console.log(`[DBS AIR] Supabase target validado: ${OFFICIAL_REF}`);

const fs = require("node:fs");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const fns = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");
const treasuryFns = fs.readFileSync("src/lib/treasury.functions.ts", "utf8");
const treasuryRoute = fs.readFileSync("src/routes/_authenticated/treasury.tsx", "utf8");
const treasuryHtml = fs.readFileSync("public/treasury.html", "utf8");
const migration = fs.readFileSync(
  "supabase/migrations/20261103200000_dbs_phase3_ledger_reporting_views.sql",
  "utf8",
);
const reservationGuard = fs.readFileSync(
  "supabase/migrations/20261103210000_dbs_phase2_reservation_sync_guard.sql",
  "utf8",
);

for (const view of [
  "treasury_vw_dre_competence_by_account",
  "treasury_vw_dre_competence",
  "treasury_vw_cash_flow_monthly_by_account",
  "treasury_vw_cash_flow_monthly",
]) {
  assert.match(migration, new RegExp("create or replace view public\\." + view, "i"));
}
assert.equal((migration.match(/with \(security_invoker = true\)/gi) || []).length, 4);
assert.match(migration, /from public\.treasury_ledger_entries/i);
assert.match(migration, /join public\.treasury_ledger_lines/i);
assert.match(migration, /join public\.treasury_accounts/i);
assert.match(migration, /where e\.status='posted'/i);
assert.ok(migration.includes("and e.entry_type not in ('installment_payment','installment_reversal')"), "debt principal payments must not inflate operating DRE");
assert.match(migration, /e\.competence_date/i);
assert.match(migration, /a\.account_type='revenue'/i);
assert.match(migration, /a\.account_type='expense'/i);
assert.match(migration, /coalesce\(e\.document_date,e\.competence_date\)/i);
assert.match(migration, /a\.code='1\.1\.01'/i);
assert.match(migration, /a\.code like 'bank:%'/i, "cash flow must include the bank:<id> account codes used by Treasury");
assert.ok(treasuryFns.includes('status === "posted"'), "reports must exclude draft Ledger entries");
assert.ok(treasuryFns.includes(String.raw`/^(?:1\.1\.01(?:\.|$)|bank:)/`), "cash account coverage must recognize standard and bank:<id> codes");
assert.match(treasuryFns, /filter\(\(entry: any\) => entry\.status === "posted"\)/, "reports must exclude draft Ledger entries");
assert.match(treasuryFns, /ledgerEntryIds = \(entries \?\? \[\]\)\.filter\(\(entry: any\) => entry\.status === "posted"\)/, "only posted Ledger entries should load report lines");
assert.match(treasuryFns, /reversed_entry_id/, "Ledger report entries must include reversal references");
assert.match(treasuryRoute, /ledgerReport: cloud\?\.ledger_report \?\? null/, "scoped Ledger reports must reach the Finance iframe");
assert.match(treasuryHtml, /LEDGER_REPORT = msg\.ledgerReport/, "Finance iframe must receive the Ledger report");
assert.match(treasuryHtml, /renderLedgerDre\(\)/, "Finance DRE must render the Ledger report");
assert.match(treasuryHtml, /ledger-cash-in/);
assert.match(treasuryHtml, /ledger-cash-out/);
assert.match(treasuryHtml, /installment_payment.*installment_reversal|installment_reversal.*installment_payment/s, "debt principal payments must remain outside operating expenses");
assert.ok(treasuryFns.includes("reversed_entry_id"), "Ledger report entries must include reversal references");
assert.match(migration, /opening_balance_cents/i);
assert.match(migration, /closing_balance_cents/i);
assert.match(migration, /rows between unbounded preceding and current row/i);
assert.match(migration, /grant select on public\.treasury_vw_dre_competence_by_account/i);
assert.doesNotMatch(migration, /dbs_control_|dbs_purchase_|dbs_control_work_orders/i);
assert.doesNotMatch(migration, /\b(drop|truncate)\s+(table|view|schema|column)\b/i);
assert.doesNotMatch(migration, /\b(insert|update|delete)\s+into?\s+public\./i);

assert.match(reservationGuard, /dbs_control_apply_work_order_delta_with_reservations/i);
assert.match(reservationGuard, /where work_order_id=v_order_id and status='reserved'/i);
assert.match(reservationGuard, /coalesce\(r\.reserved_qty,0\)/i);
assert.match(reservationGuard, /dbs_control_consume_work_order_reservations/i);
assert.match(reservationGuard, /dbs_control_reserve_work_order_parts_serialized/i);
assert.match(reservationGuard, /dbs_control_release_work_order_reservation_serialized/i);
assert.match(reservationGuard, /dbs_control_consume_work_order_reservations_serialized/i);
assert.match(reservationGuard, /dbs-os-reservations:/i);
assert.match(fns, /dbs_control_reserve_work_order_parts_serialized/);
assert.match(fns, /dbs_control_release_work_order_reservation_serialized/);

assert.match(reservationGuard, /v_status in/i);
assert.doesNotMatch(reservationGuard, /drop\s+(table|view|function)|truncate\s/i);



const renderMatch = treasuryHtml.match(/function renderLedgerDre\(\) \{[\s\S]*?\n    \}\n\n    \/\/ ===== Livro Caixa/);
assert.ok(renderMatch, "Ledger DRE renderer must be extractable for behavioral tests");
const nodes = new Map();
const sandbox = {
  LEDGER_REPORT: {
    entries: [
      { status: "posted", entryType: "service_revenue", competenceDate: "2026-11-10", displayDate: "2026-11-10", lines: [
        { account: { accountType: "revenue", code: "revenue:service" }, debitCents: 0, creditCents: 10000 },
      ] },
      { status: "posted", entryType: "operating_expense", competenceDate: "2026-11-11", displayDate: "2026-11-11", lines: [
        { account: { accountType: "expense", code: "expense:rent" }, debitCents: 2500, creditCents: 0 },
      ] },
      { status: "posted", entryType: "installment_payment", competenceDate: "2026-11-12", displayDate: "2026-11-12", lines: [
        { account: { accountType: "expense", code: "expense:passivo" }, debitCents: 3000, creditCents: 0 },
        { account: { accountType: "asset", code: "bank:account-1" }, debitCents: 0, creditCents: 3000 },
      ] },
      { status: "posted", entryType: "installment_reversal", competenceDate: "2026-11-13", displayDate: "2026-11-13", lines: [
        { account: { accountType: "expense", code: "expense:passivo" }, debitCents: 0, creditCents: 3000 },
        { account: { accountType: "asset", code: "bank:account-1" }, debitCents: 3000, creditCents: 0 },
      ] },
      { status: "draft", entryType: "service_revenue", competenceDate: "2026-11-14", displayDate: "2026-11-14", lines: [
        { account: { accountType: "revenue", code: "revenue:draft" }, debitCents: 0, creditCents: 5000 },
      ] },
    ],
  },
  document: {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { value: id === "global-period-filter" ? "2026-11" : "", textContent: "", style: {} });
      return nodes.get(id);
    },
  },
};
vm.runInNewContext(renderMatch[0], sandbox);
sandbox.renderLedgerDre();
assert.equal(nodes.get("ledger-dre-revenue").textContent, "R$ 100,00");
assert.equal(nodes.get("ledger-dre-expenses").textContent, "R$ 25,00");
assert.equal(nodes.get("ledger-dre-result").textContent, "R$ 75,00");
assert.equal(nodes.get("ledger-cash-in").textContent, "R$ 30,00");
assert.equal(nodes.get("ledger-cash-out").textContent, "R$ 30,00");
assert.equal(nodes.get("ledger-dre-empty").style.display, "none");

console.log("Phase 3 Ledger reporting: DRE by competence, cash flow by document date, security_invoker and read-only source invariants verified.");

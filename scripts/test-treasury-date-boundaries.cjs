const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const tsSource = fs.readFileSync("src/lib/brazil-date.ts", "utf8");
const jsSource = fs.readFileSync("public/dbs-treasury-date.js", "utf8");
const viewer = fs.readFileSync("src/lib/treasury-viewer.functions.ts", "utf8");
const html = fs.readFileSync("public/treasury.html", "utf8");

const compiled = ts.transpileModule(tsSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const exportsObject = {};
vm.runInNewContext(compiled, { exports: exportsObject, Intl, Date, Error, Number, String, Math });

const browserWindow = {};
vm.runInNewContext(jsSource, { window: browserWindow, Intl, Date, Error, Number, String, Math });
const dates = browserWindow.DbsTreasuryDates;

const lateNightUtc = new Date("2026-11-19T02:30:00.000Z");
const afterMidnightUtc = new Date("2026-11-19T03:01:00.000Z");
assert.equal(exportsObject.brazilBusinessDateKey(lateNightUtc), "2026-11-18");
assert.equal(dates.today(lateNightUtc), "2026-11-18");
assert.equal(exportsObject.brazilBusinessDateKey(afterMidnightUtc), "2026-11-19");
assert.equal(dates.today(afterMidnightUtc), "2026-11-19");

assert.equal(exportsObject.addBrazilCalendarDays("2026-11-30", 1), "2026-12-01");
assert.equal(dates.addDays("2026-12-31", 1), "2027-01-01");
assert.equal(dates.addDays("2024-02-28", 1), "2024-02-29");
assert.equal(dates.addDays("2024-02-29", 1), "2024-03-01");
assert.equal(exportsObject.differenceInBrazilCalendarDays("2026-11-18", "2026-11-19"), 1);
assert.equal(dates.differenceInDays("2026-11-18", "2026-11-19"), 1);
assert.equal(dates.differenceInDays("2026-11-19", "2026-11-18"), -1);
assert.deepEqual(JSON.parse(JSON.stringify(dates.monthRange("2026-11-19", 1))), {
  start: "2026-12-01", end: "2026-12-31"
});
assert.equal(dates.normalize("2026-11-19T23:59:00Z"), "2026-11-19");
assert.equal(dates.normalize("19/11/2026"), "2026-11-19");
assert.equal(dates.normalize("31/02/2026"), null);
assert.equal(dates.matchesRange("2026-12-15", "2026-12-01", "2026-12-31"), true);
assert.equal(dates.matchesRange("2027-01-01", "2026-12-01", "2026-12-31"), false);

assert.match(viewer, /brazilBusinessDateKey/);
assert.match(viewer, /addBrazilCalendarDays/);
assert.match(html, /dbs-treasury-date\.js/);
assert.match(html, /TREASURY_DATES\.today/);
assert.match(html, /TREASURY_DATES\.differenceInDays/);
assert.match(html, /TREASURY_DATES\.matchesRange/);
assert.doesNotMatch(html, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);

console.log("Treasury Brazil date boundaries: timezone, month rollover, leap day, date-only filtering verified.");

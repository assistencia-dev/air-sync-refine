const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const sharedUi = read("public/dbs-design-system.css");
const appRoot = read("src/routes/__root.tsx");
const admin = read("src/routes/_authenticated/admin.tsx");
const inventory = read("src/routes/_authenticated/dbs-inventory.tsx");
const dbsControl = read("public/dbs-control.html");
const treasury = read("public/treasury.html");
const mobileNavigation = read("src/components/MobileAdminNavigation.tsx");
const appStyles = read("src/styles.css");
const publicHome = read("src/routes/index.tsx");
const financeViewer = read("src/routes/_authenticated/financeiro-acompanhamento.tsx");

assert.match(sharedUi, /--dbs-ui-brand:\s*#1769d1/i);
assert.match(sharedUi, /\.admin-mobile-shell/);
assert.match(sharedUi, /\.dbs-operations-page/);
assert.match(sharedUi, /\.osv-head/);
assert.match(sharedUi, /\.sidebar \.nav-item/);
assert.match(sharedUi, /\.approval-row/);
assert.match(sharedUi, /:focus-visible/);
assert.match(sharedUi, /prefers-reduced-motion/);
assert.match(sharedUi, /body:has\(> aside \.nav-menu\)/, "Os estilos legados do DBS CONTROL devem ficar isolados.");
assert.match(sharedUi, /body:has\(\.sidebar-brand\)/, "Os estilos do Treasury devem ficar isolados do shell React.");

const stylesheetPath = /\/dbs-design-system\.css\?v=20261118-visual-refinement-1/;
assert.match(appRoot, stylesheetPath, "A camada compartilhada deve carregar no shell React.");
assert.match(dbsControl, stylesheetPath, "DBS CONTROL legado deve receber a mesma camada visual.");
assert.match(treasury, stylesheetPath, "DBS TREASURY deve receber a mesma camada visual.");
assert.equal((appRoot.match(/dbs-design-system\.css/g) || []).length, 1);
assert.equal((dbsControl.match(/dbs-design-system\.css/g) || []).length, 1);
assert.equal((treasury.match(/dbs-design-system\.css/g) || []).length, 1);

// Guardas de preservação: a revisão de interface não pode retirar as
// superfícies e ações operacionais já existentes.
assert.match(dbsControl, /dbs-control-os-viewer\.js/);
assert.match(dbsControl, /tab-ordens/);
assert.match(dbsControl, /tab-pecas/);
assert.match(dbsControl, /tab-compras/);
assert.match(dbsControl, /abrirVisualizacaoOS/);
assert.match(dbsControl, /exportarSelecionadasPDF/);
assert.match(inventory, /Peças & Estoque/);
assert.match(inventory, /Compras/);
assert.match(inventory, /Recebimento físico/);
assert.match(treasury, /mod-aprovacoes/);
assert.match(treasury, /DBS_TREASURY_DECIDE_PURCHASE_APPROVAL/);
assert.match(mobileNavigation, /Navegação administrativa/);
assert.match(mobileNavigation, /Encerrar sessão/);
assert.match(mobileNavigation, /currentPage\?: NavigationPage/);
assert.match(mobileNavigation, /aria-current=\{currentPage === "tickets"/);
assert.match(mobileNavigation, /aria-haspopup="dialog"/);
assert.match(appStyles, /\.admin-mobile-menu-item\[aria-current="page"\]/);
assert.match(admin, /flex flex-col gap-3 p-4 sm:flex-row/);
assert.match(admin, /Assumido por:/);
assert.match(admin, /Motivo do cancelamento:/);
assert.match(financeViewer, /showAdminNavigation = roleKey === "SUPER_ADMIN"/);
assert.match(financeViewer, /setRoleKey\(profile\.role_key \?\? null\)/);
assert.match(financeViewer, /\{showAdminNavigation && <MobileAdminNavigation/);
assert.match(publicHome, /aria-expanded=\{menuOpen\}/);
assert.match(publicHome, /aria-controls="public-mobile-navigation"/);
assert.match(publicHome, /aria-expanded=\{expandedFaq === idx\}/);

// O status do cabeçalho não deve afirmar conectividade sem uma checagem real.
assert.doesNotMatch(admin, /Operação online/);
assert.match(admin, /Acesso administrativo/);

console.log("DBS AIR shared interface layer, responsive navigation, OS viewer, inventory and Treasury preservation checks passed.");

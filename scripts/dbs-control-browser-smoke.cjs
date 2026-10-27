const { chromium } = require("playwright");

const baseUrl = process.env.DBS_CONTROL_URL || "https://air-sync-refine.lovable.app/dbs-control";
const e2eIdentifier = process.env.DBS_E2E_IDENTIFIER || process.env.DBS_E2E_EMAIL || "";
const e2ePassword = process.env.DBS_E2E_PASSWORD || "";
const errors = [];
const failedRequests = [];

async function authenticateIfConfigured(page) {
  if (!e2eIdentifier && !e2ePassword) return false;
  if (!e2eIdentifier || !e2ePassword) {
    throw new Error("DBS_E2E_IDENTIFIER/DBS_E2E_EMAIL e DBS_E2E_PASSWORD devem ser configurados juntos.");
  }

  const origin = new URL(baseUrl).origin;
  await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("#portal-identifier").fill(e2eIdentifier);
  await page.locator("#portal-password").fill(e2ePassword);
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(2500);

  const loginError = await page.locator('[role="alert"]').first().textContent().catch(() => "");
  if (loginError?.trim()) throw new Error("Falha no login E2E: " + loginError.trim());
  if (new URL(page.url()).pathname === "/login") {
    throw new Error("O login E2E permaneceu na tela de autenticação.");
  }
  return true;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    page.on("pageerror", (error) => errors.push("pageerror: " + error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push("console: " + message.text());
    });
    page.on("requestfailed", (request) => {
      const url = request.url();
      if (!/favicon|\.png(?:\?|$)|\.jpg(?:\?|$)|\.svg(?:\?|$)/i.test(url)) {
        failedRequests.push(url + " — " + (request.failure()?.errorText || "request failed"));
      }
    });

    const authenticated = await authenticateIfConfigured(page);
    const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (!response || response.status() >= 400) {
      throw new Error("DBS Control respondeu com HTTP " + (response?.status() ?? "sem resposta"));
    }
    await page.waitForTimeout(8000);

    const title = await page.title();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (!bodyText.trim()) errors.push("A página carregou sem conteúdo visível.");
    if (authenticated) {
      const iframe = page.locator("iframe").first();
      if (await iframe.count() !== 1) errors.push("O shell autenticado não renderizou o workspace do DBS Control.");
      const frame = await iframe.contentFrame();
      if (!frame) {
        errors.push("Não foi possível acessar o workspace do DBS Control dentro do iframe.");
      } else {
        await frame.locator("body").waitFor({ state: "visible", timeout: 15000 });
        const frameText = await frame.locator("body").innerText().catch(() => "");
        if (!/DBS\s*CONTROL/i.test(frameText)) errors.push("O workspace autenticado abriu sem a identificação do DBS Control.");
      }
    }
    console.log("URL:", page.url());
    console.log("Título:", title || "(sem título)");
    console.log("Modo:", authenticated ? "autenticado" : "público");
    console.log("Conteúdo visível:", bodyText.trim().slice(0, 300).replace(/\s+/g, " "));

    if (errors.length || failedRequests.length) {
      if (errors.length) console.error("\nErros de navegador:\n" + errors.join("\n"));
      if (failedRequests.length) console.error("\nRequisições que falharam:\n" + failedRequests.join("\n"));
      process.exitCode = 1;
    } else {
      console.log("DBS Control browser smoke test: aprovado.");
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

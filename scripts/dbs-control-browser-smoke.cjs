const { chromium } = require("playwright");

const baseUrl = process.env.DBS_CONTROL_URL || "https://air-sync-refine.lovable.app/dbs-control";
const errors = [];
const failedRequests = [];

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

    const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (!response || response.status() >= 400) {
      throw new Error("DBS Control respondeu com HTTP " + (response?.status() ?? "sem resposta"));
    }
    await page.waitForTimeout(8000);

    const title = await page.title();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (!bodyText.trim()) errors.push("A página carregou sem conteúdo visível.");
    console.log("URL:", page.url());
    console.log("Título:", title || "(sem título)");
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

import { expect, test, type FrameLocator, type Page } from "@playwright/test";

const e2eEmail = process.env.DBS_E2E_EMAIL?.trim() || "";
const e2ePassword = process.env.DBS_E2E_PASSWORD || "";
const isolationEmail = process.env.DBS_E2E_EMAIL_B?.trim() || "";
const isolationPassword = process.env.DBS_E2E_PASSWORD_B || "";

test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.locator("#portal-identifier").fill(email);
  await page.locator("#portal-password").fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login(?:[/?]|$)/, { timeout: 60_000 });
}

async function controlFrame(page: Page): Promise<FrameLocator> {
  const iframe = page.locator('iframe[title="DBS CONTROL"]');
  await expect(iframe).toHaveCount(1, { timeout: 60_000 });
  const frame = page.frameLocator('iframe[title="DBS CONTROL"]');
  await expect(frame.getByTestId("sync-status")).toBeVisible({ timeout: 60_000 });
  return frame;
}

async function openNewOrder(frame: FrameLocator) {
  const create = frame.getByTestId("create-os");
  await expect(create).toBeVisible({ timeout: 30_000 });
  await create.click();
  await expect(frame.getByTestId("os-client")).toBeVisible({ timeout: 30_000 });

  const clientOptions = frame.locator("#os-client-options option");
  await expect(clientOptions.first()).toBeAttached({ timeout: 30_000 });
  const clientValue = String((await clientOptions.first().getAttribute("value")) || "").trim();
  if (!clientValue) throw new Error("A base de teste não possui cliente selecionável para o fluxo de OS.");

  const clientInput = frame.getByTestId("os-client");
  await clientInput.fill(clientValue);
  await clientInput.press("Tab");
  await expect(frame.locator("#os-select-cliente")).toHaveValue(/.+/, { timeout: 15_000 });

  const equipmentInput = frame.getByTestId("os-equipment");
  await equipmentInput.click();
  const equipmentOption = frame.locator(".dbs-equipment-option").first();
  await expect(equipmentOption).toBeVisible({ timeout: 30_000 });
  await equipmentOption.click();

  // O select de técnico é mantido para compatibilidade do formulário legado.
  // Em modo colaborador a gravação usa o employee_id da sessão, mas o browser
  // ainda precisa satisfazer a validação nativa do campo oculto quando houver
  // uma opção disponível na base de teste.
  const technician = frame.locator("#os-select-tecnico");
  if (!(await technician.inputValue())) {
    const technicianOptions = technician.locator("option");
    if (await technicianOptions.count() > 1) await technician.selectOption({ index: 1 });
  }

  await frame.getByTestId("save-new-os").click();
  const clientName = clientValue.split(" — ")[0].trim();
  const order = frame.locator(".employee-order").filter({ hasText: clientName }).last();
  await expect(order).toBeVisible({ timeout: 60_000 });
  const protocol = String((await order.locator(".employee-protocol").textContent()) || "").trim();
  if (!protocol) throw new Error("A OS criada não exibiu protocolo no workspace do colaborador.");
  return { order, protocol, clientName };
}

async function drawSignature(page: Page, canvas: ReturnType<FrameLocator["getByTestId"]>) {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Área de assinatura não ficou disponível no viewport.");
  const startX = box.x + Math.max(12, box.width * 0.18);
  const startY = box.y + box.height * 0.55;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.62, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.38, { steps: 4 });
  await page.mouse.up();
}

async function acceptDialogs(page: Page) {
  page.on("dialog", async dialog => {
    await dialog.accept();
  });
}

test("criar OS, assinar, operar offline, reconciliar a outbox e persistir após reload", async ({ page, context }) => {
  test.skip(!e2eEmail || !e2ePassword, "DBS_E2E_EMAIL/DBS_E2E_PASSWORD não configurados; o job de navegador deve ser pulado no CI.");
  await acceptDialogs(page);
  await loginAs(page, e2eEmail, e2ePassword);
  const frame = await controlFrame(page);
  const { order, protocol } = await openNewOrder(frame);

  await order.locator("details.employee-execution summary").click();
  await expect(order.getByTestId("technical-report")).toBeVisible({ timeout: 15_000 });
  await drawSignature(page, order.getByTestId("sign-os"));

  await context.setOffline(true);
  await order.getByTestId("technical-report").fill("Relatório offline de validação — alteração retida no dispositivo.");
  await order.getByTestId("save-os").click();

  const syncStatus = frame.getByTestId("sync-status");
  await expect(syncStatus).toContainText(/pendente|dispositivo|aguardando/i, { timeout: 20_000 });
  await expect(syncStatus).not.toContainText(/sincronizado|confirmado/i);
  await expect
    .poll(async () => Number((await frame.getByTestId("pending-changes-count").textContent()) || "0"), { timeout: 20_000 })
    .toBeGreaterThan(0);

  await context.setOffline(false);
  await expect
    .poll(async () => (await syncStatus.textContent()) || "", { timeout: 60_000 })
    .toMatch(/sincronizado|confirmado/i);
  await expect(frame.getByTestId("pending-changes-count")).toHaveText("0", { timeout: 30_000 });

  await page.reload({ waitUntil: "domcontentloaded" });
  const reloadedFrame = await controlFrame(page);
  await reloadedFrame.locator('li[onclick*="tab-pwa"]').click();
  await expect(reloadedFrame.locator(".employee-order").filter({ hasText: protocol })).toBeVisible({ timeout: 60_000 });
});

test("isolamento: o colaborador B não enxerga a OS criada pelo colaborador A", async ({ browser }) => {
  test.skip(
    !e2eEmail || !e2ePassword || !isolationEmail || !isolationPassword,
    "Para validar isolamento são necessários DBS_E2E_EMAIL(_B) e DBS_E2E_PASSWORD(_B) em uma base de teste isolada.",
  );

  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await acceptDialogs(pageA);
  await loginAs(pageA, e2eEmail, e2ePassword);
  const frameA = await controlFrame(pageA);
  const { protocol } = await openNewOrder(frameA);
  await contextA.close();

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  try {
    await acceptDialogs(pageB);
    await loginAs(pageB, isolationEmail, isolationPassword);
    const frameB = await controlFrame(pageB);
    await frameB.locator('li[onclick*="tab-pwa"]').click();
    const visibleOrders = (await frameB.locator(".employee-order").allTextContents()).join("\n");
    expect(visibleOrders).not.toContain(protocol);
  } finally {
    await contextB.close();
  }
});

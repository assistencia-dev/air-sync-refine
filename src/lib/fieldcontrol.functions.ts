import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BASE = "https://carchost.fieldcontrol.com.br";

type AppUser = { id: string; company_id: string | null; role_key: string; status: string };

async function requireDbsControlAdmin(context: { userId: string }) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, company_id, role_key, status")
    .eq("auth_id", context.userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.status !== "ativo") throw new Error("Usuário inativo ou não encontrado.");
  if (!["SUPER_ADMIN", "ADMIN_OPERACIONAL", "GESTOR_CONTA", "GESTOR_REGIONAL"].includes(data.role_key)) {
    throw new Error("Somente administradores do DBS CONTROL podem gerenciar a integração FieldControl.");
  }
  if (!data.company_id) throw new Error("Usuário sem empresa vinculada.");
  return data as AppUser;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeKey(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function jsonObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function pickId(item: any) {
  return normalizeText(item?.id ?? item?._id ?? item?.identifier);
}

function pickName(item: any) {
  return normalizeText(item?.name ?? item?.legalName ?? item?.tradeName ?? item?.description);
}

async function fetchJson(path: string, apiKey: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
  });
  const raw = await res.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { res, data };
}

async function listAll(path: string, apiKey: string, maxPages = 30) {
  const out: any[] = [];
  let totalCount: number | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * 100;
    const { res, data } = await fetchJson(`${path}?limit=100&offset=${offset}`, apiKey);
    if (!res.ok) {
      if (page === 0) throw new Error(`FieldControl ${path}: HTTP ${res.status}`);
      break;
    }
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    out.push(...items);
    totalCount = typeof data?.totalCount === "number" ? data.totalCount : totalCount;
    if (items.length < 100 || (totalCount != null && out.length >= totalCount)) break;
  }
  return { items: out, totalCount };
}

function addressFromCustomer(customer: any) {
  const a = jsonObject(customer?.address ?? customer?.primaryLocation?.address ?? customer?.location?.address);
  return {
    zipCode: normalizeText(a.zipCode ?? a.cep).replace(/\D/g, ""),
    street: normalizeText(a.street ?? a.logradouro ?? a.address),
    number: normalizeText(a.number ?? a.numero),
    complement: normalizeText(a.complement ?? a.complemento),
    neighborhood: normalizeText(a.neighborhood ?? a.bairro),
    city: normalizeText(a.city ?? a.cidade),
    state: normalizeText(a.state ?? a.uf ?? a.stateCode),
    coords: a.coords ?? null,
  };
}

function contactFromCustomer(customer: any) {
  const contacts = Array.isArray(customer?.contacts) ? customer.contacts : [];
  const first = jsonObject(contacts[0]);
  return {
    contact_name: normalizeText(customer?.contactName ?? first.name ?? customer?.responsibleName),
    contact_phone: normalizeText(customer?.phone ?? customer?.phoneNumber ?? first.phone ?? first.mobile),
    contact_email: normalizeText(customer?.email ?? customer?.emailAddress ?? first.email),
  };
}

function equipmentListFromCustomer(customer: any) {
  const raw = customer?.equipments ?? customer?.equipment ?? customer?.assets ?? [];
  return Array.isArray(raw) ? raw : [];
}

function externalOrderCustomerId(order: any) {
  const c = jsonObject(order?.customer);
  return pickId(c) || pickId(order?.customerId);
}

async function getIntegration(companyId: string) {
  const { data, error } = await supabaseAdmin
    .from("dbs_control_integrations")
    .select("id, api_key, status, last_test_at, last_sync_at, last_sync_status, last_sync_summary")
    .eq("company_id", companyId)
    .eq("provider", "fieldcontrol")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export const getFieldControlIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const user = await requireDbsControlAdmin(context);
    const integration = await getIntegration(user.company_id as string);
    return {
      configured: !!integration?.api_key,
      status: integration?.status ?? "inativo",
      last_test_at: integration?.last_test_at ?? null,
      last_sync_at: integration?.last_sync_at ?? null,
      last_sync_status: integration?.last_sync_status ?? null,
      last_sync_summary: integration?.last_sync_summary ?? {},
    };
  });

export const saveFieldControlApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { apiKey: string }) => {
    const apiKey = normalizeText(input?.apiKey);
    if (!apiKey || apiKey.length < 10) throw new Error("Informe uma chave de API FieldControl válida.");
    return { apiKey };
  })
  .handler(async ({ context, data }) => {
    const user = await requireDbsControlAdmin(context);
    const companyId = user.company_id as string;
    const { error } = await supabaseAdmin
      .from("dbs_control_integrations")
      .upsert({
        company_id: companyId,
        provider: "fieldcontrol",
        api_key: data.apiKey,
        status: "ativo",
        updated_by_user_id: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "company_id,provider" });
    if (error) throw new Error(error.message);
    return { ok: true, configured: true };
  });

export const testFieldControlConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const user = await requireDbsControlAdmin(context);
    const companyId = user.company_id as string;
    const integration = await getIntegration(companyId);
    if (!integration?.api_key) throw new Error("A chave de API do FieldControl ainda não foi configurada.");

    const started = Date.now();
    const { res, data } = await fetchJson("/customers?limit=1&offset=0", integration.api_key);
    const now = new Date().toISOString();
    if (!res.ok) {
      await supabaseAdmin.from("dbs_control_integrations").update({
        status: "inativo",
        last_test_at: now,
        last_sync_status: `teste_falhou_${res.status}`,
        updated_by_user_id: user.id,
        updated_at: now,
      }).eq("id", integration.id);
      throw new Error(`FieldControl recusou a conexão (HTTP ${res.status}).`);
    }

    await supabaseAdmin.from("dbs_control_integrations").update({
      status: "ativo",
      last_test_at: now,
      last_sync_status: "conexao_ok",
      updated_by_user_id: user.id,
      updated_at: now,
    }).eq("id", integration.id);

    return {
      ok: true,
      elapsed_ms: Date.now() - started,
      customers_available: typeof data?.totalCount === "number" ? data.totalCount : undefined,
    };
  });

export const syncFieldControl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { mode?: "preview" | "apply" }) => ({
    mode: input?.mode === "apply" ? "apply" as const : "preview" as const,
  }))
  .handler(async ({ context, data }) => {
    const user = await requireDbsControlAdmin(context);
    const companyId = user.company_id as string;
    const integration = await getIntegration(companyId);
    if (!integration?.api_key) throw new Error("Configure a chave de API do FieldControl antes de sincronizar.");

    const run = await supabaseAdmin.from("dbs_control_sync_runs").insert({
      company_id: companyId,
      provider: "fieldcontrol",
      mode: data.mode,
      status: "running",
      created_by_user_id: user.id,
    }).select("id").single();
    if (run.error) throw new Error(run.error.message);
    const runId = run.data.id;

    const errors: string[] = [];
    const summary: Record<string, any> = {
      customers: { fetched: 0, upserted: 0 },
      sites: { fetched: 0, upserted: 0 },
      equipment: { fetched: 0, upserted: 0 },
      services: { fetched: 0, upserted: 0 },
      orders: { fetched: 0, upserted: 0 },
      employees: { fetched: 0 },
      details_attempted: 0,
      details_failed: 0,
    };

    try {
      const [customersResult, servicesResult, employeesResult] = await Promise.all([
        listAll("/customers", integration.api_key),
        listAll("/services", integration.api_key),
        listAll("/employees", integration.api_key),
      ]);
      const customers = customersResult.items;
      const services = servicesResult.items;
      const employees = employeesResult.items;
      summary.customers.fetched = customers.length;
      summary.services.fetched = services.length;
      summary.employees.fetched = employees.length;

      const customerByExternal = new Map<string, any>();
      const localClientByExternal = new Map<string, string>();

      for (const c of customers) {
        const externalId = pickId(c);
        const name = pickName(c);
        if (!externalId || !name) continue;
        customerByExternal.set(externalId, c);

        if (data.mode === "preview") continue;

        const existingRef = await supabaseAdmin
          .from("dbs_control_external_refs")
          .select("local_id")
          .eq("company_id", companyId)
          .eq("provider", "fieldcontrol")
          .eq("entity_type", "client")
          .eq("external_id", externalId)
          .maybeSingle();
        if (existingRef.error) throw new Error(existingRef.error.message);

        const address = addressFromCustomer(c);
        const contact = contactFromCustomer(c);
        let localId = existingRef.data?.local_id as string | null | undefined;

        if (localId) {
          const { error } = await supabaseAdmin.from("dbs_control_clients").update({
            legal_name: normalizeText(c.legalName ?? name),
            trade_name: normalizeText(c.tradeName ?? name) || null,
            cnpj: normalizeText(c.cnpj ?? c.document ?? c.taxId) || null,
            phone: contact.contact_phone || null,
            email: contact.contact_email || null,
            notes: normalizeText(c.notes ?? c.observations) || null,
            updated_at: new Date().toISOString(),
          }).eq("id", localId).eq("company_id", companyId);
          if (error) throw new Error(error.message);
        } else {
          const { data: inserted, error } = await supabaseAdmin.from("dbs_control_clients").insert({
            company_id: companyId,
            legal_name: normalizeText(c.legalName ?? name),
            trade_name: normalizeText(c.tradeName ?? name) || null,
            cnpj: normalizeText(c.cnpj ?? c.document ?? c.taxId) || null,
            phone: contact.contact_phone || null,
            email: contact.contact_email || null,
            notes: normalizeText(c.notes ?? c.observations) || null,
          }).select("id").single();
          if (error) throw new Error(error.message);
          localId = inserted.id;
        }

        await supabaseAdmin.from("dbs_control_external_refs").upsert({
          company_id: companyId,
          provider: "fieldcontrol",
          entity_type: "client",
          external_id: externalId,
          local_id: localId,
          metadata: { name },
          updated_at: new Date().toISOString(),
        }, { onConflict: "company_id,provider,entity_type,external_id" });
        localClientByExternal.set(externalId, localId as string);
        summary.customers.upserted += 1;

        const address = addressFromCustomer(c);
        const locationId = pickId(c?.primaryLocation ?? c?.location);
        if (locationId && localId) {
          const locationRef = await supabaseAdmin
            .from("dbs_control_external_refs")
            .select("local_id")
            .eq("company_id", companyId)
            .eq("provider", "fieldcontrol")
            .eq("entity_type", "site")
            .eq("external_id", locationId)
            .maybeSingle();
          if (locationRef.error) throw new Error(locationRef.error.message);

          let siteId = locationRef.data?.local_id as string | null | undefined;
          if (siteId) {
            await supabaseAdmin.from("dbs_control_sites").update({
              client_id: localId,
              name: normalizeText(c?.primaryLocation?.name ?? c?.location?.name ?? "Local principal"),
              address_json: address,
              contact_name: contact.contact_name || null,
              contact_phone: contact.contact_phone || null,
              contact_email: contact.contact_email || null,
              updated_at: new Date().toISOString(),
            }).eq("id", siteId).eq("client_id", localId);
          } else {
            const { data: site, error } = await supabaseAdmin.from("dbs_control_sites").insert({
              client_id: localId,
              name: normalizeText(c?.primaryLocation?.name ?? c?.location?.name ?? "Local principal"),
              address_json: address,
              contact_name: contact.contact_name || null,
              contact_phone: contact.contact_phone || null,
              contact_email: contact.contact_email || null,
            }).select("id").single();
            if (error) throw new Error(error.message);
            siteId = site.id;
          }
          await supabaseAdmin.from("dbs_control_external_refs").upsert({
            company_id: companyId,
            provider: "fieldcontrol",
            entity_type: "site",
            external_id: locationId,
            local_id: siteId,
            metadata: { client_external_id: externalId },
            updated_at: new Date().toISOString(),
          }, { onConflict: "company_id,provider,entity_type,external_id" });
          summary.sites.fetched += 1;
          summary.sites.upserted += 1;
        }
      }

      // O cadastro de cliente do FieldControl pode carregar equipamentos embutidos.
      // Também tentamos o endpoint de detalhe para contas que não os entregam na lista.
      for (const c of customers) {
        const externalCustomerId = pickId(c);
        if (!externalCustomerId) continue;
        let details = equipmentListFromCustomer(c);
        if (!details.length && summary.details_attempted < 500) {
          summary.details_attempted += 1;
          try {
            const { res, data: detail } = await fetchJson(`/customers/${encodeURIComponent(externalCustomerId)}`, integration.api_key);
            if (res.ok) details = equipmentListFromCustomer(detail);
            else summary.details_failed += 1;
          } catch {
            summary.details_failed += 1;
          }
        }

        if (!details.length) continue;
        summary.equipment.fetched += details.length;
        if (data.mode === "preview") continue;

        const localClientId = localClientByExternal.get(externalCustomerId);
        if (!localClientId) continue;

        for (const eq of details) {
          const externalId = pickId(eq);
          if (!externalId) continue;
          const eqRef = await supabaseAdmin
            .from("dbs_control_external_refs")
            .select("local_id")
            .eq("company_id", companyId)
            .eq("provider", "fieldcontrol")
            .eq("entity_type", "equipment")
            .eq("external_id", externalId)
            .maybeSingle();
          if (eqRef.error) throw new Error(eqRef.error.message);

          const payload = {
            client_id: localClientId,
            tag_code: normalizeText(eq.tag ?? eq.code ?? eq.identifier ?? eq.name) || null,
            equipment_type: normalizeText(eq.type ?? eq.equipmentType ?? eq.category) || null,
            brand: normalizeText(eq.brand ?? eq.manufacturer) || null,
            model: normalizeText(eq.model ?? eq.modelName) || null,
            serial_number: normalizeText(eq.serialNumber ?? eq.serial ?? eq.serie) || null,
            capacity: normalizeText(eq.capacity ?? eq.capacityValue) || null,
            environment: normalizeText(eq.environment ?? eq.locationName ?? eq.location) || null,
            installation_date: normalizeText(eq.installationDate ?? eq.installedAt) || null,
            technical_notes: normalizeText(eq.notes ?? eq.observations) || null,
            updated_at: new Date().toISOString(),
          };
          let localId = eqRef.data?.local_id as string | null | undefined;
          if (localId) {
            const { error } = await supabaseAdmin.from("dbs_control_equipment").update(payload).eq("id", localId).eq("client_id", localClientId);
            if (error) throw new Error(error.message);
          } else {
            const { data: inserted, error } = await supabaseAdmin.from("dbs_control_equipment").insert(payload).select("id").single();
            if (error) throw new Error(error.message);
            localId = inserted.id;
          }
          await supabaseAdmin.from("dbs_control_external_refs").upsert({
            company_id: companyId,
            provider: "fieldcontrol",
            entity_type: "equipment",
            external_id: externalId,
            local_id: localId,
            metadata: { client_external_id: externalCustomerId },
            updated_at: new Date().toISOString(),
          }, { onConflict: "company_id,provider,entity_type,external_id" });
          summary.equipment.upserted += 1;
        }
      }

      if (data.mode === "apply") {
        for (const s of services) {
          const externalId = pickId(s);
          const name = pickName(s);
          if (!externalId || !name) continue;
          const ref = await supabaseAdmin
            .from("dbs_control_external_refs")
            .select("local_id")
            .eq("company_id", companyId)
            .eq("provider", "fieldcontrol")
            .eq("entity_type", "service")
            .eq("external_id", externalId)
            .maybeSingle();
          if (ref.error) throw new Error(ref.error.message);
          const payload = {
            name,
            description: normalizeText(s.description) || null,
            estimated_hours: Number(s.duration ?? s.estimatedHours ?? 0) || null,
            table_value_cents: Number(s.value ?? s.price ?? 0) ? Math.round(Number(s.value ?? s.price) * 100) : null,
            updated_at: new Date().toISOString(),
          };
          let localId = ref.data?.local_id as string | null | undefined;
          if (localId) {
            const { error } = await supabaseAdmin.from("dbs_control_service_catalog").update(payload).eq("id", localId);
            if (error) throw new Error(error.message);
          } else {
            const { data: inserted, error } = await supabaseAdmin.from("dbs_control_service_catalog").insert(payload).select("id").single();
            if (error) throw new Error(error.message);
            localId = inserted.id;
          }
          await supabaseAdmin.from("dbs_control_external_refs").upsert({
            company_id: companyId,
            provider: "fieldcontrol",
            entity_type: "service",
            external_id: externalId,
            local_id: localId,
            metadata: {},
            updated_at: new Date().toISOString(),
          }, { onConflict: "company_id,provider,entity_type,external_id" });
          summary.services.upserted += 1;
        }
      }

      // GET /orders é usado apenas se a conta/API permitir a listagem.
      try {
        const ordersResult = await listAll("/orders", integration.api_key, 30);
        const orders = ordersResult.items;
        summary.orders.fetched = orders.length;
        if (data.mode === "apply") {
          for (const order of orders) {
            const externalId = pickId(order);
            const externalCustomerId = externalOrderCustomerId(order);
            const localClientId = externalCustomerId ? localClientByExternal.get(externalCustomerId) : undefined;
            if (!externalId || !localClientId) continue;

            const serviceExternalId = pickId(order?.service);
            let serviceId: string | null = null;
            if (serviceExternalId) {
              const ref = await supabaseAdmin
                .from("dbs_control_external_refs")
                .select("local_id")
                .eq("company_id", companyId)
                .eq("provider", "fieldcontrol")
                .eq("entity_type", "service")
                .eq("external_id", serviceExternalId)
                .maybeSingle();
              serviceId = ref.data?.local_id ?? null;
            }

            const protocol = normalizeText(order.identifier ?? order.code ?? externalId).slice(0, 120);
            const status = normalizeText(order.status ?? order.state ?? "aberta").toLowerCase();
            const payload = {
              protocol,
              client_id: localClientId,
              service_id: serviceId,
              type: normalizeText(order.type ?? order.service?.name ?? "corretiva").toLowerCase(),
              priority: normalizeText(order.priority ?? "normal").toLowerCase(),
              status,
              scheduled_at: order.scheduledAt ? new Date(order.scheduledAt).toISOString() : null,
              completed_at: order.completedAt ? new Date(order.completedAt).toISOString() : null,
              description: normalizeText(order.description ?? order.request ?? "") || null,
              technical_opinion: normalizeText(order.technicalOpinion ?? order.report ?? "") || null,
              observation: normalizeText(order.observation ?? order.notes ?? "") || null,
              updated_at: new Date().toISOString(),
            };

            const ref = await supabaseAdmin
              .from("dbs_control_external_refs")
              .select("local_id")
              .eq("company_id", companyId)
              .eq("provider", "fieldcontrol")
              .eq("entity_type", "work_order")
              .eq("external_id", externalId)
              .maybeSingle();
            if (ref.error) throw new Error(ref.error.message);

            let localId = ref.data?.local_id as string | null | undefined;
            if (localId) {
              const { error } = await supabaseAdmin.from("dbs_control_work_orders").update(payload).eq("id", localId);
              if (error) throw new Error(error.message);
            } else {
              const { data: inserted, error } = await supabaseAdmin.from("dbs_control_work_orders").insert(payload).select("id").single();
              if (error) throw new Error(error.message);
              localId = inserted.id;
            }
            await supabaseAdmin.from("dbs_control_external_refs").upsert({
              company_id: companyId,
              provider: "fieldcontrol",
              entity_type: "work_order",
              external_id: externalId,
              local_id: localId,
              metadata: {},
              updated_at: new Date().toISOString(),
            }, { onConflict: "company_id,provider,entity_type,external_id" });
            summary.orders.upserted += 1;
          }
        }
      } catch (orderError) {
        errors.push(orderError instanceof Error ? orderError.message : "Não foi possível listar as OS do FieldControl.");
      }

      const status = errors.length ? "partial" : "success";
      const finishedAt = new Date().toISOString();
      await supabaseAdmin.from("dbs_control_sync_runs").update({
        status,
        finished_at: finishedAt,
        summary,
        errors,
      }).eq("id", runId);

      await supabaseAdmin.from("dbs_control_integrations").update({
        last_sync_at: finishedAt,
        last_sync_status: status,
        last_sync_summary: summary,
        updated_by_user_id: user.id,
        updated_at: finishedAt,
      }).eq("id", integration.id);

      return { ok: true, run_id: runId, mode: data.mode, status, summary, errors };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha na sincronização FieldControl.";
      errors.push(message);
      const finishedAt = new Date().toISOString();
      await supabaseAdmin.from("dbs_control_sync_runs").update({
        status: "error",
        finished_at: finishedAt,
        summary,
        errors,
      }).eq("id", runId);
      await supabaseAdmin.from("dbs_control_integrations").update({
        last_sync_at: finishedAt,
        last_sync_status: "error",
        last_sync_summary: summary,
        updated_by_user_id: user.id,
        updated_at: finishedAt,
      }).eq("id", integration.id);
      throw new Error(message);
    }
  });
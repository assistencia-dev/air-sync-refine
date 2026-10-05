import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BASE = "https://carchost.fieldcontrol.com.br";

type AppUser = { id: string; company_id: string | null; role_key: string; status: string };

async function requireDbsControlAdmin(context: { userId: string }) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, company_id, unit_id, role_key, status")
    .eq("auth_id", context.userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.status !== "ativo") throw new Error("Usuário inativo ou não encontrado.");
  if (!["SUPER_ADMIN", "ADMIN_OPERACIONAL", "GESTOR_CONTA", "GESTOR_REGIONAL"].includes(data.role_key)) {
    throw new Error("Somente administradores do DBS CONTROL podem gerenciar a integração FieldControl.");
  }

  // Corrige automaticamente perfis administrativos antigos que ficaram sem company_id.
  // Primeiro aproveita a empresa da unidade; se não houver, recupera/cria a empresa principal da DBS Air.
  let companyId = data.company_id as string | null;
  if (!companyId && data.unit_id) {
    const { data: unit, error: unitError } = await supabaseAdmin
      .from("units")
      .select("company_id")
      .eq("id", data.unit_id)
      .maybeSingle();
    if (unitError) throw new Error(unitError.message);
    companyId = unit?.company_id ?? null;
  }

  if (!companyId) {
    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .select("id")
      .or("legal_name.ilike.%DBS AIR%,trade_name.ilike.%DBS AIR%")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (companyError) throw new Error(companyError.message);
    companyId = company?.id ?? null;
  }

  if (!companyId) {
    const { data: createdCompany, error: createCompanyError } = await supabaseAdmin
      .from("companies")
      .insert({
        legal_name: "DBS AIR REFRIGERAÇÃO LTDA",
        trade_name: "DBS AIR",
        account_type: "empresa",
      })
      .select("id")
      .single();
    if (createCompanyError) throw new Error(createCompanyError.message);
    companyId = createdCompany.id;
  }

  if (!data.company_id) {
    const { error: linkError } = await supabaseAdmin
      .from("users")
      .update({ company_id: companyId })
      .eq("id", data.id);
    if (linkError) throw new Error(linkError.message);
  }

  return { ...data, company_id: companyId } as AppUser;
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

function normalizeDate(value: unknown) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}
function normalizeDateTime(value: unknown) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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

let lastFieldControlRequestAt = 0;

async function fetchJson(path: string, apiKey: string) {
  const wait = Math.max(0, 1050 - (Date.now() - lastFieldControlRequestAt));
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastFieldControlRequestAt = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json", "User-Agent": "DBS-CONTROL/1.0" },
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
    zipCode: normalizeText(a.zipCode ?? a.postalCode ?? a.cep).replace(/\D/g, ""),
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
  const contact = jsonObject(customer?.contact);
  return {
    contact_name: normalizeText(customer?.contactName ?? first.name ?? customer?.responsibleName),
    contact_phone: normalizeText(customer?.phone ?? customer?.phoneNumber ?? contact.phone ?? first.phone ?? first.mobile),
    contact_email: normalizeText(customer?.email ?? customer?.emailAddress ?? contact.email ?? first.email),
  };
}

function locationListFromCustomer(customer: any) {
  const raw = customer?.locations ?? customer?.sites ?? customer?.addresses;
  if (Array.isArray(raw) && raw.length) return raw;
  const primary = customer?.primaryLocation ?? customer?.location;
  if (primary && typeof primary === "object") return [primary];
  return [];
}

function equipmentListFromCustomer(customer: any) {
  const direct = customer?.equipments ?? customer?.equipment ?? customer?.assets;
  const out = Array.isArray(direct) ? [...direct] : [];
  for (const location of locationListFromCustomer(customer)) {
    const nested = location?.equipments ?? location?.equipment ?? location?.assets;
    if (Array.isArray(nested)) out.push(...nested);
  }
  const seen = new Set<string>();
  return out.filter((eq: any) => {
    const id = pickId(eq);
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function detailPayload(value: any) {
  return value?.customer ?? value?.data ?? value;
}

function externalOrderCustomerId(order: any) {
  const candidates = [
    order?.customer,
    order?.customerId,
    order?.client,
    order?.clientId,
    order?.customer?.id,
    order?.customer?.identifier,
    order?.location?.customer,
    order?.location?.customerId,
  ];
  for (const candidate of candidates) {
    const id = pickId(candidate);
    if (id) return id;
    if (typeof candidate === "string" && normalizeText(candidate)) return normalizeText(candidate);
  }
  return "";
}

function externalOrderCustomerName(order: any) {
  const candidates = [
    order?.customer?.name,
    order?.customer?.legalName,
    order?.customer?.tradeName,
    order?.client?.name,
    order?.client?.legalName,
    order?.client?.tradeName,
    order?.customerName,
    order?.clientName,
  ];
  return candidates.map(normalizeText).find(Boolean) || "";
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

export const getFieldControlImportedState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const user = await requireDbsControlAdmin(context);
    const companyId = user.company_id as string;
    const integration = await getIntegration(companyId);
    if (!integration?.api_key) throw new Error("Configure a chave de API do FieldControl antes de carregar a base.");

    const [clientsResult, sitesResult, equipmentResult, servicesResult, ordersResult, linksResult] = await Promise.all([
      supabaseAdmin.from("dbs_control_clients").select("*").order("legal_name"),
      supabaseAdmin.from("dbs_control_sites").select("*"),
      supabaseAdmin.from("dbs_control_equipment").select("*"),
      supabaseAdmin.from("dbs_control_service_catalog").select("*").order("name"),
      supabaseAdmin.from("dbs_control_work_orders").select("*").order("scheduled_at", { ascending: false, nullsFirst: false }),
      supabaseAdmin.from("dbs_control_work_order_equipment").select("*"),
    ]);
    for (const result of [clientsResult, sitesResult, equipmentResult, servicesResult, ordersResult, linksResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const employeesResult = await listAll("/employees", integration.api_key);
    const technicians = employeesResult.items.map((employee: any) => ({
      id: pickId(employee),
      employeeId: null,
      nome: pickName(employee) || "Técnico FieldControl",
      email: normalizeText(employee.email ?? employee.emailAddress) || "",
      fone: normalizeText(employee.phone ?? employee.mobile) || "",
      posicao: normalizeText(employee.position ?? employee.role ?? "Técnico FieldControl"),
      fieldControlId: pickId(employee),
    })).filter((tech: any) => tech.id);

    const clients = (clientsResult.data ?? []).map((client: any) => ({
      id: client.id,
      nome: client.trade_name || client.legal_name,
      razaoSocial: client.legal_name,
      cnpj: client.cnpj || "",
      email: client.email || "",
      telefone: client.phone || "",
      observacoes: client.notes || "",
      origem: "FieldControl",
    }));
    const sites = sitesResult.data ?? [];
    const siteById = new Map(sites.map((site: any) => [String(site.id), site]));
    const clientById = new Map(clients.map((client: any) => [String(client.id), client]));
    for (const site of sites) {
      const client = clientById.get(String(site.client_id));
      if (!client) continue;
      if (!client.endereco) client.endereco = {};
      client.endereco = site.address_json ?? client.endereco;
      if (!client.contato) client.contato = site.contact_name || "";
    }

    const equipment = (equipmentResult.data ?? []).map((eq: any) => ({
      id: eq.id,
      clienteId: eq.client_id,
      siteId: eq.site_id,
      tag: eq.tag_code || "",
      tipo: eq.equipment_type || "",
      marca: eq.brand || "",
      modelo: eq.model || "",
      serie: eq.serial_number || "",
      capacidade: eq.capacity || "",
      localizacao: eq.environment || (eq.site_id ? siteById.get(String(eq.site_id))?.name : "") || "",
      dataInstalacao: eq.installation_date || "",
      observacoes: eq.technical_notes || "",
      status: eq.status || "ativo",
      origem: "FieldControl",
    }));
    const equipmentIdsByOrder = new Map<string, string[]>();
    for (const link of linksResult.data ?? []) {
      const list = equipmentIdsByOrder.get(String(link.work_order_id)) ?? [];
      list.push(String(link.equipment_id));
      equipmentIdsByOrder.set(String(link.work_order_id), list);
    }
    const services = (servicesResult.data ?? []).map((service: any) => ({
      id: service.id,
      nome: service.name,
      descricao: service.description || "",
      valor: Number(service.table_value_cents || 0) / 100,
      duracao: service.estimated_hours || 0,
      origem: "FieldControl",
    }));
    const orders = (ordersResult.data ?? []).map((order: any) => ({
      id: order.id,
      clienteId: order.client_id,
      servicoId: order.service_id,
      protocolo: order.protocol || "",
      tipo: order.type || "corretiva",
      prioridade: order.priority || "normal",
      status: order.status || "aberta",
      data: order.scheduled_at || "",
      concluidoEm: order.completed_at || "",
      diagnostico: order.technical_opinion || "",
      descricao: order.description || "",
      observacao: order.observation || "",
      equipamentoId: equipmentIdsByOrder.get(String(order.id))?.[0] || null,
      equipamentoIds: equipmentIdsByOrder.get(String(order.id)) || [],
      origem: "FieldControl",
    }));

    return { tecnicos: technicians, clientes: clients, equipamentos: equipment, pecas: [], servicos: services, compras: [], ordens: orders, osHistorico: [] };
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
    const publishProgress = async (status: string, extra: Record<string, any> = {}) => {
      await supabaseAdmin.from("dbs_control_sync_runs").update({ status, summary: { ...summary, ...extra } }).eq("id", runId);
    };

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
      const customersResult = await listAll("/customers", integration.api_key);
      const servicesResult = await listAll("/services", integration.api_key);
      const employeesResult = await listAll("/employees", integration.api_key);
      const equipmentResult = await listAll("/equipments", integration.api_key);
      const customers = customersResult.items;
      const services = servicesResult.items;
      const employees = employeesResult.items;
      const allEquipment = equipmentResult.items;
      summary.customers.fetched = customers.length;
      summary.services.fetched = services.length;
      summary.employees.fetched = employees.length;
      await publishProgress("running", { stage: "clientes_servicos_tecnicos", progress: 15 });

      const customerByExternal = new Map<string, any>();
      const localClientByExternal = new Map<string, string>();
      const localEmployeeByExternal = new Map<string, string>();

      if (data.mode === "apply") {
        for (const employee of employees) {
          const externalId = pickId(employee);
          const name = pickName(employee);
          if (!externalId || !name) continue;
          const existingEmployee = await supabaseAdmin.from("rh_employees")
            .select("id").eq("source_system", "fieldcontrol").eq("source_key", externalId).maybeSingle();
          if (existingEmployee.error) throw new Error(existingEmployee.error.message);
          const payload = {
            benefit_type: "fieldcontrol",
            full_name: name,
            unit: "DBS AIR",
            fare_cents: 0,
            trips_per_day: 1,
            is_active: true,
            registration_data: {
              source: "FieldControl",
              fieldControlId: externalId,
              email: normalizeText(employee.email ?? employee.emailAddress),
              phone: normalizeText(employee.phone ?? employee.mobile),
              position: normalizeText(employee.position ?? employee.role ?? "Técnico FieldControl"),
            },
            source_system: "fieldcontrol",
            source_key: externalId,
            updated_at: new Date().toISOString(),
          };
          let localEmployeeId = existingEmployee.data?.id as string | undefined;
          if (localEmployeeId) {
            const { error } = await supabaseAdmin.from("rh_employees").update(payload).eq("id", localEmployeeId);
            if (error) throw new Error(error.message);
          } else {
            const { data: inserted, error } = await supabaseAdmin.from("rh_employees").insert(payload).select("id").single();
            if (error) throw new Error(error.message);
            localEmployeeId = inserted.id;
          }
          localEmployeeByExternal.set(externalId, localEmployeeId);
        }
      }

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
            cnpj: normalizeText(c.cnpj ?? c.document ?? c.taxId ?? c.documentNumber) || null,
            phone: contact.contact_phone || null,
            email: contact.contact_email || null,
            notes: normalizeText(c.notes ?? c.observations) || null,
            updated_at: new Date().toISOString(),
          }).eq("id", localId);
          if (error) throw new Error(error.message);
        } else {
          const { data: inserted, error } = await supabaseAdmin.from("dbs_control_clients").insert({
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


      }

      // A API oficial expõe localizações e equipamentos como recursos próprios.
      const equipmentByCustomer = new Map<string, any[]>();
      const localSiteByExternal = new Map<string, string>();
      for (const eq of allEquipment) {
        const customerId = pickId(eq?.customer);
        if (!customerId) continue;
        const list = equipmentByCustomer.get(customerId) ?? [];
        list.push(eq);
        equipmentByCustomer.set(customerId, list);
      }

      for (const c of customers) {
        const externalCustomerId = pickId(c);
        if (!externalCustomerId) continue;

        let locations: any[] = [];
        try {
          const locationResult = await listAll(
            `/customers/${encodeURIComponent(externalCustomerId)}/locations`,
            integration.api_key
          );
          locations = locationResult.items;
        } catch {
          summary.details_failed += 1;
        }
        summary.details_attempted += 1;

        const details = equipmentByCustomer.get(externalCustomerId) ?? [];

        if (locations.length) {
          summary.sites.fetched += locations.length;
          if (data.mode === "apply") {
            const localClientId = localClientByExternal.get(externalCustomerId);
            if (localClientId) {
              for (let index = 0; index < locations.length; index += 1) {
                const location = locations[index];
                const locationId = pickId(location) || `location:${externalCustomerId}:${index}`;
                const locationRef = await supabaseAdmin
                  .from("dbs_control_external_refs")
                  .select("local_id")
                  .eq("company_id", companyId)
                  .eq("provider", "fieldcontrol")
                  .eq("entity_type", "site")
                  .eq("external_id", locationId)
                  .maybeSingle();
                if (locationRef.error) throw new Error(locationRef.error.message);

                const address = addressFromCustomer(location);
                const contact = contactFromCustomer({
                  ...c,
                  ...location,
                  address: location?.address ?? c?.address,
                });
                const siteName = normalizeText(location?.name ?? location?.description) || (index === 0 ? "Local principal" : `Local ${index + 1}`);
                let siteId = locationRef.data?.local_id as string | null | undefined;

                if (siteId) {
                  const { error } = await supabaseAdmin.from("dbs_control_sites").update({
                    client_id: localClientId,
                    name: siteName,
                    address_json: address,
                    contact_name: contact.contact_name || null,
                    contact_phone: contact.contact_phone || null,
                    contact_email: contact.contact_email || null,
                    updated_at: new Date().toISOString(),
                  }).eq("id", siteId).eq("client_id", localClientId);
                  if (error) throw new Error(error.message);
                } else {
                  const { data: site, error } = await supabaseAdmin.from("dbs_control_sites").insert({
                    client_id: localClientId,
                    name: siteName,
                    address_json: address,
                    contact_name: contact.contact_name || null,
                    contact_phone: contact.contact_phone || null,
                    contact_email: contact.contact_email || null,
                  }).select("id").single();
                  if (error) throw new Error(error.message);
                  siteId = site.id;
                }

                localSiteByExternal.set(locationId, siteId as string);
                await supabaseAdmin.from("dbs_control_external_refs").upsert({
                  company_id: companyId,
                  provider: "fieldcontrol",
                  entity_type: "site",
                  external_id: locationId,
                  local_id: siteId,
                  metadata: { client_external_id: externalCustomerId, name: siteName },
                  updated_at: new Date().toISOString(),
                }, { onConflict: "company_id,provider,entity_type,external_id" });
                summary.sites.upserted += 1;
              }
            }
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

          const equipmentLocationExternalId = pickId(eq?.location) || normalizeText(eq?.locationId);
          const payload = {
            client_id: localClientId,
            site_id: equipmentLocationExternalId ? (localSiteByExternal.get(equipmentLocationExternalId) ?? null) : null,
            tag_code: normalizeText(eq.qrCode ?? eq.name ?? eq.number) || null,
            equipment_type: normalizeText(eq.type?.name ?? eq.type?.id ?? eq.type) || null,
            brand: normalizeText(eq.brand ?? eq.manufacturer) || null,
            model: normalizeText(eq.model ?? eq.modelName) || null,
            serial_number: normalizeText(eq.number ?? eq.serialNumber ?? eq.serial ?? eq.serie) || null,
            capacity: normalizeText(eq.capacity ?? eq.capacityValue) || null,
            environment: normalizeText(eq.location?.id ?? eq.locationName ?? eq.location) || null,
            installation_date: normalizeDate(eq.installationDate ?? eq.installedAt ?? eq.createdAt),
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

      await publishProgress("running", { stage: "clientes_locais_equipamentos", progress: 55 });

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

      await publishProgress("running", { stage: "servicos", progress: 65 });

      // GET /orders é usado apenas se a conta/API permitir a listagem.
      try {
        const ordersResult = await listAll("/orders", integration.api_key, 30);
        const orders = ordersResult.items;
        summary.orders.fetched = orders.length;
        if (data.mode === "apply") {
          // Aplicação em lote: a API do FieldControl é limitada a ~1 req/s,
          // portanto não podemos fazer 3 consultas ao Supabase para cada uma das 1.434 OS.
          // Pré-carregamos as referências e gravamos em lotes para a sincronização terminar
          // em segundos/minutos, sem perder os vínculos.
          const [orderRefsResult, serviceRefsResult, existingOrdersResult] = await Promise.all([
            supabaseAdmin.from("dbs_control_external_refs")
              .select("external_id,local_id")
              .eq("company_id", companyId)
              .eq("provider", "fieldcontrol")
              .eq("entity_type", "work_order"),
            supabaseAdmin.from("dbs_control_external_refs")
              .select("external_id,local_id")
              .eq("company_id", companyId)
              .eq("provider", "fieldcontrol")
              .eq("entity_type", "service"),
            supabaseAdmin.from("dbs_control_work_orders")
              .select("id,protocol"),
          ]);
          if (orderRefsResult.error) throw new Error(orderRefsResult.error.message);
          if (serviceRefsResult.error) throw new Error(serviceRefsResult.error.message);
          if (existingOrdersResult.error) throw new Error(existingOrdersResult.error.message);

          const protocolOwnerByValue = new Map<string, string>(
            (existingOrdersResult.data ?? [])
              .filter((row: any) => normalizeText(row.protocol))
              .map((row: any) => [normalizeText(row.protocol), String(row.id)])
          );

          const orderLocalByExternal = new Map<string,string>(
            (orderRefsResult.data ?? []).map((row: any) => [String(row.external_id), String(row.local_id)])
          );
          const serviceLocalByExternal = new Map<string,string>(
            (serviceRefsResult.data ?? []).map((row: any) => [String(row.external_id), String(row.local_id)])
          );

          const workOrders: any[] = [];
          const workOrderRefs: any[] = [];
          const equipmentLinks: Array<{work_order_id:string; equipment_id:string}> = [];

          for (const order of orders) {
            const externalId = pickId(order);
            const externalCustomerId = externalOrderCustomerId(order);
            const customerName = externalOrderCustomerName(order);
            let localClientId = externalCustomerId ? localClientByExternal.get(externalCustomerId) : undefined;

            // Algumas contas do FieldControl devolvem a OS com o cliente expandido
            // ou apenas com o nome. Tenta o ID primeiro e depois o nome normalizado.
            if (!localClientId && customerName) {
              const normalizedCustomer = normalizeKey(customerName);
              for (const [externalId, customer] of customerByExternal.entries()) {
                if (normalizeKey(pickName(customer)) === normalizedCustomer) {
                  localClientId = localClientByExternal.get(externalId);
                  if (localClientId) break;
                }
              }
            }
            if (!externalId || !localClientId) {
              errors.push(`OS ${externalId || "sem ID"} ignorada: cliente do FieldControl não foi localizado no DBS CONTROL.`);
              continue;
            }

            const serviceExternalId = pickId(order?.service) || pickId(order?.serviceId);
            const serviceId = serviceExternalId ? (serviceLocalByExternal.get(serviceExternalId) ?? null) : null;
            const localId = orderLocalByExternal.get(externalId) || crypto.randomUUID();
            const firstTask = Array.isArray(order?.tasks) ? (order.tasks[0] ?? {}) : {};
            const taskEmployeeId = pickId(firstTask?.employee) || pickId(firstTask?.employeeId) || pickId(order?.employee) || pickId(order?.employeeId);
            const assignedEmployeeId = taskEmployeeId ? (localEmployeeByExternal.get(taskEmployeeId) ?? null) : null;
            const orderLocationId = pickId(order?.location) || pickId(order?.site) || pickId(order?.address);
            const localSiteId = orderLocationId ? (localSiteByExternal.get(orderLocationId) ?? null) : null;
            let protocol = normalizeText(order.identifier ?? order.code ?? externalId).slice(0, 120) || `OS-${externalId}`;

            // O protocolo é único no DBS CONTROL. Só considera colisão quando
            // pertence a outra OS; a própria OS pode manter seu protocolo.
            if (protocolOwnerByValue.has(protocol) && protocolOwnerByValue.get(protocol) !== localId) {
              const suffix = `-FC-${externalId.slice(-12)}`;
              protocol = `${protocol.slice(0, Math.max(1, 120 - suffix.length))}${suffix}`;
              let n = 2;
              while (protocolOwnerByValue.has(protocol) && protocolOwnerByValue.get(protocol) !== localId) {
                const extra = `-${n++}`;
                protocol = `${protocol.slice(0, Math.max(1, 120 - suffix.length - extra.length))}${suffix}${extra}`;
              }
            }
            protocolOwnerByValue.set(protocol, localId);

            const status = normalizeText(order.status ?? order.state ?? "aberta").toLowerCase();

            workOrders.push({
              id: localId,
              protocol,
              client_id: localClientId,
              site_id: localSiteId,
              assigned_employee_id: assignedEmployeeId,
              service_id: serviceId,
              type: normalizeText(order.type ?? order.service?.name ?? "corretiva").toLowerCase(),
              priority: normalizeText(order.priority ?? "normal").toLowerCase(),
              status,
              scheduled_at: normalizeDateTime(order.scheduledAt ?? order.scheduling?.dateTime ?? (order.scheduling?.date && order.scheduling?.time ? `${order.scheduling.date}T${order.scheduling.time}` : null)),
              completed_at: normalizeDateTime(order.completedAt ?? order.completed_at),
              description: normalizeText(order.description ?? order.request ?? "") || null,
              technical_opinion: normalizeText(order.technicalOpinion ?? order.report ?? "") || null,
              observation: normalizeText(order.observation ?? order.notes ?? "") || null,
              updated_at: new Date().toISOString(),
            });
            workOrderRefs.push({
              company_id: companyId,
              provider: "fieldcontrol",
              entity_type: "work_order",
              external_id: externalId,
              local_id: localId,
              metadata: {},
              updated_at: new Date().toISOString(),
            });

            const orderEquipments = Array.isArray(order?.equipments)
              ? order.equipments
              : Array.isArray(order?.equipment)
                ? order.equipment
                : order?.equipment ? [order.equipment] : [];
            for (const orderEquipment of orderEquipments) {
              const externalEquipmentId = pickId(orderEquipment);
              if (!externalEquipmentId) continue;
              // O mapa de equipamentos já foi importado antes desta etapa.
              const equipmentLocal = equipmentLocalByExternal.get(externalEquipmentId);
              if (equipmentLocal) equipmentLinks.push({ work_order_id: localId, equipment_id: equipmentLocal });
            }
          }

          const batchSize = 200;

          // Se uma linha problemática fizer um lote inteiro falhar, divide o lote
          // até isolar a OS problemática. Assim as outras OS continuam entrando.
          const upsertOrdersResilient = async (batch: any[]): Promise<void> => {
            if (!batch.length) return;
            const { error } = await supabaseAdmin.from("dbs_control_work_orders").upsert(batch, { onConflict: "id" });
            if (!error) return;
            if (batch.length === 1) {
              const row = batch[0];
              const fallbackSuffix = `-FC-${String(row.id).replace(/-/g, "").slice(-12)}`;
              const fallbackProtocol = `${String(row.protocol || "OS").slice(0, Math.max(1, 120 - fallbackSuffix.length))}${fallbackSuffix}`;
              const retry = await supabaseAdmin.from("dbs_control_work_orders")
                .upsert([{ ...row, protocol: fallbackProtocol }], { onConflict: "id" });
              if (retry.error) {
                errors.push(`OS ${row.id} não importada: ${retry.error.message}`);
                return;
              }
              protocolOwnerByValue.set(fallbackProtocol, String(row.id));
              return;
            }
            const middle = Math.ceil(batch.length / 2);
            await upsertOrdersResilient(batch.slice(0, middle));
            await upsertOrdersResilient(batch.slice(middle));
          };

          for (let i = 0; i < workOrders.length; i += batchSize) {
            const batch = workOrders.slice(i, i + batchSize);
            await upsertOrdersResilient(batch);
            const done = Math.min(i + batch.length, workOrders.length);
            const progress = Math.min(98, 70 + Math.round((done / Math.max(workOrders.length, 1)) * 28));
            await publishProgress("running", { stage: "ordens", progress, orders_processed: done, orders_total: workOrders.length });
          }

          for (let i = 0; i < workOrderRefs.length; i += batchSize) {
            const batch = workOrderRefs.slice(i, i + batchSize);
            const { error } = await supabaseAdmin.from("dbs_control_external_refs")
              .upsert(batch, { onConflict: "company_id,provider,entity_type,external_id" });
            if (error) throw new Error(error.message);
          }

          if (equipmentLinks.length) {
            for (let i = 0; i < equipmentLinks.length; i += batchSize) {
              const batch = equipmentLinks.slice(i, i + batchSize);
              const { error } = await supabaseAdmin.from("dbs_control_work_order_equipment")
                .upsert(batch, { onConflict: "work_order_id,equipment_id" });
              if (error) throw new Error(error.message);
            }
          }

          summary.orders.upserted = workOrders.length;
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
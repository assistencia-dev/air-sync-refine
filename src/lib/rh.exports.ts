function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function printableHtml(title: string, subtitle: string, body: string) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;color:#172033;margin:0;font-size:11px}
.header{border-bottom:2px solid #172033;padding-bottom:12px;margin-bottom:18px}
.brand{font-size:18px;font-weight:800;letter-spacing:.02em}
.title{font-size:16px;font-weight:800;margin-top:5px}
.subtitle{color:#64748b;margin-top:4px}
.section{margin:14px 0 0;border:1px solid #d9dee7;border-radius:7px;overflow:hidden;break-inside:avoid}
.section h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin:0;padding:8px 10px;background:#f3f5f8;border-bottom:1px solid #d9dee7}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0}
.item{padding:8px 10px;border-bottom:1px solid #eef1f5}
.label{font-size:8px;text-transform:uppercase;color:#64748b;font-weight:700}
.value{margin-top:3px;font-weight:600;white-space:pre-wrap}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #d9dee7;padding:6px 7px;text-align:left}
th{background:#f3f5f8;font-size:9px;text-transform:uppercase}
.total{font-weight:800;background:#f8fafc}
.footer{margin-top:18px;color:#64748b;font-size:9px}
@media print{.no-print{display:none!important}}
</style>
</head>
<body>
<div class="header"><div class="brand">DBS AIR</div><div class="title">${esc(title)}</div><div class="subtitle">${esc(subtitle)}</div></div>
${body}
<div class="footer">Documento gerado pelo módulo RH / DP · DBS AIR · ${new Date().toLocaleString("pt-BR")}</div>
<script>window.onload=()=>{setTimeout(()=>window.print(),250)}</script>
</body></html>`;
}

export function openRhPrint(title: string, subtitle: string, body: string) {
  const win = window.open("", "_blank", "noopener,noreferrer,width=1000,height=800");
  if (!win) {
    throw new Error("O navegador bloqueou a janela de impressão. Permita pop-ups para exportar o documento.");
  }
  win.document.write(printableHtml(title, subtitle, body));
  win.document.close();
}

export function exportRhEmployeeFichaPdf(employee: any, data: any) {
  const r = data?.employee?.registration_data ?? employee?.registration_data ?? {};
  const money = (value: unknown) => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) && n !== 0
      ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n / 100)
      : String(value ?? "—");
  };
  const value = (key: string, fallback = "—") => r[key] || fallback;
  const item = (label: string, val: unknown) => `<div class="item"><div class="label">${esc(label)}</div><div class="value">${esc(val || "—")}</div></div>`;
  const list = (title: string, rows: any[], mapper: (row: any) => string) =>
    `<div class="section"><h2>${esc(title)} (${rows.length})</h2>${rows.length ? rows.map(mapper).join("") : '<div class="item"><div class="value">Nenhum registro.</div></div>'}</div>`;

  const body = [
    `<div class="section"><h2>Identificação</h2><div class="grid">${item("Nome completo", employee.full_name)}${item("Unidade / setor", employee.unit)}${item("CPF", value("cpf"))}${item("RG", value("rg"))}${item("Nascimento", value("birth_date"))}${item("Telefone", value("phone"))}${item("Endereço", value("address"))}${item("Nome da mãe", value("mother_name"))}${item("Nome do pai", value("father_name"))}</div></div>`,
    `<div class="section"><h2>Dados funcionais</h2><div class="grid">${item("Cargo / função", value("job_title"))}${item("Admissão", value("admission_date"))}${item("Salário", value("salary") || money(data?.contracts?.[0]?.salary_cents))}${item("Tipo de pagamento", value("payment_type"))}${item("Jornada", value("work_hours"))}${item("PIS", value("pis"))}${item("CTPS", value("ctps"))}${item("Banco", value("bank"))}${item("Conta", value("bank_account"))}${item("Status", employee.is_active ? "Ativo" : "Inativo")}</div></div>`,
    list("Contratos", data?.contracts ?? [], (x) => `<div class="item"><div class="value">${esc([x.contract_type, x.admission_date && "Admissão: "+x.admission_date, x.termination_date && "Saída: "+x.termination_date, x.salary_cents != null && "Salário: "+money(x.salary_cents)].filter(Boolean).join(" · "))}</div></div>`),
    list("Dependentes", data?.dependents ?? [], (x) => `<div class="item"><div class="value">${esc([x.full_name, x.relationship, x.birth_date, x.is_ir_dependent && "Dependente IR"].filter(Boolean).join(" · "))}</div></div>`),
    list("Documentos", data?.documents ?? [], (x) => `<div class="item"><div class="value">${esc([x.document_type, x.file_name, x.expires_at && "Validade: "+x.expires_at, x.status].filter(Boolean).join(" · "))}</div></div>`),
    list("Histórico funcional", data?.events ?? [], (x) => `<div class="item"><div class="value">${esc([x.event_date, x.event_type, x.status].filter(Boolean).join(" · "))}</div></div>`),
    list("Benefícios", data?.benefits ?? [], (x) => `<div class="item"><div class="value">${esc([x.benefit_type || x.type || x.name, x.status, x.amount_cents != null && "Valor: "+money(x.amount_cents), x.monthly_value_cents != null && "Mensal: "+money(x.monthly_value_cents)].filter(Boolean).join(" · "))}</div></div>`),
    list("Registros de ponto", (data?.pointRecords ?? []).slice(0, 31), (x) => `<div class="item"><div class="value">${esc([x.record_date || x.date, x.entry_time && "Entrada: "+x.entry_time, x.lunch_start && "Almoço: "+x.lunch_start, x.lunch_end && "Retorno: "+x.lunch_end, x.exit_time && "Saída: "+x.exit_time, x.status].filter(Boolean).join(" · "))}</div></div>`),
    list("Histórico de folha", (data?.payrollRuns ?? []).slice(0, 12), (x) => `<div class="item"><div class="value">${esc([x.competence || x.period_competence, x.status, x.gross_cents != null && "Bruto: "+money(x.gross_cents), x.discount_cents != null && "Descontos: "+money(x.discount_cents), x.net_cents != null && "Líquido: "+money(x.net_cents)].filter(Boolean).join(" · "))}</div></div>`),
    `<div class="section"><h2>Acessos</h2><div class="grid">${item("Login", data?.access?.login_identifier || "—")}${item("Folha de Ponto", data?.employee?.ponto_access_enabled ? "Liberada" : "Não liberada")}${item("DBS CONTROL", data?.employee?.dbs_control_access_enabled ? "Liberado" : "Não liberado")}</div></div>`,
    `<div class="section"><h2>Observações</h2><div class="item"><div class="value">${esc(value("notes"))}</div></div></div>`,
  ].join("");

  openRhPrint("Ficha funcional do colaborador", `${employee.full_name} · ${employee.unit}`, body);
}

export function exportRhPayrollPdf(competence: string, rows: any[]) {
  const money = (v: unknown) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v ?? 0) / 100);
  const totalGross = rows.reduce((n, x) => n + Number(x.gross_cents ?? 0), 0);
  const totalDiscount = rows.reduce((n, x) => n + Number(x.discount_cents ?? 0), 0);
  const totalNet = rows.reduce((n, x) => n + Number(x.net_cents ?? 0), 0);
  const totalFgts = rows.reduce((n, x) => n + Number(x.fgts_base_cents ?? 0), 0);
  const body = `<div class="section"><h2>Resumo da competência</h2><div class="grid">
  <div class="item"><div class="label">Competência</div><div class="value">${esc(competence)}</div></div>
  <div class="item"><div class="label">Funcionários</div><div class="value">${rows.length}</div></div>
  <div class="item"><div class="label">Bruto</div><div class="value">${money(totalGross)}</div></div>
  <div class="item"><div class="label">Descontos</div><div class="value">${money(totalDiscount)}</div></div>
  <div class="item"><div class="label">Líquido</div><div class="value">${money(totalNet)}</div></div>
  <div class="item"><div class="label">FGTS / base registrada</div><div class="value">${money(totalFgts)}</div></div>
  </div></div>
  <div class="section"><h2>Folha detalhada</h2><table><thead><tr><th>Funcionário</th><th>Bruto</th><th>Descontos</th><th>Líquido</th><th>FGTS</th><th>Status</th></tr></thead><tbody>
  ${rows.map(x => `<tr><td>${esc(x.employee_name)}</td><td>${money(x.gross_cents)}</td><td>${money(x.discount_cents)}</td><td>${money(x.net_cents)}</td><td>${money(x.fgts_base_cents)}</td><td>${esc(x.status)}</td></tr>`).join("")}
  <tr class="total"><td>TOTAL</td><td>${money(totalGross)}</td><td>${money(totalDiscount)}</td><td>${money(totalNet)}</td><td>${money(totalFgts)}</td><td></td></tr>
  </tbody></table></div>`;
  openRhPrint("Folha de pagamento", `Competência ${competence}`, body);
}

export function exportRhPayrollExcel(competence: string, rows: any[]) {
  const money = (v: unknown) => Number(v ?? 0) / 100;
  const headers = ["Funcionário", "Competência", "Bruto", "Descontos", "Líquido", "FGTS", "Status"];
  const xmlRows = rows.map(x => [x.employee_name, competence, money(x.gross_cents), money(x.discount_cents), money(x.net_cents), money(x.fgts_base_cents), x.status]);
  const total = [
    "TOTAL",
    competence,
    rows.reduce((n,x)=>n+money(x.gross_cents),0),
    rows.reduce((n,x)=>n+money(x.discount_cents),0),
    rows.reduce((n,x)=>n+money(x.net_cents),0),
    rows.reduce((n,x)=>n+money(x.fgts_base_cents),0),
    "",
  ];
  const row = (cells: unknown[], header = false) => `<Row>${cells.map(c => `<Cell${header ? ' ss:StyleID="Header"' : ''}><Data ss:Type="${typeof c === "number" ? "Number" : "String"}">${esc(c)}</Data></Cell>`).join("")}</Row>`;
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/></Style></Styles>
<Worksheet ss:Name="Folha"><Table>${row(headers,true)}${xmlRows.map(x=>row(x)).join("")}${row(total)}</Table></Worksheet></Workbook>`;
  const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `folha_${competence.replace(/[^0-9-]/g, "")}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}

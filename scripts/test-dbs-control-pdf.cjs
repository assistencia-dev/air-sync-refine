const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/dbs-control-pdf.js"), "utf8");

function createPdfDocument() {
  let pages = 1;
  let fontSize = 8;
  const calls = [];
  return {
    calls,
    internal: { getNumberOfPages: () => pages },
    setProperties() {}, setFont() {}, setFontSize(value) { fontSize = value; },
    setTextColor() {}, setDrawColor() {}, setLineWidth() {}, setFillColor() {},
    rect() {}, roundedRect() {}, line() {},
    addImage() { calls.push({ type: "image" }); },
    addPage() { pages += 1; }, setPage() {},
    getTextWidth(value) { return String(value ?? "").length * fontSize * 0.16; },
    splitTextToSize(value, width) {
      const raw = String(value ?? "");
      const chars = Math.max(8, Math.floor(width / (fontSize * 0.16)));
      const result = [];
      for (let index = 0; index < raw.length; index += chars) result.push(raw.slice(index, index + chars));
      return result.length ? result : [""];
    },
    text(value) {
      calls.push({ type: "text", value: Array.isArray(value) ? value.join(" ") : String(value) });
    },
    addFileToVFS() {}, addFont() {},
  };
}

class FakeImage {
  constructor() {
    this.width = 640;
    this.height = 480;
    this.naturalWidth = 640;
    this.naturalHeight = 480;
  }
  set src(value) {
    this._src = value;
    if (this.onload) this.onload();
  }
}

const windowObject = {
  location: { search: "" },
  jspdf: { jsPDF: function () { return createPdfDocument(); } },
};
const documentObject = {
  createElement() {
    return {
      width: 0,
      height: 0,
      getContext() { return { drawImage() {} }; },
      toDataURL() { return "data:image/png;base64,ZmFrZQ=="; },
    };
  },
};
const context = vm.createContext({
  window: windowObject,
  document: documentObject,
  Image: FakeImage,
  URLSearchParams,
  fetch: async () => ({ ok: false }),
  btoa: value => Buffer.from(value, "binary").toString("base64"),
  console,
  setTimeout,
  clearTimeout,
  Intl,
  Date,
  Promise,
  Uint8Array,
});

vm.runInContext(source, context, { filename: "dbs-control-pdf.js" });

const baseState = {
  company: { legal_name: "DBS AIR", cnpj: "13352707000109", email: "contato@dbsair.com.br" },
  clientes: [{ id: "client-1", nome: "Cliente de Teste", cpf: "12345678901" }],
  tecnicos: [{ id: "tech-1", nome: "Técnico de Teste", matricula: "M-01", cargo: "Técnico" }],
  equipamentos: [],
  servicos: [],
  ordens: [],
};

async function render(order, extraState = {}) {
  const state = { ...baseState, ...extraState, ordens: [order] };
  const doc = await windowObject.DbsControlPdf.generate(state, order.id);
  return {
    text: doc.calls.filter(call => call.type === "text").map(call => call.value).join("\n"),
    imageCount: doc.calls.filter(call => call.type === "image").length,
    pages: doc.internal.getNumberOfPages(),
  };
}

async function main() {
  const noEquipment = await render({
    id: "os-1", protocolo: "OS-1", clienteId: "client-1", tecnicoId: "tech-1",
    tipo: "Corretiva", status: "Em Atendimento",
  });

  const multipleEquipment = await render({
    id: "os-2", protocolo: "OS-2", clienteId: "client-1", tecnicoId: "tech-1",
    equipamentos: [{ id: "eq-1" }, { id: "eq-2" }], tipo: "Corretiva", status: "Em Atendimento",
  }, {
    equipamentos: [
      { id: "eq-1", tag: "TAG-001", tipo: "Split", modelo: "Modelo A" },
      { id: "eq-2", tag: "TAG-002", tipo: "Cassete", modelo: "Modelo B" },
    ],
  });

  const correctiveWithoutChecklist = await render({
    id: "os-3", protocolo: "OS-3", clienteId: "client-1", tipo: "Corretiva", status: "Concluída",
  });

  const preventiveWithChecklist = await render({
    id: "os-4", protocolo: "OS-4", clienteId: "client-1", tipo: "Preventiva", status: "Concluída",
    checklist: [
      { titulo: "Verificar filtros", concluido: true },
      { titulo: "Verificar drenagem", concluido: true },
    ],
    checklistTecnico: { EVAPORADORA: { "Limpeza de filtro de ar": true } },
    pecasUsadas: [{ id: "P-01", nome: "Filtro", qtd: 2, unidade: "UN" }],
  });

  const withPhotos = await render({
    id: "os-5", protocolo: "OS-5", clienteId: "client-1", tipo: "Corretiva", status: "Concluída",
    fotoAntes: "data:image/png;base64,AAAA",
    fotoDepois: "data:image/png;base64,BBBB",
    assinatura: "data:image/png;base64,CCCC",
    assinaturaTecnico: "data:image/png;base64,DDDD",
  });

  const withoutPhotos = await render({
    id: "os-6", protocolo: "OS-6", clienteId: "client-1", tipo: "Corretiva", status: "Concluída",
  });

  assert.match(noEquipment.text, /Todos os equipamentos da unidade/);
  assert.match(multipleEquipment.text, /TAG-001/);
  assert.match(multipleEquipment.text, /TAG-002/);
  assert.doesNotMatch(correctiveWithoutChecklist.text, /CHECKLIST TÉCNICO \/ INSPEÇÃO PMOC/);
  assert.match(preventiveWithChecklist.text, /CHECKLIST TÉCNICO \/ INSPEÇÃO PMOC/);
  assert.match(preventiveWithChecklist.text, /CONFORME/);
  assert.match(preventiveWithChecklist.text, /PEÇAS, MATERIAIS E INSUMOS/);
  assert.match(preventiveWithChecklist.text, /DESCRIÇÃO DA PEÇA\/MATERIAL/);
  assert.match(withPhotos.text, /Evidência: Antes do Atendimento/);
  assert.match(withPhotos.text, /Evidência: Após Execução/);
  assert.ok(withPhotos.imageCount >= 5, "logo, duas evidências e as duas assinaturas devem ser renderizados");
  assert.doesNotMatch(withoutPhotos.text, /Evidência: Antes do Atendimento/);
  assert.doesNotMatch(withoutPhotos.text, /Evidência: Após Execução/);

  console.log("DBS Control PDF: no equipment, multiple equipment, corrective, preventive checklist, parts and photo evidence scenarios passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

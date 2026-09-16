import fs from "node:fs";

const path = "src/routes/_authenticated/treasury.tsx";
const source = fs.readFileSync(path, "utf8");
const startMarker = "const TREASURY_HTML = `";
const endMarker = "`;
\nfunction TreasuryPage";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start + startMarker.length);

if (start < 0 || end < 0) {
  throw new Error("Não foi possível localizar o template DBS TREASURY.");
}

let preparedSource = source;
// O Treasury é um módulo integralmente client-side. Removemos a opção SSR
// desnecessária/incompatível antes do Vite compilar a rota.
preparedSource = preparedSource.replace(
  /createFileRoute\(([^)]*)\)\(\{\s*ssr:\s*false,\s*/,
  "createFileRoute($1)({\n  ",
);

let html = preparedSource.slice(start + startMarker.length, end);
// O HTML contém JavaScript próprio com template literals. Como ele está
// dentro de um template literal TypeScript, os caracteres internos precisam
// permanecer escapados. O processo é idempotente: só escapa ocorrências que
// ainda não possuem barra invertida.
html = html.replace(/(?<!\\)`/g, "\\`");
html = html.replace(/(?<!\\)\$\{/g, "\\${");

const prepared = preparedSource.slice(0, start + startMarker.length) + html + preparedSource.slice(end);
if (prepared !== source) fs.writeFileSync(path, prepared);

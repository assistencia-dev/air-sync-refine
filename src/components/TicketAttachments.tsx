import {
  Download,
  FileArchive,
  FileText,
  ImagePlus,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { zipSync } from "fflate";
import { supabase } from "@/integrations/supabase/client";

type Attachment = {
  id: string;
  file_url: string;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  storage_path: string | null;
  created_at: string;
};

const BUCKET = "ticket-attachments";
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ACCEPT = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt";

function formatBytes(value: number | null) {
  if (!value) return "tamanho não informado";
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function safeName(value: string) {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);
}

export async function uploadTicketFiles(ticketId: string, files: File[]) {
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE)
      throw new Error(`O arquivo ${file.name} excede o limite de 15 MB.`);
    const path = `${ticketId}/${crypto.randomUUID()}-${safeName(file.name)}`;
    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (storageError) throw new Error(storageError.message);
    const { error: rowError } = await supabase.from("ticket_attachments").insert({
      ticket_id: ticketId,
      file_url: path,
      storage_path: path,
      file_name: file.name,
      file_type: file.type || null,
      file_size: file.size,
    });
    if (rowError) {
      await supabase.storage.from(BUCKET).remove([path]);
      throw new Error(rowError.message);
    }
  }
}

export function TicketAttachments({
  ticketId,
  canUpload = false,
}: {
  ticketId: string;
  canUpload?: boolean;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("ticket_attachments")
      .select("id, file_url, file_name, file_type, file_size, storage_path, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false });
    if (error) {
      setAvailable(false);
      setMessage("Anexos aguardando configuração do armazenamento.");
      setItems([]);
      setLoading(false);
      return;
    }
    setAvailable(true);
    setItems((data ?? []) as Attachment[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [ticketId]);

  const countLabel = useMemo(
    () => `${items.length} ${items.length === 1 ? "arquivo" : "arquivos"}`,
    [items.length],
  );

  async function uploadFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setUploading(true);
    setMessage(null);
    try {
      for (const file of files) {
        if (file.size > MAX_FILE_SIZE)
          throw new Error(`O arquivo ${file.name} excede o limite de 15 MB.`);
        const path = `${ticketId}/${crypto.randomUUID()}-${safeName(file.name)}`;
        const { error: storageError } = await supabase.storage.from(BUCKET).upload(path, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
        if (storageError) throw new Error(storageError.message);
        const { error: rowError } = await supabase.from("ticket_attachments").insert({
          ticket_id: ticketId,
          file_url: path,
          storage_path: path,
          file_name: file.name,
          file_type: file.type || null,
          file_size: file.size,
        });
        if (rowError) {
          await supabase.storage.from(BUCKET).remove([path]);
          throw new Error(rowError.message);
        }
      }
      await load();
      setMessage(
        `${files.length} ${files.length === 1 ? "arquivo enviado" : "arquivos enviados"} com sucesso.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível enviar o arquivo.");
    } finally {
      setUploading(false);
    }
  }

  async function signedUrl(item: Attachment) {
    const path = item.storage_path || item.file_url;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120);
    if (error || !data?.signedUrl) throw new Error("Não foi possível preparar o download.");
    return data.signedUrl;
  }

  async function downloadOne(item: Attachment) {
    try {
      const url = await signedUrl(item);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.file_name || "anexo";
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.click();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível baixar o arquivo.");
    }
  }

  async function downloadZip() {
    if (!items.length) return;
    setZipping(true);
    setMessage(null);
    try {
      const files: Record<string, Uint8Array> = {};
      for (const item of items) {
        const response = await fetch(await signedUrl(item));
        if (!response.ok) throw new Error("Um dos anexos não pôde ser lido.");
        files[safeName(item.file_name || `anexo-${item.id}`)] = new Uint8Array(
          await response.arrayBuffer(),
        );
      }
      const blob = new Blob([zipSync(files, { level: 6 })], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `anexos-${ticketId.slice(0, 8)}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível compactar os anexos.");
    } finally {
      setZipping(false);
    }
  }

  async function remove(item: Attachment) {
    if (!window.confirm(`Excluir o arquivo “${item.file_name || "anexo"}”?`)) return;
    const path = item.storage_path || item.file_url;
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([path]);
    if (storageError) return setMessage(storageError.message);
    const { error } = await supabase.from("ticket_attachments").delete().eq("id", item.id);
    if (error) return setMessage(error.message);
    await load();
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <Paperclip className="h-3.5 w-3.5 text-sky-600" /> Anexos{" "}
          <span className="font-medium text-slate-400">
            · {available ? countLabel : "aguardando configuração"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => void downloadZip()}
              disabled={zipping}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:border-sky-200 hover:text-sky-700 disabled:opacity-60"
            >
              <FileArchive className="h-3.5 w-3.5" />{" "}
              {zipping ? "Preparando ZIP..." : "Baixar tudo (.zip)"}
            </button>
          )}
          {canUpload && available && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-sky-700">
              <Upload className="h-3.5 w-3.5" /> {uploading ? "Enviando..." : "Adicionar arquivo"}
              <input
                type="file"
                multiple
                accept={ACCEPT}
                onChange={uploadFiles}
                disabled={uploading}
                className="sr-only"
              />
            </label>
          )}
        </div>
      </div>
      {canUpload && available && (
        <p className="mt-2 text-[10px] text-slate-400">
          Fotos, PDF e documentos até 15 MB por arquivo.
        </p>
      )}
      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando anexos...
        </div>
      ) : !available ? (
        <p className="py-3 text-xs text-amber-700">
          Os anexos serão ativados quando o ambiente de armazenamento correto estiver conectado.
        </p>
      ) : items.length === 0 ? (
        <p className="py-3 text-xs text-slate-400">Nenhum anexo neste chamado.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map((item) => {
            const image = item.file_type?.startsWith("image/");
            return (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-sky-50 text-sky-600">
                  {image ? (
                    <ImagePlus className="h-3.5 w-3.5" />
                  ) : (
                    <FileText className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[11px] text-slate-700">
                    {item.file_name || "Anexo"}
                  </strong>
                  <small className="text-[10px] text-slate-400">
                    {formatBytes(item.file_size)} ·{" "}
                    {new Date(item.created_at).toLocaleDateString("pt-BR")}
                  </small>
                </span>
                <button
                  type="button"
                  onClick={() => void downloadOne(item)}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-sky-50 hover:text-sky-700"
                  aria-label={`Baixar ${item.file_name || "anexo"}`}
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                {canUpload && (
                  <button
                    type="button"
                    onClick={() => void remove(item)}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label={`Excluir ${item.file_name || "anexo"}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {message && <p className="mt-2 text-[10px] font-semibold text-slate-500">{message}</p>}
    </div>
  );
}

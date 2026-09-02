import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Paperclip, Upload } from "lucide-react";
import { listTicketAttachments, uploadTicketAttachment } from "@/lib/attachments.functions";

const MAX_BYTES = 15 * 1024 * 1024;

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function sizeText(bytes: number | null) {
  if (!bytes) return "";
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Painel de anexos compartilhado entre o portal do cliente e o painel administrativo. */
export function TicketAttachments({
  ticketId,
  compact = false,
  canUpload = true,
}: {
  ticketId: string;
  compact?: boolean;
  canUpload?: boolean;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["ticket-attachments", ticketId],
    queryFn: () => listTicketAttachments({ data: { ticket_id: ticketId } }),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_BYTES) throw new Error("Arquivo acima do limite de 15 MB.");
      const data_base64 = await readAsBase64(file);
      return uploadTicketAttachment({
        data: {
          ticket_id: ticketId,
          file_name: file.name,
          file_type: file.type || null,
          data_base64,
        },
      });
    },
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["ticket-attachments", ticketId] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Falha ao enviar o anexo."),
  });

  const items = list.data ?? [];

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[.16em] text-slate-500">
        <Paperclip className="h-3.5 w-3.5" /> Anexos ({items.length})
      </div>

      {list.isLoading && (
        <p className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" /> Carregando anexos...
        </p>
      )}

      {!list.isLoading && items.length === 0 && (
        <p className="text-[11px] text-slate-400">Nenhum arquivo anexado a este chamado.</p>
      )}

      <ul className="space-y-1.5">
        {items.map((a) => (
          <li key={a.id}>
            <a
              href={a.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[220px] truncate">{a.file_name}</span>
              <span className="ml-auto whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {a.uploader_role ?? ""} {sizeText(a.file_size)}
              </span>
            </a>
          </li>
        ))}
      </ul>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload.mutate(file);
        }}
      />
      <button
        type="button"
        disabled={upload.isPending}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 transition hover:border-sky-400 hover:text-sky-700 disabled:opacity-60"
      >
        {upload.isPending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Enviando...
          </>
        ) : (
          <>
            <Upload className="h-3.5 w-3.5" /> Anexar arquivo
          </>
        )}
      </button>
      <p className="text-[10px] text-slate-400">Imagens, PDF ou planilhas até 15 MB.</p>
      {error && <p className="text-[11px] font-semibold text-red-700">{error}</p>}
    </div>
  );
}

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Paperclip, Upload } from "lucide-react";
import {
  listTicketAttachments,
  uploadTicketAttachment,
  type TicketAttachment,
} from "@/lib/attachments.functions";

function formatSize(size: number | null) {
  if (!size) return "PDF";
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function TicketAttachments({
  ticketId,
  canUpload = false,
}: {
  ticketId: string;
  canUpload?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const attachments = useQuery({
    queryKey: ["ticket-attachments", ticketId],
    queryFn: () => listTicketAttachments({ data: { ticket_id: ticketId } }),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        throw new Error("A OS precisa estar no formato PDF.");
      }
      if (file.size > 15 * 1024 * 1024) throw new Error("O PDF deve ter no máximo 15 MB.");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("Não foi possível ler o PDF."));
        reader.readAsDataURL(file);
      });
      return uploadTicketAttachment({
        data: {
          ticket_id: ticketId,
          file_name: file.name,
          file_type: "application/pdf",
          data_base64: base64,
        },
      });
    },
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["ticket-attachments", ticketId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Falha ao enviar a OS."),
  });

  return (
    <div className="min-w-[210px] space-y-2">
      {attachments.isLoading && (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" /> Verificando OS
        </span>
      )}
      {attachments.isError && (
        <span className="text-[11px] text-slate-500">Anexos indisponíveis</span>
      )}
      {(attachments.data ?? []).map((file: TicketAttachment) => (
        <a
          key={file.id}
          href={file.url ?? undefined}
          target="_blank"
          rel="noreferrer"
          download={file.file_name}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-left transition hover:border-sky-300 hover:bg-sky-50"
        >
          <FileText className="h-4 w-4 shrink-0 text-red-600" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">
            {file.file_name}
            <small className="block font-normal text-slate-400">{formatSize(file.file_size)}</small>
          </span>
          <Download className="h-3.5 w-3.5 shrink-0 text-sky-700" />
        </a>
      ))}
      {canUpload && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-sky-300 bg-sky-50 px-2.5 py-2 text-[11px] font-bold text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
          >
            <Upload className="h-3.5 w-3.5" />{" "}
            {upload.isPending ? "Enviando OS..." : "Anexar OS em PDF"}
          </button>
          {error && <p className="max-w-[220px] text-[11px] leading-4 text-red-700">{error}</p>}
        </>
      )}
      {!attachments.isLoading &&
        !attachments.isError &&
        !(attachments.data ?? []).length &&
        !canUpload && (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
            <Paperclip className="h-3 w-3" /> Nenhuma OS anexada
          </span>
        )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  ChevronRight,
  CircleHelp,
  LayoutDashboard,
  Landmark,
  LogOut,
  Menu,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type AdminArea = "home" | "operation" | "people" | "finance" | "more";

type Props = {
  active?: AdminArea;
  financePath?: "/treasury" | "/financeiro-acompanhamento";
};

const primaryItems: Array<{ id: AdminArea; label: string; icon: typeof LayoutDashboard }> = [
  { id: "home", label: "Início", icon: LayoutDashboard },
  { id: "operation", label: "Operação", icon: Wrench },
  { id: "people", label: "Pessoas", icon: Users },
  { id: "finance", label: "Financeiro", icon: Landmark },
];

/**
 * Navegação administrativa exclusiva para telas pequenas.
 * O colaborador usa outro shell; este componente não altera dados nem permissões.
 */
export function MobileAdminNavigation({ active = "home", financePath = "/treasury" }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const goHome = () => {
    setOpen(false);
    void navigate({ to: "/admin" });
  };

  const goOperation = () => {
    setOpen(false);
    void navigate({ to: "/dbs-control" });
  };

  const goPeople = () => {
    setOpen(false);
    void navigate({ to: "/admin/rh-dashboard" });
  };

  const goFinance = () => {
    setOpen(false);
    void navigate({ to: financePath });
  };

  const goTickets = () => {
    setOpen(false);
    void navigate({ to: "/admin", search: { tab: "tickets" } });
  };

  const goUsers = () => {
    setOpen(false);
    void navigate({ to: "/admin", search: { tab: "users" } });
  };

  const goTraining = () => {
    setOpen(false);
    void navigate({ to: "/treinamento" });
  };

  const signOut = async () => {
    setOpen(false);
    await supabase.auth.signOut();
    void navigate({ to: "/login", replace: true });
  };

  const go = (id: AdminArea) => {
    if (id === "home") goHome();
    if (id === "operation") goOperation();
    if (id === "people") goPeople();
    if (id === "finance") goFinance();
  };

  return (
    <>
      {open && (
        <div
          className="admin-mobile-menu-backdrop fixed inset-0 z-[70] bg-slate-950/45 backdrop-blur-[2px] lg:hidden"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <section
            className="admin-mobile-menu-sheet absolute inset-x-3 bottom-[calc(4.8rem+env(safe-area-inset-bottom))] max-h-[min(78dvh,620px)] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Mais áreas administrativas"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="admin-mobile-menu-handle" aria-hidden="true" />
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.18em] text-sky-700">DBS AIR</p>
                <h2 className="mt-1 text-lg font-black text-slate-950">Mais áreas</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid min-h-11 min-w-11 place-items-center rounded-2xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-3 grid gap-2">
              <button type="button" onClick={goTickets} className="admin-mobile-menu-item">
                <span className="admin-mobile-menu-icon bg-amber-50 text-amber-700"><CircleHelp className="h-5 w-5" /></span>
                <span><strong>Central de chamados</strong><small>Fila, responsáveis e status</small></span>
                <ChevronRight className="ml-auto h-4 w-4 text-slate-400" />
              </button>
              <button type="button" onClick={goUsers} className="admin-mobile-menu-item">
                <span className="admin-mobile-menu-icon bg-sky-50 text-sky-700"><Users className="h-5 w-5" /></span>
                <span><strong>Usuários vinculados</strong><small>Perfis, empresas e acessos</small></span>
                <ChevronRight className="ml-auto h-4 w-4 text-slate-400" />
              </button>
              <button type="button" onClick={goPeople} className="admin-mobile-menu-item">
                <span className="admin-mobile-menu-icon bg-emerald-50 text-emerald-700"><BriefcaseBusiness className="h-5 w-5" /></span>
                <span><strong>RH e ponto</strong><small>Colaboradores, jornadas e benefícios</small></span>
                <ChevronRight className="ml-auto h-4 w-4 text-slate-400" />
              </button>
              <button type="button" onClick={goFinance} className="admin-mobile-menu-item">
                <span className="admin-mobile-menu-icon bg-violet-50 text-violet-700"><BarChart3 className="h-5 w-5" /></span>
                <span><strong>Financeiro</strong><small>Ledger, caixa e acompanhamento</small></span>
                <ChevronRight className="ml-auto h-4 w-4 text-slate-400" />
              </button>
              <button type="button" onClick={goTraining} className="admin-mobile-menu-item">
                <span className="admin-mobile-menu-icon bg-cyan-50 text-cyan-700"><BookOpen className="h-5 w-5" /></span>
                <span><strong>Dúvidas e treinamento</strong><small>POP e orientações operacionais</small></span>
                <ChevronRight className="ml-auto h-4 w-4 text-slate-400" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-3 flex min-h-12 w-full items-center gap-3 rounded-2xl border border-rose-100 bg-rose-50 px-4 text-left text-sm font-black text-rose-700 transition hover:bg-rose-100"
            >
              <LogOut className="h-5 w-5" /> Encerrar sessão
            </button>
          </section>
        </div>
      )}

      <nav
        className="admin-mobile-nav fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200/90 bg-white/95 px-2 pt-2 shadow-[0_-10px_30px_rgba(15,23,42,.10)] backdrop-blur-xl lg:hidden"
        aria-label="Navegação administrativa"
      >
        <div className="mx-auto grid max-w-xl grid-cols-5 gap-1 pb-[max(8px,env(safe-area-inset-bottom))]">
          {primaryItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              className={`admin-mobile-nav-item ${active === id ? "is-active" : ""}`}
              aria-current={active === id ? "page" : undefined}
            >
              <Icon className="h-[19px] w-[19px]" />
              <span>{label}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className={`admin-mobile-nav-item ${active === "more" || open ? "is-active" : ""}`}
            aria-expanded={open}
          >
            {open ? <X className="h-[19px] w-[19px]" /> : <Menu className="h-[19px] w-[19px]" />}
            <span>Mais</span>
          </button>
        </div>
      </nav>
    </>
  );
}

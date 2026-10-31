import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Landmark,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Wifi,
  Wrench,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { BrandLogo } from "@/components/BrandLogo";
import { MobileAdminNavigation } from "@/components/MobileAdminNavigation";
import { getMyProfile } from "@/lib/admin-profile.functions";

export const Route = createFileRoute("/_authenticated/treinamento")({
  head: () => ({
    meta: [
      { title: "Dúvidas e Treinamento | DBS Air" },
      {
        name: "description",
        content: "POP operacional e central de dúvidas do DBS Air.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: TrainingPage,
});

const NATIVE_ADMIN_USERNAMES = new Set(["DBS123", "DBSASSISTENCIA123"]);

const trainingSections = [
  {
    id: "inicio",
    label: "Visão geral",
    eyebrow: "Comece aqui",
    title: "O fluxo operacional em um só lugar",
    description: "Uma leitura rápida para orientar o dia a dia, do acesso à conferência final.",
    icon: Sparkles,
    accent: "#1769D1",
    steps: [
      ["Entrar", "Confira seu perfil, base e permissões antes de iniciar."],
      ["Organizar", "Crie, receba ou filtre as OS que fazem parte da sua operação."],
      ["Executar", "Registre checklist, peças, fotos, observações e assinatura."],
      ["Concluir", "Escolha o status correto e confirme que a sincronização terminou."],
    ],
    checklist: [
      "Use sempre a mesma sessão autenticada durante o atendimento.",
      "Acompanhe o indicador de sincronização antes de fechar a tela.",
      "Em caso de dúvida, consulte o módulo correspondente antes de repetir um lançamento.",
    ],
    tip: "O sistema foi organizado para que cada alteração operacional seja gravada como uma ação individual, preservando histórico e rastreabilidade.",
  },
  {
    id: "dbs-control",
    label: "DBS CONTROL",
    eyebrow: "Ordens de serviço",
    title: "Emitir, despachar e concluir OS com segurança",
    description: "Procedimento padrão para administração, despacho e execução em campo.",
    icon: Wrench,
    accent: "#0284C7",
    steps: [
      ["Emitir", "Selecione o cliente da base correta e apenas os equipamentos necessários."],
      ["Atribuir", "Escolha o técnico responsável e confirme o tipo de atendimento."],
      ["Executar", "Preencha o checklist por etapas, registre evidências e colha o aceite."],
      [
        "Classificar",
        "Use Concluída, Concluída com pendência, Aguardando peça, Aguardando aprovação, Retorno necessário ou Cancelada.",
      ],
    ],
    checklist: [
      "O colaborador só deve visualizar clientes vinculados à sua base operacional.",
      "A opção Equipamento identifica o ativo atendido; local de atendimento não é um segundo cadastro de equipamento.",
      "Ao concluir, informe observações, peças, fotos, geolocalização e assinatura quando aplicável.",
      "Para abrir a rota do cliente, toque no endereço e escolha o aplicativo de navegação do aparelho.",
    ],
    tip: "Uma OS concluída não deve voltar para aberta após a reconexão. Se houver conflito, revise a versão mais recente e preserve o preenchimento local.",
  },
  {
    id: "rh",
    label: "RH e ponto",
    eyebrow: "Pessoas e jornada",
    title: "Corrigir ponto sem perder o histórico",
    description: "Rotina de conferência, correção e exportação do ponto eletrônico.",
    icon: Users,
    accent: "#0F766E",
    steps: [
      ["Conferir", "Revise as marcações do colaborador e o fuso da unidade."],
      ["Corrigir", "Informe o horário corrigido e uma justificativa objetiva."],
      ["Aprovar", "Mantenha o registro original, a alteração e o responsável pela aprovação."],
      ["Exportar", "Gere PDF ou CSV depois de confirmar que a tela e o relatório estão iguais."],
    ],
    checklist: [
      "Jornadas que atravessam a meia-noite devem ser conferidas pelo dia operacional correto.",
      "Até quatro marcações diárias podem ser auditadas sem apagar a marcação original.",
      "Use a justificativa da correção para facilitar a auditoria futura.",
    ],
    tip: "Correção de ponto é uma nova informação de auditoria, não uma substituição silenciosa do registro original.",
  },
  {
    id: "financeiro",
    label: "Financeiro",
    eyebrow: "DBS TREASURY",
    title: "Lançamentos com dupla entrada",
    description: "Referência rápida para registrar, conferir e acompanhar o módulo financeiro.",
    icon: Landmark,
    accent: "#7C3AED",
    steps: [
      ["Preparar", "Confirme conta, competência, descrição e valor do lançamento."],
      ["Lançar", "Registre as partidas de débito e crédito pela estrutura relacional do Ledger."],
      ["Conferir", "O total de débitos e créditos deve fechar em zero antes da confirmação."],
      ["Acompanhar", "Verifique o evento na Outbox e a atualização do saldo após o commit."],
    ],
    checklist: [
      "Use a competência do fato gerador, não apenas a data de pagamento.",
      "Em uma falha de rede, repita com a mesma idempotency key; não crie outro lançamento.",
      "Snapshots antigos são referência histórica; novos lançamentos seguem pelo Ledger relacional.",
    ],
    tip: "Se a confirmação não aparecer, pare e consulte o estado do lançamento. Repetir várias vezes pode dificultar a conciliação.",
  },
  {
    id: "cadastros",
    label: "Usuários e clientes",
    eyebrow: "Cadastro e permissões",
    title: "Cadastrar cliente ou colaborador com o vínculo correto",
    description:
      "Roteiro completo para criar o acesso, registrar a pessoa e liberar somente o escopo necessário.",
    icon: BookOpen,
    accent: "#0891B2",
    steps: [
      [
        "Preparar",
        "Confirme se você está usando um acesso SUPER_ADMIN e reúna nome, e-mail, documento, empresa e unidade.",
      ],
      [
        "Cadastrar cliente",
        "Use Admin → Usuários vinculados → + Novo Acesso. Escolha Cliente e vincule uma empresa existente ou crie uma nova.",
      ],
      [
        "Cadastrar colaborador",
        "Registre primeiro a pessoa em RH → Funcionários → Novo funcionário; depois crie o login com o papel Colaborador.",
      ],
      [
        "Definir escopo",
        "No cadastro do funcionário, selecione a Base DBS, vincule os clientes da base e marque Permitir emitir OS quando autorizado.",
      ],
      [
        "Vincular login",
        "Em Acesso do funcionário, selecione o login COLABORADOR criado em Usuários vinculados e confirme o vínculo.",
      ],
      [
        "Validar",
        "Faça um teste de entrada, confira o nome/base e valide que o usuário enxerga somente os clientes autorizados.",
      ],
    ],
    details: [
      {
        title: "A · Usuário de cliente / gestor",
        bullets: [
          "Abra o Painel Administrativo e entre em Usuários vinculados.",
          "Clique em + Novo Acesso e preencha Nome completo, E-mail, CPF opcional, Papel e Senha temporária.",
          "Para uma empresa que já existe, escolha Vincular a uma Rede/Empresa já existente e selecione Empresa e Unidade / Loja.",
          "Para uma empresa nova, escolha Cliente Novo, informe Nome da Empresa/Cliente, CNPJ e, se necessário, Nome da Unidade.",
          "Use Cliente para acesso de cliente, Gestor de conta para o responsável da rede e Gestor regional para o escopo regional.",
          "Clique em Criar Acesso, copie as credenciais exibidas uma única vez e entregue por canal seguro.",
        ],
      },
      {
        title: "B · Cadastro mestre do colaborador",
        bullets: [
          "Entre em Admin → RH → Funcionários e clique em Novo funcionário.",
          "Preencha Nome completo e Unidade / setor; depois complete CPF, telefone, cargo, admissão, jornada, salário e observações conforme a necessidade do RH.",
          "A ficha mestre alimenta ponto, DP, folha, benefícios e o vínculo operacional do DBS CONTROL.",
          "Salve o funcionário antes de liberar o acesso. Não use apenas um login solto sem cadastro RH.",
          "Se o colaborador já existir, edite o registro em vez de criar uma segunda ficha; isso evita duplicidade de histórico e de ponto.",
        ],
      },
      {
        title: "C · Login e permissão de emissão de OS",
        bullets: [
          "Em Usuários vinculados → + Novo Acesso, escolha o papel Colaborador, informe nome, e-mail e senha temporária e crie o login.",
          "Volte ao RH → Funcionários, abra Acesso do funcionário e selecione o login criado em Usuários vinculados.",
          "Marque Acesso à Folha de Ponto se ele usará o ponto e Liberar DBS CONTROL para habilitar o módulo de OS.",
          "No cadastro do funcionário, selecione uma Base operacional ativa. Sem base ativa, a emissão de OS permanece bloqueada.",
          "Marque Permitir emitir OS somente quando necessário. Essa permissão força o colaborador como responsável e limita os clientes à base.",
        ],
      },
      {
        title: "D · Base, clientes e conferência",
        bullets: [
          "No RH → Funcionários → Bases DBS, crie a base com nome e código opcional.",
          "Selecione quantos clientes forem necessários, filtre por nome/CNPJ e clique em Salvar base e vínculos.",
          "A base precisa estar ativa e os clientes precisam existir no cadastro relacional do DBS CONTROL.",
          "Para cadastrar o cliente operacional usado na OS, abra DBS CONTROL → Clientes e informe Razão Social/Nome, CNPJ/CPF, Endereço Completo e Pessoa de Contato.",
          "Depois de vincular a base, teste o login do colaborador: o menu deve mostrar Emitir OS e o seletor deve listar somente clientes daquela base.",
        ],
      },
      {
        title: "E · Segurança e manutenção",
        bullets: [
          "Nunca coloque senha, chave de integração ou credencial em observações, planilhas ou mensagens públicas.",
          "Entregue a senha temporária por canal seguro e peça a troca no primeiro acesso quando essa política estiver habilitada.",
          "Para alterar empresa, unidade ou papel, edite o usuário e registre a mudança; não crie outro login para contornar uma configuração.",
          "Para suspender, bloqueie o acesso ou inative o vínculo. O histórico de OS, ponto e auditoria deve permanecer preservado.",
          "Após qualquer mudança, saia e entre novamente no aparelho para renovar permissões e limpar o cache de sessão.",
        ],
      },
    ],
    checklist: [
      "Nome e e-mail não podem pertencer a outro acesso ativo sem uma decisão administrativa.",
      "Cliente de portal, cliente operacional e empresa/unidade são vínculos diferentes; confira cada um no módulo correto.",
      "Colaborador emissor precisa de: ficha RH ativa, login COLABORADOR, vínculo de acesso, DBS CONTROL liberado, base ativa e clientes vinculados.",
      "Faça um teste real de login e emissão antes de entregar o aparelho para o campo.",
      "Se o menu não aparecer, atualize a sessão depois de conferir todos os seis vínculos acima.",
    ],
    tip: "A ordem correta evita o problema mais comum do sistema: login criado sem funcionário, funcionário sem base ou base sem cliente vinculado. Cada etapa deve ser salva e conferida antes da próxima.",
  },
  {
    id: "sincronizacao",
    label: "Sincronização",
    eyebrow: "Confiabilidade",
    title: "O que fazer quando a conexão oscilar",
    description: "Como interpretar os estados e agir sem perder uma alteração.",
    icon: Wifi,
    accent: "#EA580C",
    steps: [
      ["Sincronizado", "A alteração foi confirmada na nuvem e pode ser encerrada."],
      ["Pendente", "A alteração está protegida na fila local; aguarde a reconexão."],
      ["Conflito", "Outro dispositivo alterou a mesma OS; revise antes de reconciliar."],
      [
        "Offline",
        "Continue o atendimento, mantenha a tela aberta e sincronize ao recuperar a rede.",
      ],
    ],
    checklist: [
      "Não exclua nem recadastre uma OS só porque o aviso de sincronização apareceu.",
      "Se houver conflito, use Revisar depois ou Reconciliar mantendo minhas alterações.",
      "A mesma alteração deve ser reprocessada com a mesma chave de idempotência.",
      "Se o estado permanecer pendente, registre o horário e encaminhe o protocolo ao administrador.",
    ],
    tip: "O aviso técnico não significa perda de dados: ele indica que o sistema bloqueou uma sobrescrita insegura e precisa concluir a reconciliação.",
  },
  {
    id: "duvidas",
    label: "Perguntas frequentes",
    eyebrow: "Ajuda rápida",
    title: "Respostas para os cenários mais comuns",
    description: "Consulte antes de repetir um processo ou abrir um chamado.",
    icon: CircleHelp,
    accent: "#DB2777",
    faqs: [
      [
        "Por que o colaborador não vê uma empresa?",
        "A tela deve respeitar a base vinculada ao colaborador. Confirme a base, o vínculo cliente-base e a permissão de emissão de OS.",
      ],
      [
        "A OS não aparece depois de concluir. O que fazer?",
        "Confira o status e o indicador de sincronização. Não recadastre a OS; aguarde a fila ou abra a revisão do conflito.",
      ],
      [
        "Posso apagar uma OS?",
        "Use a exclusão lógica somente quando autorizada. O registro desaparece da operação do colaborador, mas permanece disponível para auditoria administrativa.",
      ],
      [
        "O que significa uma OS com pendência?",
        "O atendimento foi realizado, mas ainda depende de peça, aprovação, retorno ou outra decisão operacional.",
      ],
      [
        "Como pedir ajuda?",
        "Registre o número da OS, horário, usuário, mensagem exibida e se estava online ou offline. Essas informações aceleram a investigação.",
      ],
    ],
    checklist: [
      "Tenha o número da OS em mãos antes de abrir um chamado.",
      "Descreva a ação que estava sendo executada e o resultado exibido.",
      "Nunca envie senha, token ou chave de integração em mensagens de suporte.",
    ],
    tip: "Uma descrição curta e precisa é mais útil do que várias tentativas repetidas na mesma tela.",
  },
] as const;

function TrainingPage() {
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });
  const [activeId, setActiveId] = useState("inicio");
  const [query, setQuery] = useState("");

  const canAccess = Boolean(
    profile.data &&
    (profile.data.role_key === "SUPER_ADMIN" ||
      profile.data.role_key === "ADMIN_OPERACIONAL" ||
      NATIVE_ADMIN_USERNAMES.has(profile.data.username ?? "")),
  );

  useEffect(() => {
    if (!profile.isPending && (!profile.data || !canAccess)) {
      navigate({ to: "/portal", replace: true });
    }
  }, [canAccess, navigate, profile.data, profile.isPending]);

  const visibleSections = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return trainingSections;
    return trainingSections.filter((section) => {
      const content = JSON.stringify(section).toLocaleLowerCase("pt-BR");
      return content.includes(normalized);
    });
  }, [query]);

  const activeSection =
    visibleSections.find((section) => section.id === activeId) ??
    visibleSections[0] ??
    trainingSections[0];

  if (profile.isPending || !profile.data || !canAccess) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f8fc] p-6">
        <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm">
          <BookOpen className="mx-auto h-8 w-8 animate-pulse text-[#1769D1]" />
          <p className="mt-3 text-sm font-semibold text-slate-600">
            Abrindo a central de treinamento…
          </p>
        </section>
      </main>
    );
  }

  return (
    <div
      className="admin-mobile-shell min-h-screen bg-[#f4f8fc] pb-20 text-[#102a43] lg:pb-0"
      style={{ fontFamily: "'Inter',system-ui,sans-serif" }}
    >
      <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex min-h-[72px] max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate({ to: "/admin" })}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:border-[#1769D1] hover:text-[#1769D1]"
              aria-label="Voltar ao painel administrativo"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <BrandLogo
              frameClassName="hidden rounded-lg px-2 py-1 sm:inline-flex"
              imageClassName="h-9 w-auto max-w-[150px] object-contain"
            />
            <div className="min-w-0">
              <p className="truncate text-[10px] font-extrabold uppercase tracking-[.18em] text-[#0284C7]">
                DBS AIR · CENTRAL OPERACIONAL
              </p>
              <h1 className="truncate text-base font-extrabold text-[#0B2745] sm:text-lg">
                Dúvidas / Treinamento
              </h1>
            </div>
          </div>
          <span className="hidden items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-700 sm:inline-flex">
            <ShieldCheck className="h-3.5 w-3.5" /> Conteúdo operacional
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <section className="relative overflow-hidden rounded-[28px] bg-[#0B2745] px-5 py-7 text-white shadow-[0_20px_55px_rgba(11,39,69,.18)] sm:px-8 sm:py-9">
          <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-[#1769D1]/35 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-[#22D3EE]/20 blur-3xl" />
          <div className="relative max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[.16em] text-cyan-100">
              <GraduationCap className="h-4 w-4" /> POP operacional DBS Air
            </div>
            <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              Decisões claras para uma operação sem retrabalho.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
              Consulte o procedimento certo, entenda o estado da operação e mantenha cada alteração
              rastreável — do atendimento em campo ao fechamento financeiro.
            </p>
          </div>
          <div className="relative mt-7 grid gap-3 sm:grid-cols-3">
            {[
              ["01", "Um fluxo", "Da emissão à auditoria"],
              ["06", "Módulos", "Organizados por rotina"],
              ["24/7", "Consulta", "No desktop ou celular"],
            ].map(([value, label, detail]) => (
              <div
                key={label}
                className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm"
              >
                <p className="text-2xl font-black text-cyan-200">{value}</p>
                <p className="mt-1 text-xs font-extrabold uppercase tracking-wider text-white">
                  {label}
                </p>
                <p className="mt-1 text-xs text-slate-300">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 focus-within:border-[#1769D1] focus-within:ring-2 focus-within:ring-[#1769D1]/10">
            <Search className="h-5 w-5 shrink-0 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar uma dúvida, módulo ou procedimento…"
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400"
              aria-label="Buscar no POP operacional"
            />
            <span className="hidden text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:inline">
              POP DBS
            </span>
          </label>
        </section>

        <div className="mt-5 grid gap-5 lg:grid-cols-[255px_minmax(0,1fr)]">
          <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-2 shadow-sm lg:sticky lg:top-[92px]">
            <p className="px-3 pb-2 pt-2 text-[10px] font-extrabold uppercase tracking-[.16em] text-slate-400">
              Navegar por assunto
            </p>
            <nav
              className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1"
              aria-label="Seções de treinamento"
            >
              {visibleSections.map((section) => {
                const Icon = section.icon;
                const active = section.id === activeSection.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveId(section.id)}
                    className={`group flex min-h-12 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? "bg-[#0B2745] text-white shadow-md" : "text-slate-600 hover:bg-slate-50 hover:text-[#0B2745]"}`}
                  >
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${active ? "bg-white/15" : "bg-slate-100"}`}
                      style={{ color: active ? "#A5F3FC" : section.accent }}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-extrabold">{section.label}</span>
                      <span
                        className={`block truncate text-[10px] ${active ? "text-slate-300" : "text-slate-400"}`}
                      >
                        {section.eyebrow}
                      </span>
                    </span>
                    <ChevronRight
                      className={`h-4 w-4 shrink-0 transition ${active ? "text-cyan-200" : "text-slate-300 group-hover:text-slate-500"}`}
                    />
                  </button>
                );
              })}
            </nav>
            {visibleSections.length === 0 && (
              <p className="p-3 text-xs leading-5 text-slate-500">
                Nenhum assunto encontrado. Tente outro termo.
              </p>
            )}
          </aside>

          <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-6">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
                  style={{
                    backgroundColor: `${activeSection.accent}16`,
                    color: activeSection.accent,
                  }}
                >
                  <activeSection.icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p
                    className="text-[10px] font-extrabold uppercase tracking-[.16em]"
                    style={{ color: activeSection.accent }}
                  >
                    {activeSection.eyebrow}
                  </p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight text-[#0B2745]">
                    {activeSection.title}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                    {activeSection.description}
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                <FileText className="h-3.5 w-3.5" /> POP DBS
              </span>
            </div>

            {"steps" in activeSection && (
              <section className="mt-6">
                <div className="mb-3 flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-[#1769D1]" />
                  <h3 className="text-sm font-extrabold uppercase tracking-wider text-[#0B2745]">
                    Procedimento recomendado
                  </h3>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {activeSection.steps.map(([label, detail], index) => (
                    <div
                      key={label}
                      className="relative rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
                    >
                      <span className="inline-grid h-7 w-7 place-items-center rounded-lg bg-[#1769D1] text-xs font-black text-white">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <h4 className="mt-3 text-sm font-extrabold text-[#0B2745]">{label}</h4>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {"details" in activeSection && (
              <section className="mt-6">
                <div className="mb-3 flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-[#0891B2]" />
                  <h3 className="text-sm font-extrabold uppercase tracking-wider text-[#0B2745]">
                    Detalhamento por cenário
                  </h3>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {activeSection.details.map((detail) => (
                    <section
                      key={detail.title}
                      className="rounded-2xl border border-cyan-100 bg-cyan-50/35 p-4"
                    >
                      <h4 className="text-sm font-black text-[#0B2745]">{detail.title}</h4>
                      <ul className="mt-3 space-y-2.5">
                        {detail.bullets.map((bullet) => (
                          <li
                            key={bullet}
                            className="flex gap-2.5 text-xs leading-5 text-slate-600"
                          >
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0891B2]" />
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </section>
            )}

            {"faqs" in activeSection && (
              <section className="mt-6 space-y-3">
                {activeSection.faqs.map(([question, answer]) => (
                  <details
                    key={question}
                    className="group rounded-2xl border border-slate-200 bg-slate-50/70 p-4 open:border-[#1769D1]/30 open:bg-blue-50/30"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-extrabold text-[#0B2745] [&::-webkit-details-marker]:hidden">
                      {question}
                      <ChevronRight className="h-4 w-4 shrink-0 text-[#1769D1] transition group-open:rotate-90" />
                    </summary>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{answer}</p>
                  </details>
                ))}
              </section>
            )}

            <section className="mt-6 rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-extrabold text-[#0B2745]">Checklist de conferência</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Use antes de encerrar a rotina ou solicitar suporte.
                </p>
              </div>
              <ul className="grid gap-3 p-4 sm:grid-cols-2">
                {activeSection.checklist.map((item) => (
                  <li key={item} className="flex gap-2.5 text-sm leading-5 text-slate-600">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{" "}
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <div className="mt-5 flex gap-3 rounded-2xl border border-cyan-100 bg-cyan-50/70 p-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#0284C7]" />
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wider text-[#0B5B7A]">
                  Ponto de atenção
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-600">{activeSection.tip}</p>
              </div>
            </div>
          </article>
        </div>
      </main>
      <MobileAdminNavigation active="more" />
    </div>
  );
}

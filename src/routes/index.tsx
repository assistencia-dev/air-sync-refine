import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  ChevronDown,
  CheckCircle2,
  Gavel,
  Heart,
  Beaker,
  Award,
  Phone,
  Mail,
  MapPin,
  Calendar,
  CalendarCheck,
  List,
  Instagram,
  Menu,
  X,
  ShieldCheck,
} from "lucide-react";
import logoAsset from "@/assets/logo-dbs-air.jpg.asset.json";

export const Route = createFileRoute("/")({
  component: Index,
});

const whatsappBase = "https://wa.me/5521998256991?text=";
const wa = (msg: string) => whatsappBase + encodeURIComponent(msg);
const defaultMsg =
  "Olá. Gostaria de solicitar um contato técnico comercial para avaliar a climatização/PMOC da minha empresa.";

function Index() {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleFaq = (i: number) => setExpandedFaq(expandedFaq === i ? null : i);

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      {/* ============ TOP UTILITY BAR ============ */}
      <div style={{ background: "#0F172A" }} className="text-white text-xs">
        <div className="container max-w-7xl mx-auto px-4 h-9 flex items-center justify-between">
          <div className="hidden sm:flex items-center gap-5">
            <span className="flex items-center gap-1.5" style={{ color: "#93C5FD" }}>
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="tracking-wider uppercase font-semibold">Lei 13.589/2018 · ANVISA · CREA/CFT</span>
            </span>
          </div>
          <div className="flex items-center gap-5">
            <a href="tel:+5521998256991" className="flex items-center gap-1.5 hover:text-white transition" style={{ color: "#CBD5E1" }}>
              <Phone className="w-3.5 h-3.5" /> +55 21 99825-6991
            </a>
            <a href="mailto:contato@dbsair.com.br" className="hidden md:flex items-center gap-1.5 hover:text-white transition" style={{ color: "#CBD5E1" }}>
              <Mail className="w-3.5 h-3.5" /> contato@dbsair.com.br
            </a>
            <a href="https://www.instagram.com/dbs.air/" target="_blank" rel="noopener noreferrer" className="hover:text-white transition" style={{ color: "#CBD5E1" }} aria-label="Instagram">
              <Instagram className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>

      {/* ============ MAIN HEADER (LOGO EM DESTAQUE) ============ */}
      <header className="sticky top-0 w-full bg-white z-50 shadow-md" style={{ borderBottom: "3px solid #1E3A8A" }}>
        <div className="container max-w-7xl mx-auto px-4 flex items-center justify-between h-24 md:h-28">
          {/* Logo XL */}
          <a href="#top" className="flex items-center gap-4 group">
            <img
              src={logoAsset.url}
              alt="DBS Air Refrigeração"
              className="h-16 md:h-20 w-auto object-contain transition-transform group-hover:scale-[1.02]"
            />
            <div className="hidden lg:block" style={{ borderLeft: "2px solid #E2E8F0", paddingLeft: "16px" }}>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: "#0284C7" }}>
                Engenharia de Climatização
              </p>
              <p className="text-sm font-semibold mt-0.5" style={{ color: "#0F172A" }}>
                PMOC · Manutenção · Conformidade
              </p>
            </div>
          </a>

          {/* Nav */}
          <nav className="hidden md:flex items-center gap-7">
            <a href="#solucoes" className="text-sm font-semibold text-gray-700 hover:text-[#0284C7] transition">Soluções</a>
            <a href="#pmoc" className="text-sm font-semibold text-gray-700 hover:text-[#0284C7] transition">PMOC</a>
            <a href="#modalidades" className="text-sm font-semibold text-gray-700 hover:text-[#0284C7] transition">Modalidades</a>
            <a href="#faq" className="text-sm font-semibold text-gray-700 hover:text-[#0284C7] transition">FAQ</a>
            <a
              href={wa(defaultMsg)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-white px-5 py-2.5 rounded-lg font-semibold text-sm shadow-md hover:shadow-lg transition"
              style={{ background: "linear-gradient(135deg,#1E3A8A,#0284C7)" }}
            >
              <Phone className="w-4 h-4" /> Solicitar Orçamento
            </a>
          </nav>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2 rounded-lg"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
            style={{ color: "#0F172A" }}
          >
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-gray-200 bg-white">
            <div className="container max-w-7xl mx-auto px-4 py-4 flex flex-col gap-3">
              <a href="#solucoes" onClick={() => setMenuOpen(false)} className="text-sm font-semibold text-gray-700 py-2">Soluções</a>
              <a href="#pmoc" onClick={() => setMenuOpen(false)} className="text-sm font-semibold text-gray-700 py-2">PMOC</a>
              <a href="#modalidades" onClick={() => setMenuOpen(false)} className="text-sm font-semibold text-gray-700 py-2">Modalidades</a>
              <a href="#faq" onClick={() => setMenuOpen(false)} className="text-sm font-semibold text-gray-700 py-2">FAQ</a>
              <a
                href={wa(defaultMsg)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 text-white px-5 py-3 rounded-lg font-semibold text-sm"
                style={{ background: "linear-gradient(135deg,#1E3A8A,#0284C7)" }}
              >
                <Phone className="w-4 h-4" /> Solicitar Orçamento
              </a>
            </div>
          </div>
        )}
      </header>

      {/* ============ HERO ============ */}
      <section id="top" className="py-20 md:py-28 relative overflow-hidden" style={{ background: "linear-gradient(135deg,#0F172A 0%,#1E3A8A 100%)" }}>
        {/* Decorative grid */}
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(#93C5FD 1px, transparent 1px), linear-gradient(90deg, #93C5FD 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="container max-w-7xl mx-auto px-4 relative">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.25em] mb-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ color: "#93C5FD", background: "rgba(147,197,253,0.1)", border: "1px solid rgba(147,197,253,0.3)" }}>
                <ShieldCheck className="w-3.5 h-3.5" /> Especialistas em PMOC
              </p>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-[1.1] text-white">
                Gestão Técnica de Climatização e <span style={{ color: "#93C5FD" }}>PMOC</span> para Empresas
              </h1>
              <p className="text-lg mb-8 leading-relaxed" style={{ color: "#CBD5E1" }}>
                Garanta a conformidade legal da sua operação e o desempenho térmico dos seus equipamentos com engenharia de manutenção qualificada. Atendemos empresas no <strong className="text-white">Rio de Janeiro e Região Metropolitana</strong>.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <a
                  href={wa(defaultMsg)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 text-white px-6 py-3.5 rounded-lg font-semibold transition transform hover:-translate-y-0.5 shadow-lg"
                  style={{ background: "#16A34A" }}
                >
                  <Calendar className="w-5 h-5" /> Agendar Visita Técnica
                </a>
                <a
                  href="#modalidades"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg font-semibold transition transform hover:-translate-y-0.5"
                  style={{ background: "rgba(255,255,255,0.08)", color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" }}
                >
                  <List className="w-5 h-5" /> Conhecer Modalidades
                </a>
              </div>
            </div>

            {/* Right: Quick Access Card */}
            <div className="bg-white p-8 rounded-2xl shadow-2xl" style={{ boxShadow: "0 25px 50px -12px rgba(30,58,138,0.5)" }}>
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2" style={{ color: "#0F172A" }}>
                <span className="w-1 h-6 rounded" style={{ background: "#16A34A" }} /> Acesso Rápido
              </h3>
              <div className="space-y-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#DCFCE7" }}>
                    <Phone className="w-5 h-5" style={{ color: "#16A34A" }} />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "#666" }}>Telefone</p>
                    <a href="tel:+5521998256991" className="text-base font-semibold" style={{ color: "#0284C7" }}>+55 21 99825-6991</a>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#DBEAFE" }}>
                    <Mail className="w-5 h-5" style={{ color: "#0284C7" }} />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "#666" }}>Email</p>
                    <a href="mailto:contato@dbsair.com.br" className="text-base font-semibold" style={{ color: "#0284C7" }}>contato@dbsair.com.br</a>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#FEF3C7" }}>
                    <MapPin className="w-5 h-5" style={{ color: "#D97706" }} />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "#666" }}>Localização</p>
                    <p className="text-base font-semibold" style={{ color: "#0F172A" }}>Ramos, Rio de Janeiro - RJ</p>
                  </div>
                </div>
                <div className="pt-5 border-t border-gray-200">
                  <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#16A34A" }}>Conformidade Legal</p>
                  <p className="text-sm" style={{ color: "#666" }}>Lei 13.589/2018 • ANVISA • CREA/CFT</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ METRICS ============ */}
      <section className="py-12 md:py-16" style={{ background: "#F8FAFC" }}>
        <div className="container max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-3 gap-4 md:gap-8">
            {[
              { n: "15+", l: "ANOS DE EXPERIÊNCIA" },
              { n: "100%", l: "CONFORMIDADE ANVISA" },
              { n: "24h", l: "SUPORTE EMERGENCIAL" },
            ].map((m, i) => (
              <div key={i} className="text-center">
                <p className="text-4xl md:text-5xl font-bold" style={{ color: "#0284C7" }}>{m.n}</p>
                <p className="text-xs md:text-sm mt-2 font-bold tracking-wider" style={{ color: "#0F172A" }}>{m.l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ VALUE PROPOSITION ============ */}
      <section id="solucoes" className="py-20 md:py-28 bg-white">
        <div className="container max-w-7xl mx-auto px-4">
          <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{ color: "#0F172A" }}>Por que escolher a DBS Air?</h2>
          <p className="text-lg mb-12" style={{ color: "#666" }}>Três pilares que sustentam nossa atuação no mercado corporativo.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: Award, title: "Conformidade Técnica", desc: "Emissão de ART por engenheiro responsável, laudos técnicos e total aderência às normas ABNT NBR 16401 e regulamentações da ANVISA." },
              { icon: Heart, title: "Equipe Qualificada", desc: "Técnicos certificados, uniformizados e com seguro de responsabilidade civil. Treinamento contínuo em segurança e conformidade regulatória." },
              { icon: Beaker, title: "Eficiência Operacional", desc: "Redução de consumo energético, prevenção de paradas inesperadas e otimização do desempenho térmico dos seus equipamentos." },
            ].map((item, idx) => {
              const Icon = item.icon;
              return (
                <div key={idx} className="p-8 rounded-xl transition hover:-translate-y-1 hover:shadow-xl" style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                  <div className="w-14 h-14 rounded-xl mb-6 flex items-center justify-center" style={{ background: "linear-gradient(135deg,#DBEAFE,#BFDBFE)" }}>
                    <Icon className="w-7 h-7" style={{ color: "#0284C7" }} />
                  </div>
                  <h3 className="text-xl font-bold mb-3" style={{ color: "#0F172A" }}>{item.title}</h3>
                  <p className="leading-relaxed" style={{ color: "#666" }}>{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ============ COMPLIANCE ============ */}
      <section id="pmoc" className="py-20 md:py-28" style={{ background: "#F8FAFC" }}>
        <div className="container max-w-7xl mx-auto px-4">
          <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{ color: "#0F172A" }}>Conformidade Regulatória e Responsabilidade Técnica</h2>
          <p className="text-lg mb-12" style={{ color: "#666" }}>Fundação legal robusta para a operação segura e auditável de sistemas de climatização em ambientes corporativos.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
            {[
              { icon: Gavel, title: "Lei Federal nº 13.589/2018", desc: "Tornou obrigatória a manutenção programada e a elaboração do PMOC para todos os edifícios de uso público e coletivo climatizados." },
              { icon: Heart, title: "Portaria MS nº 3.523/1998", desc: "Estabelece os parâmetros físicos de limpeza, desinfecção e periodicidade de manutenção para garantir a qualidade e integridade da saúde dos ocupantes." },
              { icon: Beaker, title: "Resolução RE nº 9/2003 ANVISA", desc: "Estabelece os padrões referenciais de qualidade do ar interior, incluindo limites de fungos, bactérias, CO₂, poeira e taxa mínima de renovação de ar." },
            ].map((item, idx) => {
              const Icon = item.icon;
              return (
                <div key={idx} className="p-8 rounded-xl shadow-sm hover:shadow-md transition" style={{ background: "#FFFFFF", border: "1px solid #E2E8F0" }}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-11 h-11 rounded-lg flex items-center justify-center" style={{ background: "#DBEAFE" }}>
                      <Icon className="w-5 h-5" style={{ color: "#0284C7" }} />
                    </div>
                    <h3 className="font-bold" style={{ color: "#0F172A" }}>{item.title}</h3>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: "#666" }}>{item.desc}</p>
                </div>
              );
            })}
          </div>

          {/* ABNT */}
          <div className="p-8 md:p-12 rounded-xl shadow-sm mb-12" style={{ background: "#FFFFFF", border: "1px solid #E2E8F0" }}>
            <h3 className="text-2xl font-bold mb-8 flex items-center gap-3" style={{ color: "#0F172A" }}>
              <Award className="w-7 h-7" style={{ color: "#16A34A" }} /> Normas Técnicas de Execução (ABNT)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div style={{ borderLeft: "4px solid #16A34A", paddingLeft: "24px" }}>
                <h4 className="font-bold mb-3" style={{ color: "#0F172A" }}>NBR 13971:2017</h4>
                <p className="text-sm leading-relaxed" style={{ color: "#666" }}>
                  <strong>Sistemas de refrigeração, condicionamento de ar e bomba de calor — Manutenção programada.</strong> Define os procedimentos, frequências e responsabilidades técnicas para manutenção preventiva e corretiva de sistemas de climatização.
                </p>
              </div>
              <div style={{ borderLeft: "4px solid #16A34A", paddingLeft: "24px" }}>
                <h4 className="font-bold mb-3" style={{ color: "#0F172A" }}>NBR 14679:2000</h4>
                <p className="text-sm leading-relaxed" style={{ color: "#666" }}>
                  <strong>Execução de serviços de higienização em sistemas de ar condicionado.</strong> Estabelece os padrões de limpeza, desinfecção e documentação de atividades de higienização em dutos, serpentinas e componentes.
                </p>
              </div>
            </div>
          </div>

          {/* Technical Responsibility */}
          <div className="p-8 md:p-12 rounded-xl shadow-sm" style={{ background: "#FFFFFF", border: "1px solid #E2E8F0" }}>
            <h3 className="text-2xl font-bold mb-4" style={{ color: "#0F172A" }}>Responsabilidade Técnica e Documentação</h3>
            <p className="mb-8 leading-relaxed" style={{ color: "#666" }}>
              A DBS Air atua em total conformidade com as exigências dos órgãos de classe (CREA, CFT, ANVISA e Vigilância Sanitária), garantindo a máxima segurança jurídica e operacional para sua empresa.
            </p>
            <div className="space-y-4">
              {[
                { num: 1, title: "ART / TRT Registrada", desc: "Emissão de Anotação de Responsabilidade Técnica (ART) ou Termo de Responsabilidade Técnica (TRT) devidamente registrada no CREA ou CFT, assinada por engenheiro mecânico ou técnico legalmente habilitado." },
                { num: 2, title: "Engenheiro Responsável Designado", desc: "Nomeação formal de profissional qualificado como responsável técnico pela operação, manutenção e conformidade do sistema de climatização da sua empresa." },
                { num: 3, title: "Livro de Registro Técnico", desc: "Documentação completa e auditável de todas as atividades de manutenção, limpeza, trocas de componentes e análises de qualidade do ar, conforme exigido pela legislação." },
                { num: 4, title: "Relatórios Mensais de Rastreabilidade", desc: "Emissão mensal de relatórios técnicos com medições de eficiência energética, análise de qualidade do ar (CO₂, fungos, bactérias), e conformidade com os padrões ANVISA." },
                { num: 5, title: "Cronograma Personalizado", desc: "Plano de manutenção customizado conforme a carga térmica, criticidade de cada ambiente e requisitos operacionais específicos da sua empresa." },
              ].map((item) => (
                <div key={item.num} className="p-6 rounded-lg" style={{ background: "#F8FAFC", borderLeft: "4px solid #16A34A" }}>
                  <div className="flex items-start gap-4">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm text-white" style={{ background: "#16A34A" }}>{item.num}</div>
                    <div>
                      <h4 className="font-bold mb-1.5" style={{ color: "#0F172A" }}>{item.title}</h4>
                      <p className="text-sm leading-relaxed" style={{ color: "#666" }}>{item.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ============ SERVICES ============ */}
      <section id="modalidades" className="py-20 md:py-28 bg-white">
        <div className="container max-w-7xl mx-auto px-4">
          <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{ color: "#0F172A" }}>Modalidades de Atendimento</h2>
          <p className="text-lg mb-12" style={{ color: "#666" }}>Escolha a estrutura que melhor se adequa às necessidades operacionais da sua empresa.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            {[
              {
                category: "Atendimento sob Demanda",
                title: "Atendimento Corretivo",
                desc: "Para situações emergenciais e reparos pontuais. Diagnóstico técnico preciso e solução ágil com peças de qualidade e garantia.",
                benefits: ["Visita técnica rápida", "Diagnóstico completo", "Peças com garantia"],
                cta: "Solicitar Atendimento Avulso",
                msg: "Olá. Gostaria de solicitar um atendimento avulso para manutenção corretiva.",
              },
              {
                category: "Recomendado para Operações Contínuas",
                title: "Contrato de Manutenção Preventiva Programada",
                desc: "Visitas periódicas programadas com higienização profunda, análise de rendimento e prevenção de paradas inesperadas.",
                benefits: ["Limpeza bactericida mensal", "Análise de eficiência energética", "Atendimento prioritário"],
                cta: "Solicitar Proposta Mensal",
                msg: "Olá. Gostaria de solicitar uma proposta para manutenção preventiva mensal.",
                highlight: true,
              },
              {
                category: "Solução Completa",
                title: "Gestão Completa & PMOC",
                desc: "Solução integrada com responsabilidade técnica, documentação legal completa e gestão operacional total do seu sistema.",
                benefits: [
                  "Responsabilidade Técnica com emissão de ART/TRT",
                  "Adequação estrita à Lei 13.589/18 e Portaria 3.523",
                  "Laudos de Qualidade do Ar (Resolução RE 09 da ANVISA)",
                  "Relatórios de Eficiência Energética e Vida Útil",
                ],
                cta: "Falar com Responsável Técnico",
                msg: "Olá. Gostaria de solicitar uma proposta técnica da solução completa de PMOC e gestão de climatização.",
              },
            ].map((service, idx) => (
              <div
                key={idx}
                className="p-8 rounded-xl transition hover:-translate-y-1 hover:shadow-xl relative flex flex-col"
                style={{
                  background: "#FFFFFF",
                  border: service.highlight ? "2px solid #1E3A8A" : "1px solid #E2E8F0",
                  boxShadow: service.highlight ? "0 20px 40px -15px rgba(30,58,138,0.25)" : undefined,
                }}
              >
                {service.highlight && (
                  <div className="absolute -top-3 left-8 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white rounded" style={{ background: "#1E3A8A" }}>
                    Mais Contratado
                  </div>
                )}
                <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#666" }}>{service.category}</p>
                <h3 className="text-2xl font-bold mb-4" style={{ color: "#0F172A" }}>{service.title}</h3>
                <p className="mb-6 leading-relaxed" style={{ color: "#666" }}>{service.desc}</p>

                <p className="text-sm font-semibold mb-3" style={{ color: "#0F172A" }}>Incluso:</p>
                <ul className="space-y-2 mb-8 flex-1">
                  {service.benefits.map((benefit, i) => (
                    <li key={i} className="text-sm flex items-start gap-2" style={{ color: "#666" }}>
                      <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#16A34A" }} />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>

                <a
                  href={wa(service.msg)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 text-white px-4 py-3 rounded-lg font-semibold transition"
                  style={{ background: service.highlight ? "linear-gradient(135deg,#1E3A8A,#0284C7)" : "#0284C7" }}
                >
                  <Phone className="w-4 h-4" /> {service.cta}
                </a>
              </div>
            ))}
          </div>

          <div className="text-center pt-8" style={{ borderTop: "1px solid #E2E8F0" }}>
            <p className="mb-4" style={{ color: "#666" }}>Precisa de uma proposta personalizada para múltiplos equipamentos ou estrutura complexa?</p>
            <a
              href={wa("Olá. Tenho uma estrutura complexa e gostaria de uma proposta personalizada de PMOC.")}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold transition hover:underline"
              style={{ color: "#0284C7" }}
            >
              Solicite uma avaliação técnica. →
            </a>
          </div>
        </div>
      </section>

      {/* ============ FAQ ============ */}
      <section id="faq" className="py-20 md:py-28" style={{ background: "#F8FAFC" }}>
        <div className="container max-w-7xl mx-auto px-4">
          <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{ color: "#0F172A" }}>Perguntas Frequentes</h2>
          <p className="text-lg mb-12" style={{ color: "#666" }}>Informações técnicas e operacionais sobre nossos serviços.</p>

          <div className="p-4 md:p-8 rounded-xl shadow-sm" style={{ background: "#FFFFFF", border: "1px solid #E2E8F0" }}>
            {[
              { q: "O PMOC é obrigatório para o meu tipo de negócio?", a: "Sim. A Lei Federal nº 13.589/2018 torna o PMOC obrigatório para todos os edifícios de uso público e coletivo climatizados, independentemente da carga térmica. Isso inclui escritórios, clínicas, hospitais, comércios, indústrias e qualquer espaço climatizado de acesso coletivo. A falta de conformidade expõe sua empresa a multas da ANVISA e riscos operacionais significativos." },
              { q: "Qual é a periodicidade recomendada para manutenção preventiva?", a: "A NBR 13971:2017 recomenda manutenção preventiva mensal para sistemas em operação contínua. A frequência pode variar conforme a carga térmica, tipo de equipamento e ambiente. A DBS Air realiza uma avaliação técnica inicial para definir o cronograma ideal para sua operação, garantindo conformidade com as normas técnicas e eficiência máxima." },
              { q: "A DBS Air emite ART e documentação legal?", a: "Sim. A DBS Air emite ART (Anotação de Responsabilidade Técnica) ou TRT (Termo de Responsabilidade Técnica) devidamente registrada no CREA ou CFT, assinada por engenheiro mecânico ou técnico legalmente habilitado. Fornecemos também Livro de Registro Técnico, relatórios mensais de rastreabilidade e toda documentação necessária para auditorias da Vigilância Sanitária e ANVISA." },
              { q: "Como é feito o diagnóstico inicial da minha climatização?", a: "O diagnóstico inicial é realizado por engenheiro qualificado e inclui: inspeção visual completa dos equipamentos, medição de eficiência energética, análise de qualidade do ar (CO₂, fungos, bactérias), verificação de conformidade com normas ABNT e ANVISA, e recomendações de manutenção. Ao final, você recebe um relatório técnico detalhado com proposta personalizada." },
              { q: "Vocês oferecem suporte emergencial fora do horário comercial?", a: "Sim. A DBS Air oferece suporte emergencial 24 horas para clientes com contrato de gestão completa ou manutenção preventiva. Contato: +55 21 99825-6991. Para atendimentos emergenciais pontuais, consulte disponibilidade. Nosso objetivo é minimizar paradas operacionais e garantir a continuidade da climatização da sua empresa." },
            ].map((item, idx, arr) => (
              <div key={idx} style={{ borderBottom: idx < arr.length - 1 ? "1px solid #E2E8F0" : "none" }} className="py-5">
                <button
                  onClick={() => toggleFaq(idx)}
                  className="w-full flex items-center justify-between text-left transition gap-4"
                  style={{ color: expandedFaq === idx ? "#0284C7" : "#0F172A" }}
                >
                  <h3 className="text-base md:text-lg font-bold">{item.q}</h3>
                  <ChevronDown className={`w-5 h-5 transition-transform flex-shrink-0 ${expandedFaq === idx ? "rotate-180" : ""}`} style={{ color: "#999" }} />
                </button>
                {expandedFaq === idx && (
                  <p className="mt-4 leading-relaxed" style={{ color: "#666" }}>{item.a}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="py-20 md:py-28 bg-white text-center" style={{ borderTop: "1px solid #E2E8F0" }}>
        <div className="container max-w-7xl mx-auto px-4">
          <h2 className="text-3xl md:text-4xl font-bold mb-6" style={{ color: "#0F172A" }}>Pronto para otimizar sua climatização?</h2>
          <p className="text-lg mb-8 max-w-2xl mx-auto" style={{ color: "#666" }}>
            Agende uma avaliação técnica gratuita com nossos engenheiros. Sem compromisso.
          </p>
          <a
            href={wa("Olá. Gostaria de agendar uma avaliação técnica gratuita de PMOC para nossa empresa.")}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 text-white px-8 py-4 rounded-lg font-semibold transition text-lg transform hover:-translate-y-0.5 shadow-lg"
            style={{ background: "linear-gradient(135deg,#1E3A8A,#0284C7)" }}
          >
            <CalendarCheck className="w-5 h-5" /> Agendar Avaliação Técnica
          </a>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer style={{ background: "#0F172A" }} className="text-white py-14">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
            <div>
              <div className="bg-white rounded-xl p-4 inline-block mb-4">
                <img src={logoAsset.url} alt="DBS Air Refrigeração" className="h-14 w-auto object-contain" />
              </div>
              <p className="text-sm" style={{ color: "#94A3B8" }}>Soluções em Refrigeração e Climatização Corporativa.</p>
            </div>

            <div>
              <p className="font-bold text-sm mb-4 uppercase tracking-widest" style={{ color: "#93C5FD" }}>Contato</p>
              <ul className="space-y-2 text-sm" style={{ color: "#CBD5E1" }}>
                <li><a href="tel:+5521998256991" className="hover:text-white transition">+55 21 99825-6991</a></li>
                <li><a href="mailto:contato@dbsair.com.br" className="hover:text-white transition">contato@dbsair.com.br</a></li>
                <li><a href="mailto:assistencia@dbsair.com.br" className="hover:text-white transition">assistencia@dbsair.com.br</a></li>
              </ul>
            </div>

            <div>
              <p className="font-bold text-sm mb-4 uppercase tracking-widest" style={{ color: "#93C5FD" }}>Endereço</p>
              <p className="text-sm" style={{ color: "#CBD5E1" }}>
                Rua Nabôr do Rêgo, 481<br />
                Ramos, Rio de Janeiro - RJ<br />
                CEP: 21031-720
              </p>
            </div>

            <div>
              <p className="font-bold text-sm mb-4 uppercase tracking-widest" style={{ color: "#93C5FD" }}>Dados Institucionais</p>
              <p className="text-xs leading-relaxed" style={{ color: "#CBD5E1" }}>
                <strong className="text-white">Razão Social:</strong> DBS AIR REFRIGERAÇÃO LTDA<br />
                <strong className="text-white">CNPJ:</strong> 13.352.707/0001-09<br />
                <strong className="text-white">Instagram:</strong>{" "}
                <a href="https://www.instagram.com/dbs.air/" target="_blank" rel="noopener noreferrer" className="hover:text-white transition inline-flex items-center gap-1">
                  <Instagram className="w-3 h-3" /> @dbs.air
                </a>
              </p>
            </div>
          </div>

          <div className="pt-8 text-center text-sm" style={{ borderTop: "1px solid #1E3A8A", color: "#94A3B8" }}>
            <p>&copy; 2024 DBS Air Refrigeração LTDA · CNPJ 13.352.707/0001-09 · Todos os direitos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

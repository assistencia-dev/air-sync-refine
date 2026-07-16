import { createFileRoute } from "@tanstack/react-router";

const WHATSAPP = "https://wa.me/5521998256991?text=Ol%C3%A1.%20Gostaria%20de%20solicitar%20um%20contato%20t%C3%A9cnico%20comercial%20para%20avaliar%20a%20climatiza%C3%A7%C3%A3o%2FPMOC%20da%20minha%20empresa.";
const INSTAGRAM = "https://www.instagram.com/dbs.air/";
const EMAIL = "contato@dbsair.com.br";

export const Route = createFileRoute("/")({
  component: Index,
});

function BrandLogo({ variant = "light" }: { variant?: "light" | "dark" }) {
  return (
    <div className="brand">
      <span className="brand-mark">DBS</span>
      <span className={variant === "light" ? "brand-text-dark" : "brand-text-light"}>AIR</span>
    </div>
  );
}

function Index() {
  const laws = [
    "Lei Federal 13.589/2018 — PMOC obrigatório",
    "Portaria MS 3.523/1998 — Qualidade do ar",
    "RE ANVISA 9/2003 — Padrões de qualidade",
    "NBR 13971 — Manutenção de sistemas",
    "NBR 16401 — Instalações centrais",
    "NR-10 — Segurança elétrica",
    "NR-35 — Trabalho em altura",
  ];
  const stripItems = [...laws, ...laws];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/85 backdrop-blur-md border-b">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <BrandLogo variant="light" />
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-navy">
            <a href="#servicos" className="hover:text-green transition">Serviços</a>
            <a href="#pmoc" className="hover:text-green transition">PMOC</a>
            <a href="#processo" className="hover:text-green transition">Processo</a>
            <a href="#contato" className="hover:text-green transition">Contato</a>
          </nav>
          <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className="btn-primary text-sm !py-2.5 !px-4">
            Falar no WhatsApp
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="hero-bg text-white">
        <div className="max-w-7xl mx-auto px-6 pt-20 pb-24 md:pt-28 md:pb-32">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/8 border border-white/15 text-xs font-mono text-white/80 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-green-glow animate-pulse" />
              Atendimento corporativo — Rio de Janeiro e Grande Rio
            </div>
            <h1 className="text-4xl md:text-6xl font-bold leading-[1.05] mb-6">
              Climatização corporativa <span style={{color:"#26B37F"}}>sem paradas</span>, com PMOC em conformidade.
            </h1>
            <p className="text-lg md:text-xl text-white/75 mb-10 leading-relaxed max-w-2xl">
              Contratos de manutenção preventiva e corretiva para empresas — Splits, VRF, Chillers e Self-Contained. Equipe técnica própria, SLA definido e laudos regulatórios.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className="btn-primary">
                Solicitar avaliação técnica
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
              </a>
              <a href="#servicos" className="btn-outline">Ver serviços</a>
            </div>

            <div className="grid grid-cols-3 gap-8 mt-16 pt-10 border-t border-white/10 max-w-xl">
              <div>
                <div className="stat-num" style={{color:"#26B37F"}}>10+</div>
                <div className="text-sm text-white/60 mt-1">Anos de mercado</div>
              </div>
              <div>
                <div className="stat-num" style={{color:"#26B37F"}}>24h</div>
                <div className="text-sm text-white/60 mt-1">Resposta emergencial</div>
              </div>
              <div>
                <div className="stat-num" style={{color:"#26B37F"}}>100%</div>
                <div className="text-sm text-white/60 mt-1">Contratos com PMOC</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Compliance strip */}
      <div className="strip">
        <div className="strip-track">
          {stripItems.map((law, i) => (
            <span key={i}>◆ {law}</span>
          ))}
        </div>
      </div>

      {/* Services */}
      <section id="servicos" className="py-24 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl mb-14">
            <div className="text-xs font-mono uppercase tracking-widest text-green mb-3">Serviços</div>
            <h2 className="text-3xl md:text-5xl font-bold text-navy mb-4">Soluções completas em refrigeração para empresas</h2>
            <p className="text-lg text-muted-foreground">Cobrimos todo o ciclo de vida dos seus sistemas de climatização — do projeto ao pós-obra.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { t: "Manutenção Preventiva", d: "Cronogramas mensais, trimestrais e semestrais com checklist técnico, higienização de serpentinas, filtros e drenos.", i: "🛡️" },
              { t: "Manutenção Corretiva", d: "Diagnóstico rápido, reparo de compressores, recarga de gás, troca de placas e componentes elétricos.", i: "🔧" },
              { t: "PMOC", d: "Plano de Manutenção, Operação e Controle conforme Lei 13.589/2018. Laudos e ART para auditoria e Vigilância Sanitária.", i: "📋" },
              { t: "Instalação & Projeto", d: "Dimensionamento de carga térmica, projeto executivo e instalação de Splits, VRF, Cassetes e Chillers.", i: "❄️" },
              { t: "VRF & Chillers", d: "Especialistas em sistemas centralizados de grande porte — data centers, hospitais, hotéis e escritórios.", i: "🏢" },
              { t: "Emergência 24h", d: "Atendimento em regime de urgência para quebras críticas — servidores, salas de cirurgia, áreas produtivas.", i: "⚡" },
            ].map((s, i) => (
              <div key={i} className="card-service">
                <div className="text-3xl mb-4">{s.i}</div>
                <h3 className="text-xl font-semibold text-navy mb-2">{s.t}</h3>
                <p className="text-muted-foreground leading-relaxed">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PMOC callout */}
      <section id="pmoc" className="py-24 bg-muted">
        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-green mb-3">Conformidade</div>
            <h2 className="text-3xl md:text-5xl font-bold text-navy mb-6">PMOC obrigatório. E nós entregamos pronto para fiscalização.</h2>
            <p className="text-lg text-muted-foreground mb-6 leading-relaxed">
              A Lei Federal 13.589/2018 exige que todo edifício de uso público e coletivo com climatização mantenha um Plano de Manutenção, Operação e Controle. Multas podem chegar a valores expressivos por unidade.
            </p>
            <ul className="space-y-3 mb-8">
              {[
                "Responsável técnico registrado no CREA",
                "ART emitida para cada contrato",
                "Registro histórico digitalizado das intervenções",
                "Laudos de qualidade do ar interior (QAI)",
              ].map((li, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-green/15 flex items-center justify-center mt-0.5 flex-shrink-0">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1E8F66" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                  </div>
                  <span className="text-navy">{li}</span>
                </li>
              ))}
            </ul>
            <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className="btn-primary">Montar meu PMOC</a>
          </div>
          <div className="bg-navy rounded-2xl p-10 text-white">
            <div className="font-mono text-xs text-white/50 mb-4">// resumo do contrato</div>
            <div className="space-y-4 font-mono text-sm">
              <div className="flex justify-between border-b border-white/10 pb-3"><span className="text-white/60">Escopo</span><span>PMOC + Preventiva</span></div>
              <div className="flex justify-between border-b border-white/10 pb-3"><span className="text-white/60">SLA</span><span>4h úteis</span></div>
              <div className="flex justify-between border-b border-white/10 pb-3"><span className="text-white/60">Visitas</span><span>Mensais</span></div>
              <div className="flex justify-between border-b border-white/10 pb-3"><span className="text-white/60">ART</span><span>Incluída</span></div>
              <div className="flex justify-between border-b border-white/10 pb-3"><span className="text-white/60">Relatórios</span><span>Digitais</span></div>
              <div className="flex justify-between"><span className="text-white/60">Emergência</span><span style={{color:"#26B37F"}}>24/7</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* Process */}
      <section id="processo" className="py-24 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl mb-14">
            <div className="text-xs font-mono uppercase tracking-widest text-green mb-3">Processo</div>
            <h2 className="text-3xl md:text-5xl font-bold text-navy mb-4">Do primeiro contato ao contrato ativo em 7 dias</h2>
          </div>
          <div className="grid md:grid-cols-4 gap-6">
            {[
              { n: "01", t: "Diagnóstico", d: "Visita técnica gratuita para mapear equipamentos e criticidade." },
              { n: "02", t: "Proposta", d: "Escopo, SLA e cronograma sob medida para sua operação." },
              { n: "03", t: "Onboarding", d: "Emissão de ART, plano PMOC e agenda de visitas." },
              { n: "04", t: "Operação", d: "Execução com relatórios digitais e suporte 24h." },
            ].map((s) => (
              <div key={s.n} className="border-l-2 border-green pl-5">
                <div className="font-mono text-sm text-green mb-2">{s.n}</div>
                <div className="font-semibold text-navy text-lg mb-2">{s.t}</div>
                <div className="text-muted-foreground text-sm leading-relaxed">{s.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="contato" className="hero-bg text-white py-24">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-6">Pronto para uma climatização que não te deixa na mão?</h2>
          <p className="text-lg text-white/70 mb-10 max-w-2xl mx-auto">
            Fale agora com um consultor técnico-comercial. Retornamos em até 2 horas úteis com uma avaliação inicial.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mb-10">
            <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className="btn-primary">
              WhatsApp: (21) 99825-6991
            </a>
            <a href={`mailto:${EMAIL}`} className="btn-outline">contato@dbsair.com.br</a>
          </div>
          <div className="font-mono text-sm text-white/50">
            Rua Nabôr do Rêgo, 481 — Ramos, Rio de Janeiro/RJ
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-navy-900 text-white/70 py-14">
        <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-4 gap-10">
          <div>
            <BrandLogo variant="dark" />
            <p className="text-sm mt-4 leading-relaxed">Refrigeração e climatização corporativa no Rio de Janeiro. PMOC, preventiva e corretiva.</p>
          </div>
          <div>
            <div className="text-white font-semibold mb-3 text-sm">Serviços</div>
            <ul className="space-y-2 text-sm">
              <li><a href="#servicos" className="hover:text-white">Manutenção Preventiva</a></li>
              <li><a href="#servicos" className="hover:text-white">Manutenção Corretiva</a></li>
              <li><a href="#pmoc" className="hover:text-white">PMOC</a></li>
              <li><a href="#servicos" className="hover:text-white">Instalação</a></li>
            </ul>
          </div>
          <div>
            <div className="text-white font-semibold mb-3 text-sm">Contato</div>
            <ul className="space-y-2 text-sm">
              <li><a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className="hover:text-white">WhatsApp: (21) 99825-6991</a></li>
              <li><a href="mailto:contato@dbsair.com.br" className="hover:text-white">contato@dbsair.com.br</a></li>
              <li><a href="mailto:assistencia@dbsair.com.br" className="hover:text-white">assistencia@dbsair.com.br</a></li>
              <li><a href={INSTAGRAM} target="_blank" rel="noopener noreferrer" className="hover:text-white">@dbs.air</a></li>
            </ul>
          </div>
          <div>
            <div className="text-white font-semibold mb-3 text-sm">Endereço</div>
            <p className="text-sm leading-relaxed">Rua Nabôr do Rêgo, 481<br/>Ramos — Rio de Janeiro/RJ<br/>CEP 21031-720</p>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-12 pt-6 border-t border-white/10 text-xs text-white/40 font-mono">
          © {new Date().getFullYear()} DBS Air Refrigeração. Todos os direitos reservados.
        </div>
      </footer>
    </div>
  );
}

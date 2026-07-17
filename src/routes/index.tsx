import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown, Zap, Users, TrendingUp, CheckCircle2, Gavel, Heart, Beaker, Award, Wind, Phone, Mail, MapPin, Instagram, Facebook } from "lucide-react";
import logoAsset from "@/assets/logo-dbs-air.jpg.asset.json";

export const Route = createFileRoute("/")({
  component: Index,
});

const whatsappBase = "https://wa.me/5521998256991?text=";
const messages = {
  header: "Olá, gostaria de solicitar uma proposta técnica de PMOC e manutenção para nossa empresa.",
  hero: "Olá, gostaria de solicitar uma proposta técnica de PMOC e manutenção para nossa empresa.",
  corretivo: "Olá, gostaria de solicitar um atendimento avulso para manutenção corretiva.",
  preventiva: "Olá, gostaria de solicitar uma proposta para manutenção preventiva mensal.",
  premium: "Olá, gostaria de solicitar uma proposta técnica da solução completa de PMOC e gestão de climatização.",
  complexa: "Olá, tenho uma estrutura complexa e gostaria de uma proposta personalizada de PMOC.",
  final: "Olá, gostaria de agendar uma avaliação técnica gratuita de PMOC para nossa empresa.",
};

const wa = (msg: string) => whatsappBase + encodeURIComponent(msg);

function Index() {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const toggleFaq = (i: number) => setExpandedFaq(expandedFaq === i ? null : i);

  const laws = [
    "Lei Federal 13.589/2018 — PMOC obrigatório",
    "Portaria MS 3.523/1998 — Qualidade do ar",
    "RE ANVISA 9/2003 — Padrões do ar interior",
    "NBR 13971:2017 — Manutenção programada",
    "NBR 14679:2000 — Higienização de sistemas",
    "NBR 16401 — Instalações centrais de ar",
  ];
  const stripItems = [...laws, ...laws];

  const services = [
    {
      category: "Atendimento sob Demanda",
      title: "Atendimento Corretivo",
      desc: "Para situações emergenciais e reparos pontuais. Diagnóstico técnico preciso e solução ágil com peças de qualidade e garantia.",
      benefits: ["Visita técnica rápida", "Diagnóstico completo", "Peças com garantia"],
      cta: "Solicitar Atendimento Avulso",
      msg: messages.corretivo,
      featured: false,
    },
    {
      category: "Recomendado para Operações Contínuas",
      title: "Manutenção Preventiva",
      desc: "Visitas periódicas programadas com higienização profunda, análise de rendimento e prevenção de paradas inesperadas.",
      benefits: ["Limpeza bactericida mensal", "Análise de eficiência energética", "Atendimento prioritário"],
      cta: "Solicitar Proposta Mensal",
      msg: messages.preventiva,
      featured: true,
    },
    {
      category: "Solução Completa",
      title: "Gestão Completa & PMOC",
      desc: "Solução integrada com responsabilidade técnica, documentação legal completa e gestão operacional total do seu sistema.",
      benefits: [
        "Responsabilidade Técnica com emissão de ART/TRT",
        "Adequação à Lei 13.589/18 e Portaria 3.523",
        "Laudos de Qualidade do Ar (RE 09 ANVISA)",
        "Relatórios de Eficiência e Vida Útil",
      ],
      cta: "Falar com Responsável Técnico",
      msg: messages.premium,
      featured: false,
    },
  ];

  const legislation = [
    {
      icon: Gavel,
      title: "Lei Federal nº 13.589/2018",
      desc: "Tornou obrigatória a manutenção programada e a elaboração do PMOC para todos os edifícios de uso público e coletivo climatizados.",
      applies: "Aplicável a: Escritórios, clínicas, hospitais, comércios, indústrias e espaços climatizados de acesso coletivo.",
    },
    {
      icon: Heart,
      title: "Portaria MS nº 3.523/1998",
      desc: "Estabelece parâmetros físicos de limpeza, desinfecção e periodicidade de manutenção para garantir a qualidade do ar e a saúde dos ocupantes.",
      applies: "Define: Frequência de limpeza, padrões bacteriológicos e protocolos de higienização.",
    },
    {
      icon: Beaker,
      title: "Resolução RE nº 9/2003 ANVISA",
      desc: "Estabelece padrões referenciais de qualidade do ar interior, incluindo limites de fungos, bactérias, CO₂ e taxa mínima de renovação de ar.",
      applies: "Especifica: Limites de contaminantes e frequência de monitoramento obrigatória.",
    },
  ];

  const responsibilityItems = [
    { num: 1, title: "ART / TRT Registrada", desc: "Emissão de Anotação de Responsabilidade Técnica (ART) ou Termo de Responsabilidade Técnica (TRT) devidamente registrada no CREA ou CFT, assinada por engenheiro mecânico ou técnico legalmente habilitado." },
    { num: 2, title: "Engenheiro Responsável Designado", desc: "Nomeação formal de profissional qualificado como responsável técnico pela operação, manutenção e conformidade do sistema de climatização da sua empresa." },
    { num: 3, title: "Livro de Registro Técnico", desc: "Documentação completa e auditável de todas as atividades de manutenção, limpeza, trocas de componentes e análises de qualidade do ar, conforme exigido pela legislação." },
    { num: 4, title: "Relatórios Mensais de Rastreabilidade", desc: "Emissão mensal de relatórios técnicos com medições de eficiência energética, análise de qualidade do ar (CO₂, fungos, bactérias) e conformidade com padrões ANVISA." },
    { num: 5, title: "Cronograma Personalizado", desc: "Plano de manutenção customizado conforme carga térmica, criticidade de cada ambiente e requisitos operacionais específicos da sua empresa." },
  ];

  const faqs = [
    { q: "O PMOC é obrigatório para o meu tipo de negócio?", a: "Sim. A Lei Federal nº 13.589/2018 torna o PMOC obrigatório para todos os edifícios de uso público e coletivo climatizados, independentemente da carga térmica. Isso inclui escritórios, clínicas, hospitais, comércios, indústrias e qualquer espaço climatizado de acesso coletivo. A falta de conformidade expõe sua empresa a multas da ANVISA e riscos operacionais significativos." },
    { q: "Qual é a periodicidade recomendada para manutenção preventiva?", a: "A NBR 13971:2017 recomenda manutenção preventiva mensal para sistemas em operação contínua. A frequência pode variar conforme a carga térmica, tipo de equipamento e ambiente. A DBS Air realiza uma avaliação técnica inicial para definir o cronograma ideal para sua operação, garantindo conformidade com as normas técnicas e eficiência máxima." },
    { q: "A DBS Air emite ART e documentação legal?", a: "Sim. A DBS Air emite ART (Anotação de Responsabilidade Técnica) ou TRT (Termo de Responsabilidade Técnica) devidamente registrada no CREA ou CFT, assinada por engenheiro mecânico ou técnico legalmente habilitado. Fornecemos também Livro de Registro Técnico, relatórios mensais de rastreabilidade e toda documentação necessária para auditorias da Vigilância Sanitária e ANVISA." },
    { q: "Como é feito o diagnóstico inicial da minha climatização?", a: "O diagnóstico inicial é realizado por engenheiro qualificado e inclui: inspeção visual completa dos equipamentos, medição de eficiência energética, análise de qualidade do ar (CO₂, fungos, bactérias), verificação de conformidade com normas ABNT e ANVISA, e recomendações de manutenção. Ao final, você recebe um relatório técnico detalhado com proposta personalizada." },
    { q: "Vocês oferecem suporte emergencial fora do horário comercial?", a: "Sim. A DBS Air oferece suporte emergencial 24 horas para clientes com contrato de gestão completa ou manutenção preventiva. Contato: +55 21 99825-6991. Para atendimentos emergenciais pontuais, consulte disponibilidade. Nosso objetivo é minimizar paradas operacionais e garantir a continuidade da climatização da sua empresa." },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logoAsset.url} alt="DBS Air Refrigeração" className="h-12 md:h-14 w-auto" />
          </div>
          <nav className="hidden lg:flex items-center gap-7 text-sm font-medium text-navy">
            <a href="#solucoes" className="hover:text-green transition">Soluções</a>
            <a href="#pmoc" className="hover:text-green transition">PMOC</a>
            <a href="#modalidades" className="hover:text-green transition">Modalidades</a>
            <a href="#faq" className="hover:text-green transition">FAQ</a>
          </nav>
          <a href={wa(messages.header)} target="_blank" rel="noopener noreferrer" className="btn-primary text-sm !py-2.5 !px-4">
            Solicitar Orçamento
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="hero-bg text-white">
        <div className="max-w-7xl mx-auto px-6 py-20 md:py-28 grid lg:grid-cols-[1.3fr_1fr] gap-14 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/8 border border-white/15 text-xs font-mono text-white/80 mb-6">
              <Wind size={14} style={{ color: "#26B37F" }} />
              Especialistas em PMOC — Rio de Janeiro e Região Metropolitana
            </div>
            <h1 className="text-4xl md:text-6xl font-bold leading-[1.05] mb-6">
              Gestão Técnica de Climatização e <span style={{ color: "#26B37F" }}>PMOC</span> para Empresas
            </h1>
            <p className="text-lg md:text-xl text-white/75 mb-10 leading-relaxed max-w-2xl">
              Garanta a conformidade legal da sua operação e o desempenho térmico dos seus equipamentos com engenharia de manutenção qualificada.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href={wa(messages.hero)} target="_blank" rel="noopener noreferrer" className="btn-primary">
                Agendar Visita Técnica
              </a>
              <a href="#modalidades" className="btn-outline">Conhecer Modalidades</a>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {[
              { n: "13+", l: "Anos de atuação" },
              { n: "100%", l: "Conformidade ANVISA" },
              { n: "24h", l: "Suporte emergencial" },
            ].map((m) => (
              <div key={m.l} className="bg-white/[0.04] border border-white/10 rounded-xl p-6 backdrop-blur">
                <div className="stat-num" style={{ color: "#26B37F" }}>{m.n}</div>
                <div className="text-xs font-mono uppercase tracking-widest text-white/60 mt-2">{m.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compliance strip */}
      <div className="strip">
        <div className="strip-track">
          {stripItems.map((law, i) => <span key={i}>◆ {law}</span>)}
        </div>
      </div>

      {/* Value Proposition */}
      <section id="solucoes" className="py-24 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl mb-14">
            <div className="text-xs font-mono uppercase tracking-widest text-green mb-3">Diferenciais</div>
            <h2 className="text-3xl md:text-5xl font-bold text-navy mb-4">Por que escolher a DBS Air?</h2>
            <p className="text-lg text-muted-foreground">Três pilares que sustentam nossa atuação no mercado corporativo.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              { Icon: Award, t: "Conformidade Técnica", d: "Emissão de ART por engenheiro responsável, laudos técnicos e total aderência às normas ABNT NBR 16401 e regulamentações da ANVISA." },
              { Icon: Users, t: "Equipe Qualificada", d: "Técnicos certificados, uniformizados e com seguro de responsabilidade civil. Treinamento contínuo em segurança e conformidade regulatória." },
              { Icon: TrendingUp, t: "Eficiência Operacional", d: "Redução de consumo energético, prevenção de paradas inesperadas e otimização do desempenho térmico dos seus equipamentos." },
            ].map(({ Icon, t, d }) => (
              <div key={t} className="card-service">
                <div className="w-12 h-12 rounded-lg bg-green/10 flex items-center justify-center mb-5">
                  <Icon size={22} color="#1E8F66" />
                </div>
                <h3 className="text-xl font-semibold text-navy mb-2">{t}</h3>
                <p className="text-muted-foreground leading-relaxed">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compliance / PMOC */}
      <section id="pmoc" className="py-24 bg-muted">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-3xl mb-14">
            <div className="text-xs font-mono uppercase tracking-widest text-green mb-3">Conformidade</div>
            <h2 className="text-3xl md:text-5xl font-bold text-navy mb-4">Conformidade Regulatória e Responsabilidade Técnica</h2>
            <p className="text-lg text-muted-foreground">Fundação legal robusta para a operação segura e auditável de sistemas de climatização em ambientes corporativos.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mb-16">
            {legislation.map(({ icon: Icon, title, desc, applies }) => (
              <div key={title} className="card-service">
                <div className="w-11 h-11 rounded-lg bg-navy/[0.06] flex items-center justify-center mb-4">
                  <Icon size={20} color="#0E1A2E" />
                </div>
                <h3 className="text-lg font-semibold text-navy mb-3">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-3">{desc}</p>
                <p className="text-xs text-navy/80 border-t pt-3 leading-relaxed">{applies}</p>
              </div>
            ))}
          </div>

          {/* ABNT */}
          <div className="bg-white border rounded-2xl p-8 md:p-10 mb-10">
            <div className="flex items-center gap-3 mb-6">
              <CheckCircle2 size={22} color="#1E8F66" />
              <h3 className="text-xl font-semibold text-navy">Normas Técnicas de Execução (ABNT)</h3>
            </div>
            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <div className="font-mono text-sm text-green mb-2">NBR 13971:2017</div>
                <p className="text-muted-foreground leading-relaxed">Sistemas de refrigeração, condicionamento de ar e bomba de calor — Manutenção programada. Define procedimentos, frequências e responsabilidades técnicas para manutenção preventiva e corretiva.</p>
              </div>
              <div>
                <div className="font-mono text-sm text-green mb-2">NBR 14679:2000</div>
                <p className="text-muted-foreground leading-relaxed">Execução de serviços de higienização em sistemas de ar condicionado. Estabelece padrões de limpeza, desinfecção e documentação em dutos, serpentinas e componentes.</p>
              </div>
            </div>
          </div>

          {/* Responsibility */}
          <div className="grid lg:grid-cols-[1.5fr_1fr] gap-8">
            <div className="bg-white border rounded-2xl p-8 md:p-10">
              <h3 className="text-2xl font-semibold text-navy mb-3">Responsabilidade Técnica e Documentação</h3>
              <p className="text-muted-foreground mb-8 leading-relaxed">A DBS Air atua em total conformidade com as exigências dos órgãos de classe (CREA, CFT, ANVISA e Vigilância Sanitária), garantindo máxima segurança jurídica e operacional.</p>

              <div className="space-y-5">
                {responsibilityItems.map((item) => (
                  <div key={item.num} className="flex gap-4">
                    <div className="w-9 h-9 rounded-lg bg-green flex items-center justify-center flex-shrink-0 font-mono text-white font-bold text-sm">{item.num}</div>
                    <div>
                      <div className="font-semibold text-navy mb-1">{item.title}</div>
                      <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-5">
              <div className="bg-navy text-white rounded-2xl p-8">
                <CheckCircle2 size={28} style={{ color: "#26B37F" }} />
                <div className="mt-4 text-sm font-mono uppercase tracking-widest" style={{ color: "#26B37F" }}>Conformidade Garantida</div>
                <div className="text-xl font-semibold mt-2 mb-3">Auditoria Pronta</div>
                <p className="text-sm text-white/70 leading-relaxed">Toda documentação técnica organizada e pronta para auditorias da Vigilância Sanitária, ANVISA ou órgãos reguladores.</p>
              </div>
              <div className="bg-white border rounded-2xl p-8">
                <Zap size={24} color="#1E8F66" />
                <div className="text-lg font-semibold text-navy mt-3 mb-2">Seguro Profissional</div>
                <p className="text-sm text-muted-foreground leading-relaxed">Equipe com Seguro de Responsabilidade Civil e registro ativo em órgãos reguladores (CREA/CFT).</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Services / Modalidades */}
      <section id="modalidades" className="py-24 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl mb-14">
            <div className="text-xs font-mono uppercase tracking-widest text-green mb-3">Modalidades</div>
            <h2 className="text-3xl md:text-5xl font-bold text-navy mb-4">Modalidades de Atendimento</h2>
            <p className="text-lg text-muted-foreground">Escolha a estrutura que melhor se adequa às necessidades operacionais da sua empresa.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {services.map((s) => (
              <div key={s.title} className={`card-service flex flex-col ${s.featured ? "!border-green ring-1 ring-green/30 relative" : ""}`}>
                {s.featured && (
                  <div className="absolute -top-3 left-6 bg-green text-white text-[10px] font-mono uppercase tracking-widest px-3 py-1 rounded-full">Recomendado</div>
                )}
                <div className="text-xs font-mono uppercase tracking-widest text-green mb-3">{s.category}</div>
                <h3 className="text-2xl font-semibold text-navy mb-3">{s.title}</h3>
                <p className="text-muted-foreground leading-relaxed mb-6">{s.desc}</p>

                <div className="text-xs font-semibold text-navy uppercase tracking-wider mb-3">Incluso:</div>
                <ul className="space-y-2 mb-8">
                  {s.benefits.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-navy">
                      <CheckCircle2 size={16} color="#1E8F66" className="flex-shrink-0 mt-0.5" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>

                <a href={wa(s.msg)} target="_blank" rel="noopener noreferrer" className={`mt-auto text-center ${s.featured ? "btn-primary" : "btn-outline !text-navy !border-navy/20 hover:!bg-navy/5"}`}>
                  {s.cta}
                </a>
              </div>
            ))}
          </div>

          <div className="mt-12 bg-navy/[0.04] border border-navy/10 rounded-xl p-6 text-center">
            <p className="text-navy font-medium">Precisa de uma proposta personalizada para múltiplos equipamentos ou estrutura complexa?</p>
            <a href={wa(messages.complexa)} target="_blank" rel="noopener noreferrer" className="text-green font-semibold hover:underline mt-1 inline-block">
              Solicite uma avaliação técnica →
            </a>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 bg-muted">
        <div className="max-w-4xl mx-auto px-6">
          <div className="mb-12 text-center">
            <div className="text-xs font-mono uppercase tracking-widest text-green mb-3">FAQ</div>
            <h2 className="text-3xl md:text-5xl font-bold text-navy mb-4">Perguntas Frequentes</h2>
            <p className="text-lg text-muted-foreground">Informações técnicas e operacionais sobre nossos serviços.</p>
          </div>

          <div className="space-y-3">
            {faqs.map((item, idx) => (
              <div key={idx} className="bg-white border rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleFaq(idx)}
                  className="w-full flex items-center justify-between text-left px-6 py-5 hover:bg-muted/50 transition"
                >
                  <span className="font-semibold text-navy pr-4">{item.q}</span>
                  <ChevronDown size={20} className={`flex-shrink-0 text-green transition-transform ${expandedFaq === idx ? "rotate-180" : ""}`} />
                </button>
                {expandedFaq === idx && (
                  <div className="px-6 pb-5 text-muted-foreground leading-relaxed border-t pt-4">{item.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="hero-bg text-white py-24">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-5">Pronto para otimizar sua climatização?</h2>
          <p className="text-lg text-white/70 mb-10">Agende uma avaliação técnica gratuita com nossos engenheiros. Sem compromisso.</p>
          <a href={wa(messages.final)} target="_blank" rel="noopener noreferrer" className="btn-primary">
            Agendar Avaliação Técnica
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-navy-900 text-white/70 py-14">
        <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-4 gap-10">
          <div>
            <div className="inline-block bg-white rounded-xl p-3"><img src={logoAsset.url} alt="DBS Air Refrigeração" className="h-14 w-auto" /></div>
            <p className="text-sm mt-4 leading-relaxed">Soluções em Refrigeração e Climatização para o mercado corporativo.</p>
          </div>
          <div>
            <div className="text-white font-semibold mb-4 text-sm">Contato</div>
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-start gap-2"><Phone size={14} className="mt-1 flex-shrink-0" /><a href={wa(messages.header)} target="_blank" rel="noopener noreferrer" className="hover:text-white">+55 21 99825-6991</a></li>
              <li className="flex items-start gap-2"><Mail size={14} className="mt-1 flex-shrink-0" /><a href="mailto:contato@dbsair.com.br" className="hover:text-white">contato@dbsair.com.br</a></li>
              <li className="flex items-start gap-2"><Mail size={14} className="mt-1 flex-shrink-0" /><a href="mailto:assistencia@dbsair.com.br" className="hover:text-white">assistencia@dbsair.com.br</a></li>
            </ul>
          </div>
          <div>
            <div className="text-white font-semibold mb-4 text-sm">Redes Sociais</div>
            <ul className="space-y-2.5 text-sm">
              <li><a href="https://www.instagram.com/dbs.air/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-white"><Instagram size={14} /> Instagram</a></li>
              <li><a href="#" className="flex items-center gap-2 hover:text-white"><Facebook size={14} /> Facebook</a></li>
            </ul>
          </div>
          <div>
            <div className="text-white font-semibold mb-4 text-sm">Localização</div>
            <div className="flex items-start gap-2 text-sm leading-relaxed">
              <MapPin size={14} className="mt-1 flex-shrink-0" />
              <p>Rua Nabôr do Rêgo, 481<br />Ramos, Rio de Janeiro — RJ<br />21031-720, Brasil</p>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-12 pt-6 border-t border-white/10 text-xs text-white/40 font-mono">
          © {new Date().getFullYear()} DBS Air — Soluções em Refrigeração. Todos os direitos reservados.
        </div>
      </footer>
    </div>
  );
}

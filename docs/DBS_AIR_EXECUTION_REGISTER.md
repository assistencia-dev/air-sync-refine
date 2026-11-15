# DBS Air — Registro Mestre de Execução

Atualizado em 2026-11-15. Este arquivo preserva a continuidade entre sessões; atualizar ao concluir cada etapa.

## Ambiente canônico e limites

- Repositório: `assistencia-dev/air-sync-refine`.
- Branch de trabalho: `main`.
- Publicação exclusiva: Lovable.
- Domínio oficial que não pode ser alterado: `https://air-sync-refine.lovable.app/`.
- Projeto Lovable: `ad3dfd84-66c1-403e-9732-79cc4f2d70df`.
- Supabase oficial: `gdglototcrehvhkvcqsq` / `https://gdglototcrehvhkvcqsq.supabase.co`.
- Projeto antigo `vtwzsuwxjrryagpjfmty` não pode ser usado.
- Não criar módulos, não remover funcionalidades, não publicar sem validação, não alterar dados reais em testes, não aplicar migrations com drift não resolvido.
- Preservar RLS, permissões, arquitetura relacional de OS, expected_version, Outbox, imutabilidade do Ledger e idempotência.

## Estado atual do trabalho

### Fase 0 — Inventário e segurança de base

**Concluída em nível de auditoria inicial.**

- Confirmado que GitHub `main` está na linha de commits de correção e que o projeto Lovable reconhece os commits recentes.
- `.env`, `supabase/config.toml` e `src/integrations/supabase/project-config.ts` mantêm o Supabase oficial.
- Não foi feita alteração de domínio, configuração Supabase, tabela ou migration de produção.
- Verificação em 2026-11-15: GitHub `main` e Lovable reconhecem o mesmo SHA `d5c14650b09eb64c2dcbc672084c86c97f8be111`; Lovable retornou `status=ready`, `is_published=true`. Isso confirma o estado do projeto Lovable, não comprova sozinho que o domínio público serve esse SHA.
- O smoke test público do navegador alcançou `/login` com título Portal DBS Air e sem erro de browser. Sem credenciais E2E, isso não comprova navegação autenticada nas telas internas.

### Fase 1 — Interface e navegação

**Correções realizadas; validação autenticada pendente.**

- `src/styles.css`: removido somente o `@import` redundante do Google Fonts que causava falha do LightningCSS/Vite. O documento raiz já carrega Inter/Space Grotesk no `<head>`; as regras visuais existentes foram preservadas.
- `src/routes/_authenticated/dbs-inventory.tsx`: adicionado aviso contextual na tela existente de Compras quando faltam fornecedores, unidades, centros de custo ou vínculos mestre das peças ativas. O botão direciona a Peças & Estoque > Cadastros Básicos; nenhum módulo novo foi criado.
- `scripts/test-inventory-financial-bridge.cjs`: adicionadas asserções para esse comportamento.
- A estrutura das telas existentes de Peças & Estoque e Compras e os formulários de fornecedores/unidades/centros de custo permanecem no componente existente.

### Correção de auditoria — atualização de cadastros mestres

- Foi inicialmente suspeitado que os handlers de fornecedor e unidade não atualizavam as listas após salvar. A leitura completa confirmou que ambos usam `runAction`, e a própria função compartilhada executa `await overview.refetch()` após qualquer ação concluída.
- As chamadas extras `overview.refetch()` que chegaram a ser adicionadas foram removidas para evitar requisições duplicadas. O teste foi ajustado para proteger a atualização central de `runAction` e confirmar que os dois cadastros usam esse caminho.
- Commits: `9e454a7ca1297e629f2774e46212a80f75fef2ed` (remove duplicidade) e `c4a2e6581c88ae9cd374e2de48a28211a30868a4` (teste do caminho compartilhado).

### Fase 4 — Visualização da OS

**Funcionalidade existente encontrada e contratos estáticos/PDF verificados.**

- `public/dbs-control-os-viewer.js` implementa overlay de visualização somente leitura com dados hidratados do `ERP_STATE`.
- A tabela de OS já chama `abrirVisualizacaoOS(id)`; o script publica `window.abrirVisualizacaoOS`.
- A visualização inclui dados da OS, cliente/local, equipamentos, relato, diagnóstico, execução, checklist, peças, fotos, anexos, assinaturas e histórico. Possui pré-visualização de PDF, impressão e download explícito; abrir uma OS não força download.
- O teste automatizado de PDF cobre equipamentos, checklist, peças, evidências fotográficas, assinaturas e preservação conjunta do problema relatado pelo cliente e execução técnica.
- A navegação/visualização interna em sessão autenticada ainda precisa ser confirmada manualmente; o smoke público sem credenciais só alcançou a tela de login.

### Fase 2 — Compras e Estoque

**Fluxo transacional completo aprovado em teste com rollback; operação real depende de cadastros válidos.**

- `scripts/test-inventory-financial-bridge.integration.sql` foi ajustado para montar fornecedor, unidade, centro de custo, unidades-base das peças e centro de custo da OS somente dentro da transação de teste.
- Execução verificada em 2026-11-15 no Supabase oficial: `integration_test_status = PASS`; o arquivo termina com `ROLLBACK`. Consultas logo após a execução confirmaram 0 fornecedores, 0 centros de custo, 0 compras, 0 itens de compra, 0 recebimentos, 0 movimentos e 0 reservas — nenhum cadastro ou movimento de teste permaneceu persistido.
- O teste percorreu: compra em rascunho sem movimento de estoque nem AP prematuro; idempotência; aprovação financeira e obrigação no Ledger; recebimento com movimentação única por item; custo médio ponderado; pagamento parcial e saldo de AP; reserva/consumo de peça na OS; COGS; replay sem baixa duplicada; fechamento da OS e receita; sete métricas do painel.
- Consultas de contagem antes/depois confirmaram que os registros de teste não permaneceram no banco.
- **Cadastros produtivos verificados em 2026-11-15:** 0 fornecedores ativos, 0 centros de custo ativos, 1 unidade ativa, 5 peças no catálogo (1 ativa e nenhuma peça ativa vinculada a unidade-base), 3 cotações, 0 compras, 0 itens de compra, 0 recebimentos e 0 movimentos de estoque. A única unidade é `C001`, nome `CORTINA DE AR VIX 150CM ONE BR 220`, símbolo `UN`, precisão 3, `is_system=false`. O símbolo indica unidade “UN”, mas o código/nome se parecem com SKU/descrição de peça; não renomear nem apagar sem confirmação do valor correto.
- Portanto, a lógica de backend foi testada transacionalmente, mas ainda não foi possível comprovar um pedido de negócio real: faltam fornecedor, centro de custo, unidade de medida correta e vínculos das peças. Não inserir valores inventados em produção.

### Fase 4 — Ordem de Serviço e visualização

**Componente existente auditado; testes de PDF passaram; validação autenticada ponta a ponta pendente.**

- `public/dbs-control-os-viewer.js` está incluído pelo `public/dbs-control.html` e abre a OS em visualização interna a partir do `ERP_STATE` hidratado, sem baixar automaticamente nem gravar o registro ao abrir.
- O viewer já apresenta fotos antes/depois, galerias de imagem, documentos/anexos (incluindo PDF), assinaturas de cliente e técnico, histórico, preview do PDF, impressão e download.
- Ações de alteração de status, consumo de estoque de veículo/gás e confirmação de instalação são chamadas somente por ações explícitas do usuário, usando os fluxos já existentes.
- `scripts/test-dbs-control-pdf.cjs` passou no CI do SHA `d5c1465`, cobrindo equipamentos, checklist, peças, fotos/evidências, assinaturas e preservação do problema original junto à execução do técnico.
- Ainda falta uma sessão autenticada de navegador para testar abrir uma OS real, navegar pelos anexos e imprimir sem alterar seu status.

### Fase 5 — Sincronização, Outbox e conflitos

**Auditoria somente leitura concluída; há conflitos históricos que exigem reconciliação cuidadosa.**

- `dbs_control_sync_commands`: 375 comandos `applied` e 28 com `DBS_OS_CONFLICT` entre 2026-10-26 e 2026-11-12.
- `dbs_control_outbox`: 1.963 eventos publicados (work orders created/updated e entidades created/updated); nenhuma linha pendente, failed ou em DLQ nos agregados consultados. Os eventos publicados aparecem com no máximo uma tentativa.
- `dbs_control_outbox_dlq`: 0 registros; nenhum DLQ sem resolução.
- Entre os 28 conflitos de OS, 23 foram ligados a OS relacionais atuais e estão com `expected_version` antigo em relação à versão atual; 11 dessas OS estão em status terminal e 12 em status não terminal. Cinco comandos não puderam ser ligados a uma OS atual nem pelo ID nem pelo protocolo do payload.
- Os conflitos não foram reexecutados, descartados nem reconciliados; payload antigo pode conter valores obsoletos e não deve sobrescrever a versão atual. A investigação é somente leitura.
- `dbs_control_inventory_outbox` está vazia, coerente com ausência de movimentos de estoque reais no banco. O worker de DBS Control concluiu com sucesso no CI.
- A fila Treasury é independente e permanece no bloqueio descrito na Fase 3.

### Fase 3 — Financeiro / DBS Treasury

**Integrações contábeis do fluxo aprovadas no teste transacional; fila Outbox Treasury permanece bloqueada.**

- O teste de integração comprovou obrigações a pagar após aprovação, lançamentos balanceados, baixa parcial, COGS e receita de OS.
- Em 2026-11-15, a tabela `treasury_ledger_outbox` contém 3 eventos `treasury.ledger.posted` pendentes, todos da origem `treasury`, tipo `installment_payment`; os três lançamentos vinculados estão `posted` e balanceados (ao menos duas linhas).
- A verificação encontrou o produtor/trigger `treasury_enqueue_posted_entry()` e o monitor `treasury_ledger_health()`, mas não encontrou consumidor/worker implementado para esse evento.
- A rotina de saúde alerta corretamente os 3 eventos antigos. Não os marcar como publicados, apagar ou alterar para silenciar o alerta. Identificar o consumidor/contrato de destino antes de implementar processamento.
- O worker `dbs-control-outbox-worker` é da fila de sincronização DBS Control e não deve ser tratado como consumidor da fila Treasury.

- `9e454a7ca1297e629f2774e46212a80f75fef2ed` — removeu recargas duplicadas; a atualização já é centralizada em `runAction`.
- `c4a2e6581c88ae9cd374e2de48a28211a30868a4` — adicionou teste do caminho compartilhado de atualização de listas.
- `d5c14650b09eb64c2dcbc672084c86c97f8be111` — adicionou este registro mestre de continuidade.

## Commits desta execução

- `1966ef9546f675249f526eb1546ad264c3aa7c81` — removeu import CSS redundante e corrigiu a causa da falha do build.
- `1fe40d23967701f3bb278d45f33b37dff70dff18` — completou fixture do teste transacional com cadastros mestres.
- `a7eb3ed5ffcfea95e6c42f3f8d2e4225d81678f5` — completou fixture de centro de custo da OS em transação com rollback.
- `652ca2623825a73c08853a650ba5e46e85961c12` — adicionou asserções para a fixture do teste.
- `4ab6a6b9742cfe413dae98ea895dfbe67d6395a4` — adicionou orientação contextual de cadastros à tela existente de Compras.
- `6e4b29c946cd19ccd84115e3f2bf592226fc7d10` — adicionou testes estáticos do aviso contextual.

## Validações observadas

- No commit `1966ef9`: Validate, TypeScript, build Vite, lint, testes operacionais, RH, estoque/financeiro, proteção de dados e fase 3 passaram; smoke de DBS Control e worker de sincronização passaram.
- No commit `652ca26`: Validate, verificar e DBS Control smoke concluíram com sucesso.
- No SHA `d5c14650b09eb64c2dcbc672084c86c97f8be111`: Validate, verificar, DBS Control smoke validation e DBS Control outbox worker concluíram com sucesso. O Validate incluiu lint, testes operacionais/performance/RH/estoque-financeiro/proteção de dados/ledger reporting, build Vite e TypeScript; o verificar incluiu contratos DBS Control/PDF/financeiro, TypeScript e build Vite.
- No SHA `4ab6a6b`, o smoke Playwright abriu o domínio público, alcançou a tela de login e terminou sem erros de browser; isso não comprova navegação autenticada nem interação com dados.
- Na última leitura, `main` e `Lovable.latest_commit_sha` estavam sincronizados em `2e16a74bd6ff27f041f44d0be7d31864dd22de50`; projeto `ready`, `is_published=true`, domínio mantido. O sinal `is_published` não foi usado como prova do SHA atualmente servido em produção.

## Bloqueios e próximos passos

1. Confirmar conclusão do CI disparado pelo último commit de registro e manter o SHA sincronizado no Lovable. Não publicar automaticamente.
2. Resolver com evidência o destino/consumidor dos 3 eventos pendentes de `treasury_ledger_outbox`; não mascarar o alerta.
3. Reconciliar histórico de migrations antes de qualquer deploy de schema: a auditoria leu 134 versões aplicadas no Supabase e 125 arquivos locais, com diferenças de versionamento/nome. Isso pode refletir renumerações históricas; não renomear, reparar ou aplicar migrations em lote sem comparar o SQL armazenado em `supabase_migrations.schema_migrations.statements` com os arquivos.
4. Cadastrar fornecedores, unidade de medida válida e centros de custo a partir dos dados reais da empresa; revisar os vínculos de fornecedor/unidade das peças já existentes.
5. Validar o ciclo de compra real em sessão autenticada depois dos cadastros mestres.
6. Concluir o ciclo de custo da OS (reserva/consumo, histórico e Treasury); a visualização interna, anexos, fotos, assinaturas e PDF já estão no código e têm testes automatizados parciais.
7. Concluir Fase 5 (reconciliação dos conflitos de OS, permissões e backups), Fase 6 (regressão/mobile) e Fase 7 (publicação pelo Lovable).

## Regra de atualização

Ao fechar uma tarefa, registrar problema, causa, arquivos/commit, teste executado, resultado e situação. Reabrir somente diante de evidência nova. Não repetir tentativas sem nova evidência. Não declarar tarefa concluída sem validação.


## Atualização de continuidade — execução 2026-11-15 (00:32–00:40 BRT)

### Estado confirmado após a auditoria complementar

- GitHub `main` recebeu os commits `509e204229e3f0b90806a6e351bce5e8b7afda07` e `85390cace1ff3235edcd90032440378a3fcd8788`: remoção de seis recargas redundantes de `overview.refetch()` em ações que já passam por `runAction()`, e teste de regressão para garantir uma única atualização compartilhada.
- O componente `runAction()` continua sendo o único ponto de atualização após ações bem-sucedidas; a chamada manual de recarga da tela de erro foi preservada. Restaram exatamente duas ocorrências no arquivo: a atualização central e a ação explícita de tentar novamente.
- O teste `scripts/test-inventory-financial-bridge.cjs` agora protege os seis handlers contra recargas duplicadas.
- Build Vite/Nitro do commit `85390cace1ff3235edcd90032440378a3fcd8788` concluiu com sucesso no check Vercel. Isso é validação de build; não é publicação oficial do produto.
- Lovable reconheceu o mesmo SHA `85390cace1ff3235edcd90032440378a3fcd8788`, projeto `ready` e `is_published=true`. Nenhum deploy/publicação foi iniciado pelo assistente e o domínio oficial não foi alterado.
- A hidratação relacional de anexos da OS está presente em `src/lib/dbs-control.functions.ts`: lê anexos apenas para IDs de OS previamente retornados pelo caminho de consulta com escopo, gera URLs assinadas e combina fotos/anexos com os campos legados. A tabela relacional atualmente contém 31 registros do tipo `assinatura`, ligados a 31 OS. Não houve gravação no banco nesta verificação.
- A verificação de compras/estoque confirmou que o bloqueio operacional atual é em grande parte cadastral: nenhum fornecedor, nenhum centro de custo, uma unidade ativa (`C001`, nome atual semelhante à descrição de uma peça), cinco peças (uma ativa e quatro inativas), a peça ativa sem fornecedor/unidade vinculados, três cotações em rascunho e nenhuma compra/recebimento/movimentação. A unidade suspeita não foi renomeada nem removida; nenhum dado empresarial foi inventado.
- A fila `treasury_ledger_outbox` contém três eventos `treasury.ledger.posted` pendentes, com zero tentativas, criados em 2026-11-10. A auditoria de funções/triggers identificou o produtor `treasury_enqueue_posted_entry()` na tabela `treasury_ledger_entries`, mas não identificou consumidor/worker nem trigger de consumo na outbox. Não foram alterados, apagados ou marcados como publicados.
- A auditoria das migrations continua somente leitura: não foi executado deploy de schema, repair ou renumeração.

### Próxima execução objetiva

1. Validar a nova suíte de regressão no CI; build passou, mas o build sozinho não executa os scripts de teste.
2. Identificar o contrato/destino dos três eventos Treasury pendentes antes de criar qualquer consumidor.
3. Obter os dados reais da empresa para fornecedores, unidade correta, centros de custo e vínculos das peças; não usar valores fictícios.
4. Após os cadastros válidos, executar o fluxo autenticado de compra e recebimento em ambiente controlado.
5. Validar em sessão autenticada o visualizador de OS, assinaturas, fotos/anexos e impressão sem alterar o status da OS.
6. Resolver drift de migrations por comparação do SQL aplicado com os arquivos locais; nenhuma aplicação em lote.
7. Continuar regressão de sincronização, permissões e mobile; publicação pelo Lovable permanece bloqueada até os critérios de aprovação.



## Atualização adicional — correções de interface e validação (2026-11-15)

- Corrigida uma duplicação real na tela Catálogo de Peças: havia dois cartões completos de catálogo com busca/filtro; foi removido o cartão antigo, mantendo o formulário lateral de cadastro/edição e o cartão responsivo mais recente. Commit: `44ff9fe5b25e17a3f8cb318689efbc07abd7f7c2`.
- O teste de regressão agora exige exatamente uma superfície de busca do catálogo. Commit: `a75cc451fb01be1ef6c726f15f682ec39423273f`.
- Verificação estática executada sobre os arquivos atuais: uma busca do catálogo; apenas duas chamadas de `overview.refetch()` (atualização central de `runAction()` e botão explícito de tentar novamente); viewer de OS carregado pelo HTML; handler de visualização presente; ações de preview, impressão e download presentes; nenhuma chamada RPC de alteração no viewer. Todos os contratos verificados passaram.
- Build Vite/Nitro do commit `a75cc451fb01be1ef6c726f15f682ec39423273f` concluiu com estado `READY`. O prebuild confirmou explicitamente o Supabase `gdglototcrehvhkvcqsq`. É apenas validação de build; não é publicação oficial.
- Lovable reconheceu o SHA `a75cc451fb01be1ef6c726f15f682ec39423273f`, projeto `ready`. O domínio oficial continua inalterado e não houve publicação.
- A suíte Node completa de regressão ainda depende do resultado do GitHub Actions; a verificação estática manual acima não deve ser confundida com execução integral dos scripts.



## Atualização de continuidade — reconciliação de OS e regressão do catálogo (2026-11-15)

### Conflitos históricos de sincronização — auditoria somente leitura

- No Supabase oficial, `dbs_control_sync_commands` apresentou 375 comandos `applied` e 28 comandos `conflict` com código `DBS_OS_CONFLICT`, entre 2026-10-26 e 2026-11-12. Os 28 comandos abrangem 10 OS; nenhum deles tem `applied_at`. Os payloads registram tentativas de gravar o status `em_atendimento` com `expected_version` anterior à versão canônica.
- A comparação entre payloads históricos, `dbs_control_work_orders` e `dbs_control_work_order_events` identificou duas OS ainda abertas cujo status coincide, mas cujo checklist técnico não foi integralmente persistido: `DBS-2026-000104` e `DBS-2026-000108`. Em ambas, a intenção local contém marcações verdadeiras ausentes do checklist canônico e não foi encontrado evento posterior `work_order_delta` que confirme essas marcações.
- `DBS-2026-000048` foi excluída por evento `work_order_deleted` depois do conflito. Ela deve permanecer soft-deleted e nunca ser reaberta por reconciliação antiga. As demais OS deste lote já estão concluídas na versão canônica e continuam protegidas.
- Nenhum comando de conflito, OS ou evento do Treasury foi atualizado, reaplicado, apagado ou marcado como publicado durante esta auditoria. A comparação foi feita por SELECT somente.

### Correção implementada — conflitos não podem ser considerados resolvidos apenas pelo status

- `src/routes/_authenticated/dbs-control.tsx`: a verificação de conflito já aplicado agora exige que, para OS ativa, a versão canônica seja mais nova, o status solicitado coincida e os campos `checklistTecnico`, `checklist` e `parametrosOperacionais` presentes na intenção também coincidam. Uma OS concluída ou excluída é terminal e pode ser retirada da fila ativa somente preservando a intenção histórica em quarentena.
- Recuperação de quarentenas antigas: apenas itens marcados pela mensagem exata de autoquarentena da regra antiga podem voltar para revisão; isso ocorre quando a OS ainda existe, está ativa e o checklist continua divergente. Quarentenas manuais do operador não são reabertas. Commit: `f9655c144d4cccc6d4ee2329cf71c724142a998f`.
- `public/dbs-control.html`: o rebase explícito une marcações técnicas verdadeiras sem desmarcar o que já está salvo na nuvem, mantém itens de checklist já concluídos e preserva o status/soft delete/assinatura de OS terminais. Commit: `cf1cf8f11b5ff6038a8f0714a9431ab4fd332b9a`.
- Testes adicionados/ajustados em `scripts/test-dbs-control-resilience.cjs` para checklist divergente, quarentena antiga, OS excluída e merge monotônico. Commits: `d3a8a5e6a29bf23049a38b03fc9963ba25c43839` e `66cbeaa84bb461078ba2f7f33cd452b3df1f49f6`.
- A reconciliação das intenções locais ainda exige ação explícita do operador na interface (“Reconciliar mantendo minhas alterações”). Nenhuma OS é regravada automaticamente por esta correção; o histórico original permanece preservado.

### Segurança adicional e regressão da interface

- `src/lib/dbs-control.functions.ts`: upload de evidências de OS para colaborador agora confere também base ativa e `client_id` pertencente aos clientes vinculados à base, mesmo quando a chamada tenta usar ID/protocolo direto. Teste correspondente em `scripts/test-dbs-control.cjs`. Commits: `2254f7cb5185fdf2baf3184b5b01f1d764824293` e `c0c4592a8fa02637422c7247113688aa014e30b3`.
- `src/routes/_authenticated/dbs-inventory.tsx`: removida a apresentação duplicada do catálogo, mantendo a superfície de busca responsiva e o formulário lateral; teste exige uma única superfície de busca. Commits: `44ff9fe5b25e17a3f8cb318689efbc07abd7f7c2`, `b42707eca690f99230c93aa344c1ec534938c7b8` e `a75cc451fb01be1ef6c726f15f682ec39423273f`.
- Removidas recargas duplicadas de `overview.refetch()`: os handlers de fornecedor, unidade e demais ações continuam usando a atualização central de `runAction()`. Testes protegem o caminho compartilhado. Commits: `509e204229e3f0b90806a6e351bce5e8b7afda07`, `85390cace1ff3235edcd90032440378a3fcd8788`.

### Validação do SHA final desta execução

- SHA de `main`: `5c79e9adc7bce7aaa9ded0a0f8e310d03a9fd8f8`.
- GitHub Actions: `Validate`, `verificar`, `DBS Control smoke validation` e `DBS Control outbox worker` concluíram com sucesso neste SHA.
- `Validate`: verificação de nomes/versões de migrations, recuperação de módulos, fronteira de autenticação, runtime loader, imports do Preview, lint, performance, testes operacionais, RH/Ponto, inventário-financeiro, proteção de dados, ledger reporting, escopo da base, escala RH, build Bun e TypeScript.
- `verificar`: testes DBS Control, resiliência de sincronização, escopo/base, RH/Ponto, PDF OS, ponte inventário-financeiro, proteção de dados, TypeScript e build Vite.
- O smoke validation executou os contratos de scripts inline, concorrência/retry/outbox, 50 sessões concorrentes, RH/Ponto, backup/retenção e build; worker de outbox DBS Control concluiu com sucesso.
- Lovable reconhece o mesmo SHA `5c79e9adc7bce7aaa9ded0a0f8e310d03a9fd8f8`, status `ready`, `is_published=true`. Isso confirma sincronização do projeto Lovable; não é prova isolada do SHA servido no domínio público. Nenhuma publicação foi disparada nesta execução.

### Próximos passos operacionais

1. Em sessão autenticada do colaborador/dispositivo que contém as intenções locais, revisar os conflitos reabertos de `DBS-2026-000104` e `DBS-2026-000108` e usar a ação explícita de reconciliação somente após conferir os checklists; não reenviar OS concluídas nem a OS excluída `DBS-2026-000048`.
2. Manter a auditoria dos três eventos pendentes de `treasury_ledger_outbox` sem alteração até identificar o contrato/consumidor correto.
3. Obter dados reais para fornecedores, unidade de medida e centros de custo antes do primeiro pedido produtivo.
4. Validar visualizador de OS e ciclo real de compras em sessão autenticada antes de liberar publicação pelo Lovable.


## Atualização de continuidade — execução consolidada 2026-11-15 (00:33–00:41 BRT)

### Entregas de código concluídas nesta rodada

- **Peças & Estoque:** removida a segunda renderização redundante do catálogo antigo, mantendo o catálogo atual, seus filtros, a listagem responsiva e os drawers de cadastro/edição. A suíte exige exatamente uma área de busca do catálogo. Commits: `44ff9fe5b25e17a3f8cb318689efbc07abd7f7c2`, `b42707eca690f99230c93aa344c1ec534938c7b8` e `a75cc451fb01be1ef6c726f15f682ec39423273f`.
- **Atualização dos cadastros:** as ações de fornecedor/unidade continuam usando o refetch central de `runAction()`; removidas chamadas adicionais duplicadas. O refetch manual de recuperação foi preservado. Commits: `509e204229e3f0b90806a6e351bce5e8b7afda07` e `85390cace1ff3235edcd90032440378a3fcd8788`.
- **Visualização de OS:** o carregamento agora complementa os campos legados com `dbs_control_work_order_attachments`, restrito aos IDs de OS que já passaram pela consulta com escopo/limite de colaborador. Os arquivos privados recebem URLs assinadas temporárias e entram na visualização de fotos/anexos; assinatura mais recente também pode preencher a evidência da OS. O viewer continua somente leitura ao abrir.
- **Proteção de anexos:** URLs assinadas expirantes são removidas dos snapshots do servidor, dos deltas enviados pelo cliente e do cache local quando já existe `storagePath`. Isso evita persistir tokens temporários ou tentar reutilizar links expirados. Commits: `b38753289e915360a0178649d7b4009518dfd399`, `ccc52422a922be39f1333ec27dc561c5b8193bc6`, `863e0a3aeee39c871aa8cb71e0b518b411cf9e3b`, `3cff309c55201eeaff334be2e8d125747989a7eb`, `b390d3a809656fa4c56c441a6bf04140a037fa3d` e `8ef963470c2b382e5d6e658a12cad333de62c164`.
- **Evidência no Storage:** conferência somente leitura confirmou 31 registros relacionais de assinatura e 31 objetos correspondentes no bucket privado `dbs-control-os`; nenhum objeto ausente. Nenhum arquivo foi alterado, removido ou recadastrado.
- **Sincronização/confli​tos:** a auto-quarentena de conflito agora exige correspondência também do checklist e parâmetros de execução, não apenas versão/status. Conflitos antigos auto-quarentenados com checklist divergente podem voltar para revisão; marcações técnicas verdadeiras são unidas sem permitir que uma intenção antiga desmarque uma marcação canônica. OS concluída ou excluída não é reaberta por rebase. Upload de evidência de colaborador verifica base ativa, cliente vinculado e técnico atribuído. Essas mudanças são de código e testes; nenhum conflito da fila de produção foi reaplicado, apagado ou atualizado. Commits incluem `b7ddd84da2b4728903a9dfce63b3683a9f4cf574`, `cf1cf8f11b5ff6038a8f0714a9431ab4fd332b9a`, `d3a8a5e6a29bf23049a38b03fc9963ba25c43839`, `c0c4592a8fa02637422c7247113688aa014e30b3`, `f9655c144d4cccc6d4ee2329cf71c724142a998f` e `66cbeaa84bb461078ba2f7f33cd452b3df1f49f6`.

### Validações finais observadas

- SHA atual de `main`: `5c79e9adc7bce7aaa9ded0a0f8e310d03a9fd8f8`.
- No SHA acima, GitHub Actions concluiu com sucesso: **Validate**, **verificar**, **DBS Control smoke validation** e **DBS Control outbox worker**.
- O projeto Lovable reconhece o mesmo SHA `5c79e9adc7bce7aaa9ded0a0f8e310d03a9fd8f8`, retornou `ready` e `is_published=true`. O domínio oficial permanece o mesmo. Nenhuma ação de publicação foi iniciada por esta execução; o campo `is_published` não é usado como prova independente do SHA servido pelo domínio público.
- A suíte Playwright pública alcançou a tela de login sem erro de browser, mas o teste de OS autenticado não executou porque as credenciais/URL da base isolada de E2E não estavam configuradas. Não afirmar validação autenticada ponta a ponta.

### Bloqueios que permanecem

1. **Compras reais:** sem fornecedores e centros de custo produtivos, e com uma única unidade ativa de identificação ambígua; a única peça ativa ainda está sem os vínculos obrigatórios. Não criar valores fictícios nem renomear/remover a unidade atual sem confirmação dos dados corretos.
2. **Treasury:** três eventos `treasury.ledger_outbox` continuam pendentes, sem consumidor confirmado. Preservar a fila até identificar o contrato de destino; não marcar como publicados nem criar um worker presumido.
3. **Migrations:** manter a auditoria de drift somente leitura até comparar os SQLs armazenados no histórico do Supabase com os arquivos locais. Não renumerar nem aplicar em lote.
4. **Validação autenticada:** falta uma sessão E2E isolada com credenciais para executar compra real, visualizar OS autenticada com anexos e testar impressão; o smoke público anônimo não cobre essa operação.

### Regra para a próxima rodada

Prosseguir pelo próximo bloqueio que tenha solução segura no código. Para cadastros produtivos, é necessário usar os dados oficiais da empresa; para Treasury, é necessário confirmar o consumidor/contrato. Não modificar produção para produzir um resultado artificial.


### Complemento final — proteção de OS canceladas (2026-11-15)

- A revisão terminal foi ampliada para incluir OS canceladas, além de concluídas e excluídas. `dbsControlStateOrderIsCancelled` normaliza acentos/espaços e reconhece `cancelada`, `cancelado`, `cancelled` e `canceled`.
- A proteção se aplica em todos os caminhos: autoquarentena de conflitos já refletidos; recuperação de quarentenas antigas; rebase de sessão de colaborador; e merge do estado do iframe. Quando a versão canônica é terminal, o status canônico prevalece sobre um payload antigo do dispositivo.
- Commits: `52e3a4aa5db6b41b120c7089e3db91bb96280316` (classificação cancelada), `55810241d0da2ba7d78652e8f9e9aeb85eaa76fa` (normalização Unicode corrigida), `df48c157ad0247964d0f835b74a01c24fafa7a9e` (preservação de status no iframe), `685a21e2d16fc620907d0c55fe19ee69a92b1af4` (todos os guardas de recuperação/rebase), `b643001efda710f475ade3296b61694ebc8f912e` e `df07d81ec1dd9783132df3f5161fc95e7a763035` (testes de regressão).
- Validação do SHA `df07d81ec1dd9783132df3f5161fc95e7a763035`: Validate, verificar, DBS Control smoke validation e DBS Control outbox worker concluíram com sucesso. O Validate passou build Bun, TypeScript, lint, performance e testes operacionais/RH/Ponto/inventário-financeiro/proteção de dados/Ledger/escopo; verificar passou testes DBS Control/resiliência/base/PDF/financeiro, TypeScript e Vite build; smoke passou os contratos inline, retry/outbox, concorrência, RH/Ponto, backup/retenção e build; worker concluiu com sucesso.
- Lovable reconheceu o mesmo SHA `df07d81ec1dd9783132df3f5161fc95e7a763035`, status `ready`. `is_published=true` foi observado, mas não prova sozinho o SHA servido no domínio público. Não houve publicação iniciada nem alteração de domínio.
- Nenhuma OS ou comando de conflito foi alterado no Supabase. As duas OS abertas com checklist divergente permanecem para revisão explícita; OS concluídas, canceladas e excluídas permanecem terminais.
## Auditoria complementar de segurança — escopo RLS e integridade de anexos (2026-11-15)

- **Storage de OS:** conferência SQL somente leitura comparou dbs_control_work_order_attachments.storage_path com storage.objects.name no bucket privado dbs-control-os: 31 registros relacionais, 31 objetos, 31 correspondências exatas, zero objeto ausente, zero objeto órfão e zero caminho duplicado. Nenhum caminho ou arquivo foi exposto/alterado.
- O bucket continua privado (public=false), limitado a 10 MiB e a JPEG/PNG/WebP. Não há objetos PDF nem anexos relacionais além de assinaturas neste momento; o visualizador suporta renderizar PDFs quando já estiverem disponíveis, mas o endpoint atual de upload ainda aceita somente foto antes/depois e assinatura.
- **Ponto de atenção RLS:** no catálogo de produção, dbs_control_work_orders (SELECT/UPDATE) e dbs_control_work_order_attachments (SELECT/INSERT) continuam autorizando colaboradores por vínculo a private.dbs_my_employee_ids()/assigned_employee_id; as políticas lidas não repetem a condição de base ativa e cliente vinculado que a hidratação do servidor e o endpoint de upload já aplicam.
- Isso cria uma possível diferença entre o escopo de tela/API server-side e as consultas REST diretas por usuário autenticado, caso exista OS atribuída fora dos clientes da base RH ou uma base inativa. Não foi executado teste de REST com JWT de colaborador nem leitura de conteúdo fora do escopo; portanto, registrar como lacuna de autorização a validar, sem afirmar exploração confirmada.
- Nenhuma policy, grant, tabela ou dado foi alterado. Antes de corrigir, comparar o SQL das policies aplicadas com as migrations do repositório, definir como tratar colaborador sem base configurada e com base inativa, então preparar migration aditiva para alinhar SELECT/UPDATE/INSERT de OS, anexos e tabelas dependentes, executar supabase db advisors e testes por perfil. A migration não deve ser aplicada até resolver o drift histórico e validar a matriz de permissões.
- **Proteção de cancelamento:** os caminhos de autoquarentena, recuperação de quarentena antiga, rebase do colaborador e merge do iframe agora também preservam OS canceladas (cancelada, cancelado, cancelled, canceled). Commits adicionais: 52e3a4aa5db6b41b120c7089e3db91bb96280316, 55810241d0da2ba7d78652e8f9e9aeb85eaa76fa, df48c157ad0247964d0f835b74a01c24fafa7a9e, 685a21e2d16fc620907d0c55fe19ee69a92b1af4, b643001efda710f475ade3296b61694ebc8f912e e df07d81ec1dd9783132df3f5161fc95e7a763035.

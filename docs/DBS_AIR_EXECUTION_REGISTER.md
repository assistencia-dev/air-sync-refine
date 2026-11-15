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

## Continuidade — etapa de segurança de OS/RLS (2026-11-15)

- SHA conferido na main: 78b17f5e3ab7601e58b0ded5ea36579e730f1bae; Lovable reconhece o mesmo SHA e estado ready.
- GitHub Actions no commit de registro anterior concluiu Validate, verificar, DBS Control smoke validation e DBS Control outbox worker. Isso valida os workflows daquele SHA; não substitui teste autenticado por perfil.
- Consulta somente leitura às policies de produção confirmou:
  - dbs_control_work_orders: SELECT/UPDATE de colaborador via private.dbs_my_employee_ids(), além de filtro de excluída/cancelada.
  - dbs_control_work_order_attachments: SELECT via atribuição da OS ao empregado retornado pela mesma função; INSERT exige usuário autenticado que envia o anexo e empregado ativo com acesso Ponto/DBS habilitado.
  - private.dbs_my_employee_ids() considera vínculo direto ponto_portal_user_id e vínculo rh_employee_access, exigindo dbs_control_access_enabled=true e is_active=true.
- A função não filtra dbs_control_base_id nem a relação do cliente. Portanto, a hipótese de diferença entre o escopo das telas/handlers e o escopo REST/RLS continua tecnicamente plausível, mas não está provada como acesso indevido: ainda falta definir se a regra oficial de autorização por base/cliente deve ser aplicada também à consulta direta.
- Nenhuma policy, função, grant, migration ou registro foi alterado. Nenhum JWT de colaborador foi usado para consultar OS de outro escopo.
- Próxima ação segura: comparar a regra de escopo efetivamente usada pelo backend de leitura e pelos vínculos RH com a matriz oficial de permissões antes de propor migration. Não restringir RLS por suposição, pois isso poderia retirar acesso legítimo a OS atribuída.


### Correção complementar — base de outra empresa não pode virar “sem base” (2026-11-15)

- `getCollaboratorBaseScope` preserva o `dbs_control_base_id` quando detecta divergência entre `dbs_control_bases.company_id` e `users.company_id`, retornando `baseActive=false`, `canIssueWorkOrders=false` e `clientIds=[]`. Antes, zerava o `baseId`, fazendo `filterCollaboratorState` tratar o caso como colaborador sem base e liberar o fallback legado de OS atribuída.
- O banco oficial foi consultado somente para verificar o estado atual: 3 colaboradores ativos com acesso DBS, todos vinculados a bases ativas e sem incompatibilidade empresa/base. As 46 OS atribuídas a esses colaboradores pertencem aos clientes das respectivas bases; nenhum registro fora de escopo foi encontrado.
- `scripts/test-dbs-control-base-scope.cjs` agora exige que a base permaneça vinculada no ramo de divergência de empresa. Commits: `31d6b1da93731317d5ad287f5386388a19d96f48` (correção do serviço) e `f36555f55e7d4d00c7ff60e90bf3666a4c66e7ce` (teste).
- No SHA `f36555f55e7d4d00c7ff60e90bf3666a4c66e7ce`, os workflows `Validate`, `verificar`, `DBS Control smoke validation` e `DBS Control outbox worker` concluíram com sucesso. `Validate` passou lint, performance, testes operacionais/RH/Ponto/inventário-financeiro/proteção de dados/Ledger/escopo RH, build Bun e TypeScript. `verificar` passou os testes DBS Control/resiliência/base/PDF/financeiro, TypeScript e Vite build.
- Lovable sincronizado com o mesmo SHA, status `ready`; nenhuma publicação foi iniciada, nenhum domínio foi alterado e nenhum dado/RLS/migration de produção foi modificado.


## Continuidade — correção de escopo de base RH e sincronização (2026-11-15)

- A leitura do backend confirmou que a base RH configurada é preservada mesmo quando inativa, e que a hidratação de OS usa a lista de clientes vinculados à base como limite de consulta no servidor. Foi identificada e corrigida uma exceção: quando a base configurada pertencia a outra empresa, o fluxo poderia tratar a situação como ausência de base e cair no caminho legado de OS atribuídas.
- Correção aditiva em `getCollaboratorBaseScope()`: base de outra empresa permanece vinculada, porém com `baseActive=false`, `clientIds=[]` e `companyId=null`. A hidratação passa a retornar escopo vazio, sem fallback de OS atribuídas. Teste de regressão em `scripts/test-dbs-control-base-scope.cjs` valida esse bloqueio. Commits: `31d6b1da93731317d5ad287f5386388a19d96f48` e `f36555f55e7d4d00c7ff60e90bf3666a4c66e7ce`.
- Validação no commit `f36555f55e7d4d00c7ff60e90bf3666a4c66e7ce`: status Vercel reportado como `success`; o projeto Lovable está `ready` e reconhece exatamente o mesmo SHA. O domínio oficial não foi alterado e nenhuma publicação foi iniciada. A confirmação do SHA servido publicamente continua separada dessa sincronização.
- A inspeção do histórico de migrations no Supabase oficial confirmou que os SQLs aplicados de `20261026161106_dbs_control_private_employee_scope` e `20261027151430_rls_scope_lookup_indexes` estão armazenados no histórico. Ainda não foi feita reconciliação integral do SQL de RLS aplicado versus o arquivo local nem teste autenticado REST com JWT de colaborador; portanto, nenhuma policy foi alterada.
- Treasury permanece bloqueado para qualquer ação automática: a outbox contém três eventos `treasury.ledger.posted` pendentes e o repositório contém apenas o produtor/trigger e o health RPC, sem consumidor correspondente encontrado. Os eventos e lançamentos permanecem intactos.
- Cadastros de compras permanecem sem dados reais suficientes (fornecedores/centros de custo e unidade ambígua); nenhum cadastro fictício foi criado.
- Próximas ações seguras: terminar a comparação de RLS/migrations e a verificação visual/operacional sem escrita; manter a publicação bloqueada até resolver ou formalmente isolar os bloqueios de operação real e executar validação autenticada em ambiente controlado.



### Auditoria complementar de ACL SQL — `TRUNCATE` (2026-11-15)

- No Supabase oficial, as ACLs padrão em `public` concedem `TRUNCATE` a `anon` em 31 tabelas e a `authenticated` em 56 tabelas; as 100 tabelas públicas consultadas têm RLS ativado. A lista inclui `dbs_control_work_orders`, anexos, equipamentos, eventos, partes, serviços, `rh_employees` e `users`.
- `TRUNCATE` não é filtrado por RLS. A inspeção não encontrou função `SECURITY DEFINER` executável por `anon` cujo corpo contenha `TRUNCATE`, portanto não foi demonstrado um caminho de exploração pelo endpoint REST nesta auditoria. Ainda assim, a permissão é desnecessária para usuários finais e deve ser removida.
- As tabelas de estoque imutável, snapshots, sync commands e Treasury já têm ACLs mais restritas; as tabelas de OS/RH não têm o mesmo endurecimento consistente. Os default ACLs de `postgres` e `supabase_admin` também concedem privilégios amplos em novas tabelas `public`.
- **Nenhum GRANT/REVOKE foi executado.** A remediação requer migration aditiva para revogar `TRUNCATE` (e rever defaults de `public`) após conciliar as 134 versões aplicadas com os arquivos locais e as policies ao vivo; não fazer repair/apply em lote enquanto esse drift persistir.


## Testes adicionais — leitura de produção e gates de liberação (2026-11-15)

- Build Vercel do commit `3f7a1210a793ed15cd27dff00814bbc6209c32ea`: `READY`; compilação Vite/Nitro concluída; prebuild confirmou Supabase `gdglototcrehvhkvcqsq`. Combined status: `success`.
- Logs Vercel para o deployment testado: nenhuma entrada warning/error/fatal no intervalo disponível de 30 minutos. A conta Hobby não reteve a janela de 1 hora solicitada; por isso não foi possível ampliar a janela de logs.
- Saúde da sincronização DBS Control via `dbs_control_sync_health()`: 1.963 publicados, 0 pendentes, 0 em processamento, 0 falhos, 0 dead-letter, 0 retries acima de 3 e nenhum erro registrado. Métricas dos últimos 7 dias: 160 execuções do worker, 72 eventos reclamados e 72 concluídos, 0 falhas, média ~849 ms.
- A Edge Function `dbs-control-outbox-worker` está ACTIVE, com `verify_jwt=true`; código exige token com role `service_role`, usa RPC de claim/complete e valida agregado canônico. Nenhum disparo manual foi feito.
- RLS/advisors: 22 tabelas com RLS habilitado sem policies explícitas; para as tabelas críticas verificadas, não há privilégios de escrita para `authenticated` e não há acesso `anon`. Leituras operacionais de fornecedores/unidades/cotações/estoque de veículo são feitas no servidor via `supabaseAdmin`; OS e anexos possuem policies próprias. Não foi alterada nenhuma policy.
- 15 funções SECURITY DEFINER foram inspecionadas quanto a autenticação, administrador, técnico atribuído e delegação para RPCs protegidas. Todas negam `anon`; as rotas administrativas verificam administrador e as rotas de colaborador delegam/validam vínculo e OS atribuída. O advisor WARN permanece para revisão contínua, mas não foi identificado bypass evidente na leitura estática das funções.
- Treasury: `treasury_ledger_health()` informa 3 eventos pendentes críticos e acima do SLA desde 2026-11-10; o único trigger encontrado é o produtor `treasury_enqueue_posted_entry`. A única Edge Function ativa é o worker DBS Control, que processa `dbs_control_outbox`, não a outbox Treasury. Sem consumidor Treasury confirmado, os três eventos não foram tocados.
- Integridade operacional de Compras: 0 compras, 0 recebimentos, 0 movimentos de estoque, 0 pagamentos, 0 fornecedores ativos, 0 centros de custo ativos e 1 unidade ativa. Isso impede um teste transacional real de compra/recebimento sem criar cadastros/dados fictícios em produção; nenhum dado foi criado.
- O branch Supabase conectado aparece `MIGRATIONS_FAILED`; logs de workflow mostram `Remote migration versions not found in local migrations directory`. O banco oficial está `ACTIVE_HEALTHY` e lista migrations aplicadas até `20261112143134`, mas há versões remotas antigas sem arquivo correspondente encontrado na pasta local. Isso é divergência de histórico Git/Supabase e precisa ser reconciliada sem reset ou reaplicação destrutiva.
- Limites do teste: o build de produção foi executado e os dados/health/RLS foram auditados em modo leitura. Não houve teste autenticado REST/UI com sessão real de administrador e colaborador, nem teste transacional de compra/recebimento; não há credenciais/sessões de teste disponíveis e não foram criadas contas. Não afirmar homologação ponta a ponta.
- Decisão: publicação permanece bloqueada até (1) reconciliar o histórico de migrations do branch sem reset, (2) implementar/validar consumidor idempotente da outbox Treasury ou definir formalmente que os eventos não exigem consumidor, e (3) executar testes autenticados e transacionais em ambiente isolado com dados de teste.



### Reconciliação de nomes de migrations e DRE/Fluxo de Caixa (2026-11-15)

- Comparação por nome-base entre o repositório e `supabase_migrations.schema_migrations`: 125 arquivos locais, 134 registros remotos; 113 nomes-base correspondem. Restam 12 arquivos locais sem correspondência direta e 21 nomes remotos sem arquivo local de mesmo nome. Parte relevante é reversionamento/reparos (ex.: `dbs_control_delta_outbox_v2`, `dbs_control_delta_outbox_repair_*`, `rls_explicit_batch_02` a `08`) e não deve ser tratada automaticamente como migration faltante.
- A migração antiga `20261103090000_dbs_purchase_orders_partial_receipts.sql` não aparece por nome; porém o modelo produtivo atual é o novo conjunto `dbs_control_purchases`, `dbs_control_purchase_items`, `dbs_control_purchase_receipts` e movimentos imutáveis. As tabelas legadas `dbs_purchase_orders`/`dbs_inventory_receipts` não existem. Tratar o SQL antigo como supersedido, não reaplicá-lo.
- A migration local `20261103200000_dbs_phase3_ledger_reporting_views.sql` não tem correspondência de histórico e as quatro views previstas (`treasury_vw_dre_competence_by_account`, `treasury_vw_dre_competence`, `treasury_vw_cash_flow_monthly_by_account`, `treasury_vw_cash_flow_monthly`) não existem no Supabase oficial. Também não foram encontradas referências de consumo dessas views no frontend; a tela de DRE/fluxo derivada do Ledger ainda precisa de implementação/deploy relacional efetivo.
- A migration local `20261016100000_dbs_control_os_document_retention.sql` também não tem correspondência de nome e a tabela `dbs_control_work_order_revisions` não existe. O histórico operacional corrente usa `dbs_control_work_order_events`; não criar a tabela de revisão sem confirmar que o requisito append-only continua desejado.
- A migration de alias `20261018120000_dbs_control_snapshot_safe_v2_alias.sql` não corresponde por nome, mas a função `dbs_control_save_snapshot_safe_v2(jsonb)` existe no banco; não duplicar sua criação.
- **Não foi executado `db push`, `repair`, migration SQL ou gravação em `schema_migrations`.** Não renumerar arquivos nem aplicar em lote. A divergência deve ser reconciliada por comparação do SQL de cada registro remoto com os arquivos locais antes de qualquer migração adicional.


### Correção de fluxo de caixa — contas bancárias dinâmicas (2026-11-15)

- Revisão do modelo real do Treasury confirmou que as contas bancárias são criadas com código `bank:<uuid>` (ex.: `bank:banco_...`), enquanto as views de fluxo de caixa da migration `20261103200000_dbs_phase3_ledger_reporting_views.sql` filtravam somente `1.1.01` e `1.1.01.%`. Assim, o fluxo de caixa poderia omitir movimentos das contas bancárias efetivamente usadas pelo módulo.
- Correção aditiva no SQL: os dois filtros das views por conta passaram a incluir também `a.code like 'bank:%'`. O teste `scripts/test-phase3-ledger-reporting.cjs` agora protege esse contrato.
- Commits: `b842eb421da2d977d37c7a1ef38638f08d2e2d61` (migration) e `bd19b4dc1d5eaaa8358bc7c131f44f4c19665b96` (regressão).
- A migration ainda não foi aplicada no Supabase oficial porque a divergência do histórico remoto/local permanece em reconciliação. Nenhuma linha do Ledger, dívida, parcela, outbox ou outro dado de produção foi alterada. A correção aguarda validação CI e aplicação segura em ambiente de migração reconciliado.


### Treasury — relatório derivado do Ledger conectado à tela (2026-11-15)

- A leitura server-side de Treasury agora monta um conjunto de relatório por escopo autorizado, carregando partidas e plano de contas em blocos de até 250 IDs; inclui referências de estorno e só expõe ao relatório lançamentos com status `posted`. O acesso continua passando por `requireTreasuryReader` e pelo escopo da empresa/responsável.
- A rota `/treasury` envia o relatório ao iframe existente; a tela ganhou um painel adicional com DRE por competência e entradas/saídas de caixa pela data documental, sem remover o DRE legado.
- Parcelamentos (`installment_payment`) e estornos de parcelamento (`installment_reversal`) são excluídos das despesas operacionais do DRE; permanecem considerados nas movimentações de caixa. Não houve alteração de status, valor, histórico ou lançamento existente.
- Correção complementar: a cobertura de contas caixa reconhece tanto códigos padrão `1.1.01` quanto contas dinâmicas `bank:<id>`; a leitura de relatório inclui `reversed_entry_id` e filtra rascunhos.
- Teste `scripts/test-phase3-ledger-reporting.cjs` ampliado para verificar a migration, segurança `security_invoker`, contas dinâmicas, filtragem de lançamentos postados, passagem dos dados ao iframe e exclusão de principal de parcelamento das despesas operacionais. Verificação estática executada nesta sessão: 9/9 contratos passaram. O workflow Vercel do SHA de teste ainda estava em execução na última consulta; build READY já confirmado para o commit de integração anterior `84d25e4646770cac0c6efa95c53dcd67eaf983a4`.
- Commits desta sequência: `462d2c61ef5e55d8364477f73414897b7c5e3e8d`, `882d6fced6a029e7003420960ad6d64c5032cb50`, `36e5231f189514f7a5b40a871a51146c696ad1b0`, `84d25e4646770cac0c6efa95c53dcd67eaf983a4`, `bc30806da5ce324eb36a5c6af12dd38e02acb4a8`, `e0c7d262da059fa4e9e82e19d8d6755c00a03049`, `b1948e388871c278299401dce13982883df73bff`.
- **Ainda pendente:** a migration SQL das views não foi aplicada no Supabase oficial devido à divergência de histórico; não houve teste autenticado no iframe. Nenhuma publicação Lovable foi iniciada e o domínio oficial permanece intocado.


### Gate de build — teste de DRE/Fluxo de Caixa (2026-11-15)

- O teste `scripts/test-phase3-ledger-reporting.cjs` passou a integrar o `prebuild`, antes da checagem do Supabase oficial. Assim, qualquer build que execute `prebuild` valida os contratos do relatório Ledger e falha antes da compilação caso haja regressão.
- O painel Ledger mantém o DRE legado intacto e acrescenta uma visão derivada dos lançamentos postados, com entradas e saídas de caixa separadas. Principal de parcelamentos não é classificado como despesa operacional; continua como saída de caixa. O SQL da view DRE recebeu a mesma regra.
- Commits adicionais: `9a1951b70fe74ddb9f3b4a33c716bfd1e018de1f` (regra contábil na view), `356b5c90e69ecd37f8869d0ff4701a48c1188787` (teste), `e0f12c2d0e1e11d61f1f1e2f61f38552d31ded80` (teste no prebuild).
- A compilação do SHA `b1948e388871c278299401dce13982883df73bff` ficou `READY`; o SHA `9a1951b70fe74ddb9f3b4a33c716bfd1e018de1f` também ficou `READY`. O build do SHA `e0f12c2d0e1e11d61f1f1e2f61f38552d31ded80`, que executa o novo teste no prebuild, está em fila no momento deste registro.
- Nenhum SQL foi aplicado ao Supabase oficial. Nenhuma dívida, parcela, baixa, estorno ou lançamento existente foi alterado. Publicação Lovable não foi iniciada.

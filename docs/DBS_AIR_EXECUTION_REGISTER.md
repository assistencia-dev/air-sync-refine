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
- A última confirmação do Lovable retornou `status=ready`, `is_published=true` e SHA sincronizado `4ab6a6b9742cfe413dae98ea895dfbe67d6395a4`. Depois disso, o GitHub recebeu commits adicionais; confirmar a sincronização antes de qualquer publicação.
- O smoke test público do navegador alcançou `/login` com título Portal DBS Air e sem erro de browser. Sem credenciais E2E, isso não comprova navegação autenticada nas telas internas.

### Fase 1 — Interface e navegação

**Correções realizadas; validação autenticada pendente.**

- `src/styles.css`: removido somente o `@import` redundante do Google Fonts que causava falha do LightningCSS/Vite. O documento raiz já carrega Inter/Space Grotesk no `<head>`; as regras visuais existentes foram preservadas.
- `src/routes/_authenticated/dbs-inventory.tsx`: adicionado aviso contextual na tela existente de Compras quando faltam fornecedores, unidades, centros de custo ou vínculos mestre das peças ativas. O botão direciona a Peças & Estoque > Cadastros Básicos; nenhum módulo novo foi criado.
- `scripts/test-inventory-financial-bridge.cjs`: adicionadas asserções para esse comportamento.
- A estrutura das telas existentes de Peças & Estoque e Compras e os formulários de fornecedores/unidades/centros de custo permanecem no componente existente.

### Fase 2 — Compras e Estoque

**Fluxo transacional completo aprovado em teste com rollback; operação real depende de cadastros válidos.**

- `scripts/test-inventory-financial-bridge.integration.sql` foi ajustado para montar fornecedor, unidade, centro de custo, unidades-base das peças e centro de custo da OS somente dentro da transação de teste.
- A execução no Supabase oficial terminou com `integration_test_status = PASS` e `ROLLBACK`.
- O teste percorreu: compra em rascunho sem movimento de estoque nem AP prematuro; idempotência; aprovação financeira e obrigação no Ledger; recebimento com movimentação única por item; custo médio ponderado; pagamento parcial e saldo de AP; reserva/consumo de peça na OS; COGS; replay sem baixa duplicada; fechamento da OS e receita; sete métricas do painel.
- Consultas de contagem antes/depois confirmaram que os registros de teste não permaneceram no banco.
- **Cadastros produtivos verificados em 2026-11-15:** 0 fornecedores ativos, 0 centros de custo ativos, 1 unidade ativa, 5 peças no catálogo (1 ativa e nenhuma peça ativa vinculada a unidade-base), 3 cotações, 0 compras, 0 itens de compra, 0 recebimentos e 0 movimentos de estoque. A única unidade cadastrada tem código `C001` e nome `CORTINA DE AR VIX 150CM ONE BR`, aparentando ser um item de catálogo, não uma unidade de medida. Não corrigir nem apagar esse registro sem confirmação do dado correto.
- Portanto, a lógica de backend foi testada transacionalmente, mas ainda não foi possível comprovar um pedido de negócio real: faltam fornecedor, centro de custo, unidade de medida correta e vínculos das peças. Não inserir valores inventados em produção.

### Fase 3 — Financeiro / DBS Treasury

**Integrações contábeis do fluxo aprovadas no teste transacional; fila Outbox Treasury permanece bloqueada.**

- O teste de integração comprovou obrigações a pagar após aprovação, lançamentos balanceados, baixa parcial, COGS e receita de OS.
- Em 2026-11-15, a tabela `treasury_ledger_outbox` contém 3 eventos `treasury.ledger.posted` pendentes, todos da origem `treasury`, tipo `installment_payment`; os três lançamentos vinculados estão `posted` e balanceados (ao menos duas linhas).
- A verificação encontrou o produtor/trigger `treasury_enqueue_posted_entry()` e o monitor `treasury_ledger_health()`, mas não encontrou consumidor/worker implementado para esse evento.
- A rotina de saúde alerta corretamente os 3 eventos antigos. Não os marcar como publicados, apagar ou alterar para silenciar o alerta. Identificar o consumidor/contrato de destino antes de implementar processamento.
- O worker `dbs-control-outbox-worker` é da fila de sincronização DBS Control e não deve ser tratado como consumidor da fila Treasury.

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
- No commit `6e4b29c`: workflows foram iniciados; registrar aqui as conclusões depois de finalizarem.
- O smoke de navegador público só valida o acesso público/redirecionamento para login; não afirma que a sessão autenticada percorreu a operação.

## Bloqueios e próximos passos

1. Confirmar conclusão do CI do SHA atual e sincronização do mesmo SHA no Lovable. Não publicar automaticamente.
2. Resolver com evidência o destino/consumidor dos 3 eventos pendentes de `treasury_ledger_outbox`; não mascarar o alerta.
3. Reconciliar histórico de migrations antes de qualquer deploy de schema: a auditoria leu 134 versões aplicadas no Supabase e 125 arquivos locais, com diferenças de versionamento/nome. Isso pode refletir renumerações históricas; não renomear, reparar ou aplicar migrations em lote sem comparar o SQL armazenado em `supabase_migrations.schema_migrations.statements` com os arquivos.
4. Depois de dados mestres legítimos serem cadastrados pela operação, validar o ciclo de compra real em sessão autenticada.
5. Prosseguir para Fase 4 (visualização da OS, anexos/fotos/assinaturas/PDF e ciclo de custo), Fase 5 (sincronização, permissões, backups), Fase 6 (regressão/mobile) e Fase 7 (publicação pelo Lovable).

## Regra de atualização

Ao fechar uma tarefa, registrar problema, causa, arquivos/commit, teste executado, resultado e situação. Reabrir somente diante de evidência nova. Não repetir tentativas sem nova evidência. Não declarar tarefa concluída sem validação.

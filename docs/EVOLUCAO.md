# Evolução estrutural do DBS Air — Fase 1 (auditoria somente leitura)

> **Escopo desta fase:** documentação do repositório `assistencia-dev/air-sync-refine` e leitura de metadados do Supabase oficial `gdglototcrehvhkvcqsq`. Nenhum código funcional, tela, tabela, migration ou dado de produção foi alterado nesta fase. Este arquivo é documentação; não é autorização para executar a fase 2.

**Base examinada:** branch `main`, commit `a2394159ea87f062f55f417439776869ffb2ec98` (árvore GitHub consultada durante a auditoria).  
**Banco consultado:** projeto Supabase `gdglototcrehvhkvcqsq`, schema `public`; consultas somente de catálogo/metadados e listagem de tabelas, sem DML/DDL.  
**Limite:** a presença de código/migration no Git não prova, isoladamente, que o fluxo foi executado em produção. Quando a tabela esperada não apareceu no catálogo atual, isso é indicado explicitamente.

## A. Inventário por módulo

### A.1 RH

| Objeto | Papel / relacionamento observado | Evidência |
|---|---|---|
| `rh_employees` | Cadastro canônico e também configuração legada de benefícios; PK `id`; `registry_employee_id` autorreferencia o registro canônico; contém `benefit_type`, tarifa e viagens/dia. | `supabase/migrations/20260831190000_rh_benefits.sql`; `supabase/migrations/20260929180000_rh_central_employee_registry.sql`; `src/lib/rh.functions.ts` |
| `rh_topups` | Recargas VT/VA, FK `employee_id → rh_employees.id`, tipo, valor, data, criador. | `supabase/migrations/20260831190000_rh_benefits.sql`; `src/lib/rh.functions.ts` |
| `rh_benefit_requests`, `rh_request_attachments`, `rh_request_audit` | Solicitações de benefício, anexos e trilha da solicitação; a solicitação aponta para funcionário. | `supabase/migrations/20260831190000_rh_benefits.sql` e migrações RH subsequentes; catálogo atual Supabase; `src/lib/rh.request.admin.functions.ts` |
| `rh_departments`, `rh_positions` | Cadastros auxiliares de departamento/cargo. | `supabase/migrations/20260930200000_rh_dp_foundation.sql` |
| `rh_employee_contracts` | Contratos/salários por funcionário; FK para `rh_employees`, departamento e posição. | `supabase/migrations/20260930200000_rh_dp_foundation.sql` |
| `rh_employee_dependents`, `rh_employee_documents` | Dependentes e documentos associados ao funcionário. | `supabase/migrations/20260930200000_rh_dp_foundation.sql` |
| `rh_work_schedules`, `rh_employee_schedule_assignments` | Jornada e atribuição de jornada ao funcionário. | `supabase/migrations/20260930200000_rh_dp_foundation.sql` |
| `rh_employee_events`, `rh_audit_log` | Eventos funcionais e auditoria com ator, entidade, `before_data` e `after_data`. | `supabase/migrations/20260930200000_rh_dp_foundation.sql` |
| `rh_ponto_records`, `rh_ponto_audit` | Marcações de ponto e auditoria de ponto por funcionário/ator. | `supabase/migrations/20260916110000_rh_folha_ponto.sql`; catálogo atual Supabase |
| `rh_vacation_periods`, `rh_vacation_requests`, `rh_leave_records` | Férias e afastamentos vinculados a funcionário. | `supabase/migrations/20260930210000_rh_dp_operations.sql` |
| `rh_payroll_periods`, `rh_payroll_items`, `rh_payroll_runs`, `rh_payroll_rules` | Competência, itens, cálculo/resumo de folha e regras parametrizadas. | `supabase/migrations/20260930210000_rh_dp_operations.sql` |
| `rh_time_adjustments`, `rh_time_closures` | Ajustes e fechamento de ponto por funcionário/competência. | `supabase/migrations/20260930210000_rh_dp_operations.sql` |
| `rh_admission_processes`, `rh_termination_processes`, `rh_medical_exams`, `rh_safety_events`, `rh_employee_requests` | Processos de admissão/desligamento, exames, segurança e solicitações do colaborador. | `supabase/migrations/20260930210000_rh_dp_operations.sql` |
| `rh_employee_access`, `rh_employee_advances` | Acesso do colaborador e vales/adiantamentos/descontos associados ao funcionário. | `supabase/migrations/20260929120000_rh_employee_access.sql`; `supabase/migrations/20261002150000_rh_employee_advance_request_link.sql`; `src/lib/rh.finance.functions.ts` |

**Observação de identidade:** a migration `20260929180000_rh_central_employee_registry.sql` cria a relação canônica por `registry_employee_id), mas mantém linhas antigas e configurações de VT/VA na própria `rh_employees`. O código filtra registros canônicos em algumas consultas e configura benefícios em registros associados. Portanto, a regra “uma pessoa = um cadastro mestre” está parcialmente implementada por vínculo, não por uma separação física completa de cadastros.

### A.2 DBS Control / OS

| Objeto | Papel / relacionamento observado | Evidência |
|---|---|---|
| `dbs_control_clients`, `dbs_control_sites`, `dbs_control_equipment`, `dbs_control_service_catalog` | Clientes → locais → equipamentos; catálogo de serviços. | `supabase/migrations/20260930170000_dbs_control_core.sql` |
| `dbs_control_work_orders` | OS; relaciona cliente, local, serviço e funcionário atribuído. | `supabase/migrations/20260930170000_dbs_control_core.sql`; `supabase/migrations/20261017000000_dbs_control_relational_os_guard.sql` |
| `dbs_control_work_order_equipment`, `dbs_control_work_order_parts`, `dbs_control_work_order_services` | Relações de OS com equipamentos, peças e serviços. | `supabase/migrations/20260930170000_dbs_control_core.sql`; `supabase/migrations/20261031040330_dbs_control_inventory_financial_bridge.sql` |
| `dbs_control_work_order_events`, `dbs_control_work_order_attachments`, `dbs_control_work_order_status_catalog` | Eventos/auditoria operacional, anexos e catálogo de status. | `supabase/migrations/20261027130001_enterprise_indexes_and_status_catalog.sql`; `supabase/migrations/20261027130004_execution_evidence_columns.sql` |
| `dbs_control_work_order_financials` | Uma linha por OS (restrição UNIQUE), receita, custo de peças e referência ao lançamento de receita no Treasury. | `supabase/migrations/20261031040330_dbs_control_inventory_financial_bridge.sql` |
| `dbs_control_bases`, `dbs_control_base_clients` | Bases operacionais e associação base/cliente; RH liga funcionário à base. | `supabase/migrations/20261026180000_dbs_control_bases_issue_scope.sql`; `src/lib/rh.functions.ts` |
| `dbs_control_snapshots`, `dbs_control_snapshot_history` | Compatibilidade/snapshot e histórico de revisões. | `supabase/migrations/20260930190000_dbs_control_cloud_snapshots.sql`; `supabase/migrations/20261018190000_dbs_control_snapshot_history_optimistic_guard.sql` |
| `dbs_control_sync_commands`, `dbs_control_outbox`, `dbs_control_outbox_dlq`, `dbs_control_sync_runs`, `dbs_control_sync_metrics`, `dbs_control_entity_records`, `dbs_control_legacy_id_map` | Comandos idempotentes/versionados, Outbox, DLQ, métricas, registros de entidade e compatibilidade legada. | `supabase/migrations/20261026130000_dbs_control_delta_outbox.sql`; `supabase/migrations/20261027130002_enterprise_security_and_outbox_dlq.sql`; `src/lib/dbs-control.functions.ts`; `supabase/functions/dbs-control-outbox-worker/index.ts` |

### A.3 Compras e Estoque

| Objeto | Papel / relacionamento observado | Evidência |
|---|---|---|
| `dbs_control_parts` | Catálogo de peças, SKU, quantidade física, custo e quantidade reservada. | `supabase/migrations/20260930170000_dbs_control_core.sql`; `supabase/migrations/20261031040330_dbs_control_inventory_financial_bridge.sql` |
| `dbs_control_purchases`, `dbs_control_purchase_items` | Compra registrada, fornecedor, itens, peça, quantidade e custo. | `supabase/migrations/20261031040330_dbs_control_inventory_financial_bridge.sql` |
| `dbs_control_inventory_movements` | Livro de movimentos de estoque com tipo, quantidade, saldo, custo, compra/OS e chave idempotente. | `supabase/migrations/20261031040330_dbs_control_inventory_financial_bridge.sql` |
| `dbs_control_inventory_commands`, `dbs_control_inventory_outbox` | Comandos de estoque e eventos de integração. | `supabase/migrations/20261031051656_dbs_control_inventory_idempotency_guard.sql`; `supabase/migrations/20261031040330_dbs_control_inventory_financial_bridge.sql` |
| `dbs_control_work_order_reservations`, `dbs_control_reservation_batches`, `dbs_control_reservation_consumptions` | Reserva por OS/peça, lote e consumo efetivo, com idempotência. | `supabase/migrations/20261103180000_dbs_phase2_sales_reservations.sql` |
| `dbs_purchase_orders`, `dbs_purchase_order_items`, `dbs_inventory_receipts`, `dbs_inventory_receipt_items` | Modelo novo de pedido e recebimento parcial item a item descrito no Git. **NÃO ENCONTRADO no catálogo atual do projeto Supabase consultado.** | Definidos em `supabase/migrations/20261103090000_dbs_purchase_orders_partial_receipts.sql`; ausência confirmada na listagem atual de tabelas `public`. |

### A.4 Financeiro / DBS TREASURY

| Objeto | Papel / relacionamento observado | Evidência |
|---|---|---|
| `treasury_accounts` | Plano de contas por escopo/empresa, código único por escopo e tipo contábil. | `supabase/migrations/20261027153849_treasury_ledger_additive.sql` |
| `treasury_ledger_entries` | Cabeçalho do lançamento, competência, origem, estado, idempotência e vínculo de estorno. | Mesma migration |
| `treasury_ledger_lines` | Partidas débito/crédito por lançamento e conta; FK com RESTRICT. | Mesma migration |
| `treasury_ledger_outbox` | Eventos de lançamentos postados, chave idempotente. | Mesma migration |
| `treasury_snapshots` | Estado legado/compatibilidade por escopo, lido junto do razão relacional. | `supabase/migrations/20260929074800_treasury_server_persistence.sql`; `src/lib/treasury.functions.ts` |
| `treasury_viewer_access` | Relação entre usuário proprietário e usuário com acesso de leitura. | `supabase/migrations/20261013123000_treasury_viewer_access.sql` |

## B. Funções, RPCs, triggers e Edge Functions

### B.1 Funções/RPCs identificadas no banco atual

| Função/RPC | Responsabilidade observada | Origem versionada |
|---|---|---|
| `post_treasury_ledger_entry(...)` | Cria lançamento e partidas com chave idempotente; chamado pelo código Treasury e fluxos de compra/OS. | `supabase/migrations/20261027155816_treasury_ledger_command_rpc.sql`; `src/lib/treasury.functions.ts` |
| `treasury_assert_entry_balanced()` | Impede lançamento postado/revertido sem débitos e créditos iguais. | `supabase/migrations/20261027153849_treasury_ledger_additive.sql` |
| `treasury_block_posted_line_mutation()` | Bloqueia alteração/exclusão de partidas de lançamentos postados/revertidos. | Mesma migration |
| `treasury_enqueue_posted_entry()` | Enfileira lançamento postado no Outbox do Treasury. | Mesma migration |
| `treasury_ledger_health()` | Saúde/conciliação do ledger. | `supabase/migrations/20261027162135_treasury_ledger_health_rpc.sql` |
| `dbs_control_register_purchase(jsonb)` | Registra compra e gera obrigação no Ledger (estoque em trânsito x fornecedores). | `supabase/migrations/20261105125808_dbs_control_purchase_register_and_receipt_lifecycle.sql` |
| `dbs_control_receive_registered_purchase(uuid,uuid,text)` | Recebe compra registrada, movimenta estoque e reclassifica estoque em trânsito para estoque de peças. | Mesma migration |
| `dbs_process_purchase_receipt(jsonb)` | Recebimento parcial por item; atualiza quantidade/custo e registra entrada contábil. | `supabase/migrations/20261103090000_dbs_purchase_orders_partial_receipts.sql` (**migration existe no Git; tabelas correspondentes não foram encontradas no catálogo atual**) |
| `dbs_control_reserve_work_order_parts(...)`, `dbs_control_consume_work_order_reservations(...)`, `dbs_control_release_work_order_reservation(...)` | Reserva, consumo e liberação de peças por OS. | `supabase/migrations/20261103180000_dbs_phase2_sales_reservations.sql` |
| `dbs_control_reconcile_work_order_financials(...)`, `dbs_control_reconcile_work_order_parts_cost()` | Reconciliação do custo/financeiro de OS. | `supabase/migrations/20261031040330_dbs_control_inventory_financial_bridge.sql`; `supabase/migrations/20261105135208_dbs_inventory_scope_sku_and_financial_reconciliation.sql` |
| `dbs_control_inventory_financial_overview(...)`, `dbs_control_inventory_health()` | Visão financeira/saúde de estoque. | `supabase/migrations/20261105135208_dbs_inventory_scope_sku_and_financial_reconciliation.sql` |
| `dbs_control_apply_work_order_delta(...)`, `process_work_order_update(...)` | Atualização relacional/delta de OS e compatibilidade legada. | `supabase/migrations/20261026130000_dbs_control_delta_outbox.sql`; `supabase/migrations/20260930170000_dbs_control_core.sql` |
| `rh_set_updated_at()` | Atualiza `updated_at` em tabelas RH. | `supabase/migrations/20260831190000_rh_benefits.sql` e migrations RH aditivas |
| `set_treasury_snapshot_updated_at()`, `treasury_ledger_set_updated_at()` | Atualização de timestamps/versão Treasury. | `supabase/migrations/20260929074800_treasury_server_persistence.sql`; `supabase/migrations/20261027153849_treasury_ledger_additive.sql` |

A lista acima contém as funções relevantes retornadas pelo catálogo atual, não todas as funções internas do banco. Outras funções de segurança e sincronização estão definidas em migrations de hardening e DBS Control; não são reproduzidas aqui para evitar inferir responsabilidades sem revisão individual de cada corpo.

### B.2 Triggers relevantes observados

| Trigger → tabela | Função executada | Origem |
|---|---|---|
| `rh_employees_updated_at` → `rh_employees` | `rh_set_updated_at()` | `supabase/migrations/20260831190000_rh_benefits.sql` |
| `rh_benefit_requests_updated_at`, `rh_employee_access_updated_at`, `rh_employee_advances_updated_at` | `rh_set_updated_at()` | Migrations RH; catálogo atual |
| `treasury_entry_balance_check` → `treasury_ledger_entries` | `treasury_assert_entry_balanced()` | `supabase/migrations/20261027153849_treasury_ledger_additive.sql` |
| `treasury_posted_line_guard` → `treasury_ledger_lines` | `treasury_block_posted_line_mutation()` | Mesma migration |
| `treasury_posted_outbox` → `treasury_ledger_entries` | `treasury_enqueue_posted_entry()` | Mesma migration |
| `trg_dbs_control_inventory_outbox` → `dbs_control_inventory_movements` | `dbs_control_enqueue_inventory_outbox()` | `supabase/migrations/20261031040330_dbs_control_inventory_financial_bridge.sql` |
| `trg_dbs_control_reconcile_work_order_parts_cost` → `dbs_control_work_order_financials` | `dbs_control_reconcile_work_order_parts_cost()` | `supabase/migrations/20261031040330_dbs_control_inventory_financial_bridge.sql` |
| `trg_dbs_control_work_order_financial_lifecycle` → `dbs_control_work_orders` | `dbs_control_work_order_financial_lifecycle()` | `supabase/migrations/20261031040330_dbs_control_inventory_financial_bridge.sql` |
| `trg_dbs_control_work_orders_outbox` → `dbs_control_work_orders` | `dbs_control_enqueue_outbox()` | `supabase/migrations/20261026130000_dbs_control_delta_outbox.sql` |
| `trg_dbs_control_snapshot_history` → `dbs_control_snapshots` | `dbs_control_archive_snapshot_revision()` | `supabase/migrations/20261018190000_dbs_control_snapshot_history_optimistic_guard.sql` |

O catálogo atual retornou triggers duplicados em algumas linhas por evento/visão de metadados; a tabela acima os apresenta por nome, sem contar duplicidade de retorno como duplicação real do trigger.

### B.3 Edge Functions

- **Encontrada:** `supabase/functions/dbs-control-outbox-worker/index.ts` — worker para processar a Outbox do DBS Control. Workflow de execução: `.github/workflows/dbs-control-outbox-worker.yml`.
- **Edge Functions específicas de RH, benefícios ou Treasury:** **NÃO ENCONTRADO** no diretório `supabase/functions/` da árvore examinada.
- O processamento de VT/VA e funções do Treasury identificados nesta auditoria são Server Functions TanStack Start em `src/lib/rh.functions.ts`, `src/lib/rh.finance.functions.ts` e `src/lib/treasury.functions.ts`, não Edge Functions.

## C. Permissões por perfil (RLS e RBAC)

### C.1 Papéis de aplicação

O enum `role_key` observado no banco contém: `SUPER_ADMIN`, `ADMIN_OPERACIONAL`, `GESTOR_CONTA`, `GESTOR_REGIONAL`, `CLIENTE_PF`, `COLABORADOR`, `FINANCEIRO_LEITURA`. Evidência: catálogo atual Supabase e migrations de segurança `supabase/migrations/20260930180000_security_hardening.sql`, `supabase/migrations/20261027130005_rls_policy_consolidation.sql`.

### C.2 Regras de aplicação observadas no código

- RH de benefícios exige operador nativo: `SUPER_ADMIN` ou `ADMIN_OPERACIONAL`, ou usuários nativos específicos `DBS123` / `DBSASSISTENCIA123`. Evidência: `src/lib/rh.functions.ts`, helper `requireNativeOperator`.
- Operações de adiantamento/vale de folha exigem `SUPER_ADMIN` ou `ADMIN_OPERACIONAL`, ou usuário nativo. Evidência: `src/lib/rh.finance.functions.ts`, helper `requireRhOperator`.
- Server Functions do Treasury atualmente exigem `SUPER_ADMIN`. Evidência: `src/lib/treasury.functions.ts`, helper `requireTreasuryUser`.
- O leitor do Treasury tem controle de acesso separado por vínculo de usuário. Evidência: `supabase/migrations/20261013123000_treasury_viewer_access.sql` e `supabase/migrations/20261013120000_treasury_readonly_role.sql`.
- O SSO para o sistema externo de passagem é restrito a usuários nativos ativos. Evidência: `src/lib/vale-passage.functions.ts`.

### C.3 RLS observado no banco atual

- As tabelas de RH listadas na seção A estão com RLS habilitado no catálogo consultado. A migration inicial de benefícios cria políticas `rh_employees_no_direct_access` e `rh_topups_no_direct_access` negando acesso direto a `authenticated`; as Server Functions usam o cliente administrativo no servidor. Evidência: `supabase/migrations/20260831190000_rh_benefits.sql`, `src/lib/rh.functions.ts`.
- As tabelas operacionais internas do DBS Control, comandos, Outbox, DLQ, movimentos e compras têm políticas de serviço em várias migrations; o escopo de OS para administrador/colaborador é detalhado em `supabase/migrations/20261026160010_dbs_control_collaborator_independent_access.sql`, `supabase/migrations/20261026160020_dbs_control_private_employee_scope.sql` e `supabase/migrations/20261027130005_rls_policy_consolidation.sql`.
- O Treasury restringe leitura/escrita de contas e lançamentos por papel e tem políticas específicas de visualização. Evidência: `supabase/migrations/20261027162711_treasury_ledger_security_grants.sql`, `supabase/migrations/20261013123000_treasury_viewer_access.sql`.
- **Atenção:** `src/lib/rh.functions.ts` e `src/lib/treasury.functions.ts` usam `supabaseAdmin` no servidor. Nesse caminho, a proteção efetiva depende também dos guards de aplicação e das grants/RPCs; RLS sozinho não substitui os guards. Não foi feita tentativa de acesso com cada perfil nesta fase.

## D. Respostas objetivas (REAL / VISUAL / NÃO EXISTE)

Os rótulos significam: **REAL** = regra/estrutura executável encontrada em código/banco; **VISUAL** = evidência limitada à interface/cálculo cliente; **NÃO EXISTE** = não encontrado na implementação examinada. Quando o código existe mas o schema de produção consultado diverge, a divergência é explicitada.

1. **Uma recarga de vale-transporte gera lançamento no Financeiro? — NÃO EXISTE.** `createRhTopup` insere somente em `rh_topups`; não chama RPC Treasury nem cria vínculo com `treasury_ledger_entries`. Evidência: `src/lib/rh.functions.ts`, `supabase/migrations/20260831190000_rh_benefits.sql`. Não foi encontrada FK entre `rh_topups` e o Ledger.
2. **É possível editar e cancelar recarga? Fica histórico do valor anterior? — NÃO EXISTE (edição) / REAL (exclusão física disponível).** Não há função de edição de recarga. `deleteRhTopup` executa DELETE físico em `rh_topups`; não registra valor anterior/novo em `rh_audit_log`. Evidência: `src/lib/rh.functions.ts`. A tela apresenta histórico/listagem, mas isso não constitui trilha de auditoria: `src/components/RhBenefitPanel.tsx`.
3. **Existe cadastro de vale-alimentação com histórico? — REAL, com limitação.** VT e VA usam `rh_employees` com `benefit_type` e `rh_topups` com `benefit_type`; a mesma tela compartilhada lista recargas. Não há evidência de histórico de alterações de cada recarga nem de integração contábil. Evidência: `supabase/migrations/20260831190000_rh_benefits.sql`, `src/lib/rh.functions.ts`, `src/components/RhBenefitPanel.tsx`.
4. **É possível ver quanto foi gasto de passagem por funcionário, por mês? — VISUAL (parcial).** A interface soma recargas do mês corrente em `totalMonth`, mas o cálculo examinado é total agregado da lista carregada; não há consulta/relatório histórico por funcionário e competência. Evidência: `src/components/RhBenefitPanel.tsx`. A tabela `rh_topups` permite agrupar por funcionário/data, mas o relatório não foi encontrado.
5. **Uma compra recebida gera entrada no estoque? Gera conta a pagar? — REAL, no fluxo relacional registrado; há mais de um caminho.** `dbs_control_register_purchase` gera lançamento no Treasury em estoque em trânsito x fornecedores; `dbs_control_receive_registered_purchase` atualiza `dbs_control_parts`, cria movimento `receipt` e reclassifica o valor para estoque de peças. Evidência: `supabase/migrations/20261105125808_dbs_control_purchase_register_and_receipt_lifecycle.sql`. Também há caminho alternativo `dbs_process_purchase_receipt` na migration de recebimento parcial, mas suas tabelas específicas não aparecem no catálogo atual. A implementação de compra registrada não prova por si só que cada tela está usando o RPC correto.
6. **Recebimento parcial é tratado por item? — NÃO EXISTE no schema atual consultado; REAL no código/migration versionado, não confirmado implantado.** A migration `20261103090000_dbs_purchase_orders_partial_receipts.sql` define quantidade recebida por item e RPC `dbs_process_purchase_receipt`; as tabelas `dbs_purchase_orders`, `dbs_purchase_order_items`, `dbs_inventory_receipts`, `dbs_inventory_receipt_items` não foram encontradas na listagem atual do projeto Supabase. O fluxo implantado `dbs_control_receive_registered_purchase` recebe a compra inteira e agrupa por peça, não oferece parcial por item.
7. **O custo médio do estoque é calculado? Como? — REAL.** As funções de recebimento atualizam custo médio ponderado: `((saldo_anterior × custo_anterior) + (quantidade_recebida × custo_unitário)) / novo_saldo`, arredondado para centavos. Evidência: `supabase/migrations/20261105125808_dbs_control_purchase_register_and_receipt_lifecycle.sql` e `supabase/migrations/20261103090000_dbs_purchase_orders_partial_receipts.sql`. Confirmado no código SQL versionado; parcial por item não está confirmado implantado.
8. **O consumo de peça em OS baixa o estoque e entra no custo da OS? — REAL, com ressalvas.** Existem reservas sem baixa física, consumo efetivo, movimentos `consume`, tabela `dbs_control_work_order_financials` e RPCs de consumo/reconciliação. Evidência: `supabase/migrations/20261031040330_dbs_control_inventory_financial_bridge.sql`, `supabase/migrations/20261103180000_dbs_phase2_sales_reservations.sql`. A reserva não baixa o estoque; o consumo é o evento que efetiva a baixa. É necessário testar ponta a ponta antes de afirmar que todas as rotas/telas usam o fluxo canônico.
9. **Existe trilha de auditoria (quem, quando, valor anterior/novo)? — REAL, mas fragmentada e incompleta por domínio.** RH tem `rh_audit_log` com `actor_user_id`, `before_data`, `after_data`; ponto tem `rh_ponto_audit`; OS tem eventos; Treasury mantém autor, postador, data e imutabilidade de partidas postadas. Entretanto, a recarga `rh_topups` não é auditada pelo código atual e pode ser fisicamente apagada. Evidência: `supabase/migrations/20260930200000_rh_dp_foundation.sql`, `src/lib/rh.functions.ts`, `supabase/migrations/20261027153849_treasury_ledger_additive.sql`.

## E. Riscos e pontos de atenção

1. **Delete físico de recarga:** `deleteRhTopup` chama `.delete()` diretamente em `rh_topups`; risco de perder histórico e divergência com relatórios futuros. Arquivo: `src/lib/rh.functions.ts`.
2. **Configuração de benefícios dentro do cadastro mestre:** `rh_employees` guarda registros canônicos e registros por tipo de benefício ligados por `registry_employee_id`. É uma estratégia de compatibilidade, mas abre espaço para linhas paralelas e exige filtros consistentes. Arquivos: `supabase/migrations/20260929180000_rh_central_employee_registry.sql`, `src/lib/rh.functions.ts`.
3. **Recarga sem integração financeira:** `createRhTopup` não gera lançamento Treasury; RH e Financeiro podem divergir. Arquivo: `src/lib/rh.functions.ts`.
4. **VA e VT compartilham estrutura e interface:** isso simplifica o cadastro, mas regras de cálculo/competência, comprovantes e relatórios específicos precisam ser formalizados. Arquivos: `src/components/RhBenefitPanel.tsx`, `src/lib/rh.functions.ts`.
5. **Relatório mensal insuficiente:** soma da tela usa mês/ano atuais e não é relatório histórico por colaborador/competência. Arquivo: `src/components/RhBenefitPanel.tsx`.
6. **Dois modelos de compras coexistem:** `dbs_control_purchases` + itens (fluxo registrado/recebido inteiro) e `dbs_purchase_orders` + recebimentos parciais (migration no Git, tabelas não encontradas no banco consultado). Risco de telas/RPCs usarem caminhos diferentes. Arquivos: `supabase/migrations/20261031040330_dbs_control_inventory_financial_bridge.sql`, `supabase/migrations/20261103090000_dbs_purchase_orders_partial_receipts.sql`, `supabase/migrations/20261105125808_dbs_control_purchase_register_and_receipt_lifecycle.sql`.
7. **Outbox e ledger são mecanismos distintos:** o DBS Control tem sua Outbox operacional e o Treasury tem `treasury_ledger_outbox`. Não devem ser confundidos nem fundidos sem desenho explícito. Evidência: migrations de Outbox e `20261027153849_treasury_ledger_additive.sql`.
8. **Auditoria não é uniforme:** RH registra before/after em funções específicas; nem toda operação encontrada registra esses campos. Exemplo concreto: recarga não grava auditoria. Arquivos: `src/lib/rh.functions.ts`, `supabase/migrations/20260930200000_rh_dp_foundation.sql`.
9. **Acesso privilegiado no servidor:** Server Functions usam `supabaseAdmin`; falha/ausência de guard em qualquer função pode contornar políticas de RLS. Arquivos: `src/lib/rh.functions.ts`, `src/lib/rh.finance.functions.ts`, `src/lib/treasury.functions.ts`.
10. **Divergência migration ↔ banco:** objetos de recebimento parcial descritos em `20261103090000_dbs_purchase_orders_partial_receipts.sql` não aparecem no catálogo consultado. A migration não deve ser reaplicada nem “corrigida” automaticamente; primeiro comparar histórico de migrations remoto/local e confirmar estado real.
11. **Exclusão em outras áreas:** há soft-delete em OS via `deleted_at` e em solicitações/anexos via `is_deleted` em migrations próprias; o catálogo mostra políticas DELETE restritas a `service_role` em tabelas internas. O delete físico identificado diretamente no código desta auditoria é o de `rh_topups`; em `src/lib/rh.functions.ts`, `setDbsControlBaseClients` também remove e recria vínculos base/cliente para substituir a seleção atual (não é exclusão de OS/estoque/financeiro).
12. **CMP e arredondamento:** custo médio é calculado em centavos inteiros e arredondado; devem ser definidos testes de precisão, frete/desconto/impostos e saldo zero/negativo antes de ampliar relatórios. Evidência: migrations de recebimento acima.

## F. Plano proposto por fase (não executar nesta fase)

1. **VT — histórico e controle confiável:** manter `rh_employees` como cadastro mestre; modelar recarga como evento rastreável; edição por retificação/estorno + novo registro, sem DELETE físico; guardar ator, instante, competência, valor anterior/novo, comprovante, origem e chave idempotente; relatório por colaborador/mês/ano.
2. **Integração RH → Treasury:** definir evento financeiro e contas contábeis para benefícios; gerar partidas balanceadas no razão, idempotentes por recarga/retificação; conciliar RH x Ledger; não lançar novamente ao reprocessar.
3. **VA:** aplicar o mesmo padrão de histórico, competência, cálculo e auditoria, com regras próprias de elegibilidade/dias/valor; separar relatório de VT e VA.
4. **Compras → Estoque → Financeiro:** decidir formalmente qual modelo de pedido/recebimento será canônico; reconciliar migration Git x schema real antes de qualquer aplicação; receber parcial por item; criar movimento por linha recebida; gerar/reclassificar obrigação e estoque no Treasury sem duplicidade.
5. **Custo de OS:** garantir ciclo reserva → consumo efetivo → movimento de estoque → custo da OS → lançamento contábil quando aplicável; estorno em devolução/cancelamento; idempotência e conciliação com `dbs_control_work_order_financials`.
6. **Produtividade:** consolidar funcionário canônico, OS atribuídas/concluídas, tempo, complexidade, retrabalho e qualidade; não ranquear só por quantidade; respeitar escopo de acesso e contexto de cada equipe.

**Gate obrigatório entre fases:** especificação de regra de negócio, mapa de dados e migração aditiva proposta; revisão do usuário; testes em ambiente não produtivo; validação de idempotência, RLS/RBAC, conciliação e regressão. Nenhuma migration ou DML em produção sem aprovação explícita.

## G. STATUS

- **Fase atual:** Fase 1 — leitura e documentação.
- **Concluído:** árvore do repositório e commit base identificados; inventário de tabelas consultado no Supabase oficial; metadados de funções, triggers, RLS/policies consultados; fluxos RH/benefícios, Treasury, compras, estoque e OS revisados nos arquivos citados; diferenças relevantes entre migration e schema atual registradas; este documento criado.
- **Decisões tomadas:** nenhuma alteração de código funcional, tela, tabela, migration ou dado; nenhuma alteração na sincronização DBS Control/Outbox; `rh_employees` permanece a fonte canônica de identidade; correções financeiras futuras devem ocorrer por estorno e novo lançamento; razão Treasury permanece de dupla entrada e imutável após postagem.
- **Pendências:** validar visualmente todos os fluxos de compra e RH com usuários/perfis; conferir histórico remoto de migrations e a divergência de recebimento parcial; testar os fluxos ponta a ponta em ambiente isolado; confirmar política/role exata para cada tabela e função com matriz de testes de acesso; revisar todos os corpos de funções de segurança não detalhados neste inventário.
- **Fase 2:** **NÃO INICIADA — aguarda aprovação explícita do usuário.**
- **Produção:** nenhuma escrita de aplicação, alteração de schema, migration, recarga, compra, estoque ou lançamento financeiro foi executada nesta auditoria.


---

## Fase 2 — Vale-Transporte (em desenvolvimento / aguardando validação)

**Branch de trabalho:** `feat/rh-vt-auditavel-fase2`  
**Base:** `main`  
**Escopo autorizado:** exclusivamente VT. VA, Financeiro/Treasury, Compras, Estoque e DBS Control permanecem fora do escopo.

### Decisões confirmadas
- Identificador central do funcionário: `public.rh_employees.id`.
- `rh_employees.employee_id`: **NÃO EXISTE** no schema consultado.
- `rh_employees.registry_employee_id` mantém a ligação com o cadastro canônico legado.
- Competência padrão: mês da data da recarga.
- Nenhuma migration foi aplicada ao Supabase; nenhuma gravação em produção foi executada.

### Implementação preparada na branch
- `supabase/migrations/20261109140000_rh_vt_auditable_phase2.sql`: estrutura aditiva de configuração VT, recargas, auditoria imutável, funções transacionais para lote/edição/cancelamento e chave reservada de integração futura com Treasury.
- `src/lib/rh.vt.functions.ts`: Server Functions com autorização de operador nativo, configuração, consulta, lote, edição, cancelamento e leitura da auditoria.
- `src/components/RhVtPanel.tsx`: interface específica de VT.
- `src/components/RhBenefitPanel.tsx`: roteia apenas VT para a interface nova; VA continua no componente e fluxo existentes.
- A migration preserva o histórico de `rh_topups` do tipo `passagem` por cópia aditiva para a nova estrutura, mantendo a tabela original intacta e registrando a origem histórica.

### Limites ainda pendentes antes de considerar a fase concluída
- CI da branch executado em 09/11/2026: `Validate`, `verificar` e `DBS Control smoke validation` concluíram com sucesso no SHA de código `19a6d98db77df680f95a9fb8fccf4523c8524003`; lint, build, TypeScript e testes automatizados incluídos nesses workflows passaram.
- Validar o SQL em banco de desenvolvimento/staging antes de qualquer aplicação em produção; a CI atual validou o nome da migration, não executou o DDL em banco.
- Upload de comprovante foi ligado ao bucket privado existente `rh-files`; falta validar o ciclo de consulta/download do arquivo e as permissões reais de acesso.
- Filtros por funcionário, mês/ano e totais por empresa foram adicionados à interface; falta teste funcional com dados reais após migração.
- Criação individual/em lote, edição e cancelamento possuem chaves de idempotência; falta exercitar reenvios concorrentes e retries em teste funcional após a migration.

**STATUS: CÓDIGO DA FASE 2 PREPARADO E CI VERDE — AINDA NÃO LIBERADO.** PR #148 permanece em draft. Não fazer merge, não publicar e não aplicar a migration em produção. Aguardar validação SQL em ambiente de desenvolvimento, teste funcional do fluxo completo e aprovação explícita para qualquer alteração no Supabase.


---

## Fase 3 — Integração de Vale-Transporte ao DBS TREASURY V10

### Decisão contábil confirmada
- Regime de competência: recarga ativa reconhece **Débito 3.1.02.01 — Despesas com Vale-Transporte** e **Crédito 2.1.02.01 — Vale-Transporte a Pagar**.
- Pagamento efetivo da obrigação permanece operação posterior da Tesouraria: débito em VT a Pagar e crédito na conta bancária/caixa escolhida no fluxo de liquidação.
- Edição: estorno integral do lançamento anterior e novo lançamento com o valor/competência atualizados.
- Cancelamento: estorno integral do lançamento ativo.
- Nunca alterar ou excluir partidas postadas; o lançamento de estorno referencia o original em `treasury_ledger_entries.reversed_entry_id`.

### Implementação preparada na branch `feat/rh-vt-financeiro-fase3`
- Dependência: branch `feat/rh-vt-auditavel-fase2` / PR #148. Esta fase não deve ser integrada diretamente em `main` antes da Fase 2.
- `supabase/migrations/20261109160000_rh_vt_treasury_integration_phase3.sql`:
  - Acrescenta os vínculos `financial_entry_id`, `financial_reversal_entry_id` e revisão financeira à tabela de recargas criada na Fase 2.
  - Cria trilha append-only `rh_vt_financial_events`.
  - Aciona a RPC canônica `post_treasury_ledger_entry(...)` dentro da transação da recarga; a RPC existente continua responsável por validar partidas equilibradas e publicar no Outbox próprio do Treasury.
  - Identifica origem `source_module='rh'` e metadados da recarga/funcionário/centro de custo. Não utiliza nem altera a Outbox ou sincronização do DBS Control.
  - Gera contas por escopo a partir dos códigos confirmados, apenas quando ausentes; se o mesmo código já existir com nome, tipo ou estado incompatível, interrompe a transação em vez de reclassificar silenciosamente o plano de contas.
  - Reenvios usam chave `RH_VT_RECHARGE_{recharge_id}_{status}`; edições recebem sufixo de revisão para permitir vários ajustes independentes sem colisão.
  - Inclui RPC de conciliação RH × Treasury por funcionário e competência; diferença é exibida, nunca corrigida automaticamente.
  - Habilita RLS e revoga acesso direto de `anon`/`authenticated` à trilha financeira; operações permanecem no caminho server-side com `service_role`, respeitando o modelo de acesso restrito já usado pela Fase 2.
- `src/lib/rh.vt.functions.ts`: adiciona leitura server-side do relatório de conciliação.
- `src/components/RhVtPanel.tsx`: adiciona totais RH/Treasury, diferença e detalhamento por funcionário/competência.

### Segurança e limites
- Nenhuma migration foi aplicada no Supabase oficial `gdglototcrehvhkvcqsq`.
- Nenhum lançamento, conta contábil ou dado de teste foi criado em produção.
- Nenhum lançamento financeiro existente foi alterado; nenhuma partida foi excluída.
- Histórico legado importado na Fase 2 não é postado retroativamente de forma automática. Se estiver ativo e não tiver vínculo financeiro, aparecerá como divergência na conciliação para regularização explícita.
- A liquidação bancária de VT a pagar não é criada nesta fase; será feita no fluxo normal de pagamento do Treasury, sem antecipar saída de caixa.

### Roteiro de validação obrigatório antes de liberar
Usar banco de desenvolvimento isolado e funcionários/empresas de teste, nunca produção:
1. **Criar:** recarga de R$ 100,00 na competência 2026-11. Esperado: 1 lançamento postado, débito 3.1.02.01 = 10.000 centavos, crédito 2.1.02.01 = 10.000 centavos, origem RH e centro de custo correto.
2. **Reenviar:** repetir a mesma operação/chave. Esperado: mesmo `entry_id`, `replayed=true`, total de lançamentos continua 1 para a criação.
3. **Editar:** alterar R$ 100,00 para R$ 120,00. Esperado: 1 estorno de R$ 100,00 (débito VT a pagar / crédito despesa) + 1 novo lançamento de R$ 120,00; total 3 lançamentos no ciclo; saldo líquido de despesa = R$ 120,00.
4. **Reenviar edição:** repetir a mesma chave de operação. Esperado: sem novo estorno ou lançamento; total continua 3.
5. **Cancelar:** cancelar a recarga editada. Esperado: 1 estorno de R$ 120,00; total 4 lançamentos; saldo líquido de despesa = R$ 0,00; histórico e partidas originais preservados.
6. **Reenviar cancelamento:** repetir a mesma chave. Esperado: total continua 4.
7. **Conciliação:** testar uma recarga ativa e uma recarga legada sem lançamento. Esperado: valores RH e Treasury separados e divergência sinalizada; nenhuma correção automática.
8. **Concorrência:** duas requisições simultâneas com a mesma chave. Esperado: apenas um lançamento por chave, sem duplicidade de Outbox Treasury.
9. **Segurança:** usuário sem perfil operador não acessa a RPC/relatório; tabelas novas sem acesso direto por `authenticated`; confirmar RLS/grants e executar Supabase Advisors.

**STATUS FASE 3: CÓDIGO E MIGRATION PREPARADOS NA BRANCH DE DESENVOLVIMENTO — NÃO VALIDADO EM BANCO, NÃO MERGEADO E NÃO APLICADO.** Aguardar CI, revisão SQL em staging e testes funcionais numerados acima. Não publicar nem aplicar em produção.

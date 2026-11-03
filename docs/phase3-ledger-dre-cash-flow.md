# Fase 3 — DRE e Fluxo de Caixa derivados do Ledger

## Escopo implementado

Migration aditiva: `20261103200000_dbs_phase3_ledger_reporting_views.sql`.

Views criadas:
- `treasury_vw_dre_competence_by_account`: DRE por mês de competência e conta contábil.
- `treasury_vw_dre_competence`: consolidado mensal de receita, despesas e resultado líquido.
- `treasury_vw_cash_flow_monthly_by_account`: fluxo mensal por conta caixa/bancos.
- `treasury_vw_cash_flow_monthly`: fluxo mensal consolidado por escopo.

## Regras contábeis

- Fonte exclusiva: `treasury_ledger_entries`, `treasury_ledger_lines` e `treasury_accounts`.
- Somente lançamentos com status `posted` entram nos relatórios. Lançamentos originais revertidos deixam de compor os totais; seus lançamentos compensatórios postados permanecem.
- DRE usa `competence_date`, agregada por mês.
- Receita é crédito menos débito nas contas `account_type='revenue'`.
- Despesa é débito menos crédito nas contas `account_type='expense'`.
- Resultado líquido = receita - despesas.
- Fluxo de caixa usa contas de ativo com código `1.1.01` (e subcontas `1.1.01.*`); entradas são débitos e saídas são créditos.
- Período de caixa usa `document_date`, com fallback para `competence_date` quando a data documental não estiver preenchida.
- Saldos de abertura/fechamento são acumulados a partir do primeiro movimento postado presente no Ledger para o escopo/conta.

## Segurança e performance

- Views usam `security_invoker=true`, respeitando as políticas RLS das tabelas de origem no PostgreSQL 17.
- SELECT concedido a `authenticated` e `service_role`; sem concessão a `anon` ou `PUBLIC`.
- Índices aditivos em `(scope_key,status,document_date)` e `(account_id,entry_id)`.
- Sem snapshots, tabelas de OS, compras, vendas, caixa paralelo ou agregados manuais.
- Nenhuma linha ou lançamento é criado, atualizado, excluído ou reclassificado pela migration.
- A migration não foi aplicada ao Supabase oficial.

## Testes

`test:phase3-ledger-reporting` verifica estaticamente as quatro views, a fonte Ledger exclusiva, competência/data documental, contas caixa, janelas de saldo, RLS por security invoker e ausência de DDL/DML destrutivo.

A validação estática não substitui parser PostgreSQL, execução em Sandbox, conferência dos saldos contra amostras do Ledger nem advisors Supabase. O único projeto Supabase conectado atualmente é o oficial, que permanece intocado.

## Hardening complementar da Fase 2

A migration `20261103210000_dbs_phase2_reservation_sync_guard.sql` corrige o ciclo de reserva da OS: em autosaves não terminais, quantidades reservadas também são subtraídas do payload legado, evitando que o autosave faça baixa física antes da conclusão. A baixa da reserva ocorre apenas no estado terminal. Reserva, liberação, autosave e conclusão compartilham advisory lock por OS para serializar concorrência.

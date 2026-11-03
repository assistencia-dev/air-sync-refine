# Fase 2 — Vendas avulsas e reserva de estoque em OS

Status: camada relacional e ações seguras de backend implementadas na branch isolada do PR #138. Ainda não está liberada para operação: faltam integração da conclusão da OS no fluxo existente, interface administrativa e testes de execução/concorrência em PostgreSQL isolado.

## Base confirmada na main após PR #137

- Estoque relacional: `dbs_control_parts.stock_quantity`, `cost_cents`, `reserved_quantity`, `version`.
- Movimentos imutáveis: `dbs_control_inventory_movements`, com chave única por `(scope_key,idempotency_key)`.
- Ledger existente: `post_treasury_ledger_entry`, dupla entrada e Outbox contábil.
- Financeiro da OS: `dbs_control_work_order_financials`; receita de serviço permanece no fluxo existente.
- O fluxo legado `dbs_control_apply_work_order_parts_in_tx` foi preservado sem substituição.

## Implementado neste PR

### Reserva de estoque para OS
- Tabelas aditivas para lotes, reservas e consumo final de reservas.
- RPCs transacionais para reservar, liberar e consumir; lock de peças por UUID, cálculo de disponibilidade física menos reserva, chave idempotente e custo capturado no momento da reserva.
- Reserva altera somente `reserved_quantity`; consumo reduz estoque físico e reservado na mesma transação.
- Movimentos imutáveis para reserva/liberação/consumo e COGS no Ledger quando o consumo é efetivado.
- A RPC de consumo e a ação de backend estão expostas, mas **a chamada ainda precisa ser conectada ao fluxo atual de conclusão da OS** antes de habilitar a operação pela interface. O fluxo legado de aplicação de peças não foi alterado nesta etapa para evitar dupla baixa.

### Venda avulsa de peças
- Cabeçalho, itens e liquidações de venda em tabelas separadas.
- RPC de venda bloqueia peças em ordem determinística, valida estoque livre (físico menos reservado), captura CMP, baixa estoque e registra movimentos.
- Receita: Dr Contas a Receber (1.1.02) / Cr Receita de venda de peças (4.1.02). A existência/mapeamento dessa conta no plano de contas da instância precisa ser confirmada no Sandbox antes de aplicar a migration.
- COGS: Dr Custo de peças vendidas (5.1.01) / Cr Estoque (1.1.03).
- Liquidação parcial/total separada: Dr Caixa e bancos (1.1.01) / Cr Contas a Receber (1.1.02).
- Ações de backend protegidas por sessão e perfil administrativo.

### Outbox e isolamento
- Outbox de domínio de estoque separada (`dbs_control_inventory_outbox`), alimentada por trigger na mesma transação dos movimentos.
- Não altera `dbs_control_outbox`, snapshots, rotinas de sincronização, backup, nem Outbox do Ledger.
- RLS habilitada, acesso direto revogado para anon/authenticated e RPCs privilegiadas concedidas somente a `service_role`.
- Nenhuma migration foi aplicada ao Supabase oficial.

## Testes e limites atuais

- A suíte estática `scripts/test-inventory-financial-bridge.cjs` foi ampliada para verificar tabelas, RPCs, locks, idempotência, contas do Ledger e ausência de DDL destrutivo.
- Essa validação estática não substitui parser PostgreSQL, execução transacional, testes de concorrência ou replay real.
- A homologação em PostgreSQL isolado ainda não foi executada.
- A integração do consumo ao fluxo de conclusão da OS e a interface de vendas/reservas continuam pendentes.
- O PR deve permanecer em Draft até essas etapas e os checks do commit final passarem.

## Invariantes obrigatórios

- Nunca permitir `reserved_quantity > stock_quantity` nem disponibilidade negativa.
- Toda mutação de estoque usa locks determinísticos, idempotency key e movimento imutável.
- Reserva não altera estoque físico; recebimento aumenta estoque físico; consumo/venda reduz estoque físico.
- Ledger balanceado em centavos inteiros; sem float monetário.
- Liquidação não é reconhecida como receita novamente.
- Cancelamentos após postagem usam movimentos/lançamentos compensatórios; nunca exclusão de histórico.
- Isolamento por `scope_key` e `company_id`; RPC privilegiada somente via backend confiável.
- Migrations aditivas; sem DROP/TRUNCATE e sem exclusão de dados operacionais.

# Fase 2 — Vendas avulsas e reserva de estoque em OS

Status: implementação iniciada em branch isolada. Esta especificação é o contrato técnico para a entrega incremental; não habilita operação até migrations, RPCs, testes e integração de backend estarem concluídos.

## Base confirmada na main após PR #137

- Estoque relacional: `dbs_control_parts.stock_quantity`, `cost_cents`, `reserved_quantity`, `version`.
- Movimentos imutáveis: `dbs_control_inventory_movements`, com tipos `receipt`, `reserve`, `release`, `consume`, `return`, `adjustment`, `reversal`; chave única por `(scope_key, idempotency_key)`.
- Linhas de peças da OS: `dbs_control_work_order_parts`, com `cost_cents`, `consumption_status` e `idempotency_key`.
- Contabilidade: `post_treasury_ledger_entry`, Ledger de partidas dobradas e Outbox contábil.
- Financeiro da OS: `dbs_control_work_order_financials`; receita da OS é lançada na conclusão e consumo de peças gera COGS.
- Não alterar nem substituir o fluxo legado `dbs_control_apply_work_order_parts_in_tx` sem migração compatível e testes de regressão, pois hoje ele baixa estoque ao aplicar peças.

## Entrega 2A — Reserva de peças para OS

1. Criar registro relacional de reservas por OS/peça, com quantidade, custo unitário capturado, estado `reserved | consumed | released`, versão e chave idempotente.
2. RPC transacional para reservar: lock determinístico das peças, validar escopo/empresa/OS, calcular disponível como `stock_quantity - reserved_quantity`, impedir saldo negativo, incrementar `reserved_quantity`, gravar movimento `reserve` e Outbox na mesma transação.
3. RPC para liberar: lock, liberar somente saldo ainda reservado, decrementar `reserved_quantity`, gravar movimento `release`; idempotente.
4. Integração de conclusão da OS: converter reserva em consumo uma única vez, reduzir estoque físico e reserva na mesma transação, gravar `consume`, reconhecer COGS usando o custo capturado na reserva e não cobrar/baixar duas vezes.
5. Cancelamento/remoção de peça libera reserva; OS concluída não pode liberar nem consumir novamente. Reversões devem ser novos movimentos compensatórios.

## Entrega 2B — Venda avulsa de peças

1. Criar cabeçalho e itens de venda, pagamentos/recebimentos separados do reconhecimento da receita, com referências a cliente, escopo, ator, valores em centavos, estado e idempotência.
2. RPC transacional de venda: lock determinístico do catálogo, validar quantidade disponível (físico menos reservado), preço e autorização; baixar estoque e gravar movimento de saída.
3. Lançar receita: Dr Contas a Receber (1.1.02) / Cr Receita de Venda de Peças (conta de receita própria, confirmada no plano de contas).
4. Lançar custo: Dr Custo de Peças Vendidas (5.1.01) / Cr Estoque (1.1.03), usando CMP vigente.
5. Liquidação financeira é operação separada: Dr Caixa/Bancos / Cr Contas a Receber. Não confundir venda faturada com recebimento.
6. Cancelamentos após postagem usam estorno contábil e movimento reverso, nunca exclusão de histórico.

## Invariantes obrigatórios

- Nunca permitir `reserved_quantity > stock_quantity` nem disponibilidade negativa.
- Toda mutação de estoque usa locks de linha em ordem determinística, idempotency key e movimento imutável.
- Reserva não altera estoque físico; recebimento aumenta estoque físico; consumo/venda reduz estoque físico.
- Reserva, consumo, liberação, movimento, Ledger e Outbox devem ser atômicos.
- Ledger sempre balanceado; valores em centavos inteiros; sem float monetário.
- Isolamento por `scope_key` e `company_id`; RLS e grants mínimos; RPC privilegiada somente via backend confiável.
- Não tocar em snapshots globais, pipeline de sincronização, `dbs_control_outbox` existente ou rotinas de backup.
- Não alterar fluxo legado de compras nem `dbs_control_receive_purchase`; PR #137 permanece compatível.
- Migrations exclusivamente aditivas; sem DROP/TRUNCATE e sem exclusão de dados operacionais.

## Matriz mínima de testes

- Reserva concorrente: dois pedidos de 4 unidades com disponibilidade 5; apenas um pode reservar 4.
- Reserva repetida com mesma chave: replay sem duplicar reserva/movimento.
- Liberação repetida: replay sem reduzir reserva duas vezes.
- OS concluída: reserva 4 vira consumo 4; físico reduz 4 e reservado reduz 4 exatamente uma vez.
- Cancelamento: reserva liberada; estoque físico permanece igual.
- Venda avulsa: venda de 2 unidades bloqueia estoque reservado; baixa 2; Ledger receita e COGS balanceados.
- Replay de venda: não duplica venda, movimento ou lançamentos.
- Venda faturada e recebimento posterior: AR permanece aberto até liquidação.
- Falha em qualquer etapa: rollback integral de estoque, reserva, movimentos, Ledger e Outbox.

## Critério de aceite

CI verde no commit final, testes SQL em PostgreSQL isolado, evidência de concorrência/idempotência e regressão das rotinas atuais de OS/estoque. Nenhuma migration desta fase deve ser aplicada ao Supabase oficial antes desses critérios.

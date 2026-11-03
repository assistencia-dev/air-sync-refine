# Fase 2 — Vendas avulsas e reserva de estoque em OS

Status: integração de backend e telas administrativas implementadas na branch do PR #138. O banco oficial não recebeu migrations.

## Implementado

### Reservas para OS
- Tabelas aditivas para lotes, reservas e consumo.
- RPCs transacionais para reservar, liberar e consumir com locks, escopo, CMP capturado e idempotência.
- Reserva altera apenas a quantidade reservada; consumo reduz o estoque físico e reservado, registra movimento e COGS no Ledger.
- Consumo agora é chamado dentro do wrapper transacional `dbs_control_apply_work_order_delta_with_reservations`, usado pelo fluxo normal de sincronização da OS.
- Ao finalizar uma OS com reservas, o wrapper retira do payload legado a quantidade já reservada (subtrai por peça) e chama a RPC de consumo na mesma transação. Quantidades adicionais continuam no caminho legado; evita dupla baixa sem desativar o mecanismo para peças não reservadas.
- O consumo grava também as linhas em `dbs_control_work_order_parts`, preservando quantidade aplicada e custo capturado. A autorização permite administrador ou colaborador atribuído à OS.
- Estados terminais incluem concluída, concluída com pendência e atendimento com pendência.

### Vendas avulsas
- Cabeçalho, itens e liquidações separados.
- Baixa apenas de estoque livre (físico menos reservado), captura CMP, gera AR/receita e COGS no Ledger.
- Recebimento parcial/total separado do reconhecimento da receita.
- Tela administrativa em `/dbs-inventory` com vendas recentes, registro de venda, recebimento e lista/liberação de reservas.

### Navegação e isolamento
- Link “Estoque & Vendas” no topo administrativo do DBS CONTROL.
- Consultas de vendas/reservas filtradas por `scope_key`; OS listadas pelos usuários ativos do escopo.
- Catálogo de peças e saldo físico permanecem na tabela legada compartilhada `dbs_control_parts`; essa tabela-base ainda não possui `company_id`. A aplicação de múltiplas empresas exigirá migração separada de estoque por empresa, sem assumir isolamento inexistente no schema atual.
- Outbox de domínio `dbs_control_inventory_outbox` independente do Outbox operacional.
- Nenhuma alteração nos snapshots, sincronização, `dbs_control_outbox`, backups ou Ledger Outbox.

## Conta contábil 4.1.02

A migration de Fase 2 lança receita em `4.1.02` (“Receita de venda de peças”). O RPC existente `post_treasury_ledger_entry` cria/atualiza a conta em `treasury_accounts` por `(scope_key, code)` com `INSERT ... ON CONFLICT`; portanto, o código é provisionado transacionalmente no primeiro lançamento, sem depender de uma seed manual prévia. A conta 4.1.02 ainda não foi materializada em banco Sandbox, porque o único projeto conectado é o Supabase oficial e ele permanece intocado.

## Testes e pendências
- `test:inventory-financial` verifica contratos estáticos de migration, wrapper de conclusão, exclusão das quantidades reservadas do delta legado, persistência das linhas de peças, código 4.1.02 e tela administrativa.
- CI executa lint, testes operacionais, bridge financeiro, build e TypeScript.
- Não há Sandbox conectado; parser PostgreSQL, transação real e teste concorrente ainda precisam ser executados em banco isolado antes de aplicar a migration em qualquer ambiente.
- A tabela legada de peças não tem company_id; não afirmar isolamento físico multiempresa enquanto essa arquitetura não for evoluída.
- Sem DROP/TRUNCATE, sem exclusão de dados e sem alteração no Supabase oficial.

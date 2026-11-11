# Fase 2 — Auditoria para Migration F (Orçamento → OS)

Data da auditoria: 2026-11-11
Base auditada: `main` em `3d497726f6e78e2b857a18885b56ebb61e760476`
Projeto Supabase auditado: `gdglototcrehvhkvcqsq` (somente leitura)

## Resultado executivo

A infraestrutura de reserva e consumo de peças na OS já está implantada no banco oficial. O fluxo de orçamento, entretanto, ainda é legado: os orçamentos são armazenados no estado JSON dos snapshots e a conversão para OS ocorre no navegador. Não existe, neste momento, uma entidade relacional de orçamento aprovada que a Migration F possa vincular com segurança à OS.

Por esse motivo, esta branch registra a auditoria e os critérios de implementação. **Não aplica DDL nem altera dados de produção.** A Migration F executável fica bloqueada até que a origem relacional do orçamento e a identidade persistente da OS sejam definidas e cobertas por testes.

## Evidências do schema oficial

- `dbs_control_parts` contém `sale_cents`, `cost_cents`, `supplier_id` e `measure_unit_id`.
- `dbs_control_work_order_parts` já existe e contém `work_order_id`, `part_id`, `quantity`, `unit_cents`, `cost_cents`, `consumption_status` e `idempotency_key`.
- Já existem `dbs_control_reservation_batches`, `dbs_control_work_order_reservations` e `dbs_control_reservation_consumptions`.
- Já existem as RPCs `dbs_control_reserve_work_order_parts`, `dbs_control_consume_work_order_reservations` e o wrapper `dbs_control_apply_work_order_delta_with_reservations`.
- O fluxo de reservas foi aplicado no Supabase oficial nas migrations versionadas `20261104135123` e `20261104135126`. O código-fonte correspondente está em `20261103180000_dbs_phase2_sales_reservations.sql` e `20261103210000_dbs_phase2_reservation_sync_guard.sql`.

## Evidências do módulo de Orçamentos

- `public/dbs-control-orcamentos-v2.js` mantém `ERP_STATE.orcamentos` dentro do snapshot; o orçamento atual contém serviço, quantidade, desconto, total e `osId`, sem itens do catálogo `dbs_control_parts`.
- A aprovação é feita por `window.quoteStatus`, alterando o JSON do snapshot.
- `window.quoteToOs` gera a OS no cliente, usando identificador legado textual `OS-...`, adiciona a OS ao estado e define `q.osId`. Não chama uma RPC transacional de conversão.
- No schema público não foi encontrada tabela relacional de orçamentos/propostas nem view operacional do catálogo de vendas.
- A leitura de metadados encontrou 1 snapshot com 3 registros no array `orcamentos`. Nenhum registro foi alterado.

## Bloqueios para DDL/produção

1. Não há chave relacional estável ligando o identificador textual legado `ORC-...` / `OS-...` às linhas UUID de `dbs_control_work_orders`. Fazer backfill ou inserir peças previstas sem esse vínculo pode associar itens à OS errada ou criar registros órfãos.
2. A aprovação atual é uma mutação de JSON no cliente; não existe evento confiável no banco para disparar a vinculação apenas após aprovação.
3. O consumo de reserva já reduz estoque e lança o custo. Criar outra RPC de baixa na confirmação de instalação causaria risco de dupla baixa. A confirmação deve consumir/liberar a reserva existente com idempotência, sem um segundo movimento.
4. A tabela `dbs_control_work_order_parts` já possui dados operacionais e políticas/controles existentes. Novos estados e colunas precisam ser compatíveis com os valores atuais e com o wrapper de sincronização.
5. A nova view do catálogo deve ser `security_invoker`, expor somente campos comerciais necessários (incluindo `sale_cents`) e nunca `cost_cents`, fornecedor ou custo capturado. Como o Supabase passou a exigir exposição explícita de novas tabelas/views no Data API, a migration precisa declarar os GRANTs mínimos para `authenticated`, sem abrir `anon`.

## Plano de implementação da Migration F

A implementação segura deverá ser entregue em commits pequenos dentro desta branch:

1. **Catálogo comercial:** criar view operacional `security_invoker` sobre `dbs_control_parts`, com apenas ID/SKU/nome/descrição/unidade/preço de venda/status. Revogar acesso amplo e conceder somente SELECT necessário a `authenticated`; validar que custo e fornecedor não aparecem nem no schema da view nem na resposta REST.
2. **Orçamento relacional:** definir cabeçalho e itens de orçamento com chave de legado, escopo, cliente, preço comercial capturado, estado de aprovação e idempotência. Migrar os 3 registros legados preservando IDs e metadados, sem expor custo.
3. **Conversão atômica:** substituir a conversão no cliente por RPC que valide aprovação, escopo, OS de destino e idempotência; persistir vínculo orçamento–OS e linhas previstas em `dbs_control_work_order_parts` com estado `pendente_instalacao`.
4. **Confirmação de campo:** registrar confirmação por item, ator e timestamp; validar técnico atribuído/escopo. Para itens que exigem estoque, consumir a reserva existente uma única vez. A confirmação não pode criar uma segunda baixa, nem consumir estoque sem reserva válida.
5. **Testes:** parser PostgreSQL, testes de grants/view, RLS/escopo, orçamento aprovado/rejeitado, conversão repetida, confirmação repetida, concorrência e prova de que uma instalação gera exatamente um movimento e um lançamento de custo.

## Preservações obrigatórias

- Não modificar snapshots, sincronização delta, Outbox operacional, Ledger Outbox, compras, contas a pagar, Financeiro ou rotinas de backup.
- Não alterar custos/fornecedores visíveis a perfis operacionais ou técnicos.
- Não criar dados fictícios em produção.
- Não aplicar migration nem publicar Lovable nesta etapa de auditoria.


## Detalhamento confirmado dos 3 orçamentos legados

A leitura pontual do único snapshot que contém orçamentos confirmou:

| ID legado | Cliente UUID | Estado | Itens |
|---|---|---|---|
| ORC-1001 | `85372da6-c90b-4c4f-a212-61fd91cbc035` | Rascunho | 1 item manual, R$ 890,00 |
| ORC-1002 | `85372da6-c90b-4c4f-a212-61fd91cbc035` | Rascunho | 1 item manual, R$ 890,00 |
| ORC-1003 | `c765dda3-0c8c-44be-9d32-326748ac32a4` | Rascunho | 1 item manual, R$ 930,00 |

Os três itens têm `catalogoId: null`; portanto, não são itens vinculáveis automaticamente a uma peça do estoque. Devem ser preservados como itens manuais relacionais, sem criar reserva ou baixa retroativa. O snapshot original deve permanecer intacto após o backfill.

## Ajuste de arquitetura solicitado para a implementação

- O card “Itens Previstos (Contrato/Orçamento)” deve ler os itens relacionais vinculados à OS, não confiar somente em arrays locais do iframe.
- A ação “Confirmar Instalação” deve chamar uma RPC autenticada no backend. A RPC confirma os itens e chama `dbs_control_consume_work_order_reservations` com chave idempotente; nunca cria movimento `consume` diretamente.
- A reserva ocorre na conversão/aprovação do orçamento para a OS. A confirmação física consome a reserva já existente; itens manuais sem `part_id` são apenas confirmados, sem movimentação de estoque.
- O card deve ser responsivo e de leitura simples. Não adicionar campos obrigatórios extras ao formulário de OS.
- A conversão precisa criar uma OS relacional UUID em `dbs_control_work_orders` e manter a referência legada `ORC-...` como chave externa. Não associar a OS textual do snapshot por aproximação.

# DBS Air — Reestruturação de Peças, Estoque, Compras e Garantias

## Princípios que não podem ser quebrados

- GitHub `main` é a fonte do código; Lovable é somente o publicador e não será acionado nesta execução.
- O DBS Control registra a operação física (peça, quantidade, reserva, consumo, ferramenta e cilindro). O Financeiro controla custo, preço, fornecedor, cotação, compra, recebimento e lançamentos.
- O mesmo SKU é a identidade compartilhada entre pedido operacional, compra, recebimento e baixa na OS.
- O recebimento usa o RPC transacional existente, mantém recebimento parcial, custo médio ponderado, idempotência e Ledger/Outbox atuais.
- `FINANCEIRO_LEITURA` permanece somente leitura. A função de operador financeiro será um papel separado e validado no servidor e nas RPCs.
- Nenhum operador operacional recebe custo de aquisição ou valores de compra. Permissões serão aplicadas no servidor/RLS, não apenas escondendo campos na interface.
- Migrações são aditivas. Não há dados fictícios, ajustes diretos na produção, exclusões de tabelas ou alterações do fluxo de sincronização de OS.

## Fases

### Fase 1 — Base de garantias (migration adicionada ao repositório)

- Garantia de fornecedor/fabricante por SKU, lote ou número de série, com vínculo opcional ao item do recebimento físico.
- Cobertura de garantia da DBS separada da garantia do fornecedor, rastreada por OS e peça/serviço.
- Histórico de solicitações, análises, aprovações, recusas, substituições e créditos.
- Tabelas protegidas por RLS, sem leitura/gravação direta para `authenticated`; acesso futuro será por funções servidoras autorizadas.
- Datas de início e término são explícitas; o banco não inventa prazo padrão ou regra legal.

### Fase 2 — Papéis e limites de acesso

- Criar um papel financeiro operacional distinto de `FINANCEIRO_LEITURA`.
- Permitir ao Financeiro gerir catálogo, preços, fornecedores, cotações, compras, aprovações e recebimentos.
- Manter custo e dados financeiros fora do DTO operacional e de todas as rotas do técnico/operador.
- Validar as mesmas regras nos handlers, funções SQL/RPC e escopo da empresa.

### Fase 3 — DBS Control operacional

- Catálogo operacional de consulta: descrição/SKU/unidade/quantidade disponível, sem custo.
- Solicitação de peça/ferramenta/insumo para o Financeiro com quantidade, justificativa e OS/centro de custo.
- Reserva, separação, transferência, entrega e consumo no estoque operacional com trilha idempotente.
- Controle de ferramentas e cilindros (responsável, veículo, movimentação, uso, devolução e consulta de garantia), preservando os registros existentes.

### Fase 4 — Financeiro e integração de-para

- Catálogo financeiro único com custo médio, fornecedor e preço de revenda calculado por regra configurável.
- Fila de solicitações operacionais: atender com saldo existente ou originar cotação/compra.
- Aprovar, comprar, receber parcialmente, transferir ao estoque operacional e baixar na OS sem duplicidade.
- Compras, contas a pagar, Ledger, CMV e Outbox continuam transacionais e idempotentes.

### Fase 5 — Garantias na operação

- Registrar garantia de fornecedor ao conferir recebimento, incluindo nota, série/lote, evidências e regra de início.
- Vincular lote/série efetivamente consumido à peça instalada na OS.
- Registrar cobertura da DBS na conclusão da OS, de acordo com os termos configurados e aprovados.
- Consultar por peça, série/lote, cliente e OS; alertar vencimentos e acompanhar reclamações/RMA sem apagar o histórico.

## Situação desta entrega

A Fase 1 adiciona somente a estrutura relacional de garantias e seu teste estático. A migration ainda precisa ser revisada/aplicada no ambiente Supabase oficial por meio do fluxo controlado de migrações. Nenhuma tabela nova foi criada na produção por esta alteração de código. As fases 2–5 continuam necessárias para a experiência completa descrita.

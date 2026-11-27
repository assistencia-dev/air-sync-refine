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

### Fase 1 — Base de garantias (estrutura aditiva criada no repositório)

- Garantia de fornecedor/fabricante por SKU, lote ou número de série, com vínculo opcional ao item do recebimento físico.
- Cobertura de garantia da DBS separada da garantia do fornecedor, rastreada por OS e peça/serviço.
- Histórico de solicitações, análises, aprovações, recusas, substituições e créditos.
- Tabelas protegidas por RLS, sem leitura/gravação direta para `authenticated`; acesso futuro será por funções servidoras autorizadas.
- Datas de início e término são explícitas; o banco não inventa prazo padrão ou regra legal.

### Fase 2 — Papéis e limites de acesso (implementação inicial no branch)

- Criar um papel financeiro operacional distinto de `FINANCEIRO_LEITURA`.
- Permitir ao Financeiro gerir catálogo, preços, fornecedores, cotações, compras, aprovações e recebimentos.
- Manter custo e dados financeiros fora do DTO operacional e de todas as rotas do técnico/operador.
- Validar as mesmas regras nos handlers, funções SQL/RPC e escopo da empresa.

### Fase 3 — DBS Control operacional (visão segura e solicitações implementadas em parte)

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
- Consultar por peça/SKU, série/lote, fornecedor, recebimento, cliente e protocolo da OS; alertar vencimentos e acompanhar reclamações/RMA sem apagar o histórico.
- A consulta cruzada de garantias por peça, série/lote, fornecedor, recebimento, cliente e OS está implementada nesta branch; a criação automática na conferência de recebimento e a captura do lote/série efetivamente consumido na OS permanecem condicionadas à integração com o fluxo transacional de recebimento/consumo, sem presumir prazos ou criar vínculos artificiais.

## Situação desta entrega

A Fase 1 cria a estrutura relacional e testes estáticos de garantias. A Fase 2 inclui o perfil FINANCEIRO_OPERADOR separado do FINANCEIRO_LEITURA, com guardas de servidor/RPC e navegação. A Fase 3 inclui consulta operacional sem valores financeiros, reserva de peça por OS, solicitação de peça/ferramenta/insumo/recarga de botija e fila financeira inicial com vínculo de-para e transferência idempotente do saldo central ao estoque operacional.

A consulta de garantias por múltiplas referências foi concluída nesta etapa, incluindo identificação do cliente e do recebimento. A custódia individual de ferramentas e o histórico de movimentações de botijas/ferramentas também estão implementados no branch. Permanecem para integração seguinte: criação de garantia durante o recebimento quando houver termos/documentos informados, captura real de série/lote no consumo de peças da OS e emissão da cobertura DBS no encerramento da OS. Não se presume prazo de garantia. As migrations ainda não foram aplicadas no Supabase oficial e nenhuma tabela/dado de produção foi alterado.

# Auditoria DBS CONTROL e plano incremental

Nada foi alterado. Este é o diagnóstico baseado no código atual e um plano em fases. Nenhuma fase apaga dados.

## 1. Diagnóstico

### O que funciona
- **Acesso**: `/dbs-control` exige login. Administrador e Admin Operacional entram em modo completo. O colaborador só entra se o RH tiver liberado o acesso (cadastro de funcionário ativo, com acesso ao ponto e ao DBS CONTROL). Cliente não tem acesso.
- **Ponte com a nuvem**: o módulo envia `READY` com o estado local. A nuvem responde com `CLOUD_STATE`: o estado salvo na nuvem vence, a menos que esteja vazio e o local tenha dados. Cada alteração envia `SAVE`, que é gravado depois de 450 ms.
- **Colaborador**: o servidor filtra o que ele recebe (só as próprias OS, clientes, equipamentos e peças ligados a elas, sem compras). Ao salvar, o servidor mescla apenas os campos de execução da OS e ajusta o estoque. Essa proteção é boa.
- **Importação** (`dbs-control-import.js`): aceita CSV e Excel de clientes, equipamentos, técnicos, serviços e peças, com prévia. Não apaga registros, e campos vazios não sobrescrevem dados. Há um único nível de "desfazer" e o resultado chega à nuvem pelo mesmo caminho do `SAVE`.
- **PDF**: gerado com jsPDF, carregado de um servidor externo (CDN).

### O que é apenas um bloco de dados (JSON) ou armazenamento do navegador
- Todo o ERP é um único bloco de dados por empresa, guardado no snapshot do DBS CONTROL. O navegador também guarda cópias locais: o estado atual, o anterior, um backup de dados corrompidos e o backup da importação.
- As tabelas organizadas do DBS CONTROL (clientes, locais, equipamentos, catálogo, peças, OS e itens da OS) **existem no banco, mas nenhum código as usa**.
- Vale o último que salvar: o bloco inteiro é regravado, sem controle de versão. Duas abas ou dois administradores ao mesmo tempo podem apagar o trabalho um do outro.

### Limitações
- **OS com vários equipamentos**: cada OS guarda um único equipamento. A tabela que permitiria ligar vários equipamentos a uma OS existe no banco, mas não é usada.
- **Checklist**: é escolhido pelo texto do tipo da OS. Preventiva/PMOC recebe um checklist padrão, e Corretiva não recebe nenhum. O checklist é opcional: uma OS pode ser concluída sem ele. Também não fica ligado a cada equipamento.
- **PDF**: só tem o título em texto. Não tem logo, nem identidade azul e branca. O logo existe apenas na tela de login.
- **Arquivo sem uso**: `dbs-control-orcamentos.js` (v1) existe, mas não é carregado pela página. A v2 é a usada.

### Campos que faltam
- **Clientes** (hoje só nome, CNPJ, endereço e contato): faltam razão social e nome fantasia separados, e-mail, telefone, endereço dividido (CEP, cidade, UF), unidades/locais, situação, observações e o código do cliente no FieldControl.
- **Equipamentos** (hoje cliente, TAG, tipo, marca, modelo, série, capacidade, ambiente): faltam local/unidade, data de instalação, situação, fluido refrigerante, periodicidade PMOC, última manutenção, observações técnicas e o código no FieldControl.

### FieldControl (verificado no projeto Field Order Creator)
- Endereço usado: `https://carchost.fieldcontrol.com.br`, com chave enviada no cabeçalho `X-Api-Key`.
- Leituras com paginação (`limit=100&offset`): `customers`, `orders`, `tasks`, `services`, `employees`.
- Escrita: criação de `orders` (com `tasks`). Download do PDF da OS em `orders/{id}/pdf`.
- **Não há nenhum uso de equipamentos ou de histórico de equipamento.** Com o que está comprovado, dá para importar clientes, OS, tarefas, serviços e funcionários. Equipamentos e histórico **não estão confirmados**.
- O DBS Air não tem hoje nenhuma integração com o FieldControl.

### Riscos para dados e permissões
1. Vale o último que salvar no bloco inteiro: risco real de perda entre administradores.
2. As permissões do servidor aceitam Gestor de Conta e Gestor Regional. Se eles receberem acesso, recebem **o bloco completo, sem filtro**, porque o filtro só existe para Colaborador.
3. Administradores recebem tudo, incluindo custos e preços. Não há corte por campo.
4. Há duas migrações diferentes para o snapshot, com regras de acesso que conflitam. É preciso confirmar qual está ativa no banco.
5. jsPDF, jszip e o leitor de Excel vêm de servidores externos, sem verificação de integridade. Se esses servidores falharem, o PDF e a importação param.
6. O "desfazer" da importação existe só no navegador e só para a última importação.

## 2. Plano incremental (priorizado e sem apagar nada)

**Fase 0: Segurança dos dados (rápida)**
- Gravar com controle de versão: só salvar se a versão na nuvem não mudou. Se mudou, avisar e recarregar.
- Guardar um histórico de snapshots, apenas acrescentando registros, para poder restaurar.
- Restringir as permissões do servidor aos mesmos papéis do controle de acesso, ou aplicar o filtro também aos gestores.

**Fase 1: Experiência imediata (sem mudar o banco)**
- PDF com o logo DBS AIR, cabeçalho azul e branco, dados do cliente e do equipamento, checklist e assinatura.
- Checklist obrigatório para concluir uma OS Preventiva/PMOC. Checklist curto opcional para Corretiva.
- Novos campos de cliente e equipamento, aceitos tanto no bloco de dados quanto na importação (o modelo da planilha é atualizado).

**Fase 2: OS com vários equipamentos**
- Trocar o equipamento único da OS por uma lista de equipamentos, mantendo a leitura das OS antigas.
- Checklist por equipamento, aparecendo também no PDF.

**Fase 3: Passar para as tabelas organizadas**
- Copiar clientes, locais, equipamentos e OS do bloco de dados para as tabelas que já existem, mantendo o snapshot como reserva.
- Ler das tabelas com o snapshot como reserva, e depois desligar a gravação no snapshot quando tudo estiver validado.

**Fase 4: FieldControl**
- Importação no servidor de clientes, serviços, funcionários e OS/tarefas para o DBS CONTROL, sem duplicar registros (pelo código do FieldControl, CNPJ ou e-mail).
- Equipamentos e histórico só depois de confirmar os pontos abaixo.

## 3. A confirmar antes das fases correspondentes
- Se a API do FieldControl tem algum recurso de equipamentos (por exemplo `equipments`) e de histórico de equipamento.
- Quais campos vêm em `customers`, como endereço e documento, e se há locais por cliente.
- Os limites de uso da API e se a chave usada no Field Order Creator pode ser usada no DBS Air.
- Qual regra de acesso do snapshot está realmente ativa no banco.
- Se os gestores devem ter acesso ao DBS CONTROL.

## Detalhes técnicos
- Acesso: `hasMyDbsControlAccess` em `src/lib/rh.functions.ts` (linhas 833-855) e `requireDbsControlUser` em `src/lib/dbs-control.functions.ts` (linhas 12-26).
- Filtro e mescla do colaborador: `filterCollaboratorState` e `mergeCollaboratorOrderState` (linhas 92-220). A gravação na nuvem é um `upsert` por `scope_key` (linhas 295-299).
- Na página do DBS CONTROL: OS com um único equipamento (linhas 1345 e 2217-2243), checklist (linhas 1877-1935) e PDF (linhas 1338-1355).
- Na Fase 0, a versão do estado seria comparada antes de gravar. As tabelas do DBS CONTROL e os tipos do banco já estão gerados.
- Identidade visual: azul DBS AIR e branco.

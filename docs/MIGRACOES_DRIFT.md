# Auditoria de drift de migrations

## Objetivo

O script `scripts/check-migration-drift.mjs` compara, sem alterar o banco, as
versões do diretório `supabase/migrations/` com a tabela
`supabase_migrations.schema_migrations`.

O acesso remoto usa exclusivamente `SUPABASE_DB_URL_READONLY`. A consulta é
executada dentro de uma transação PostgreSQL `READ ONLY`; o script não chama
Supabase CLI, `db push`, `migration repair` ou qualquer comando de escrita.

## Checagem local

Valida nomes de arquivo, versões numéricas e versões duplicadas sem precisar de
credencial:

```bash
node scripts/check-migration-drift.mjs --local-only
```

Essa mesma checagem é executada no workflow `Validate` em todo pull request.

## Auditoria remota somente leitura

Defina a URL de conexão somente leitura fora do repositório e execute:

```bash
export SUPABASE_DB_URL_READONLY='postgresql://usuario:senha@host:5432/postgres?sslmode=require'
node scripts/check-migration-drift.mjs
```

O relatório JSON lista:

- versões existentes apenas no banco;
- versões existentes apenas no repositório;
- versões cujo nome diverge;
- colunas disponíveis na tabela de histórico;
- confirmação `transaction_read_only=on`.

## Recuperação controlada de versões ausentes

Quando uma versão existe somente no banco, a recuperação é opcional e escreve
apenas arquivos locais no checkout atual:

```bash
node scripts/check-migration-drift.mjs --recover
```

Se a coluna `statements` existir e tiver conteúdo, o SQL armazenado no banco é
salvo com a mesma versão em `supabase/migrations/`. O script nunca inventa SQL.
Se `statements` não existir ou estiver vazio, a versão é registrada em
`docs/MIGRACOES_PENDENTES.md` com o motivo. O comando mantém exit code diferente
de zero enquanto houver drift, exigindo revisão e commit explícito.

Depois de revisar os arquivos recuperados, execute novamente a checagem local e
a auditoria remota. Não use `supabase migration repair` para mascarar diferença
de histórico.

## Workflow semanal

`.github/workflows/migration-drift.yml` executa semanalmente e também por
`workflow_dispatch`. O secret `SUPABASE_DB_URL_READONLY` é usado somente como
variável do job. O relatório e o artefato JSON são publicados no Job Summary;
qualquer diferença ou ausência do secret faz o job falhar.

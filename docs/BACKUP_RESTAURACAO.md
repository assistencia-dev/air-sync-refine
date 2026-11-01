# Backup e restauração do DBS Air

## Escopo

Este procedimento valida o backup lógico JSON sem escrever no Supabase de produção. A restauração do drill usa um PostgreSQL descartável e cria o schema isolado `backup_restore`.

O snapshot contém as linhas das tabelas relacionais como objetos JSON. O drill restaura cada linha em uma tabela de payload (`backup_restore.rows_<tabela>`) e compara as contagens com o manifesto. Esse formato corresponde ao backup implementado em `scripts/backup-supabase.mjs`; não é um dump físico `pg_dump`.

## Backup diário

O workflow `.github/workflows/daily-supabase-backup.yml` executa às 03:17 UTC e também aceita `workflow_dispatch`.

Secrets obrigatórios do GitHub:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

O service role é usado somente pelo workflow para leitura REST/Storage e gravação do artefato no bucket privado `db-backups`. Ele nunca deve ser colocado no código, no `.env` ou no frontend.

O backup deve produzir:

- 78 tabelas no mapa `tables`;
- `snapshot_size_bytes`;
- SHA-256 do snapshot;
- contagem de cada tabela, inclusive quando a contagem é zero;
- inventário SHA-256 dos documentos de `dbs-control-os`, `rh-files` e `ticket-files`.

## Drill automático

O workflow `.github/workflows/backup-restore-drill.yml` executa semanalmente às 04:37 UTC ou manualmente.

1. Sobe `postgres:16` como serviço efêmero.
2. Baixa o manifesto mais recente com status `verified` usando somente leitura no Supabase.
3. Valida SHA-256, tamanho do snapshot, 78 tabelas e documentos.
4. Executa `scripts/restore-backup-json.mjs` contra o PostgreSQL efêmero.
5. Executa `scripts/backup-parity.sql` com `ON_ERROR_STOP=1`.
6. Publica as contagens no Job Summary.
7. Anexa `restore-output.json` e `parity-output.txt` como artefatos.

O workflow não contém URL de banco de produção como destino de restauração. O destino é sempre:

```text
postgres://postgres:postgres@127.0.0.1:5432/backup_drill
```

## Execução manual isolada

Em uma máquina com Docker/PostgreSQL local:

```bash
docker run --rm --name dbs-backup-drill \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=backup_drill \
  -p 5432:5432 \
  postgres:16
```

Em outro terminal:

```bash
bun install --frozen-lockfile

export SUPABASE_URL='https://SEU_PROJETO.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='SECRET_DO_GITHUB'
export SUPABASE_BACKUP_BUCKET='db-backups'
export SUPABASE_REQUIRE_DOCUMENT_BACKUP='true'
export RESTORE_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/backup_drill'
export RESTORE_SCHEMA='backup_restore'

bun scripts/restore-backup-json.mjs | tee restore-output.json
psql "$RESTORE_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f scripts/backup-parity.sql \
  | tee parity-output.txt
```

Resultado aceito:

```text
Backup restore parity: OK — 78 tabelas e documentos conferidos sem divergências.
```

## Recuperação operacional

O drill não grava produção e não é uma autorização para restaurar diretamente sobre o banco operacional. Em um desastre real:

1. Preserve o manifesto e os artefatos do workflow.
2. Execute o drill isolado e guarde o Summary/artefatos.
3. Compare o manifesto aprovado com o schema de destino.
4. Obtenha aprovação administrativa para qualquer restauração operacional.
5. Use uma instância de recuperação separada antes de qualquer cutover.
6. Nunca aponte `RESTORE_DATABASE_URL` para o Supabase de produção.

Manifests anteriores à Fase 1 podem não possuir `snapshot_size_bytes` ou as 9 tabelas financeiras. Eles são rejeitados pelo drill até que um novo backup seja gerado pelo workflow atualizado.

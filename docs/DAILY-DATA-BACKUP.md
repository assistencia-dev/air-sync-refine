# Backup diário da base DBS Air

A rotina de backup exporta diariamente as tabelas críticas do Supabase para o bucket privado `db-backups`. O arquivo é JSON, recebe um manifesto com contagem por tabela e hash SHA-256, e nunca é publicado como arquivo público.

## Tabelas protegidas

A rotina inclui `users`, `companies`, `units`, `tickets`, `ticket_attachments`, `ticket_timeline`, `audit_log`, `rh_employees` e `rh_topups`.

## Configuração necessária

No repositório privado do GitHub, em **Settings → Secrets and variables → Actions**, criar:

| Secret | Conteúdo |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase que realmente alimenta o portal DBS Air |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key do mesmo projeto; nunca colocar no código ou no Lovable |

O workflow `.github/workflows/daily-supabase-backup.yml` executa diariamente às 03:17 UTC e também pode ser iniciado manualmente pelo botão **Run workflow**.

## Regra de segurança

O bucket deve ser privado. O service role key só fica no secret do GitHub Actions e nunca é exposto ao navegador, ao frontend, ao chat do Lovable ou ao usuário. A rotina é somente de leitura nas tabelas e grava apenas no bucket de backup.

## Verificação

Cada execução deve exibir no log a quantidade de registros exportados por tabela e o hash do arquivo. Uma execução só deve ser considerada bem-sucedida quando o manifesto e o arquivo JSON forem gravados no bucket.

## Restauração

A restauração não é automática e não deve sobrescrever a produção. Primeiro deve-se baixar uma cópia para análise, comparar o manifesto com a produção e restaurar apenas registros ausentes usando chaves primárias e `upsert` controlado. Qualquer restauração deve ser autorizada e registrada separadamente.

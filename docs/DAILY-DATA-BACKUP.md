# Backup diário da base DBS Air

A rotina de backup exporta diariamente as tabelas operacionais do Supabase e copia os objetos dos buckets privados `dbs-control-os`, `rh-files` e `ticket-files` para `db-backups`. O snapshot JSON e cada documento recebem SHA-256, são baixados e lidos novamente para verificação, e o manifesto verificado (incluindo os buckets cobertos) é registrado em `dbs_control_backup_manifests`. Nada é publicado como arquivo público.

## Tabelas protegidas

A rotina inclui `users`, `companies`, `units`, `tickets`, `ticket_attachments`, `ticket_timeline`, `audit_log`, `rh_employees` e `rh_topups`.

## Configuração necessária

No repositório privado do GitHub, em **Settings → Secrets and variables → Actions**, criar:

| Secret | Conteúdo |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase que realmente alimenta o portal DBS Air |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key do mesmo projeto; nunca colocar no código ou no Lovable |

O workflow `.github/workflows/daily-supabase-backup.yml` executa diariamente às 03:17 UTC e também pode ser iniciado manualmente pelo botão **Run workflow**. A variável `SUPABASE_DOCUMENT_BUCKETS` mantém a cobertura explícita dos três buckets de documentos; se um bucket não existir e houver metadado relacional correspondente, o backup falha fechado.

## Regra de segurança

O bucket deve ser privado. O service role key só fica no secret do GitHub Actions e nunca é exposto ao navegador, ao frontend, ao chat do Lovable ou ao usuário. A rotina é somente de leitura nas tabelas e grava apenas no bucket de backup.

## Verificação

Cada execução deve exibir no log a quantidade de registros exportados por tabela e o hash do arquivo. Uma execução só deve ser considerada bem-sucedida quando o manifesto e o arquivo JSON forem gravados no bucket.

## Restauração

A restauração não é automática e não deve sobrescrever a produção. Primeiro deve-se baixar uma cópia para análise, comparar o manifesto e os checksums com a produção e restaurar apenas registros/objetos ausentes usando chaves primárias e `upsert` controlado. Qualquer restauração deve ser autorizada e registrada separadamente. Se houver metadado relacional de anexo sem objeto correspondente, a rotina falha fechada em vez de marcar um backup incompleto como sucesso.

## Worker da outbox do DBS CONTROL

O workflow `.github/workflows/dbs-control-outbox-worker.yml` executa a cada cinco minutos e chama a Edge Function `dbs-control-outbox-worker`. Ele usa os mesmos secrets `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, processa até 200 eventos por lote, recupera locks abandonados e registra métricas na tabela `dbs_control_sync_metrics`. A chave nunca é enviada ao navegador nem gravada no repositório.

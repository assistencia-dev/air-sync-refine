# Integração do Controle de Passagem

A integração utiliza o login nativo do DBS Air para abrir o módulo do Sistema de Vale Passagem sem duplicar a autenticação na experiência do operador.

## Variáveis necessárias

No DBS Air:

- `VALE_PASSAGEM_URL`: endereço público do Sistema de Vale Passagem.
- `VALE_PASSAGEM_SSO_SECRET`: segredo compartilhado forte, definido de forma idêntica nos dois ambientes.

No Sistema de Vale Passagem:

- `DBS_SSO_SHARED_SECRET`: o mesmo segredo usado pelo DBS Air.
- `DBS_SSO_ALLOWED_USERNAME`: opcional; por padrão, `DBSASSISTENCIA123`.

## Fluxo

1. O usuário nativo `DBSASSISTENCIA123` acessa a aba Controle de Passagem no painel administrativo DBS Air.
2. O servidor DBS Air valida a sessão Supabase e emite um token HMAC de curta duração.
3. O navegador acessa `/auth/sso` no Vale Passagem.
4. O Vale Passagem valida assinatura, usuário e expiração, cria a sessão original do módulo e redireciona para o painel.
5. O banco MySQL do Vale Passagem continua sendo o banco original; nenhum dado é copiado, migrado, removido ou substituído.

## Segurança

O segredo não deve ser colocado no código, no frontend ou no Git. O endpoint SSO deve ser publicado somente com HTTPS. A integração atual é aditiva e não modifica o esquema do banco nem as tabelas de colaboradores, recargas, sessões ou notificações.

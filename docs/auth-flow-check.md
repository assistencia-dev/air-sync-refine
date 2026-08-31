# Teste do fluxo administrativo e publicação

Portal real: https://air-sync-refine.lovable.app/admin

A sessão administrativa existente abriu o painel sem solicitar novas credenciais. A aba `CONTROLE DE PASSAGEM` apareceu dentro do painel e navegou para `/passage`.

No portal publicado, a rota `/passage` ainda exibiu a mensagem antiga de ambiente não configurado antes da nova publicação ser concluída.

No editor Lovable, a publicação foi autorizada e iniciada. O Lovable exibiu `Erro de runtime` com `Unauthorized: No authorization header provided` no preview do projeto. O erro ocorreu durante a chamada server-side de `getMyProfile` no preview sem sessão/autorização. A ação de publicação não alterou dados do Vale Passagem.

Conclusão parcial: o login do admin real está válido; o teste de não solicitar nova credencial dentro do iframe depende de o portal publicado carregar a nova rota e da sessão do módulo original. O preview Lovable não possui uma sessão administrativa válida, portanto não é um teste confiável do fluxo autenticado.

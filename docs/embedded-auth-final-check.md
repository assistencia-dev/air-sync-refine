# Teste final do módulo incorporado

A rota publicada `https://air-sync-refine.lovable.app/passage` carregou corretamente dentro do portal DBS Air após a sessão administrativa existente.

O portal DBS não solicitou novas credenciais para abrir a rota. Dentro do iframe, porém, o Sistema de Vale Passagem exibiu sua própria tela de login (`Usuário` e `Senha`). Isso confirma que a sessão nativa do DBS não é compartilhada automaticamente com o domínio do módulo independente.

A incorporação visual funciona e os dados permanecem no sistema original, mas o requisito de zero segundo login não está tecnicamente concluído somente com alteração no portal. Para eliminar essa tela seria necessária uma ponte de autenticação no módulo original, um proxy de mesma origem ou uma migração controlada da autenticação; não foi executada nenhuma dessas operações nesta verificação.

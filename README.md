# DBS Air Solutions

Por favor, com base no novo código HTML/CSS fornecido pelo Claude, aplique as seguintes correções cirúrgicas para que o site funcione perfeitamente:

1. CORREÇÃO DA LOGO (CABEÇALHO E RODAPÉ):

   Como não temos a imagem local "logo-dbs-air.jpg", substitua a tag <img> da logo tanto no <header> quanto no <footer> por um elemento de texto estilizado em HTML/CSS para que nunca apareça quebrado:

   - Use uma estrutura como: 

     <div class="brand" style="font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:20px; letter-spacing:-0.02em;">

       <span style="color:#FFFFFF; background:#1E8F66; padding:2px 8px; border-radius:2px; margin-right:6px;">DBS</span>

       <span style="color:#0E1A2E;">AIR</span>

     </div>

   - No footer, ajuste as cores para que o texto contraste com o fundo escuro (DBS com fundo verde e AIR em branco).

2. CORREÇÃO DA ANIMAÇÃO DO COMPLIANCE STRIP (CSS):

   Para que a faixa de leis com efeito de letreiro (strip-track) deslize de forma infinitamente suave e sem quebras, atualize o CSS da classe `.strip` e `.strip-track` para:

   - `.strip { background: var(--navy-700); border-bottom: 1px solid rgba(255,255,255,0.08); overflow: hidden; width: 100%; }`

   - `.strip-track { display: flex; gap: 56px; padding: 13px 0; font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: #B7C6D0; letter-spacing: 0.03em; width: max-content; animation: scroll 40s linear infinite; }`

3. MENSAGEM DO WHATSAPP DE CONVERSÃO B2B:

   Substitua todos os links de WhatsApp ("https://wa.me/5521998256991") pelo seguinte link com mensagem profissional pré-configurada para facilitar o contato do gestor:

   "https://wa.me/5521998256991?text=Olá.%20Gostaria%20de%20solicitar%20um%20contato%20técnico%20comercial%20para%20avaliar%20a%20climatização/PMOC%20da%20minha%20empresa."

Mantenha toda a estrutura excelente de design, fontes e cores que o Claude gerou.https://dbsairweb-w372yhdd.manus.space/sei que voce e bom com design quero que faça uma landing page em  html para minha empresa, somos uma empresa de manuntenção de ar condicionado e nosso foco é o b2b business to business quero que seja atrativo em vendas portanto temos uma pagina no intagram que e https://www.instagram.com/dbs.air/ o contato e por email contato@dbsair.com.br  assistencia@dbsair.com.br e o whatsapp é +55 21 99825-6991 o endereço Rua Nabôr do Rêgo, 481 - Ramos, Rio de Janeiro - RJ, 21031-720, Brasil o site https://dbs-air-solucoes-em-refrigeracao-e.negocio.site/?m=true pode usar referencia logo tudo desse site os serviços toda a estrutura nossa logo esta no intagram use ela e uma boa identidade visual use a logo

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://air-sync-refine.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ad3dfd84-66c1-403e-9732-79cc4f2d70df).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

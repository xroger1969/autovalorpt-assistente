# Publicações criativas no servidor

A rotina editorial prepara e publica um conteúdo por dia em `@autovalorpt`, sem depender do Chrome, do Mac ou de um iPhone ligado. O painel privado é `/editorial.html` e usa a sessão administrativa já existente.

## Calendário e conteúdo

- Início: **21 de novembro de 2026**.
- Primeira execução a partir das **19:00 em Europe/Lisbon**. A infraestrutura pode executar dentro dessa hora; o painel não promete uma hora exata.
- Uma execução de recuperação às **20:00 locais** retoma a preparação do mesmo conteúdo, ou confirma que já foi publicado. Não publica uma segunda peça.
- Há dois pares de crons UTC com guardas de estação, para verão e inverno. Cada entrada corre uma vez por dia; só a estação correta avança.
- O arquivo conserva os temas, as imagens e os carrosséis das primeiras edições. A partir de 26 de novembro de 2026, a agenda usa 32 temas de mobilidade elétrica e as edições extra usam outros 32. A agenda intercala edições sobre apoios e atualidade, com fontes identificadas na legenda quando disponíveis.
- **22/11/2026:** Reel «O carro cabe na tua rotina?».
- **29/11/2026:** Reel «O que observas num test drive?».
- Os dois Reels usam os vídeos já preparados, adaptados para entrega web. A divulgação de IA está no vídeo, na legenda e no pedido da etiqueta nativa. Se a etiqueta não puder ser confirmada, o painel indica essa limitação sem repetir a publicação.
- O Reel publicado em 20/11/2026 não está incluído nesta fila.

O servidor compõe as imagens a partir das contas e das condições de cada exemplo. A legenda usa a chave OpenAI da aplicação. O modelo editorial predefinido é `gpt-6.2-astra`. Se a API recusar explicitamente o acesso a esse modelo, o servidor pode escolher o modelo compatível de maior prioridade disponível na conta. O detalhe da legenda identifica o modelo usado quando disponível. A redação da AutoValorPT fornece uma legenda completa se o modelo estiver indisponível ou introduzir uma afirmação que a aplicação rejeite. A pré-visualização e a publicação reutilizam a mesma edição guardada. A consulta da agenda de sete dias usa os planos locais.

## Configuração

`INSTAGRAM_EDITORIAL_ENABLED=true` em produção ativa o valor inicial da rotina. Uma pausa ou ativação explícita no painel fica guardada e prevalece sobre esse valor. A aplicação reutiliza `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`, `INSTAGRAM_LOGIN_MODE`, `INSTAGRAM_PUBLIC_BASE_URL`, a autorização Blob e `CRON_SECRET` já existentes.

O novo publicador usa `INSTAGRAM_EDITORIAL_GRAPH_VERSION`, com valor predefinido `v27.0`. A versão do publicador de stock e do gestor de renovação da autorização não muda.

O build de produção executa uma verificação da identidade `autovalorpt` e da consulta à quota de publicação quando a rotina editorial está ativada. Só emite o resultado seguro, sem credenciais ou respostas brutas. Pode também preparar o rascunho da próxima edição e registar a origem da legenda. Quando esse rascunho usa o texto da redação, o build verifica o acesso ao modelo e prepara, no máximo, a edição diária seguinte para validar a escrita assistida. O envio para o Instagram é feito pela rotina ou após confirmação manual no painel. A Meta volta a verificar as permissões ao receber cada publicação; uma ligação validada não equivale a uma publicação confirmada.

## Acesso e acompanhamento

As ações privadas passam pela função existente:

| Pedido | Acesso e efeito |
| --- | --- |
| `integration=editorial&action=status` | Consulta privada de estado e histórico. |
| `integration=editorial&action=preview&date=YYYY-MM-DD` | Consulta privada da peça preparada. |
| `integration=editorial&action=extra-preview` | `GET` na sessão de administrador. Mostra a imagem e a legenda completas e prepara a confirmação dessa edição. |
| `integration=editorial&action=extra-run` | `POST` da mesma sessão e origem, com o identificador e a confirmação da edição revista. |
| `integration=editorial&action=settings` | `POST` de administrador, com origem coincidente e `{ "enabled": true/false }`. |
| `integration=editorial&action=validate` | Verifica ligação, conta e quota; não publica. |
| `integration=editorial&action=run&season=summer/winter` | Cron autenticado, ou `POST` administrativo com a mesma origem. A data vem sempre do servidor. |
| `integration=editorial-image&date=YYYY-MM-DD&slide=1&v=v1` | Imagem educativa autoral, pública para entrega à Meta; não aceita URLs, caminhos ou texto do utilizador. |
| `integration=editorial-post&date=YYYY-MM-DD` | Devolve apenas o URL público de uma publicação já confirmada e guardada. Não mostra conteúdo pendente nem detalhes privados. |

O carregamento do painel e a consulta de pré-visualizações não publicam nada. Não existe botão «publicar agora». O histórico distingue preparação, falha, publicação incerta e publicação confirmada. A ausência de um URL público não prova que a publicação tenha falhado: a confirmação pode ainda precisar de reconciliação.

## Proteção contra duplicados

O estado privado editorial está separado das rotinas de stock. Guarda uma entrada por data de Lisboa e usa escritas condicionais com ETag para reservar a tentativa e autorizar a publicação. Uma pausa é novamente verificada imediatamente antes do envio. Uma execução que atravesse a mudança de dia deixa de poder publicar a peça anterior.

Se a resposta de publicação se perder, o estado fica bloqueado e o servidor consulta o contentor já existente. Não cria uma nova publicação para resolver uma resposta incerta. A recuperação da mesma noite reutiliza o contentor em processamento. Um conteúdo concluído não volta a ser publicado após uma nova implantação.

As rotinas existentes de stock, catálogo e WhatsApp mantêm os seus endpoints e agendamentos. A antiga tarefa de publicação pelo navegador deve ficar pausada após a migração, ou ser convertida em acompanhamento sem autorização para publicar em paralelo.

## Referências técnicas

- [Publicação de conteúdos na plataforma Instagram](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- [Campos de criação de media na Graph API](https://developers.facebook.com/docs/graph-api/reference/shadow-ig-user/media/)
- [Limites e precisão dos crons Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing)

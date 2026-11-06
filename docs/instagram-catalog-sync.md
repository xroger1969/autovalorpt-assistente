# AutoValorPT: catálogo → publicações Instagram

Integração desativada por defeito. Não cria uma Loja Meta nem altera o catálogo WhatsApp. O cron diário das 10:00 UTC lê a mesma folha usada pelo catálogo e publica no máximo um novo anúncio por execução, apenas depois de validar que a conta é `autovalorpt`.

## Configuração de produção

Configurar apenas no servidor/Vercel; nunca colocar tokens no código, logs ou capturas:

| Variável | Valor |
| --- | --- |
| `INSTAGRAM_SYNC_ENABLED` | `false` até autorização e validação concluídas; depois `true` |
| `INSTAGRAM_FEED_URL` | `https://docs.google.com/spreadsheets/d/1RENDbmN9Inyd2fr0FQJJmbe1jMpJl4Psevlawc92uVs/export?format=csv&gid=2105479537` |
| `INSTAGRAM_USER_ID` | ID confirmado pela Meta para `autovalorpt` |
| `INSTAGRAM_ACCESS_TOKEN` | Token da conta autorizada, variável sensível |
| `INSTAGRAM_TOKEN_EXPIRES_AT` | No modo `instagram`, data ISO de expiração devolvida para o token inicial de longa duração |
| `INSTAGRAM_LOGIN_MODE` | `instagram` ou `facebook`, conforme o fluxo autorizado |
| `INSTAGRAM_GRAPH_VERSION` | `v26.0` |
| `INSTAGRAM_PUBLIC_BASE_URL` | `https://autovalorpt-assistente.vercel.app` |

Reutiliza `CRON_SECRET`, `ADMIN_SESSION_SECRET` e o Blob privado OIDC já configurados. Não altera as filas, dados ou envio de contactos. Não usa o token WhatsApp da Watermelon. O modo Instagram Login requer apenas acesso básico e publicação; mensagens/comentários não são necessários.

No modo `instagram`, configurar um token inicial de **longa duração**, com validade conhecida de pelo menos três dias, e a data de expiração devolvida pela Meta. Tokens de uma hora, sem expiração conhecida ou quase expirados são recusados. O primeiro pedido valida `autovalorpt` e guarda a autorização cifrada com AES-256-GCM num Blob privado separado (`instagram/v1/production/auth.json`). A chave é derivada de `ADMIN_SESSION_SECRET`, vinculada à conta e ao token inicial. O valor em Vercel permanece como referência de arranque; os tokens renovados ficam apenas no armazenamento cifrado.

O cron diário verifica a autorização antes de consultar o feed. A primeira renovação fica elegível depois de 25 horas; depois renova a cada sete dias, guardando a validade real devolvida pela Meta. Uma reserva CAS impede renovações concorrentes. A nova credencial só é persistida depois de confirmar novamente o ID e nome `autovalorpt`. Falhas de renovação conservam a credencial anterior e tentam novamente no dia seguinte; a publicação volta sempre a validar a conta. Se a autorização expirar ou for revogada, bloqueia e exige uma nova ligação. O status privado mostra datas e estado, nunca tokens, URLs de autorização ou respostas brutas.

No modo `facebook`, não chama o endpoint de renovação Instagram e conserva o token do ambiente. Alterar o token inicial ou `ADMIN_SESSION_SECRET` obriga a validar novamente a autorização de arranque; depois de uma rotação, invocar apenas o deployment de produção atual, evitando deployments antigos com credenciais antigas. Nunca apagar os registos de publicações para renovar uma credencial.

## Arranque e operação

1. Publicar com `INSTAGRAM_SYNC_ENABLED=false`. O cron permanece inativo.
2. Administrador autenticado consulta `GET /api/stock?integration=instagram-sync&action=status` e `GET /api/stock?integration=instagram-sync&action=dry-run`. O segundo valida o CSV e apresenta o próximo texto/foto sem escrever estado nem publicar.
3. Depois da autorização da Meta, configurar token/ID, validar a conta e ativar. A primeira execução válida grava todos os IDs atuais como **baseline** e publica zero carros. No estado inicial conhecido existem 11; a fonte atual é sempre revalidada.
4. Execuções seguintes publicam só IDs novos que estejam `in stock`. Alterar preço ou retirar/repor um ID já publicado ou inicial não cria outro post. Um ID novo visto inicialmente sem stock pode ser publicado quando ficar disponível. O feed original e as suas imagens não são alterados.
5. Cada foto é entregue à Meta por URL assinado válido duas horas. Apenas a origem OLX permitida é lida. A imagem é convertida em JPEG sRGB e recebe margens neutras quando necessário, sem cortar o automóvel; máximo 1440 px de largura/8 MB.

O cron usa UTC: 10:00 em Portugal continental no inverno, 11:00 no verão. A execução anterior das 08:00 para contactos mantém-se. A Vercel suporta 100 cron jobs por projeto em todos os planos; este projeto passa de um para dois e ambos são diários.

## Falhas e duplicados

Estado privado em `instagram/v1/production/state.json`. A transição exclusiva CAS é persistida antes de criar o contentor e antes de publicar. Falha de rede ou processo depois de iniciar a publicação deixa a tentativa em `publishing`/`unknown`; **não se repete automaticamente**, mesmo que a gravação posterior tenha falhado. Execuções seguintes consultam o contentor: `PUBLISHED` confirma a publicação sem repetir; `ERROR`/`EXPIRED` confirmam que pode haver uma nova tentativa. Outros estados mantêm `review_required`; confirmar o resultado na conta/Meta antes de qualquer intervenção no registo. Nunca apagar o estado para forçar nova tentativa. O status privado inclui o ID do contentor e apenas códigos numéricos seguros dos erros Meta.

O mesmo pedido verifica a preparação até oito vezes com intervalos de 1,5 segundos, respeitando o orçamento de execução. Contentores ainda em preparação podem retomar na execução seguinte; se tiverem expirado, o anúncio permanece elegível para uma nova tentativa. Se o anúncio sair de stock ou os dados mudarem antes da publicação, a tentativa é cancelada e a versão atual pode ser reconsiderada. Há no máximo três tentativas de criação por ID; falhas sem publicação não impedem os outros anúncios. Um resultado de publicação ainda incerto bloqueia a fila até ser esclarecido. Respostas inválidas, conta diferente, CSV incompleto, IDs repetidos e redução superior a metade do número de linhas bloqueiam o envio. Uma redução real dessa dimensão requer revisão, porque não pode ser distinguida automaticamente de um feed parcial. Com uma publicação por execução diária, várias entradas novas ficam para os dias seguintes.

Desativar `INSTAGRAM_SYNC_ENABLED` suspende novas execuções; o estado é preservado. O endpoint administrativo de execução exige POST da mesma origem, e o cron exige Bearer `CRON_SECRET`. Status e dry run também são privados. Nenhum erro devolve o corpo Meta ou credenciais.

## Validação

`npm test` inclui baseline sem posts, concorrência, duplicados, alteração/retirada de stock, falhas de persistência e de publicação, feed parcial, conta errada, configuração incompleta, autorização dos endpoints e conversão/assinatura das imagens. Todos os envios nos testes são simulados.

Referências oficiais verificadas em 2026-11-06:

- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
- https://vercel.com/docs/vercel-blob/using-blob-sdk
- https://vercel.com/changelog/cron-jobs-now-support-100-per-project-on-every-plan

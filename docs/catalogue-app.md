# App do catálogo AutoValorPT

## Utilização

A app pública fica em `/app/index.html`, no endereço AutoValorPT existente. É uma aplicação web instalável (PWA), com pesquisa, filtros, favoritos guardados neste dispositivo e contacto por WhatsApp. A instalação coloca um ícone no ecrã principal e abre o catálogo numa janela própria. Esta entrega não é uma publicação na App Store nem no Google Play.

No iPhone, abrir a app no Safari, tocar em **Partilhar** e escolher **Adicionar ao ecrã principal**. Se o sistema apresentar a opção **Abrir como aplicação web**, mantê-la ativa. No Android, abrir no Chrome e usar **Instalar aplicação** ou **Adicionar ao ecrã principal**, no menu do navegador. O botão de instalação da app apresenta a opção disponível no dispositivo.

O painel continua acessível em `/stock-rapido.html`, através da rewrite para `/rotina.html`. Não criar um ficheiro físico com o nome `stock-rapido.html`, pois voltaria a sobrepor-se a essa configuração. O acesso à app pública não dá acesso ao painel privado.

## Atualização do catálogo

O modo público `GET /api/stock?integration=catalogue-app` lê exclusivamente o último snapshot válido produzido pelo sistema de stock. É a mesma fonte que alimenta o catálogo WhatsApp/Meta: união das contas Standvirtual Samucar e AutoValorPT, com fotografias originais. As viaturas retiradas do stock deixam de aparecer depois de uma sincronização bem-sucedida.

A consulta pública não inicia uma sincronização, não publica em redes sociais e não altera o stock. A sincronização continua a pertencer à rotina existente e ao botão **Atualizar tudo** no painel. `updatedAt` identifica a sincronização real da fonte; não é a hora em que o visitante abriu a app. Uma falha de leitura devolve um erro, em vez de substituir o catálogo por uma lista vazia.

A app consulta a fonte ao abrir, ao regressar ao primeiro plano, de 60 em 60 segundos enquanto está visível e através da atualização manual. Se a ligação falhar, a última cópia local pode continuar visível, claramente identificada como informação guardada. Essa cópia não constitui confirmação atual de disponibilidade ou preço. A recuperação da ligação volta a consultar o stock.

Os filtros incluem híbridos como categoria própria, distinta de elétricos, gasolina e gasóleo. Os favoritos são guardados apenas no navegador/dispositivo; não criam uma conta de cliente nem sincronizam entre dispositivos. O contacto atual da AutoValorPT nesta app é `+351 965 637 736`. Abrir uma ligação WhatsApp prepara a mensagem; o visitante confirma o envio no WhatsApp.

## PWA e cache

O manifest é `/app/manifest.webmanifest`, com `id` e `start_url` em `/app/index.html`, `scope` em `/app/`, idioma `pt-PT` e modo `standalone`. Os ícones PNG de 192 e 512 pixels usam a identidade azul-marinho e dourado; existe também um ícone Apple de 180 pixels. O SVG de origem está em `app/icons/brand-icon.svg`.

Registar `/app/sw.js` com `{ scope: '/app/', updateViaCache: 'none' }`. O service worker fica estritamente limitado à app e não substitui o `OneSignalSDKWorker.js` existente na raiz. A lista de cache contém apenas o HTML, CSS, módulos JavaScript, manifest e ícones desta app. Nunca armazena o endpoint `/api/stock`, imagens externas de viaturas, credenciais, páginas administrativas ou respostas de autenticação.

O HTML deve incluir `<meta name="autovalor-app-build" content="20261126-1">`. As referências a `styles.css`, `catalogue.js` e ao import de `catalogue-core.js` usam `?v=20261126-1`. A instalação só conclui quando todo o shell válido está disponível. As navegações procuram primeiro a página online; na ausência de rede, recuperam a página da mesma versão do shell, preservando ligações `?viatura=ID...`. A API continua a ser consultada pela app e não pelo worker.

O worker não força a substituição de uma versão em utilização. Uma atualização preparada entra em vigor quando a versão anterior deixa de ter janelas abertas. Na ativação são eliminadas apenas caches com o prefixo `autovalor-catalogue-v1-`; caches de outros componentes permanecem intactas. O HTML de uma versão futura nunca substitui o HTML offline da versão atual, e as URLs com versões diferentes de CSS/JS passam diretamente para a rede.

Ao publicar alterações ao shell, incrementar em conjunto `BUILD` em `sw.js`, a meta `autovalor-app-build`, as referências CSS/JS no HTML e o import de `catalogue-core.js`. A chave de dados do catálogo e os favoritos têm ciclos de vida independentes da cache do shell.

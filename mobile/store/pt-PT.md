# AutoValorPT — ficha da loja em português de Portugal

**Estado em 26/11/2026: build iOS 1.0.0 (3) assinada, processada pela Apple, disponibilizada no TestFlight e selecionada para App Review; ficha pública 1.0.0 ainda não enviada para revisão, com lançamento manual.** O Apple ID é `6839660385`; a equipa é `QBU2Z3YJ88` e o SKU é `AUTOVALORPT-IOS-001`. A descrição completa com ferramentas, as notas de revisão atualizadas e os contactos de revisão foram guardados no App Store Connect. O copyright **2026 Carlos Vasconcelos** foi confirmado como guardado. Palavras-chave, URLs de apoio/marketing, ausência de login, subtítulo **O teu próximo automóvel**, categoria **Compras** e URL de privacidade também estão guardados. A classificação etária **4+**, os direitos de conteúdo e a declaração **App Privacy** foram concluídos e guardados; os detalhes de privacidade foram publicados na Apple.

**As ferramentas e os contactos descritos abaixo estão incluídos na build 3. O titular confirmou que testou a app instalada e aprovou esta versão em 26/11/2026, autorizando o envio definitivo à revisão Apple e deixando melhorias para versões posteriores.** Esta confirmação não constitui uma bateria de testes em todos os dispositivos. A descrição completa deste documento foi guardada na Apple. As notas para App Review constituem uma referência editorial de conteúdo equivalente às notas guardadas, não uma transcrição literal.

[App Store Connect — ficha pública AutoValorPT](https://appstoreconnect.apple.com/apps/6839660385/distribution/ios/version/inflight). A [build de produção EAS `c53a3057-d41f-4205-a683-493313ff6481`](https://expo.dev/accounts/cvasconcelos1969s-team/projects/autovalorpt-catalogo/builds/c53a3057-d41f-4205-a683-493313ff6481) terminou com estado **Succeeded**, versão **1.0.0 (3)**, a partir do commit `877654a24a86b4fad319683c20b12bb7881a5566`. A compilação demorou **2 min 10 s**, com **2 min 37 s** de duração total. A [submissão `9f500b1b-9dd0-4879-97f4-17f11d2b0738`](https://expo.dev/accounts/cvasconcelos1969s-team/projects/autovalorpt-catalogo/submissions/9f500b1b-9dd0-4879-97f4-17f11d2b0738) terminou com estado **Succeeded**, enviada às **18:07 de 26/11/2026, hora de Lisboa**. A Apple concluiu o processamento e apresenta a [build 3 no TestFlight](https://appstoreconnect.apple.com/teams/f14e8d50-2439-4216-bbe0-5697b90f3551/apps/6839660385/testflight/ios/4d947a8a-378c-412c-af86-5d77a82ca94a) como **«Pronta para enviar»**, com associação ao grupo interno confirmada.

O grupo interno **Team (Expo)** tem **2 compilações, as builds 2 e 3, e 1 tester, o titular**. A [build 2](https://appstoreconnect.apple.com/teams/f14e8d50-2439-4216-bbe0-5697b90f3551/apps/6839660385/testflight/ios/f2758a0b-d878-4c20-90fa-c36be985fcf1) mantém-se no grupo como referência anterior. O convite foi reenviado e recebido às **18:48 de 26/11/2026, hora de Lisboa**; o titular confirmou posteriormente a instalação e o teste. As métricas de sessões da Apple não foram usadas para essa confirmação. **Beta Info global e notas foram atualizadas para Mais, simuladores e logótipo; What to Test da build 3 foi preenchido e guardado, com persistência confirmada.** As ligações das builds abrem páginas de gestão, não convites públicos.

**Continuam pendentes as screenshots nativas de iPhone/iPad e o envio à revisão Apple; a app ainda não foi publicada na App Store.** A build 3 já está selecionada para App Review. Não foi criada uma ligação pública de TestFlight. A build histórica de simulador 1.0.0 (1) está documentada em `../README.md`.

## Identificação

| Campo | Valor e estado |
| --- | --- |
| Nome | AutoValorPT |
| Subtítulo | O teu próximo automóvel — guardado no App Store Connect |
| Idioma | Português de Portugal (`pt-PT`) |
| Categoria principal | Compras — guardada no App Store Connect |
| Dispositivos iOS | iPhone e iPad; a configuração atual tem `supportsTablet: true` |
| Bundle ID | `pt.autovalor.catalogo` — registado na equipa Apple `QBU2Z3YJ88` |
| Número de contacto | +351 965 637 736 |
| Telefone em formato internacional sem símbolos | `351965637736` |
| Política de privacidade | https://autovalorpt-assistente.vercel.app/app/privacidade.html |
| URL de suporte | https://autovalorpt-assistente.vercel.app/app/apoio.html |

O URL de privacidade foi guardado na Apple e verificado em produção com resposta **HTTP 200**, em 26/11/2026. O URL de apoio também está guardado na ficha. As revisões destas páginas que descrevem a build 3 estão incluídas no [PR #72](https://github.com/xroger1969/autovalorpt-assistente/pull/72). Confirmar o conteúdo publicado contra a aplicação nativa final antes da submissão à revisão.

## Ferramentas e contactos da build 3

**Incluídas na build 1.0.0 (3), compilada, processada pela Apple, instalada e aprovada pelo titular em 26/11/2026.** A verificação de tipos, os 8 testes nativos e a exportação dos bundles iOS/Android foram aprovados para estas alterações. O preview Vercel do mesmo commit aprovou os 727 testes web/backend, sem falhas. O separador **Contacto** passou a **Mais**, mantendo quatro separadores: Viaturas, Favoritos, Comparar e Mais. Um atalho no catálogo abre os simuladores e a avaliação do usado. O cabeçalho e o cartão de contacto usam o mesmo logótipo PNG através de `BrandMark`.

Os seguintes destinos foram confirmados na interface da bio de **@autovalorpt em 26/11/2026**:

| Ação | Destino externo |
| --- | --- |
| Avaliar o meu usado | [Pedido de avaliação](https://xroger1969.github.io/autovalorpt-avaliacao-v2/) |
| Simular crédito | [CREDICARROS](https://xroger1969.github.io/CREDICARROS/) |
| Simular carregamento | [CARREGADOR](https://xroger1969.github.io/CARREGADOR/) |
| Instagram | [@autovalorpt](https://www.instagram.com/autovalorpt/) |

A app abre estes endereços com `Linking`. A avaliação e os simuladores são páginas externas no navegador, exigem internet e não são formulários nativos. Os formulários não são preenchidos automaticamente pela app; os endereços não incluem parâmetros de tracking do Instagram. O WhatsApp direto mantém o número **+351 965 637 736**.

A descrição e as notas de revisão com estas ferramentas já foram guardadas na ficha pública, que permanece em rascunho e ainda não foi enviada para App Review. A informação beta global e o What to Test da build 3 também foram atualizados e guardados, com persistência confirmada na Apple.

## Descrição curta

Carros usados, favoritos e comparação num só lugar.

Este texto pode servir como descrição curta numa futura ficha Android. Na App Store, usar o subtítulo indicado acima; não confundir os dois campos.

## Texto promocional opcional

Consulte viaturas, guarde favoritos e compare até três carros na AutoValorPT.

## Descrição completa

**Descrição guardada no App Store Connect em 26/11/2026.** A ficha pública ainda não foi enviada para App Review; a build 3 foi testada e aprovada pelo titular e está selecionada para revisão, aguardando as screenshots nativas obrigatórias.

Explore o catálogo AutoValorPT e organize as viaturas que quer conhecer melhor.

Consulte as fotografias originais e os dados disponíveis de cada carro, incluindo preço, ano, quilómetros e combustível. Pesquise por marca ou modelo, filtre as opções e ordene os resultados de acordo com o que procura.

GUARDE AS SUAS OPÇÕES

Adicione viaturas aos favoritos para voltar a consultá-las. Os favoritos ficam guardados no dispositivo, sem necessidade de criar uma conta.

COMPARE ATÉ TRÊS VIATURAS

Selecione até três carros e compare os dados disponíveis numa só vista. A comparação ajuda a organizar as opções antes de pedir mais informações.

PARTILHE E ENTRE EM CONTACTO

Partilhe uma viatura através das opções de partilha do seu dispositivo. Pode também contactar a AutoValorPT para esclarecer dúvidas e confirmar o preço e a disponibilidade da viatura.

FERRAMENTAS PARA A SUA PRÓXIMA ESCOLHA

Na secção Mais, aceda às ferramentas AutoValorPT para pedir uma avaliação do seu usado, simular crédito e comparar custos de carregamento e utilização de um elétrico. Estas ferramentas abrem páginas externas no navegador e precisam de ligação à internet. Os formulários são preenchidos por si no serviço escolhido.

Encontre também o contacto direto por WhatsApp e o perfil Instagram @autovalorpt.

CONSULTE A ÚLTIMA CÓPIA GUARDADA

Depois de uma primeira consulta com ligação à internet, a app pode apresentar a última cópia válida do catálogo guardada no dispositivo quando não consegue atualizar os dados. A informação guardada pode já ter mudado; confirme a data indicada e a disponibilidade com a AutoValorPT. As fotografias e os serviços externos podem precisar de ligação à internet.

Uma forma prática de acompanhar as suas opções no iPhone e no iPad.

## Palavras-chave

```text
carros,usados,automoveis,eletricos,hibridos,stock,comparar,favoritos,Portugal
```

O conjunto acima fica abaixo de 100 bytes e não repete o nome da app.

## Notas para App Review

Referência editorial das notas atualizadas e guardadas no App Store Connect em 26/11/2026. O texto guardado tem conteúdo equivalente, incluindo as ferramentas externas, o endpoint público do catálogo e a origem OLX das fotografias; este bloco não é uma transcrição literal:

> A AutoValorPT é uma aplicação de catálogo automóvel com interface nativa React Native. A consulta do catálogo, a pesquisa, os favoritos e a comparação decorrem dentro da app, sem WebView. Não é necessário iniciar sessão para usar estas funcionalidades.
>
> O catálogo é obtido por HTTPS a partir de https://autovalorpt-assistente.vercel.app/api/stock?integration=catalogue-app. Apresenta o último stock sincronizado pelo sistema comercial existente. As fotografias originais são carregadas a partir do domínio ireland.apollo.olxcdn.com. A data do catálogo identifica a sincronização dos dados, não a hora de publicação da app. Os dados de gestor e as credenciais de administração não são usados pela aplicação.
>
> Para verificar as funcionalidades: abra o catálogo com internet; pesquise uma marca ou modelo; experimente os filtros; guarde uma viatura nos favoritos; selecione duas ou três viaturas para comparação. Os favoritos e a seleção para comparação são guardados localmente no dispositivo.
>
> Para verificar a consulta sem ligação, carregue primeiro o catálogo com internet. Depois desative a ligação e volte à app. Quando disponível, a última cópia válida dos dados é apresentada com indicação de que precisa de atualização. O primeiro carregamento exige internet; as fotografias remotas não têm disponibilidade offline garantida. Uma falha de atualização não deve ser interpretada como catálogo vazio ou como confirmação de disponibilidade atual.
>
> A partilha usa as opções nativas do sistema. O contacto WhatsApp abre uma ligação para +351 965 637 736 com uma mensagem preparada; o envio depende da ação da pessoa no serviço de destino. A consulta do catálogo não exige a instalação do WhatsApp.
>
> A secção Mais reúne contactos e ligações para os serviços AutoValorPT de avaliação do usado, simulação de crédito e simulação de carregamento. Um atalho no catálogo abre essa secção. As três ferramentas abrem páginas externas no navegador através do mecanismo de ligações do sistema; exigem internet e os respetivos formulários não são preenchidos automaticamente pela app. Não são simuladores nativos. Existe também uma ligação para o perfil Instagram @autovalorpt, sem parâmetros de tracking do Instagram nos endereços configurados.
>
> Esta versão não processa pagamentos ou reservas dentro da app. O contacto comercial serve para pedir informações e confirmar preço e disponibilidade. A app suporta iPhone e iPad.

Os contactos de revisão foram preenchidos e guardados na Apple em 26/11/2026:

| Campo de revisão | Estado |
| --- | --- |
| Nome e apelido do responsável | Carlos Vasconcelos — guardado |
| E-mail de contacto | Endereço do titular guardado no App Store Connect |
| Telefone | +351 965 637 736 — guardado como contacto de revisão |
| Credenciais de demonstração | Não aplicáveis à consulta pública; rever se a build final introduzir autenticação |
| Build selecionada para revisão | Build 1.0.0 (3) selecionada para App Review em 26/11/2026; a ficha pública ainda não foi enviada para revisão. |

## Screenshots pendentes

Capturar a aplicação nativa final num iPhone e num iPad. Não apresentar capturas do site como se fossem capturas desta app.

| Captura sugerida | Conteúdo |
| --- | --- |
| Catálogo | Fotografias e dados reais das viaturas, com o estado de atualização visível |
| Pesquisa e filtros | Uma pesquisa compreensível e filtros funcionais |
| Favoritos | Seleção de viaturas guardadas no dispositivo |
| Comparação | Duas ou três viaturas com dados disponíveis |
| Ficha da viatura | Informação e ações de partilha/contacto |
| Mais | Ferramentas e contactos da build 3 |

Preparar os formatos exigidos pela especificação Apple vigente. Na documentação consultada, existe uma categoria iPhone Dynamic Island de ecrã médio, com formatos como **1206 × 2622** e **1179 × 2556**. Como há suporte iPad, é também necessária a categoria de screenshots **iPad de 13 polegadas**. Confirmar os tamanhos aceites no momento do upload. As imagens não podem incluir transparência.

**Estado dos screenshots:** pendentes. O titular já testou a app instalada e aprovou a versão 3; faltam as capturas nativas exigidas para iPhone e iPad. O catálogo web existente foi verificado em desktop e a 390/320 px, mas essas capturas não são screenshots nativas para a App Store.

## Dados de conta e publicação

| Campo | Estado |
| --- | --- |
| Titular legal / nome do vendedor | Pendente de confirmação na conta Apple |
| Apple Team ID | `QBU2Z3YJ88` — confirmado |
| Apple ID numérico da app / `ascAppId` | `6839660385` — app criada e perfil de submissão configurado |
| SKU | `AUTOVALORPT-IOS-001` — registado |
| Conta Expo / EAS Project ID | `cvasconcelos1969s-team` / `99e2814b-559a-42fe-899b-19b167c1c05c`; projeto `autovalorpt-catalogo` ligado ao GitHub, pasta `mobile` |
| Bundle ID | `pt.autovalor.catalogo` — registado na equipa Apple confirmada |
| Perfil de assinatura App Store | Perfil correto para `QBU2Z3YJ88.pt.autovalor.catalogo`, disponível e válido no Expo; correspondência confirmada com o certificado de distribuição existente. |
| IPA assinada | Build de produção 1.0.0 (3) concluída pelo EAS, submetida e processada pela Apple, com estado «Pronta para enviar». Inclui as ferramentas e os contactos atualizados. |
| Publicação Android | Pendente; ainda não foi executada uma build nativa Android |
| Preço da aplicação e territórios | Gratuita (0 EUR), com Portugal como país base. Disponibilidade configurada e guardada apenas para Portugal (1 país); inclusão automática de futuros países desativada. |
| Classificação etária | 4+ — questionário concluído e guardado na Apple em 26/11/2026 |
| Direitos de conteúdo | Declaração de conteúdo de terceiros e respetivos direitos guardada na Apple em 26/11/2026; catálogo baseado nos inventários autorizados AutoValorPT/Samucar e fotografias originais dos anúncios |
| Copyright | 2026 Carlos Vasconcelos — confirmado como guardado na Apple |
| Declaração App Privacy | Publicada na Apple em 26/11/2026: localização aproximada e outros dados de diagnóstico; finalidade funcionalidade da app; associados ao utilizador; não utilizados para tracking |
| Exportação de encriptação | Build 3 configurada com `ITSAppUsesNonExemptEncryption: false`; o código utiliza HTTPS/TLS do sistema, sem encriptação própria |
| Estado de comerciante DSA / contactos UE | A interface Apple identifica a app como disponibilizada por um comerciante. O estado de verificação do comerciante ao nível da conta não foi confirmado de forma independente. |
| Grupo interno TestFlight | Team (Expo), com 2 compilações, as builds 2 e 3, processadas e associadas; 1 tester, apenas o titular, que confirmou a instalação e o teste em 26/11/2026 |
| Informação beta | Beta Info global e notas atualizadas para Mais, simuladores e logótipo. What to Test da build 3 preenchido e guardado, com persistência confirmada. |
| Ligação pública TestFlight | Ainda não confirmada; requer grupo e revisão aplicáveis para testadores externos. |
| Publicação pública na App Store | Pendente; ficha 1.0.0 em rascunho, ainda não enviada para revisão, com lançamento manual. |

A declaração App Privacy considera o endereço IP, a cidade/país aproximados derivados desse IP e os dados técnicos tratados pelo alojamento para funcionamento e segurança. A app nativa não pede acesso ao GPS. Pesquisa, favoritos e comparação permanecem locais; não existe SDK de publicidade, analytics ou tracking no cliente. As categorias declaradas não se referem aos formulários que o utilizador pode optar por abrir e preencher no navegador externo.

## Fontes oficiais

Consultadas em 26 de novembro de 2026; confirmar os requisitos antes da submissão.

- [Regras de revisão Apple, incluindo utilidade da app e catálogos](https://developer.apple.com/app-store/review/guidelines/)
- [Informação e identificadores da app](https://developer.apple.com/help/app-store-connect/reference/app-information/app-and-compliance-information/)
- [Campos da versão e informação de suporte](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)
- [Especificações de screenshots](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [Política de privacidade e respostas App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)
- [Definições de recolha e detalhes de privacidade](https://developer.apple.com/app-store/app-privacy-details/)
- [Classificação etária Apple](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/)
- [Privacidade da Vercel, incluindo visitantes das APIs de clientes](https://vercel.com/legal/privacy-notice)
- [Dados técnicos e retenção de logs Vercel](https://vercel.com/docs/logs/runtime)
- [Requisitos de comerciante na União Europeia](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements)
- [Distribuição TestFlight com Expo](https://docs.expo.dev/submit/testflight/)

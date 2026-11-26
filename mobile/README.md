# AutoValorPT — app nativa

Aplicação em português de Portugal para consultar o catálogo AutoValorPT no iPhone e no iPad, com uma base preparada para Android. A interface usa componentes React Native; não é uma WebView do site.

O projeto usa Expo e TypeScript. As versões concretas das dependências estão em `package.json` e devem ficar fixadas no `package-lock.json`. A configuração iOS atual inclui `supportsTablet: true`; por isso, a validação e os materiais de publicação devem abranger iPhone **e iPad**.

## Estado da entrega

Em **26/11/2026**, a build iOS de produção **1.0.0 (3)** foi compilada, submetida e processada com sucesso pela Apple. A build 3 está **«Pronta para enviar»** no TestFlight e associada ao grupo interno **Team (Expo)**. O grupo tem **2 compilações, as builds 2 e 3, e 1 tester convidado**; apenas o titular foi adicionado. Ainda não há instalação ou sessões registadas, validação visual nativa ou publicação pública na App Store.

A build 3 inclui as ferramentas da bio, a secção Mais, o atalho no catálogo e o logótipo comum descritos em **«Ferramentas e contactos da build 3»**. A descrição e as notas da ficha pública foram atualizadas e guardadas na Apple com estas funcionalidades.

| Etapa | Estado verificado em 26/11/2026 |
| --- | --- |
| TypeScript e testes de lógica | Build 3: verificação de tipos e 8 testes nativos aprovados em 26/11/2026. O gate obrigatório do preview Vercel do mesmo commit aprovou os 727 testes web/backend, sem falhas. |
| Expo Doctor | 19 de 20 verificações aprovadas. O único aviso refere-se a `eas-cli` como dependência local de desenvolvimento; não impediu a compilação. |
| Exportação dos bundles iOS e Android | Concluída para o código da build 3 em ambas as plataformas, em 26/11/2026. Produz JavaScript/Hermes e recursos, não uma IPA ou um APK. |
| Geração e compilação nativas | Expo Prebuild para iOS e Android concluído; builds iOS de simulador e de produção concluídas pelo EAS com Expo SDK 58.0.26. Ainda não foi compilado um binário Android. |
| Teste da interface em iPhone e iPad | Pendente de evidência em dispositivos ou simuladores nativos. |
| Catálogo web existente | Publicado e verificado em desktop e larguras de 390 e 320 px, com oito viaturas e sem transbordo horizontal. Estas verificações não validam a interface nativa. A correção de acessibilidade dos filtros está acompanhada no [PR #70](https://github.com/xroger1969/autovalorpt-assistente/pull/70). |
| Preview Vercel do código da build 3 | Deployment `dpl_3TXwht2oTDsG7dGC92qTPa7d8s5k` em estado READY, a partir do commit `877654a24a86b4fad319683c20b12bb7881a5566`; gate concluído em 3 minutos. Apoio e privacidade foram revistos no [PR #72](https://github.com/xroger1969/autovalorpt-assistente/pull/72). |
| Conta Expo e projeto EAS | Projeto `autovalorpt-catalogo` criado na conta `cvasconcelos1969s-team`; ID `99e2814b-559a-42fe-899b-19b167c1c05c`. GitHub ligado ao repositório atual e pasta `/mobile`. A sessão CLI local continua sem login. |
| Conta Apple, equipa e identificadores | Registo criado em 26/11/2026: Carlos Vasconcelos, equipa `QBU2Z3YJ88`, bundle `pt.autovalor.catalogo`, Apple ID `6839660385`. |
| Perfil de assinatura App Store | Perfil correto disponível e válido no Expo, com correspondência confirmada ao certificado de distribuição existente. |
| IPA assinada e TestFlight | Produção 1.0.0 (3) compilada, submetida e processada; Apple mostra «Pronta para enviar». Grupo interno Team (Expo) com as builds 2 e 3 e 1 tester convidado; sem instalação ou sessões registadas. |
| Informação beta | Beta Info global e notas atualizadas para Mais, simuladores e logótipo; What to Test da build 3 preenchido e guardado, com persistência confirmada na Apple. |
| App Store e screenshots | Ficha pública 1.0.0 em rascunho PT-PT, com lançamento manual. Descrição completa com ferramentas, notas de revisão, contactos de revisão e copyright «2026 Carlos Vasconcelos» guardados. Subtítulo, categoria Compras e URLs de apoio/privacidade também guardados. Faltam validação visual, screenshots nativas e submissão à revisão da App Store. |

**Última build de produção enviada:** [EAS `c53a3057-d41f-4205-a683-493313ff6481`](https://expo.dev/accounts/cvasconcelos1969s-team/projects/autovalorpt-catalogo/builds/c53a3057-d41f-4205-a683-493313ff6481), estado **Succeeded**, versão **1.0.0 (3)**, a partir do commit `877654a24a86b4fad319683c20b12bb7881a5566`. A compilação demorou **2 min 10 s**, com **2 min 37 s** de duração total. A [submissão EAS `9f500b1b-9dd0-4879-97f4-17f11d2b0738`](https://expo.dev/accounts/cvasconcelos1969s-team/projects/autovalorpt-catalogo/submissions/9f500b1b-9dd0-4879-97f4-17f11d2b0738) terminou com estado **Succeeded**, enviada às **18:07 de 26/11/2026, hora de Lisboa**. A Apple concluiu o processamento e confirmou a associação ao grupo interno nos [detalhes da build 3 no TestFlight](https://appstoreconnect.apple.com/teams/f14e8d50-2439-4216-bbe0-5697b90f3551/apps/6839660385/testflight/ios/4d947a8a-378c-412c-af86-5d77a82ca94a), com estado **«Pronta para enviar»**. A ligação dá acesso à página de gestão da build.

**Build anterior já processada:** [EAS `d858fcd5-a2a7-4290-85fd-79daf47f3b9d`](https://expo.dev/accounts/cvasconcelos1969s-team/projects/autovalorpt-catalogo/builds/d858fcd5-a2a7-4290-85fd-79daf47f3b9d), estado **Succeeded**, versão **1.0.0 (2)**, a partir do commit `ff2629c7ac80fac98d6dc5e3a612f6bab97fefec`. A submissão EAS `c22925e6-1c63-4b68-9892-ca74052a2b85` terminou com estado **Succeeded** às **17:44 de 26/11/2026**. O processamento e a associação ao grupo interno foram confirmados nos [detalhes da build 2 no App Store Connect](https://appstoreconnect.apple.com/teams/f14e8d50-2439-4216-bbe0-5697b90f3551/apps/6839660385/testflight/ios/f2758a0b-d878-4c20-90fa-c36be985fcf1). Esta é uma página de gestão, não uma ligação pública de instalação.

**Referência histórica de simulador:** [EAS `ae9ca583-0113-4179-90c2-86bb90af9117`](https://expo.dev/accounts/cvasconcelos1969s-team/projects/autovalorpt-catalogo/builds/ae9ca583-0113-4179-90c2-86bb90af9117), estado **Succeeded**, versão **1.0.0 (1)**, a partir do commit `e7f0cb0e7f04498c45bc4aa6bf0cc9460d1b661a`. A compilação demorou **2 min 44 s**, com **3 min 33 s** de duração total. O serviço Expo Simulators estava indisponível para esta conta, pelo que não foi executado um teste visual nativo.

Guardar o resultado e a data das verificações efetuadas no relatório da entrega ou no pull request. Não substituir a validação num dispositivo nativo por capturas de uma versão web.

O workflow GitHub Actions [Validate desta alteração](https://github.com/xroger1969/autovalorpt-assistente/actions/runs/45872834770) não arrancou: a anotação pública indica bloqueio da conta por um problema de faturação. Nenhuma proteção foi desativada. As verificações de código e a compilação EAS acima foram concluídas; o gate Vercel do mesmo código executou os 727 testes com sucesso.

## Catálogo e atualização

A aplicação lê o endpoint público:

```text
https://autovalorpt-assistente.vercel.app/api/stock?integration=catalogue-app
```

Este endpoint disponibiliza o último snapshot de stock sincronizado pelo sistema usado em `stock-rapido.html`, a mesma fonte comercial do catálogo WhatsApp. A app não precisa do código privado do gestor, de cookies administrativos nem de tokens Meta.

O cliente valida a resposta completa antes de a apresentar ou guardar. `updatedAt` é a data da sincronização do catálogo; a hora da última consulta da app é um dado diferente. Uma consulta bem-sucedida não significa que a origem tenha sido sincronizada nesse instante.

A lógica de consulta pede os dados ao abrir a app, ao regressar ao primeiro plano e periodicamente enquanto está ativa. Não cria uma rotina de atualização em segundo plano no servidor. A gestão do stock continua no sistema existente.

Funcionalidades implementadas no código, com validação final em dispositivo ainda pendente:

- Pesquisa, filtros por combustível e marca, limite de preço e ordenação.
- Fotografia original, preço, ano e quilómetros quando esses dados existem no catálogo.
- Favoritos guardados no dispositivo e comparação de até três viaturas.
- Partilha através do sistema e contacto AutoValorPT pelo número **+351 965 637 736**.
- Consulta da última cópia válida do catálogo quando a atualização falha, com indicação de que os dados precisam de confirmação.

O primeiro carregamento do catálogo requer internet. A cópia local conserva dados comerciais e preferências; não garante que todas as fotografias estejam disponíveis sem ligação. Preços e disponibilidade devem ser confirmados com a AutoValorPT. Os contactos externos dependem dos serviços correspondentes.

## Ferramentas e contactos da build 3

**Estado: incluídas na build 1.0.0 (3), compilada, enviada, processada pela Apple e associada ao grupo interno TestFlight; validação nativa pendente.** A verificação de tipos, os 8 testes nativos e a exportação dos bundles iOS/Android foram aprovados para estas alterações. O preview Vercel do mesmo commit aprovou os 727 testes web/backend, sem falhas.

- A navegação mantém quatro separadores: **Viaturas**, **Favoritos**, **Comparar** e **Mais**. O separador Mais substitui Contacto e reúne as ferramentas e os contactos.
- O catálogo inclui o atalho **Simuladores e avaliação do usado** para abrir essa secção.
- A secção Mais inclui três ferramentas da bio e o perfil Instagram, através dos endereços confirmados abaixo.
- O componente `BrandMark` usa o mesmo logótipo PNG no cabeçalho e no cartão de contacto.
- O contacto direto por WhatsApp mantém o número **+351 965 637 736**.

Os destinos foram confirmados na interface da bio de **@autovalorpt em 26/11/2026**:

| Ação | Destino |
| --- | --- |
| Avaliar o meu usado | [Pedido de avaliação](https://xroger1969.github.io/autovalorpt-avaliacao-v2/) |
| Simular crédito | [CREDICARROS](https://xroger1969.github.io/CREDICARROS/) |
| Simular carregamento | [CARREGADOR](https://xroger1969.github.io/CARREGADOR/) |
| Instagram | [@autovalorpt](https://www.instagram.com/autovalorpt/) |

A avaliação e os simuladores são serviços externos, abertos pelo `Linking` do React Native no navegador; não são simuladores nativos incorporados na app. Exigem internet. A app não preenche os formulários desses serviços e os endereços não incluem parâmetros de tracking do Instagram. O Instagram abre através do mesmo mecanismo de ligação externa. O contacto WhatsApp só prepara a conversa; o envio da mensagem depende da pessoa.

A descrição PT-PT completa com estas ferramentas foi **guardada na ficha pública da Apple em 26/11/2026**, e as notas de revisão foram atualizadas com conteúdo equivalente, incluindo o endpoint do catálogo e a origem OLX das fotografias. `store/pt-PT.md` conserva a descrição e uma referência editorial das notas. A ficha permanece em rascunho; guardar os textos não publica a app nem substitui a validação nativa.

## Preparação local

Usar Node compatível com `engines` em `package.json`. A partir da raiz deste repositório:

```sh
cd mobile
npm ci
npm run check
npm run export:native
```

`npm ci` pressupõe um `package-lock.json` versionado e coerente. `npm run check` executa a verificação TypeScript, os testes e a verificação de versões Expo. `npm run export:native` prepara os bundles iOS e Android em `dist-native`.

Para iniciar o servidor de desenvolvimento:

```sh
npm start
```

É possível desenvolver e validar a lógica neste ambiente Linux. A compilação iOS local exige macOS e Xcode. A compilação Android local exige a instalação e configuração do SDK Android e da toolchain correspondente.

## Associar o projeto às contas corretas

O identificador **`pt.autovalor.catalogo`** foi registado em Apple Developer na equipa **`QBU2Z3YJ88`** (Carlos Vasconcelos), em 26/11/2026. A ficha App Store Connect tem Apple ID **`6839660385`**, SKU **`AUTOVALORPT-IOS-001`**, idioma `pt-PT` e versão **1.0.0**. `app.json` e `eas.json` usam estes identificadores reais. A configuração Android usa o mesmo identificador de pacote; ainda não existe uma publicação Google Play verificada.

[Ficha da AutoValorPT no App Store Connect](https://appstoreconnect.apple.com/apps/6839660385/distribution/ios/version/inflight).

O projeto Expo **`autovalorpt-catalogo`** foi criado na conta **`cvasconcelos1969s-team`**, com EAS Project ID **`99e2814b-559a-42fe-899b-19b167c1c05c`**, ligado a este repositório e à pasta **`/mobile`**. O `app.json` já contém a associação real.

[Projeto Expo AutoValorPT](https://expo.dev/accounts/cvasconcelos1969s-team/projects/autovalorpt-catalogo). Não criar um segundo projeto nem substituir os identificadores Apple por valores de outra app. A sessão do navegador foi suficiente para este registo; não foi extraída para autenticar o terminal.

O EAS CLI instalado pelo projeto permite consultar a sessão e o projeto já associado:

```sh
npx eas whoami
npx eas project:info
```

O login é necessário apenas quando não existe uma sessão válida. Num ambiente com o browser separado do terminal, o fluxo oficial de dispositivo permite autorizar a sessão sem copiar cookies ou tokens:

```sh
npx eas login --device --non-interactive
```

Depois da aprovação no endereço apresentado, retomar com `npx eas login --device --non-interactive --resume REQUEST_ID`; acrescentar `--match NUMERO_APRESENTADO` apenas se o fluxo pedir essa confirmação. A build de simulador de referência foi iniciada pela interface web Expo a partir do GitHub, sem autenticar o CLI local.

As credenciais Apple e Expo devem ser introduzidas através dos fluxos oficiais ou do armazenamento seguro de segredos do serviço. Não colocar palavras-passe, códigos de autenticação, chaves `.p8`, certificados ou tokens neste repositório, em `app.json`, no código da app ou em variáveis `EXPO_PUBLIC_*`.

O uso anterior de Expo ou Apple Developer noutras apps não confirma, por si só, que esta sessão tenha acesso à mesma conta ou equipa.

## Build iOS, TestFlight e publicação

O perfil App Store correto para **`QBU2Z3YJ88.pt.autovalor.catalogo`** está disponível e válido nas credenciais iOS do projeto Expo. A correspondência com o certificado iOS Distribution existente foi confirmada e permitiu compilar as IPAs assinadas **1.0.0 (2)** e **1.0.0 (3)**. O ficheiro de perfil e os restantes materiais de assinatura não devem ser adicionados ao repositório.

O perfil `production` de `eas.json` usa distribuição de loja. Para compilar a próxima versão com a conta, os identificadores e a assinatura já associados:

```sh
npm run build:ios
```

Este comando pede uma compilação à infraestrutura Expo; pode ser iniciado em Linux. Para uma build destinada a TestFlight ou App Store, é necessário acesso a uma conta Apple Developer ativa e à assinatura adequada. Registar o identificador e o resultado reais da build.

Para enviar uma build de produção concluída:

```sh
npm run submit:ios
```

O perfil de submissão já usa o `ascAppId` real **`6839660385`**. A submissão de uma IPA assinada permite o processamento no App Store Connect e no TestFlight; a publicação pública exige os metadados, a revisão Apple e a opção de lançamento escolhida.

A build 3 está processada, com estado **«Pronta para enviar»**, e associada ao grupo interno **Team (Expo)**, que contém as builds 2 e 3. O único tester é o titular, no estado **Convidado**, com data de 26/11/2026; não há instalação ou sessões registadas. **Beta Info** global e as notas foram atualizadas para Mais, simuladores e logótipo. O **What to Test da build 3** foi preenchido e guardado, com persistência confirmada na Apple. A execução nativa continua pendente. A ficha pública 1.0.0 permanece em rascunho e ainda não foi enviada para App Review.

Uma ligação pública para testadores externos ainda não está confirmada. Testadores externos do TestFlight precisam de um grupo e da revisão beta aplicável. Só apresentar uma ligação de teste como disponível depois de verificar a build, o grupo e o acesso correspondentes.

O perfil `simulator` permite preparar uma build iOS de simulador, sem assinatura de dispositivo:

```sh
npx eas build --platform ios --profile simulator
```

Uma build de simulador não pode ser enviada para TestFlight. O simulador iOS local exige Mac. A alternativa Expo Simulators permite controlo remoto a partir de Linux, mas depende da disponibilidade do serviço para a conta; não foi possível executar essa validação nesta entrega.

Para uma fase Android posterior, estão disponíveis `npm run preview:android` e `npm run build:android`. Ainda não foi executada uma build nativa Android. O APK de pré-visualização e a build de loja têm destinos diferentes; confirmar a assinatura e o registo Google Play antes de distribuir.

## Privacidade e materiais da loja

Os dados locais incluem favoritos, seleção para comparação e a última cópia válida do catálogo. Rever a recolha efetiva do binário, dos SDKs e dos serviços usados antes de preencher o questionário App Privacy. Não declarar ausência de recolha apenas porque não há formulário de registo na app.

Rever os manifests de privacidade das dependências efetivamente instaladas e as razões de acesso exigidas pela Apple. As declarações devem corresponder ao binário final. A definição de exportação de encriptação também deve ser confirmada para essa build.

Endereços da entrega:

- Privacidade: <https://autovalorpt-assistente.vercel.app/app/privacidade.html>
- Apoio: <https://autovalorpt-assistente.vercel.app/app/apoio.html>

O URL de privacidade foi guardado no App Store Connect e verificado em produção com resposta **HTTP 200**, em 26/11/2026. O URL de apoio também está guardado na ficha. As revisões destas páginas incluídas no código da build 3 estão no preview Vercel e **ainda aguardam merge e publicação em produção**. Confirmar o conteúdo publicado contra a versão nativa final antes da submissão à revisão. A ficha PT-PT, as notas para revisão e os campos ainda pendentes estão em `store/pt-PT.md`.

## Fontes oficiais

Documentação consultada em 26 de novembro de 2026; confirmar alterações antes de publicar.

- [Compatibilidade Expo SDK](https://docs.expo.dev/versions/latest/)
- [Expo CLI: exportação e compilação](https://docs.expo.dev/more/expo-cli/)
- [EAS CLI: autenticação e comandos](https://docs.expo.dev/eas/cli/)
- [Builds locais](https://docs.expo.dev/guides/local-app-development/)
- [Certificados e perfis de assinatura](https://docs.expo.dev/app-signing/app-credentials/)
- [Submissão iOS a partir de Expo](https://docs.expo.dev/submit/ios/)
- [Distribuição através do TestFlight](https://docs.expo.dev/submit/testflight/)
- [Simulador iOS sem Mac próprio](https://docs.expo.dev/eas/simulators/how-to/work-without-a-mac/)
- [Acesso e utilização de Expo Simulators](https://docs.expo.dev/eas/simulators/reference/usage-and-billing/)
- [Manifests de privacidade no Expo](https://docs.expo.dev/guides/apple-privacy/)
- [Privacidade no App Store Connect](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)
- [Identificadores e informações da app](https://developer.apple.com/help/app-store-connect/reference/app-information/app-and-compliance-information/)

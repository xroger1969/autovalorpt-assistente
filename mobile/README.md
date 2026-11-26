# AutoValorPT — app nativa

Aplicação em português de Portugal para consultar o catálogo AutoValorPT no iPhone e no iPad, com uma base preparada para Android. A interface usa componentes React Native; não é uma WebView do site.

O projeto usa Expo e TypeScript. As versões concretas das dependências estão em `package.json` e devem ficar fixadas no `package-lock.json`. A configuração iOS atual inclui `supportsTablet: true`; por isso, a validação e os materiais de publicação devem abranger iPhone **e iPad**.

## Estado da entrega

Em **26/11/2026**, a aplicação foi compilada com sucesso pelo EAS para o **simulador iOS**. Existe, portanto, uma build nativa de simulador; ainda não existe uma IPA assinada, uma build no TestFlight ou uma publicação na App Store. A interface ainda não foi executada num dispositivo ou simulador nativo.

| Etapa | Estado verificado em 26/11/2026 |
| --- | --- |
| TypeScript e testes de lógica | Aprovados em 26/11/2026: verificação de tipos e 8 testes nativos; 710 testes do projeto web/backend também aprovados. |
| Expo Doctor | 19 de 20 verificações aprovadas. O único aviso refere-se a `eas-cli` como dependência local de desenvolvimento; não impediu a compilação. |
| Exportação dos bundles iOS e Android | Concluída para ambas as plataformas em 26/11/2026. Produz JavaScript/Hermes e recursos, não uma IPA ou um APK. |
| Geração e compilação nativas | Expo Prebuild para iOS e Android concluído; build nativa iOS de simulador concluída pelo EAS com Expo SDK 58.0.26. Ainda não foi compilado um binário Android. |
| Teste da interface em iPhone e iPad | Pendente de evidência em dispositivos ou simuladores nativos. |
| Catálogo web existente | Publicado e verificado em desktop e larguras de 390 e 320 px, com oito viaturas e sem transbordo horizontal. Estas verificações não validam a interface nativa. A correção de acessibilidade dos filtros está acompanhada no [PR #70](https://github.com/xroger1969/autovalorpt-assistente/pull/70). |
| Conta Expo e projeto EAS | Projeto `autovalorpt-catalogo` criado na conta `cvasconcelos1969s-team`; ID `99e2814b-559a-42fe-899b-19b167c1c05c`. GitHub ligado ao repositório atual e pasta `/mobile`. A sessão CLI local continua sem login. |
| Conta Apple, equipa e identificadores | Registo criado em 26/11/2026: Carlos Vasconcelos, equipa `QBU2Z3YJ88`, bundle `pt.autovalor.catalogo`, Apple ID `6839660385`. |
| Perfil de assinatura App Store | Criado na Apple para esta app; o carregamento do perfil no Expo ainda está pendente. |
| IPA assinada e TestFlight | Pendentes. A build de simulador não pode ser enviada para TestFlight. |
| App Store e screenshots | Ficha 1.0.0 em rascunho PT-PT, com lançamento manual. Descrição, apoio e notas guardados; subtítulo, categoria Compras e URL de privacidade confirmados como guardados. Faltam screenshots nativas e submissão. |

**Build nativa de referência:** [EAS `ae9ca583-0113-4179-90c2-86bb90af9117`](https://expo.dev/accounts/cvasconcelos1969s-team/projects/autovalorpt-catalogo/builds/ae9ca583-0113-4179-90c2-86bb90af9117), estado **Succeeded**, versão **1.0.0 (1)**, a partir do commit `e7f0cb0e7f04498c45bc4aa6bf0cc9460d1b661a`. A compilação demorou **2 min 44 s**, com **3 min 33 s** de duração total. O serviço Expo Simulators estava indisponível para esta conta, pelo que não foi executado um teste visual nativo.

Guardar o resultado e a data das verificações efetuadas no relatório da entrega ou no pull request. Não substituir a validação num dispositivo nativo por capturas de uma versão web.

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

O perfil Apple **`AutoValorPT Catalogo App Store 20261126`** foi gerado para **`QBU2Z3YJ88.pt.autovalor.catalogo`**, com validade até **14/10/2027**, usando um certificado iOS Distribution já existente na equipa Apple. **Falta descarregar o perfil na Apple e carregá-lo nas credenciais iOS do projeto Expo.** A correspondência com o certificado guardado no Expo deve ser confirmada nessa importação. O perfil ainda não está disponível no Expo para esta app; não foi gerada uma IPA assinada. O ficheiro de perfil e os restantes materiais de assinatura não devem ser adicionados ao repositório.

O perfil `production` de `eas.json` usa distribuição de loja. Depois de confirmar conta, identificadores, assinatura e condições de utilização do serviço:

```sh
npm run build:ios
```

Este comando pede uma compilação à infraestrutura Expo; pode ser iniciado em Linux. Para uma build destinada a TestFlight ou App Store, é necessário acesso a uma conta Apple Developer ativa e à assinatura adequada. Registar o identificador e o resultado reais da build.

Para enviar uma build de produção concluída:

```sh
npm run submit:ios
```

O perfil de submissão já usa o `ascAppId` real **`6839660385`**. A submissão de uma IPA assinada permite o processamento no App Store Connect e no TestFlight; a publicação pública exige os metadados, a revisão Apple e a opção de lançamento escolhida.

Testadores externos do TestFlight precisam de um grupo e da revisão beta aplicável. A ligação de teste só deve ser apresentada como disponível depois de a build estar processada e atribuída ao grupo correto.

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

O URL de privacidade foi guardado no App Store Connect e verificado em produção com resposta **HTTP 200**, em 26/11/2026. O URL de apoio também está guardado na ficha. Rever o conteúdo de ambos contra a versão nativa final antes da submissão. A ficha PT-PT, as notas para revisão e os campos ainda pendentes estão em `store/pt-PT.md`.

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

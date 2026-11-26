# AutoValorPT — app nativa

Aplicação em português de Portugal para consultar o catálogo AutoValorPT no iPhone e no iPad, com uma base preparada para Android. A interface usa componentes React Native; não é uma WebView do site.

O projeto usa Expo e TypeScript. As versões concretas das dependências estão em `package.json` e devem ficar fixadas no `package-lock.json`. A configuração iOS atual inclui `supportsTablet: true`; por isso, a validação e os materiais de publicação devem abranger iPhone **e iPad**.

## Estado da entrega

Este diretório contém a preparação da aplicação e os ficheiros necessários para continuar o desenvolvimento e configurar uma build. A existência do código, de `eas.json` ou de um bundle JavaScript não comprova que exista uma aplicação iOS compilada, assinada ou publicada.

| Etapa | Estado a registar antes de publicar |
| --- | --- |
| TypeScript e testes de lógica | Aprovados em 26/11/2026: verificação de tipos e 8 testes nativos; 710 testes do projeto web/backend também aprovados. |
| Versões das dependências | Conferidas com os metadados incluídos no Expo SDK 58. A consulta online ao diretório React Native esteve indisponível neste ambiente. |
| Exportação dos bundles iOS e Android | Concluída para ambas as plataformas em 26/11/2026. Produz JavaScript/Hermes e recursos, não uma IPA ou um APK. |
| Geração dos projetos nativos | Expo Prebuild para iOS e Android concluído; não foram instalados Pods nem compilados binários. |
| Teste da interface em iPhone e iPad | Pendente de evidência em dispositivos ou simuladores nativos. |
| Conta Expo e projeto EAS | `eas whoami` devolveu `Not logged in`. Associação à conta correta pendente. |
| Conta Apple, equipa e identificadores | Pendentes de confirmação. |
| IPA assinada e TestFlight | Não confirmados por este documento. Registar a build e a ligação reais quando existirem. |
| App Store e screenshots | Preparação editorial em `store/pt-PT.md`; submissão e publicação não confirmadas. |

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

A configuração propõe o identificador **`pt.autovalor.catalogo`** para iOS e Android. É uma proposta: confirmar a disponibilidade e a titularidade na conta correta **antes de o registar ou enviar a primeira build**. A Apple não permite alterar o bundle ID de um registo depois do primeiro upload.

Não há um Apple App ID, Team ID, conta Expo ou EAS Project ID fictício a preencher por aproximação. Usar os identificadores devolvidos pelas contas reais. Antes de criar um projeto novo, verificar se já existe um projeto AutoValorPT adequado nessa conta.

Com a conta Expo selecionada, o EAS CLI instalado pelo projeto pode ser usado para consultar a sessão e associar o projeto:

```sh
npx eas whoami
npx eas login
npx eas project:info
```

O login é necessário apenas quando não existe uma sessão válida. Se a app ainda não estiver associada, usar `npx eas init` para selecionar um projeto existente ou criar o projeto correto após a verificação. O comando poderá atualizar a configuração com o EAS Project ID real.

As credenciais Apple e Expo devem ser introduzidas através dos fluxos oficiais ou do armazenamento seguro de segredos do serviço. Não colocar palavras-passe, códigos de autenticação, chaves `.p8`, certificados ou tokens neste repositório, em `app.json`, no código da app ou em variáveis `EXPO_PUBLIC_*`.

O uso anterior de Expo ou Apple Developer noutras apps não confirma, por si só, que esta sessão tenha acesso à mesma conta ou equipa.

## Build iOS, TestFlight e publicação

O perfil `production` de `eas.json` usa distribuição de loja. Depois de confirmar conta, identificadores, assinatura e condições de utilização do serviço:

```sh
npm run build:ios
```

Este comando pede uma compilação à infraestrutura Expo; pode ser iniciado em Linux. Para uma build destinada a TestFlight ou App Store, é necessário acesso a uma conta Apple Developer ativa e à assinatura adequada. Registar o identificador e o resultado reais da build.

Para enviar uma build de produção concluída:

```sh
npm run submit:ios
```

Confirmar o registo de app correto no App Store Connect. Se for configurado `ascAppId` no perfil de submissão, usar apenas o ID real devolvido pela Apple. A submissão do binário permite o processamento no App Store Connect e no TestFlight; a publicação pública exige os metadados, a revisão Apple e a opção de lançamento escolhida.

Testadores externos do TestFlight precisam de um grupo e da revisão beta aplicável. A ligação de teste só deve ser apresentada como disponível depois de a build estar processada e atribuída ao grupo correto.

O perfil `simulator` permite preparar uma build iOS de simulador, sem assinatura de dispositivo:

```sh
npx eas build --platform ios --profile simulator
```

Uma build de simulador não pode ser enviada para TestFlight. O simulador iOS local exige Mac. A alternativa Expo Simulators permite controlo remoto a partir de Linux, mas depende de uma conta elegível num plano pago; confirmar o acesso e as condições antes de iniciar uma sessão.

Para uma fase Android posterior, estão disponíveis `npm run preview:android` e `npm run build:android`. O APK de pré-visualização e a build de loja têm destinos diferentes; confirmar a assinatura e o registo Google Play antes de distribuir.

## Privacidade e materiais da loja

Os dados locais incluem favoritos, seleção para comparação e a última cópia válida do catálogo. Rever a recolha efetiva do binário, dos SDKs e dos serviços usados antes de preencher o questionário App Privacy. Não declarar ausência de recolha apenas porque não há formulário de registo na app.

Rever os manifests de privacidade das dependências efetivamente instaladas e as razões de acesso exigidas pela Apple. As declarações devem corresponder ao binário final. A definição de exportação de encriptação também deve ser confirmada para essa build.

Endereços previstos para a entrega:

- Privacidade: <https://autovalorpt-assistente.vercel.app/app/privacidade.html>
- Apoio: <https://autovalorpt-assistente.vercel.app/app/apoio.html>

Confirmar que ambos abrem publicamente e correspondem à versão nativa antes da submissão. A ficha PT-PT, as notas para revisão e os campos ainda pendentes estão em `store/pt-PT.md`.

## Fontes oficiais

Documentação consultada em 26 de novembro de 2026; confirmar alterações antes de publicar.

- [Compatibilidade Expo SDK](https://docs.expo.dev/versions/latest/)
- [Expo CLI: exportação e compilação](https://docs.expo.dev/more/expo-cli/)
- [Builds locais](https://docs.expo.dev/guides/local-app-development/)
- [Submissão iOS a partir de Expo](https://docs.expo.dev/submit/ios/)
- [Distribuição através do TestFlight](https://docs.expo.dev/submit/testflight/)
- [Simulador iOS sem Mac próprio](https://docs.expo.dev/eas/simulators/how-to/work-without-a-mac/)
- [Acesso e utilização de Expo Simulators](https://docs.expo.dev/eas/simulators/reference/usage-and-billing/)
- [Manifests de privacidade no Expo](https://docs.expo.dev/guides/apple-privacy/)
- [Privacidade no App Store Connect](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)
- [Identificadores e informações da app](https://developer.apple.com/help/app-store-connect/reference/app-information/app-and-compliance-information/)

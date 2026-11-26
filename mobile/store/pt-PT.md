# AutoValorPT — ficha da loja em português de Portugal

**Estado em 26/11/2026: ficha Apple criada, versão 1.0.0 em rascunho, com lançamento manual.** O Apple ID é `6839660385`; a equipa é `QBU2Z3YJ88` e o SKU é `AUTOVALORPT-IOS-001`. A descrição, palavras-chave, URLs de apoio/marketing, notas de revisão e ausência de login foram guardados no App Store Connect. O subtítulo **O teu próximo automóvel**, a categoria **Compras** e o URL de privacidade também foram confirmados como guardados. Os textos abaixo são a base editorial; rever a versão guardada antes da submissão.

[App Store Connect — AutoValorPT](https://appstoreconnect.apple.com/apps/6839660385/distribution/ios/version/inflight). A [build nativa de simulador iOS `ae9ca583-0113-4179-90c2-86bb90af9117`](https://expo.dev/accounts/cvasconcelos1969s-team/projects/autovalorpt-catalogo/builds/ae9ca583-0113-4179-90c2-86bb90af9117) terminou com sucesso, versão **1.0.0 (1)**, a partir do commit `e7f0cb0e7f04498c45bc4aa6bf0cc9460d1b661a`. **Ainda não existe IPA assinada, build no TestFlight, validação visual nativa ou screenshots de iPhone/iPad.** Confirmar as funcionalidades na build final antes de submeter a ficha à revisão.

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

O URL de privacidade foi guardado na Apple e verificado em produção com resposta **HTTP 200**, em 26/11/2026. O URL de apoio também está guardado na ficha. Rever o conteúdo de ambos contra a aplicação nativa final antes da submissão.

## Descrição curta

Carros usados, favoritos e comparação num só lugar.

Este texto pode servir como descrição curta numa futura ficha Android. Na App Store, usar o subtítulo indicado acima; não confundir os dois campos.

## Texto promocional opcional

Consulte viaturas, guarde favoritos e compare até três carros na AutoValorPT.

## Descrição completa

Explore o catálogo AutoValorPT e organize as viaturas que quer conhecer melhor.

Consulte as fotografias originais e os dados disponíveis de cada carro, incluindo preço, ano, quilómetros e combustível. Pesquise por marca ou modelo, filtre as opções e ordene os resultados de acordo com o que procura.

GUARDE AS SUAS OPÇÕES

Adicione viaturas aos favoritos para voltar a consultá-las. Os favoritos ficam guardados no dispositivo, sem necessidade de criar uma conta.

COMPARE ATÉ TRÊS VIATURAS

Selecione até três carros e compare os dados disponíveis numa só vista. A comparação ajuda a organizar as opções antes de pedir mais informações.

PARTILHE E ENTRE EM CONTACTO

Partilhe uma viatura através das opções de partilha do seu dispositivo. Pode também contactar a AutoValorPT para esclarecer dúvidas e confirmar o preço e a disponibilidade da viatura.

CONSULTE A ÚLTIMA CÓPIA GUARDADA

Depois de uma primeira consulta com ligação à internet, a app pode apresentar a última cópia válida do catálogo guardada no dispositivo quando não consegue atualizar os dados. A informação guardada pode já ter mudado; confirme a data indicada e a disponibilidade com a AutoValorPT. As fotografias e os serviços externos podem precisar de ligação à internet.

Uma forma prática de acompanhar as suas opções no iPhone e no iPad.

## Palavras-chave

```text
carros,usados,automoveis,eletricos,hibridos,stock,comparar,favoritos,Portugal
```

O conjunto acima fica abaixo de 100 bytes e não repete o nome da app.

## Notas para App Review

Rascunho a rever contra a build final antes de o copiar para o App Store Connect:

> A AutoValorPT é uma aplicação de catálogo automóvel com interface nativa React Native. A consulta do catálogo, a pesquisa, os favoritos e a comparação decorrem dentro da app, sem WebView. Não é necessário iniciar sessão para usar estas funcionalidades.
>
> O catálogo é obtido por HTTPS a partir de um endpoint público AutoValorPT. Apresenta o último stock sincronizado pelo sistema comercial existente. A data do catálogo identifica a sincronização dos dados, não a hora de publicação da app. Os dados de gestor e as credenciais de administração não são usados pela aplicação.
>
> Para verificar as funcionalidades: abra o catálogo com internet; pesquise uma marca ou modelo; experimente os filtros; guarde uma viatura nos favoritos; selecione duas ou três viaturas para comparação. Os favoritos e a seleção para comparação são guardados localmente no dispositivo.
>
> Para verificar a consulta sem ligação, carregue primeiro o catálogo com internet. Depois desative a ligação e volte à app. Quando disponível, a última cópia válida dos dados é apresentada com indicação de que precisa de atualização. O primeiro carregamento exige internet; as fotografias remotas não têm disponibilidade offline garantida. Uma falha de atualização não deve ser interpretada como catálogo vazio ou como confirmação de disponibilidade atual.
>
> A partilha usa as opções nativas do sistema. O contacto WhatsApp abre uma ligação para +351 965 637 736 com uma mensagem preparada; o envio depende da ação da pessoa no serviço de destino. A consulta do catálogo não exige a instalação do WhatsApp.
>
> Esta versão não processa pagamentos ou reservas dentro da app. O contacto comercial serve para pedir informações e confirmar preço e disponibilidade. A app suporta iPhone e iPad.

Antes da submissão, completar o contacto de revisão exigido pela Apple. Não usar dados fictícios:

| Campo de revisão | Estado |
| --- | --- |
| Nome e apelido do responsável | Pendente de confirmação |
| E-mail de contacto | Pendente de confirmação |
| Telefone | +351 965 637 736 — confirmar como contacto de revisão |
| Credenciais de demonstração | Não aplicáveis à consulta pública; rever se a build final introduzir autenticação |
| Build selecionada para revisão | Pendente de upload e processamento reais |

## Screenshots pendentes

Capturar a aplicação nativa final num iPhone e num iPad. Não apresentar capturas do site como se fossem capturas desta app.

| Captura sugerida | Conteúdo |
| --- | --- |
| Catálogo | Fotografias e dados reais das viaturas, com o estado de atualização visível |
| Pesquisa e filtros | Uma pesquisa compreensível e filtros funcionais |
| Favoritos | Seleção de viaturas guardadas no dispositivo |
| Comparação | Duas ou três viaturas com dados disponíveis |
| Ficha da viatura | Informação e ações de partilha/contacto |

Preparar os formatos exigidos pela especificação Apple vigente. Na documentação consultada, existe uma categoria iPhone Dynamic Island de ecrã médio, com formatos como **1206 × 2622** e **1179 × 2556**. Como há suporte iPad, é também necessária a categoria de screenshots **iPad de 13 polegadas**. Confirmar os tamanhos aceites no momento do upload. As imagens não podem incluir transparência.

**Estado dos screenshots:** pendentes; a interface ainda não foi executada num dispositivo ou simulador nativo. O catálogo web existente foi verificado em desktop e a 390/320 px, mas essas capturas não são screenshots nativas para a App Store.

## Dados de conta e publicação

| Campo | Estado |
| --- | --- |
| Titular legal / nome do vendedor | Pendente de confirmação na conta Apple |
| Apple Team ID | `QBU2Z3YJ88` — confirmado |
| Apple ID numérico da app / `ascAppId` | `6839660385` — app criada e perfil de submissão configurado |
| SKU | `AUTOVALORPT-IOS-001` — registado |
| Conta Expo / EAS Project ID | `cvasconcelos1969s-team` / `99e2814b-559a-42fe-899b-19b167c1c05c`; projeto `autovalorpt-catalogo` ligado ao GitHub, pasta `mobile` |
| Bundle ID | `pt.autovalor.catalogo` — registado na equipa Apple confirmada |
| Perfil de assinatura App Store | `AutoValorPT Catalogo App Store 20261126`, para `QBU2Z3YJ88.pt.autovalor.catalogo`, válido até 14/10/2027. Gerado na Apple; transferência e carregamento no Expo pendentes. |
| IPA assinada | Pendente; existe apenas a build iOS de simulador referida acima |
| Publicação Android | Pendente; ainda não foi executada uma build nativa Android |
| Preço da aplicação e territórios | Pendentes de confirmação |
| Classificação etária | Pendente das respostas sobre o conteúdo e funcionalidades reais |
| Copyright | Pendente de confirmação do titular legal |
| Declaração App Privacy | Pendente de revisão do binário, dependências e serviços efetivamente usados |
| Exportação de encriptação | Pendente de confirmação para a build final |
| Estado de comerciante DSA / contactos UE | Pendente de confirmação e verificação na conta Apple |
| Grupo e ligação TestFlight | Pendentes de build processada, associação e revisão aplicável |

Não declarar “dados não recolhidos” apenas com base na existência de favoritos locais. As respostas de privacidade devem também considerar o comportamento dos SDKs, do backend e dos serviços que recebem pedidos da app.

## Fontes oficiais

Consultadas em 26 de novembro de 2026; confirmar os requisitos antes da submissão.

- [Regras de revisão Apple, incluindo utilidade da app e catálogos](https://developer.apple.com/app-store/review/guidelines/)
- [Informação e identificadores da app](https://developer.apple.com/help/app-store-connect/reference/app-information/app-and-compliance-information/)
- [Campos da versão e informação de suporte](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)
- [Especificações de screenshots](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [Política de privacidade e respostas App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)
- [Definições de recolha e detalhes de privacidade](https://developer.apple.com/app-store/app-privacy-details/)
- [Requisitos de comerciante na União Europeia](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements)
- [Distribuição TestFlight com Expo](https://docs.expo.dev/submit/testflight/)

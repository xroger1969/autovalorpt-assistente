# Capturas nativas da AutoValorPT 1.0.0 (3)

Esta preparação está numa branch isolada com base em
`877654a24a86b4fad319683c20b12bb7881a5566`, o código da build3 já instalada por TestFlight.
Só acrescenta ficheiros em `mobile/.eas`; não altera código, dependências, ícones,
configuração ou conteúdo da app. Não envia uma nova build para a Apple e não
publica atualizações OTA.

## Execução depois da revisão

No projeto Expo `autovalorpt-catalogo`, a pasta base do repositório é **mobile**.
A execução pela interface Expo deve selecionar esta branch e o workflow
`appstore-screenshots-build3.yml`. Não executar no main que já contém código de
galeria posterior à build3.

Equivalente por CLI autenticada, a partir de `mobile`:

```sh
npx eas-cli@27.11.0 workflow:validate .eas/workflows/appstore-screenshots-build3.yml
npx eas-cli@27.11.0 workflow:run .eas/workflows/appstore-screenshots-build3.yml --non-interactive
```

O workflow só tem execução manual. Uma execução cria uma build de simulador
com o perfil `simulator` já existente e dois jobs `maestro` nos runners macOS
`sdk-58`. Não usa `maestro-cloud` nem Expo Simulators. Disponibilidade/quota da
conta Expo devem ser confirmadas antes de o iniciar.

## Dispositivos e resultados

| Job | Dispositivo real do Simulator | Resolução vertical |
| --- | --- | --- |
| capture_iphone | iPhone 16 Pro | 1206 × 2622 |
| capture_ipad | iPad Pro 13-inch (M4); M5 se M4 não existir | 2064 × 2752 |

Cada job cria um dispositivo com nome próprio no runtime iOS disponível mais
recente. O job falha se o tipo necessário não existir. Não substitui um iPhone
por iPad nem amplia uma imagem para simular outra resolução.

O Maestro abre a app, espera que o catálogo remoto tenha viaturas e captura
**Catálogo**, **Ficha da viatura** e **Mais**. Não abre WhatsApp, telefone, páginas
de formulários nem envia contactos. Os dados e fotografias são os que a própria
app carrega do servidor naquele momento.

Os artefactos `autovalorpt-build3-iphone-screenshots` e
`autovalorpt-build3-ipad-screenshots` contêm PNGs originais, JPEGs sem alpha,
`device.json` e `capture-manifest.json`. A conversão JPEG não redimensiona nem
altera o layout. O conjunto original também permanece em **Maestro Test Results**.

**Antes do upload na Apple:** abrir e verificar visualmente as seis capturas,
confirmar fotografias carregadas, dados legíveis e ausência de avisos/erros.
As verificações automáticas de dimensões não substituem essa revisão visual.

## Referências oficiais

- https://docs.expo.dev/eas/workflows/pre-packaged-jobs/#maestro
- https://docs.expo.dev/eas/workflows/syntax/#easupload_artifact
- https://docs.expo.dev/build-reference/build-with-monorepos/
- https://docs.expo.dev/build-reference/infrastructure/
- https://docs.maestro.dev/reference/commands-available/takescreenshot
- https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/

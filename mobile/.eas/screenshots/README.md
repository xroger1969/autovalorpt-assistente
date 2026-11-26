# Capturas nativas da AutoValorPT 1.0.0 (3)

Esta preparação está numa branch isolada com base em
`877654a24a86b4fad319683c20b12bb7881a5566`, o código da build3 já instalada por TestFlight.
Só acrescenta ficheiros em `mobile/.eas`; não altera código, dependências, ícones,
configuração ou conteúdo da app. Não envia uma nova build para a Apple e não
publica atualizações OTA.

## Execução depois da revisão

No projeto Expo `autovalorpt-catalogo`, a pasta base do repositório é **mobile**.
A execução pela interface Expo deve selecionar esta branch e o workflow
**`capture-existing-build3.yml`**, que reutiliza a build de simulador concluída
`c678705c-7f83-476a-9a20-d02dee71c36b`. Não executar no main que já contém código de
galeria posterior à build3.

Equivalente por CLI autenticada, a partir de `mobile`:

```sh
npx eas-cli@27.11.0 workflow:validate .eas/workflows/capture-existing-build3.yml
npx eas-cli@27.11.0 workflow:run .eas/workflows/capture-existing-build3.yml --non-interactive
```

O workflow só tem execução manual e executa dois jobs `maestro` nos runners macOS
`sdk-58`; não recompila a app. O workflow original `appstore-screenshots-build3.yml`
continua disponível caso seja necessário reconstruir o simulador no futuro.

## Dispositivos e resultados

| Job | Dispositivo real do Simulator | Resolução vertical |
| --- | --- | --- |
| capture_iphone | iPhone 16 Pro preferido; outro iPhone com Dynamic Island médio se incompatível | 1206 × 2622 ou 1179 × 2556 |
| capture_ipad | iPad Pro 13-inch M4/M5 preferido; outro modelo aceite no grupo de 13 polegadas se incompatível | 2064 × 2752 ou 2048 × 2732 |

Cada job escolhe um **par compatível de dispositivo e runtime**, consultando
`supportedDeviceTypes` e os limites mínimo/máximo do tipo de dispositivo. Tenta
primeiro o modelo preferido no runtime compatível mais recente. Se o CoreSimulator
ainda rejeitar um par com o erro 403, tenta o candidato seguinte. Esta seleção
corrige a tentativa incompatível de iPhone 16 Pro com iOS 27.1. O manifesto regista
o dispositivo e runtime usados, as rejeições e as dimensões reais dos PNGs.
O job falha se não existir um par adequado ou se a captura não tiver uma resolução
admitida. Não substitui um iPhone por iPad nem amplia uma imagem.

O Maestro abre a app, espera que o catálogo remoto tenha viaturas e captura
**Catálogo**, **Ficha da viatura** e **Mais**. Não abre WhatsApp, telefone, páginas
de formulários nem envia contactos. Os dados e fotografias são os que a própria
app carrega do servidor naquele momento.

Cada JPEG é enviado como artefacto individual, por exemplo
`autovalorpt-build3-iphone-01-catalogue.jpg`, permitindo descarregar os seis
ficheiros diretamente. Cada job envia também o seu manifesto JSON com os hashes,
dispositivo, runtime e dimensões. Os PNGs originais permanecem em
**Maestro Test Results**. A conversão JPEG remove a possibilidade de alpha sem
redimensionar nem alterar o layout.

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

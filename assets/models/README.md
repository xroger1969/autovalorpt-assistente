# U2NetP — máscara local das fotografias do catálogo

O modelo serve apenas para prever uma máscara. O processamento copia os píxeis
RGB da fotografia real para a composição e não gera nem reconstrói o automóvel.
As entradas reduzidas a 320 × 320 existem apenas para a inferência; a fotografia
que fornece o veículo conserva as dimensões originais, após orientação EXIF.
Uma sombra de contacto suave é calculada apenas sob a margem inferior da máscara
e composta atrás do veículo. Não é aplicada nos contornos superiores nem altera
os píxeis das zonas opacas do carro.

## Proveniência e ficheiro fixado

- Modelo original: **U²-Net / U2NetP**, Xuebin Qin et al.,
  <https://github.com/xuebinqin/U-2-Net>.
- Artigo: *U²-Net: Going Deeper with Nested U-Structure for Salient Object Detection*,
  Pattern Recognition, 2020, <https://arxiv.org/abs/2005.09007>.
- Licença do projeto original: **Apache-2.0**, cópia em `U2NET-LICENSE.txt`.
- Conversão/distribuição ONNX utilizada pelo rembg:
  <https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx>.
- Tamanho: **4 574 861 bytes**.
- MD5 publicado pelo rembg: `8e83ca70e441ab06c318d82300c84806`.
- SHA-256 verificado em 2026-11-20:
  `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`.

`scripts/prepare-catalog-model.mjs` descarrega e verifica o artefacto durante o
build. O binário está ignorado pelo Git; o deployment deve incluí-lo explicitamente
em `assets/models/u2netp.onnx`. Não há download de modelos durante pedidos HTTP.
O processador verifica novamente o SHA-256 antes de criar a sessão de inferência.

## Código e atribuições

O pré-processamento e a interpretação da saída foram adaptados do rembg:
<https://github.com/danielgatis/rembg/blob/main/rembg/sessions/base.py> e
<https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2netp.py>.
Copyright (c) 2020 Daniel Gatis. Licença **MIT**, cópia em `REMBG-LICENSE.txt`.
As licenças dos modelos não se confundem com a licença MIT do rembg; esta
integração fixa especificamente U2NetP e não usa o modelo predefinido do rembg.

Execução: `onnxruntime-web` **1.31.1**, Microsoft, licença MIT, instalada pelo npm
e fixada no lockfile; <https://github.com/microsoft/onnxruntime>.
No Node é usado WASM local com uma thread. São necessários o entrypoint Node,
`ort-wasm-simd-threaded.mjs` e `ort-wasm-simd-threaded.wasm` da mesma versão.
Não se devem incluir desnecessariamente as variantes GPU, WebGL ou JSPI.

## Limites de qualidade

U2NetP deteta o objeto em destaque e não identifica por si só a conta de origem,
o automóvel correto ou se a fotografia mostra exterior/interior. Essa seleção
compete à camada chamadora. A máscara de 320 × 320 pode falhar nos contornos,
espelhos, rodas, antenas e fundos complexos. Vidros e reflexos reais permanecem
na fotografia; não são inventados nem retocados.

Máscaras vazias, quase integrais, cortadas pela borda ou com vários objetos
significativos são rejeitadas. Máscaras com avisos exigem revisão e não passam
por predefinição. Os controlos geométricos não substituem revisão visual nem
garantem que todos os detalhes foram recortados corretamente. A camada chamadora
deve manter a fotografia original quando o processamento falha ou é rejeitado.

## Prazo e cancelamento

O processador aceita `signal`, `deadlineAt` (timestamp absoluto em milissegundos)
e `remainingMs`. O prazo efetivo é o mais curto entre estes limites e 45 segundos
por fotografia. O chamador deixa de esperar quando o prazo expira ou o sinal é
abortado. WASM em execução não é apresentado como interrompido: a fila continua
ocupada até a previsão e a libertação dos tensores terminarem. Pedidos em fila
que já expiraram são descartados antes de iniciar uma nova inferência.

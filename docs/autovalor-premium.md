# AutoValorPT Premium

## Entrada e identidade

A entrada continua a ser `https://autovalorpt-assistente.vercel.app/stock-rapido.html`.
Uma reescrita interna serve o painel de `rotina.html` sem mudar o endereço visível.
O atalho instalado e o acesso antigo com `#atalho` continuam reconhecidos.

`lib/autovalor-brand.js` centraliza a versão visual `premium1` e as cores:
azul-marinho `#0B2030`, azul secundário `#123247`, dourado `#D6B36A` e branco
`#F8F7F4`. O painel existente usa a mesma paleta.

## Geradores existentes

| Formato | Implementação | Resultado |
| --- | --- | --- |
| Fotografia de stock | `instagram-image.js`, `instagram-image-handler.js`, `instagram-stock-image.js` | Fotografia original completa numa moldura 1080 × 1350; estilo incluído na assinatura do URL. |
| Vídeo de stock, Stories e partilha | `instagram-video.js`, `instagram-stories.js` | Composição 1080 × 1920; fotografia inteira, texto separado e música/duração existentes. |
| Dicas, comparação e carrosséis | `editorial-image.js`, `editorial-premium-image.js`, `editorial-image-handler.js` | Tema público `premium1`, títulos legíveis, pressupostos completos, barras proporcionais e QR aprovado. |
| Capa dos Reels editoriais | `instagram-editorial.js` | Capa 1080 × 1920 enviada como `cover_url`; vídeo, apresentador e áudio existentes. |
| Imagens para Estado WhatsApp | `whatsapp-editorial.js`, `editorial-image.js` | Variante vertical com a mesma identidade; mantém o fluxo de partilha existente. |
| Destaques do perfil | `scripts/prepare-brand-covers.mjs`, `assets/brand/` | Seis capas PNG e SVG: Elétricos, Híbridos, Stock, Guias, Simulador e Sobre nós. |

As capas dos destaques ficam em **Mais detalhes e definições → Identidade visual**.
A escolha de cada capa no perfil é feita no Instagram.

## Aplicação às próximas publicações

- Dicas agendadas: `premium1` a partir de 26 de novembro de 2026.
- Extras: `premium1` a partir de 27 de novembro de 2026, preservando a imagem do
  extra já publicado na manhã de lançamento.
- Fotografias: novos URLs assinados incluem `style=premium1`; URLs antigos
  continuam válidos com a apresentação anterior.
- Vídeos novos usam um identificador visual de cache distinto. Os identificadores
  do stock, fingerprints de conteúdo e registos de publicação mantêm-se.
- Os temas editoriais anteriores e os seus URLs/ETags continuam disponíveis.

Os horários existentes permanecem: stock às 08h00, editorial às 19h00 e
recuperação às 20h00, hora de Lisboa. O lançamento não provoca uma publicação
extra, nem substitui conteúdos publicados. As contas, limites, credenciais,
modelos de IA e regras de prevenção de duplicados não são alterados.

## Validação da implementação

- `npm test`: 688 testes aprovados, sem falhas.
- Prévias verificadas de fotografia real, vídeo de stock, comparação, capa de
  Reel e seis destaques.
- Todos os mais de 60 temas de aconselhamento próximos cabem no novo formato;
  os valores da comparação mantêm a proporção gráfica.
- Um vídeo real foi codificado localmente: H.264, 1080 × 1920, 25 fps, 30 segundos,
  áudio AAC estéreo e 8,29 MB.
- A verificação final em produção deve confirmar HTTP 200 no mesmo URL, painel
  completo sem redirecionamento, imagens premium e autenticação das APIs privadas.

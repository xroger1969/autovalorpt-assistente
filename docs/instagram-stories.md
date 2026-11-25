# Automatic stock videos and Instagram Stories

The [morning flow](morning-flow.md), starting from 08:00 Europe/Lisbon, runs the Story stage after catalog reconciliation and the photo stage. It generates at most one 30-second vertical MP4 for a newly observed, available stock ID and publishes it as an Instagram Story. Initial stock is recorded as a baseline and never backfilled automatically. Existing publication ledgers are preserved; the old independent 10:00 and 11:00 UTC crons are removed.

The `energy-128-v2` renderer uses eight short scenes, gentle camera moves and quick beat-aligned transitions with an original 128 BPM electro-pop instrumental (drums, bass, bright plucks and chord stabs). It keeps the exact feed price and factual vehicle details, uses the orange AutoValorPT identity, and closes with the WhatsApp contact. Photographs retain their proportions; no synthetic driving footage, wheel animation, invented car details or spoken voice is generated.

Up to five photographs come from the two authorised dealer inventories (Samucar and AutoValorPT), only when the exact advert URL, ID, EUR price and primary-photo identity match the current feed. Ambiguous or unavailable galleries fall back to the verified feed photo. Requests reject redirects, enforce size/time limits and accept only the existing OLX image host. No paid music service or licensed recording download is required.

Videos are 1080×1920, 30 seconds, H.264/AAC and stored in private Vercel Blob. Bundled FFmpeg runs natively with a 180-second render deadline inside the 300-second function budget. The style applies to newly rendered assets. Existing videos, content fingerprints, publication histories and duplicate prevention are preserved; changing the style does not republish old stock.

## Activation and private verification

Default: `INSTAGRAM_STORIES_ENABLED` is absent/false. Before activation, validate the production function bundle and a private preview. Only production may use stock, Story state or signed video streaming.

The existing Instagram Login token manager verifies that `autovalorpt` is a Business account and publishes with `instagram_business_basic` and `instagram_business_content_publish`. Preflight reads the documented Instagram profile and content publishing limit; Instagram Login does not expose Facebook's `/me/permissions` edge. This is a read-only capability check, not an enumeration of granted Instagram scopes. Meta enforces scopes on every media creation and publication. The automatic routine uses Facebook Login for account association and active Story readback. Its preflight checks `instagram_basic`, `instagram_manage_contents`, and `pages_read_engagement`. A new Facebook publication grant is not needed. No token is returned to the caller or embedded in video URLs.

The quota check requires a nonnegative integer `quota_usage` and a positive integer `config.quota_total`, using the live account limit rather than a fixed daily allowance. If `config.quota_duration` is returned, it must be a positive integer and is reported as `durationSeconds`; missing duration metadata does not prevent checking remaining capacity. Meta's [official SDK response type](https://github.com/meta/facebook-python-business-sdk/blob/main/facebook_business/adobjects/contentpublishinglimitresponse.py) leaves `config` as an object, and its [publishing sample](https://github.com/fbsamples/reels_publishing_apis/blob/main/insta_reels_publishing_api_sample/index.js) computes remaining capacity from the total and usage. This preflight does not infer a reset time. Business-account verification remains required for Stories, as stated in [Meta's official API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).

Existing cron authorization and same-origin authenticated administration remain supported. Optional `INSTAGRAM_STORY_WORKER_SECRET` (at least 32 characters; generate 256 random bits) authorizes only these Story operations using `Authorization: Bearer …`. It does not grant access to the old photo publisher or retirement actions.

All operations use `/api/stock?integration=instagram-sync`:

| Action | Method | Effect |
| --- | --- | --- |
| `stories-status` | GET | Read configuration and Story ledger |
| `stories-dry-run` | GET | Read live stock and verify Meta permissions/account; no media publication |
| `stories-preview&id=ID…` | POST | Render the latest confirmed photo publication if the vehicle is currently in stock; private video only |
| `stories-run` | POST | Run the enabled queue; cron may use GET |
| `stories-resume` | POST | Same-origin administrator confirmation of one already-prepared container. Expects JSON with `id`, `attemptId` from the active status and `confirmed: true`. |
| `stories-run&sample_id=ID…` | POST | Explicit first test of that latest confirmed photo publication; still requires enabled=true and all authorization checks |

The age of the photo publication does not expire an explicit sample. Eligibility still requires the latest confirmed photo ID, a valid non-future confirmation timestamp, and current in-stock data. Price and the complete content fingerprint are revalidated after rendering and immediately before publication. This does not change the automatic queue or backfill existing vehicles.

Private previews do not enroll baseline stock in automatic publication, including after a failure or interrupted request. Returned video links expire after two hours and bind the exact stock ID, content hash and expiry using `ADMIN_SESSION_SECRET`. `GET` streams the video; `HEAD` returns metadata. Single byte ranges return 206 for playback and seeking on iPhone. The download link serves the same file as an attachment. Successful Meta ingestion must be verified in production before declaring Story delivery operational.

## Vídeos escolhidos no painel

Em `/rotina.html`, **Criar vídeo de outra viatura** abre o stock disponível dos dois inventários. A seleção cria uma pré-visualização privada. O MP4 pode ser descarregado antes de decidir publicar. **Publicar Story agora** pede confirmação para a viatura e o vídeo revistos.

As ações `stories-manual-stock`, `stories-manual-preview`, `stories-manual-publish` e `stories-manual-status` pertencem à integração `instagram-sync`. Usam a sessão privada do painel. O registo por viatura em `instagram/v1/production/manual-stories/` conserva as tentativas manuais separadas das filas automáticas. Uma confirmação incerta pode ser consultada pelo identificador do envio à Meta.

A chave dos novos MP4 inclui o template, os dados do anúncio e a ordem das fotografias usadas. Os vídeos históricos continuam guardados. Quando um vídeo antigo só tem a assinatura dos dados da ficha, o primeiro pedido manual pode criar um novo MP4 para verificar também a galeria atual.

## Coherence and failures

The separate private ledger `instagram/v1/production/stories.json` binds the source, account, Page and Instagram publication provider. The earlier Facebook-provider ledger may migrate only if it has no active claim, container or published media; existing private previews can migrate without resetting history. Conditional writes claim a single render/publication. Stock and all content fields are checked again after rendering and immediately before publication. Confirmed publications are never repeated; uncertain publication/deletion outcomes block for review, including when a provider succeeds but the confirmation write fails.

After successful Instagram publication, `mapping_pending` and the returned `instagramMediaId` are persisted before any readback. The pipeline reads that media's permalink and compares it with the complete paginated Facebook `/stories` listing for the verified account. Exactly one matching `/stories/autovalorpt/<numeric-id>/` permalink is required, with Facebook `media_product_type=STORY` and an equal creation timestamp. Time alone never identifies media. The resulting `facebookMediaId` is stored separately. Missing or ambiguous readback pauses the automatic queue while subsequent runs retry mapping reads. Actual cross-provider readback must be verified during the first production Story test.

Non-public render/container failures retry at most three times. A prepared but unpublished vehicle that disappears is canceled. Stories remain on Instagram for their natural 24-hour lifetime. At the next scheduled reconciliation after expiry, the ledger records the expired status and retains the MP4 and publication details.

This implementation does not publish WhatsApp Status. It creates a compatible MP4, but no automatic WhatsApp Status delivery is claimed. The existing catalogue feed remains a separate integration.

## Verification

`npm test` covers queue baseline, current stock, permissions/account binding, concurrent claims, no duplicate publication, ambiguous outcomes, confirmation-write failures, preview isolation, worker scope and signed streaming. A real local FFmpeg render verifies the 30-second 1080×1920 H.264/AAC output. Production still needs a private render, signed media retrieval and actual Meta ingestion/publication verification before activation is considered complete.
### Processamento demorado

O publicador aguarda o processamento do Instagram dentro do orçamento da função, reservando tempo para confirmar o stock e publicar. Se ainda devolver `preparing`, conserva o identificador do envio. Após seis minutos desde o início, o painel permite **Continuar Story em processamento** para a mesma viatura verificada. A continuação reutiliza o envio existente; não renderiza, cria ou publica outra viatura. Operações `publishing`, `unknown` ou `mapping_pending` continuam bloqueadas para novo envio.


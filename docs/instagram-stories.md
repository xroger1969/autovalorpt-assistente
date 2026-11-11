# Automatic stock videos and Instagram Stories

The daily 11:00 UTC cron generates one 30-second vertical MP4 for a newly observed, available stock ID and publishes it as an Instagram Story. Initial stock is recorded as a baseline and never backfilled automatically. The existing 10:00 photo publisher and its ledger are unchanged.

The renderer uses the current feed photo, exact price and description, three text scenes, and an original synthesized instrumental soundtrack. It preserves image proportions. The current feed supplies one hero photo; the renderer can accept a trusted gallery when a future feed supports it. Videos are 1080×1920, H.264/AAC and stored in private Vercel Blob. Bundled FFmpeg runs natively with a 180-second render deadline inside the 300-second function budget. No external rendering service is required.

## Activation and private verification

Default: `INSTAGRAM_STORIES_ENABLED` is absent/false. Before activation, validate the production function bundle and a private preview. Only production may use stock, Story state or signed video streaming.

The existing Instagram Login token manager verifies that `autovalorpt` is a Business account and publishes with `instagram_business_basic` and `instagram_business_content_publish`. Facebook Login is used only for account association, active Story readback and deletion; it requires `instagram_basic`, `instagram_manage_contents`, and `pages_read_engagement`. A new Facebook publication grant is not needed. No token is returned to the caller or embedded in video URLs.

Existing cron authorization and same-origin authenticated administration remain supported. Optional `INSTAGRAM_STORY_WORKER_SECRET` (at least 32 characters; generate 256 random bits) authorizes only these Story operations using `Authorization: Bearer …`. It does not grant access to the old photo publisher or retirement actions.

All operations use `/api/stock?integration=instagram-sync`:

| Action | Method | Effect |
| --- | --- | --- |
| `stories-status` | GET | Read configuration and Story ledger |
| `stories-dry-run` | GET | Read live stock and verify Meta permissions/account; no media publication |
| `stories-preview&id=ID…` | POST | Render the latest confirmed photo publication from the last 48 hours; private video only |
| `stories-run` | POST | Run the enabled queue; cron may use GET |
| `stories-run&sample_id=ID…` | POST | Explicit first test of that latest recent photo publication; still requires enabled=true and all authorization checks |

Private previews do not enroll baseline stock in automatic publication, including after a failure or interrupted request. Returned video links expire after two hours and bind the exact stock ID, content hash and expiry using `ADMIN_SESSION_SECRET`. `GET` streams the video; `HEAD` returns metadata. Range is deliberately answered with the complete 200 response. Successful Meta ingestion must be verified in production before declaring Story delivery operational.

## Coherence and failures

The separate private ledger `instagram/v1/production/stories.json` binds the source, account, Page and Instagram publication provider. The earlier Facebook-provider ledger may migrate only if it has no active claim, container or published media; existing private previews can migrate without resetting history. Conditional writes claim a single render/publication. Stock and all content fields are checked again after rendering and immediately before publication. Confirmed publications are never repeated; uncertain publication/deletion outcomes block for review, including when a provider succeeds but the confirmation write fails.

After successful Instagram publication, `mapping_pending` and the returned `instagramMediaId` are persisted before any readback. The pipeline reads that media's permalink and compares it with the complete paginated Facebook `/stories` listing for the verified account. Exactly one matching `/stories/autovalorpt/<numeric-id>/` permalink is required, with Facebook `media_product_type=STORY` and an equal creation timestamp. Time alone never identifies media. The resulting `facebookMediaId` is stored separately. Missing or ambiguous readback blocks further publication and deletion; subsequent runs retry only mapping reads, never publication. Actual cross-provider readback must be verified during the first production Story test.

Non-public render/container failures retry at most three times. A prepared but unpublished vehicle that disappears is canceled. A confirmed Story is deleted only by its recorded Facebook Graph media ID after an explicit unavailable row or a changed content fingerprint. Before deletion the exact cross-provider identity and live stock are checked again. A merely absent row never authorizes deletion. Stories older than 25 hours are marked expired, not reported as deleted. Daily runs imply daily reconciliation; Instagram normally expires Stories after 24 hours.

This implementation does not publish WhatsApp Status. It creates a compatible MP4, but no automatic WhatsApp Status delivery is claimed. The existing catalogue feed remains a separate integration.

## Verification

`npm test` covers queue baseline, current stock, permissions/account binding, concurrent claims, no duplicate publication, ambiguous outcomes, confirmation-write failures, preview isolation, worker scope and signed streaming. A real local FFmpeg render verifies the 30-second 1080×1920 H.264/AAC output. Production still needs a private render, signed media retrieval and actual Meta ingestion/publication verification before activation is considered complete.

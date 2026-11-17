# AutoValorPT: verificação e importação do catálogo Meta

A produção usa snapshots validados do inventário completo Standvirtual. A Google Sheets mantém-se como espelho diário e como semente única do histórico. O catálogo e o feed existentes são preservados. Cada importação manual usa o URL imutável correspondente ao hash auditado; a importação periódica da Meta é migrada para o último snapshot confirmado, preservando o seu intervalo.

## Destinos preservados

- Negócio: `759014320107772`.
- Catálogo: `1817371622874450`.
- Feed: `1117326544352704`.
- Google Sheets: `1RENDbmN9Inyd2fr0FQJJmbe1jMpJl4Psevlawc92uVs`.
- `Catalogo`, gid `1511112026`: espelho só de viaturas disponíveis.
- `Stock`, gid `2105479537`: espelho histórico e semente única do novo inventário.

A integração não escreve na folha Google. Os publicadores usam o novo inventário através de um fornecedor interno, mantendo exatamente a identidade do URL antigo e os históricos de publicações.

## Execução sem sessão de navegador

A rotina [morning-flow](morning-flow.md), iniciada a partir das **08h00 Europe/Lisbon**, chama esta operação depois de sincronizar e validar o inventário completo Samucar. O antigo cron independente das 12h00 UTC foi removido:

```text
/api/stock?integration=meta-catalog&action=run
```

O cron usa o `CRON_SECRET` já configurado. A consulta privada está disponível em `/catalogo.html` com a sessão administrativa existente. A página não abre autenticação Meta, não pede tokens e não cria outra sessão. A automação não depende de a página estar aberta.

As ações `status`, `check` e `run` exigem autenticação administrativa ou a credencial de cron. `check` guarda o diagnóstico e `run` pode pedir importação. Para acesso por navegador, estas duas ações exigem POST da mesma origem. A credencial do trabalhador de Stories não autoriza operações do catálogo.

## Configuração de servidor

| Variável | Função |
| --- | --- |
| `META_CATALOG_ACCESS_TOKEN` | Autorização própria de servidor para o catálogo, guardada como segredo de produção. |
| `META_CATALOG_SYNC_ENABLED` | `true` permite pedir importação quando todas as verificações passam. Ausente/desativada mantém apenas a verificação. |
| `META_CATALOG_AUTHORIZATION_PROBE_ENABLED` | `true` permite consultar exclusivamente `me/permissions` da credencial Facebook já existente quando falta a credencial própria. |
| `META_CATALOG_USE_EXISTING_FACEBOOK_TOKEN` | Opt-in separado: só permite usar a credencial existente se `catalog_management` estiver efetivamente concedido e os destinos forem validados. Não concede nem amplia permissões. |
| `META_CATALOG_GRAPH_VERSION` | Versão da Graph API; predefinição `v27.0`. |

Os três IDs de destino estão fixados à associação aprovada pelo proprietário durante a configuração. Qualquer valor diferente em `META_CATALOG_ID`, `META_CATALOG_FEED_ID` ou `META_CATALOG_BUSINESS_ID` bloqueia a operação antes de consultar a origem ou a Graph API. Mudar de negócio, catálogo ou feed exige rever essa associação no código; não basta alterar uma variável.

A credencial usa apenas `catalog_management`. A consulta do catálogo pede `id,name`, sem expandir objetos Business nem exigir `business_management`. O negócio fixado é o contexto de propriedade aprovado na configuração, **não uma nova comprovação de propriedade pela API em cada execução**. A rotina confirma ao vivo o identificador do catálogo, a pertença do feed e a origem dos produtos. Se a resposta incluir inesperadamente `business` ou `owner_business`, um valor incompatível bloqueia a operação.

**Uma flag não concede acesso ao catálogo.** Sem uma credencial com acesso efetivo ao ativo, o resultado é `authorization_required` ou um erro sanitizado do fornecedor. A consulta de permissões isolada nunca consulta produtos nem envia importações. A credencial Instagram Login não é usada nesta integração.

Configure qualquer autorização nova diretamente no fornecedor e no armazenamento de segredos, com acesso mínimo ao catálogo pretendido. Não coloque valores secretos em código, ficheiros de documentação, mensagens, URLs ou logs.

## Proteções de dados e importação

Antes de importar, a auditoria exige:

- Inventário atual completo, com total anunciado, total JSON, quantidade e IDs distintos coincidentes.
- Correspondência dos IDs, preços, títulos, ano, quilometragem, combustível, marca, ligações e fotografia principal.
- Correspondência exata do snapshot persistido com o inventário atual; CSV imutável com hash dos bytes.
- Recusa de inventário vazio, parcial, duplicado ou de uma redução superior a metade do último inventário validado.
- Correspondência exata com a associação negócio/catálogo/feed aprovada pelo proprietário e fixada no código; confirmação ao vivo do catálogo e da pertença do feed.
- Paginação completa e limitada dos produtos. As ligações de paginação do fornecedor não são seguidas; só os cursores são reaplicados ao domínio Graph fixo.
- Nova validação da origem imediatamente antes de qualquer pedido de importação.

O estado fica em Blob privado, separado dos históricos Instagram:

```text
meta-catalog/v1/production/state.json
```

As escritas usam ETag para impedir sobreposição de operações. A intenção de importação é guardada **antes** do POST. Um timeout ou resultado desconhecido impede outro envio até existir uma reconciliação segura. Uma importação aceite não é anunciada como concluída.

## Supervisão

`meta_catalog_result` e `meta_catalog_failed` registam apenas estado, razão sanitizada e contagens. O registo privado preserva o resultado mesmo depois da retenção de logs da Vercel. Não existem notificações externas novas nem pedidos automáticos de login.

`catalog_matches` confirma os identificadores, a pertença ao feed, os preços, a disponibilidade, a publicação (`visibility=published`) e a aprovação específica do WhatsApp devolvida pela Meta. A aprovação exige uma única entrada `{key: "WHATSAPP", value: "APPROVED"}` em `capability_to_review_status`. Uma entrada `REJECTED` é apresentada como rejeição; campos ausentes, vazios, ambíguos, malformados ou estados `NO_REVIEW`, `PENDING` e `OUTDATED` continuam por confirmar. A aprovação de outro canal não substitui a do WhatsApp. O antigo `review_status`, que pode ser vazio, não é usado como prova.

A comparação remota não inclui título, descrição ou fotografia; a auditoria da origem cobre os nove campos. **A integração não declara visibilidade WhatsApp comprovada apenas por a contagem, aprovação de canal ou importação coincidir.**

## Validação

```sh
npm ci
npm test
```

Os testes novos cobrem integridade da origem, permissões, associação ao destino, paginação, concorrência, importações desconhecidas, proteção dos segredos e autenticação do endpoint. A auditoria pública real de 14/11/2026 confirmou nove viaturas antes de qualquer importação.

Referências primárias: [Feed API e reconciliação](https://github.com/facebookincubator/catalogue-of-api-solutions/blob/main/solutions/catalogue/catalogue-batch-feed-optimiser.md), [ProductFeedUpload no SDK Meta](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/productfeedupload.py), [ProductItem e estados por capacidade no SDK Meta](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/productitem.py) e [System Users](https://developers.facebook.com/docs/business-management-apis/system-users/).



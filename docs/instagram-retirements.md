# Remoção de anúncios retirados do stock

Esta rotina é separada da publicação existente e fica **desativada por defeito**. O cron diário `0 9 * * *` chama `/api/stock?integration=instagram-sync&action=retirement-run`; sem ativação explícita, devolve `disabled` sem consultar o feed ou a Meta. O cron de publicação das 10:00 UTC e a sua autorização Instagram Login mantêm-se. Em Hobby, cada cron diário pode executar dentro da respetiva hora, sem precisão ao minuto.

## Autorização ainda necessária

A remoção usa a API Instagram com **Facebook Login**, servidor `graph.facebook.com`, versão `v27.0` ou posterior. O token atual de Instagram Login usado para publicar não fornece esta autorização e não é reutilizado nem alterado. Não existe aqui um novo fluxo OAuth: é necessário obter separadamente a autorização do utilizador e configurar uma credencial adequada no servidor.

| Variável de produção | Finalidade |
| --- | --- |
| `INSTAGRAM_RETIREMENTS_ENABLED` | Só `true` depois da nova autorização, validação da conta e revisão do dry run; omitir equivale a desativado. |
| `INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN` | Token Facebook Login sensível, com `instagram_basic` e `instagram_manage_contents` concedidos e acesso à Página associada. Nunca copiar para código, logs ou respostas. |
| `INSTAGRAM_RETIREMENTS_PAGE_ID` | Página Facebook cuja associação à conta Instagram será confirmada. |
| `INSTAGRAM_RETIREMENTS_USER_ID` | ID da conta Instagram devolvido pelo fluxo Facebook Login. |
| `INSTAGRAM_RETIREMENTS_GRAPH_VERSION` | `v27.0` por defeito; versões anteriores são recusadas. |

Antes de qualquer DELETE, a rotina verifica as permissões concedidas, a associação Página → conta Instagram e o nome `autovalorpt`. A credencial tem de permitir estas leituras; a mera presença das variáveis não comprova acesso nem permissões. Não há publicações no Facebook.

## Identificação e proteção do stock

Mantém-se o URL atual do feed completo `Stock`, incluindo o histórico de viaturas indisponíveis. Não apontar esta integração ao separador filtrado do catálogo Meta, nem alterar `INSTAGRAM_FEED_URL` ou `INSTAGRAM_LOGIN_MODE`: o histórico de publicações está vinculado a esses valores.

Apenas linhas explícitas `out of stock` ou `discontinued`, com publicação confirmada no registo original, podem ser removidas. IDs ausentes do CSV, viaturas disponíveis e anúncios nunca publicados pela integração não desencadeiam remoções. A atualização do Stock deve continuar a confirmar toda a montra Samucar antes de marcar uma viatura como indisponível. A rotina valida o CSV completo e bloqueia reduções superiores a metade do número de linhas conhecido.

O ID numérico de media de Instagram Login não é usado diretamente no DELETE. A rotina obtém a ligação da publicação pelo publicador existente e procura nas publicações da própria conta Facebook Login uma correspondência única de **permalink e ID estável Standvirtual numa ligação da legenda**. Correspondências ausentes ou ambíguas exigem revisão. A leitura de media é limitada a cinco páginas de cem registos; se não puder concluir a paginação, não remove nada. A lista é consultada através de cursores, sem seguir URLs arbitrários devolvidos pelo fornecedor.

O Stock é relido imediatamente antes de reclamar cada remoção. Uma viatura reposta em stock cancela a operação. Cada execução processa as saídas elegíveis em sequência, até dez anúncios e dentro de um orçamento partilhado de 45 segundos. O resultado inclui a contagem removida e os restantes candidatos; só estes ficam para a execução seguinte. O limite de uma publicação por dia não limita as remoções.

## Estado, falhas e operação

O registo `instagram/v1/production/retirements.json` usa ETag/CAS, separado de `state.json`. A intenção `deleting` é gravada antes de chamar o fornecedor. O histórico original `published` permanece intacto, prevenindo republicações. Apenas uma remoção pode estar em curso; resultados `deleting`/`unknown` bloqueiam novas remoções até revisão, sem impedir a publicação normal de outras viaturas.

Uma resposta com `success=true` e `deleted_id` igual ao ID pedido grava `retired`. Uma rejeição explícita grava `failed`; uma falha de transporte, resposta incerta ou processo interrompido deixa `unknown`/`deleting`. Nenhum desses casos é repetido automaticamente. O lote termina perante uma falha ou resultado incerto. Nunca apagar o histórico para tentar novamente. Confirmar o resultado na Meta e corrigir o estado através de uma intervenção administrativa revista; esta alteração não inclui um endpoint de reconciliação manual. O endpoint público de ligação deixa de devolver posts cujo estado seja `retired`.

As ações privadas na rota `integration=instagram-sync` são:

- `retirement-status`: configuração e estados seguros, sem credenciais.
- `retirement-dry-run`: validação e correspondências previstas, sem DELETE ou escrita no registo de remoções. A consulta da ligação publicada pode renovar a credencial existente, segundo o mecanismo já em produção.
- `retirement-run`: execução autorizada pelo `CRON_SECRET` ou por administrador, via POST da mesma origem. Um GET de administrador sem autenticação de cron não pode remover.

O marcador `instagram_retirement_result` contém apenas estado, contagem e ID do anúncio. Os erros continuam no marcador seguro `instagram_sync_failed`, com `action=retirement-run`. A supervisão deve distinguir `disabled`, `no_retirements`, `canceled` e `deferred` de uma remoção confirmada. A ausência de logs não comprova falha.

## Validação

Os testes usam exclusivamente credenciais e respostas sintéticas, cobrindo conta errada, permissões insuficientes, anúncios ausentes ou disponíveis, correspondência ambígua, concorrência, reposição de stock durante a execução e perda de confirmação após DELETE. Nenhuma remoção real é executada pelos testes. A ativação de produção depende da nova autorização e de um dry run verificado; este código, por si só, não comprova uma remoção real.

Referência de agendamento: https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing — 100 crons por projeto no Hobby, cada um no máximo uma vez por dia.

Referência da remoção de media: https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/ — secção Deleting, API com Facebook Login.

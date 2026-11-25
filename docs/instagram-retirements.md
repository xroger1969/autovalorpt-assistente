# Histórico comercial no Instagram

As fotografias, os vídeos, os Reels e as publicações criativas da AutoValorPT ficam no Instagram quando uma viatura é vendida, deixa de constar do stock ou muda de preço. Os Stories expiram naturalmente após 24 horas. O MP4 original e os registos de publicação permanecem guardados.

A etapa histórica `retirements` continua na rotina para manter a compatibilidade com os ciclos anteriores. O painel apresenta o histórico como preservado. As ações privadas `retirement-status`, `retirement-dry-run` e `retirement-run` devolvem `disabled` sem consultar a Meta, o stock ou o Blob. A antiga variável `INSTAGRAM_RETIREMENTS_ENABLED` já não permite ativar remoções.

Os registos antigos em `instagram/v1/production/retirements.json` mantêm a informação sobre remoções anteriores. A consulta de ligações públicas continua a respeitar esses registos. O catálogo WhatsApp usa o stock disponível de Samucar e AutoValorPT.

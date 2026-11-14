# AutoValorPT — ciclo sequencial da manhã

A tarefa ChatGPT existente atualiza e valida Stock/Catalogo às 08h00 Europe/Lisbon. O servidor só avança quando o inventário Samucar completo e os dois CSV coincidem. Seguem-se catálogo Meta, retiradas Instagram, uma fotografia, um vídeo/Story e verificação. O servidor continua sem acesso de escrita à folha Google: não se deve confundir a auditoria com uma atualização da folha.

## Agendamento

`vercel.json` substitui os quatro crons independentes das 09/10/11/12 UTC por duas entradas de arranque, 07 e 08 UTC. `Intl.DateTimeFormat` com `Europe/Lisbon` aceita apenas a entrada que corresponda à hora local 08. Cada data local tem um registo exclusivo; pedidos repetidos não iniciam outro ciclo. A precisão do arranque depende do plano de cron Vercel: uma entrada às 08 não garante execução exatamente ao minuto. O cron de tentativas de contactos comerciais mantém-se intacto.

`GET /api/stock?integration=morning-flow&action=start` requer o CRON_SECRET existente. Um administrador também pode antecipar o arranque dentro da hora 08 com POST da mesma origem e a sessão já válida. O servidor não depende desse acesso administrativo. As entradas individuais antigas continuam disponíveis para administração, mas já não são agendadas; não as chamar para repetir uma etapa do ciclo.

## Continuação e proteção contra duplicados

O registo privado `morning-flow/v1/production/AAAA-MM-DD.json` guarda etapas, tentativas e resultados. Cada etapa reclama um ticket por ETag/CAS antes de executar. O resultado é persistido antes de entregar o ticket seguinte. Os serviços existentes preservam os próprios registos e limites.

Cada etapa usa uma invocação separada, registada com `waitUntil`. As continuações são POST autenticados exclusivamente para o domínio de produção fixo, sem redirecionamentos. Uma pausa de processamento usa outra invocação curta; não consome o orçamento do renderizador. A etapa Story recebe 240 segundos dos 300 disponíveis para reservar tempo para persistência e entrega.

Uma origem ainda não sincronizada recebe até 30 auditorias com pausas de 30 segundos. Nunca são removidas ou publicadas viaturas a partir de uma auditoria inválida. Fotografias/Stories em `preparing` só continuam o mesmo ID/container; `mapping_pending`, resultados desconhecidos e mudanças de identidade não repetem publicação. As retiradas podem continuar lotes seguros, até 10 chamadas. O ciclo aceita continuações durante uma hora desde o arranque.

Uma falha de autorização do catálogo fica registada e permite continuar as etapas independentes do Instagram; nunca equivale a catálogo atualizado. Uma falha ao guardar o resultado mantém o ticket em `running` e exige revisão, pois a operação remota pode ter ocorrido. Falhas de entrega recebem três tentativas; um ticket ainda em fila pode ser reentregue por outro arranque autorizado. Não há garantia de recuperação automática após perda definitiva da invocação; um estado sem progresso durante seis minutos é assinalado `stalled/requiresReview`. Nunca reiniciar o registo para contornar isto.

## Diagnóstico e avisos

`GET /api/stock?integration=morning-flow&action=status&day=AAAA-MM-DD` é privado e só lê. O log `morning_flow_result` guarda resultados sem credenciais; `morning_flow_failed` sinaliza interrupções. `finished` significa que as etapas terminaram as suas tentativas, não que todos os destinos estão corretos. Inspecionar `results`, `verification`, `catalogConfirmed` e operações ativas. A visibilidade efetiva no WhatsApp continua separada (`whatsappVisibilityVerified=false`). O Estado WhatsApp mantém-se manual.

A tarefa ChatGPT única das 08h00 acompanha este resultado no fim do fluxo, sem ocorrência autónoma às 13h30. Avisar alterações comprovadas e intervenções concretas, conforme a preferência guardada; não anunciar publicação em curso como sucesso nem repetir pedidos já comunicados. O cron não envia mensagens por si e não há aviso instantâneo entre execuções da tarefa.

## Validação

`tests/morning-flow.test.mjs` cobre ordem, horário de Lisboa/verão/inverno, concorrência, origem incompleta, continuação do mesmo container, resultados incertos, falha de persistência, destino fixo, autenticação e preservação do cron alheio ao stock. Nenhuma publicação real é necessária para testar o coordenador.

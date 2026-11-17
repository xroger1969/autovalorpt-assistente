# AutoValorPT — ciclo sequencial da manhã

A tarefa ChatGPT existente mantém a folha Google como espelho de consulta às 08h00 Europe/Lisbon. O servidor sincroniza diretamente o inventário completo Standvirtual num snapshot privado, preservando o histórico e validando a origem antes de cada operação. Seguem-se catálogo Meta, retiradas Instagram, uma fotografia, um vídeo/Story e verificação. A folha deixa de bloquear a execução extraordinária. O servidor não escreve na folha: a atualização desse espelho continua a cargo da tarefa ChatGPT.

## Agendamento

`vercel.json` substitui os quatro crons independentes das 09/10/11/12 UTC por duas entradas de arranque, 07 e 08 UTC. `Intl.DateTimeFormat` com `Europe/Lisbon` aceita apenas a entrada que corresponda à hora local 08. Cada data local tem um registo exclusivo; pedidos repetidos não iniciam outro ciclo. A precisão do arranque depende do plano de cron Vercel: uma entrada às 08 não garante execução exatamente ao minuto. O cron de tentativas de contactos comerciais mantém-se intacto.

`GET /api/stock?integration=morning-flow&action=start` requer o CRON_SECRET existente. Um administrador pode iniciar uma execução extra diária a qualquer hora por `POST action=manual-start`, da mesma origem e com sessão válida. O arranque agendado continua limitado às 08h00. O servidor não depende desse acesso administrativo. As entradas individuais antigas continuam disponíveis para administração, mas já não são agendadas; não as chamar para repetir uma etapa do ciclo.

## Continuação e proteção contra duplicados

O registo privado `morning-flow/v1/production/AAAA-MM-DD.json` guarda etapas, tentativas e resultados. Cada etapa reclama um ticket por ETag/CAS antes de executar. O resultado é persistido antes de entregar o ticket seguinte. Os serviços existentes preservam os próprios registos e limites.

O servidor executa as etapas num único trabalhador interno limitado a 260 segundos, com `waitUntil`, sem cadeias de chamadas HTTP à própria função. Cada etapa continua a reclamar o seu ticket por CAS e guarda o resultado antes da seguinte. O orçamento de renderização é ajustado ao tempo restante.

Se o orçamento não permitir outra etapa, o ticket fica em fila. `POST action=resume&mode=manual|scheduled` exige administrador da mesma origem ou credencial de cron e retoma apenas trabalho não reclamado, dentro da janela original de uma hora. Nunca cria novo ciclo nem assume uma operação em estado incerto. O ecrã do iPhone retoma automaticamente um ticket manual em fila há mais de um minuto enquanto estiver aberto. As tarefas de supervisão podem usar a mesma retoma autenticada.

Os callbacks antigos continuam disponíveis para compatibilidade, mas as novas execuções não dependem de chamadas recursivas. Os logs desses callbacks incluem apenas o código HTTP em caso de falha, sem URLs nem credenciais.

Uma origem ainda não sincronizada recebe até 30 tentativas de sincronização validada com pausas de 30 segundos. Nunca são removidas ou publicadas viaturas a partir de uma auditoria inválida. Fotografias/Stories em `preparing` só continuam o mesmo ID/container; `mapping_pending`, resultados desconhecidos e mudanças de identidade não repetem publicação. As retiradas podem continuar lotes seguros, até 10 chamadas. O ciclo aceita continuações durante uma hora desde o arranque.

Uma falha de autorização do catálogo fica registada e permite continuar as etapas independentes do Instagram; nunca equivale a catálogo atualizado. Uma falha ao guardar o resultado mantém o ticket em `running` e exige revisão, pois a operação remota pode ter ocorrido. Um ticket ainda em fila pode ser retomado por outro pedido autorizado, sem repetir etapas concluídas. Não há garantia de recuperação automática após perda definitiva da invocação; um estado sem progresso durante seis minutos é assinalado `stalled/requiresReview`. Nunca reiniciar o registo para contornar isto.

## Diagnóstico e avisos

`GET /api/stock?integration=morning-flow&action=status&day=AAAA-MM-DD` é privado e só lê. O log `morning_flow_result` guarda resultados sem credenciais; `morning_flow_failed` sinaliza interrupções. `finished` significa que as etapas terminaram as suas tentativas, não que todos os destinos estão corretos. Inspecionar `results`, `verification`, `catalogConfirmed` e operações ativas. A visibilidade efetiva no WhatsApp continua separada (`whatsappVisibilityVerified=false`). O Estado WhatsApp mantém-se manual.

A tarefa ChatGPT única das 08h00 acompanha este resultado no fim do fluxo, sem ocorrência autónoma às 13h30. Avisar alterações comprovadas e intervenções concretas, conforme a preferência guardada; não anunciar publicação em curso como sucesso nem repetir pedidos já comunicados. O cron não envia mensagens por si e não há aviso instantâneo entre execuções da tarefa.

## Validação

`tests/morning-flow.test.mjs` cobre ordem, horário de Lisboa/verão/inverno, concorrência, origem incompleta, continuação do mesmo container, resultados incertos, falha de persistência, destino fixo, autenticação e preservação do cron alheio ao stock. Nenhuma publicação real é necessária para testar o coordenador.


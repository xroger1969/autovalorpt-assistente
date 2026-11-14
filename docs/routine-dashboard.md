# Acompanhamento da rotina

`/rotina.html` é a entrada privada para acompanhar a rotina no telemóvel. Reutiliza o código e a sessão de `/api/admin-session`; não cria credenciais nem altera a duração da sessão. Os dados só são pedidos depois de a sessão ser confirmada. Um `401` oculta e limpa o resultado visível.

O painel consulta apenas operações de leitura:

- `morning-flow/status`, para o dia selecionado;
- `meta-catalog/status`, para o último diagnóstico e configuração;
- `instagram-sync/status` e `instagram-sync/stories-status`, para os últimos resultados.

A consulta inicial pode procurar o último ciclo nos sete dias anteriores, parando no primeiro registo encontrado. Isto é identificado como histórico e nunca apresentado como execução de hoje. Enquanto o utilizador acompanha «Hoje», o dia muda automaticamente à meia-noite de Lisboa. A atualização a cada 30 segundos só ocorre com a página visível e pode ser desligada.

Um ciclo `finished` com resultados ausentes, erros ou catálogo por confirmar aparece como terminado com pendências. As contagens Samucar, ficheiro e Meta são independentes; valores ausentes mostram `—`. Falhas de leitura de um serviço não apagam resultados disponíveis de outros. O painel não executa `run`, `check`, publicações, importações ou remoções.

O Estado WhatsApp permanece explicitamente «Automação ainda por validar». Não há ainda um endpoint ou registo automático para esse destino. A ligação de um dispositivo ou um Story publicado não deve mudar este texto para sucesso. Quando a integração for concluída, substituir esta indicação por um estado autenticado com prova por vídeo; nunca inferir publicação a partir do Instagram.

As instruções de controlo explicam onde rever e revogar dispositivos WhatsApp e permissões Meta. Não são incluídos tokens, códigos ou ligações com credenciais. Os avisos continuam a pertencer à tarefa AutoValorPT no ChatGPT; a página não cria notificações novas.

Validação: `node --test tests/routine-dashboard.test.mjs tests/meta-catalog-dashboard.test.mjs` cobre o acesso privado, as contagens desconhecidas, a conclusão com pendências, erros parciais, expiração da sessão, procura histórica e consultas sem mutações.

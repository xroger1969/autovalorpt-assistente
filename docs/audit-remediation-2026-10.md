# Correções da auditoria — outubro de 2026

## Pedidos e acesso privado

O cliente revê os dados e carrega em **Enviar pedido**. O servidor guarda o pedido completo no armazenamento privado antes de contactar qualquer serviço de avisos. Só depois devolve a referência de receção. Repetir a mesma tentativa não cria um segundo pedido nem repete canais já aceites.

- Área privada: `/leads.html` (pedidos, contacto, assuntos, fotografias e estados dos avisos).
- Fotografias: `/retomas.html`; aceita `?batch=<id>` após autenticação.
- Ativação de push no dispositivo: `/avisos-carlos.html`, após autenticação.
- Os URLs dos avisos contêm apenas o identificador opaco do pedido. Os detalhes exigem a sessão privada.
- O antigo código e os antigos tokens de arquivo deixam de ser aceites. Não reutilizar credenciais presentes no histórico Git.

### Configuração administrativa

Guardar exclusivamente como segredos do projeto:

| Variável | Valor |
| --- | --- |
| `ADMIN_ACCESS_HASH` | SHA-256 hexadecimal do código privado aleatório (código com 24–128 caracteres permitidos) |
| `ADMIN_SESSION_SECRET` | Segredo aleatório com pelo menos 32 caracteres |
| `CRON_SECRET` | Segredo aleatório com pelo menos 32 caracteres para a recuperação agendada |

O cookie `__Host-avpt_admin` é assinado, HttpOnly, Secure e SameSite=Strict, com sete dias de validade verificada no servidor. Rodar qualquer uma das duas variáveis administrativas invalida todas as sessões existentes. Produção e o ramo de revisão usam credenciais diferentes.

## Armazenamento e repetição

Reutiliza-se o Vercel Blob privado já ligado ao projeto. Produção usa `leads/v1/production/`; cada ramo de Preview usa um prefixo próprio. As reservas, registos, índices e estados de entrega usam identificadores opacos, leituras de origem e escrita condicional com ETag quando existe atualização concorrente.

Os estados dos avisos são independentes: `pending`, `sending`, `accepted`, `failed`, `unknown`, `unconfigured` ou `disabled`. **Accepted significa aceite pelo fornecedor, não entrega confirmada no dispositivo.**

- OneSignal: chave de idempotência estável e exigência de identificador na resposta.
- Slack e WhatsApp: um timeout ou resposta ambígua é `unknown`; exige verificação e repetição manual explícita.
- A recuperação diária, às **08:00 UTC**, processa até oito pedidos pendentes, dois de cada vez, através de `GET /api/notify-lead?action=retry-pending`, protegido por `CRON_SECRET`.
- Um checkpoint privado por ambiente conserva o cursor e os pedidos por tentar. As execuções percorrem a fila antes de voltar às falhas antigas; o orçamento de 50 segundos e os leases permitem retomar após interrupções.
- A área privada permite recuperar antes desse horário e mostra falhas definitivas ou configurações em falta.
- Os avisos externos ficam desativados em Preview por defeito. `NOTIFICATIONS_PREVIEW_ENABLED=true` é necessário para uma validação real deliberada. `NOTIFICATIONS_ENABLED=false` desativa envios globalmente.
- Quando deliberadamente ativados num Preview, os três canais usam a ligação privada desse ambiente, obtida de `VERCEL_BRANCH_URL` ou `VERCEL_URL`. Sem um destino Preview válido, os avisos mantêm-se desativados.
- Não há follow-up de marketing automático nem envio automático a clientes nesta alteração.

O limite por IP na criação de sessões e submissões é uma proteção por instância. Uma necessidade futura de limitação global exige armazenamento próprio ou regras de firewall.

## Fotografias

Cada sessão permite dez caminhos imutáveis, independentemente do formato. O token de leitura é distinto do token de escrita, válido durante duas horas. O pedido guarda um conjunto fechado de fotografias efetivamente recebidas, associado ao seu identificador.

URLs de upload previamente emitidos podem durar até 90 segundos, mas uploads tardios não alteram o conjunto associado ao pedido. As galerias antigas continuam legíveis. Não foi aplicada eliminação retroativa de fotografias nem de dados de clientes.

O restauro das fotografias aguarda o restauro dos dados do pedido. Uma rejeição definitiva de uma sessão expirada permite escolher novamente os anexos ou enviar sem fotografias, preservando os restantes dados. Uma falha ambígua de rede conserva o payload e o identificador originais para uma repetição idempotente.

## WhatsApp automático para o Carlos

A integração retoma o contrato de cinco parâmetros preparado na PR 24 e permanece desativada até existir configuração completa e `WHATSAPP_ENABLED=true`.

| Variável | Finalidade |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Credencial da Meta com autorização de envio |
| `WHATSAPP_PHONE_NUMBER_ID` | Identificador do número emissor na plataforma |
| `WHATSAPP_ALERT_TO` | Número destinatário do Carlos, com indicativo |
| `WHATSAPP_TEMPLATE_NAME` | Nome exato de um modelo aprovado |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Idioma aprovado; por defeito `pt_PT` |
| `WHATSAPP_GRAPH_VERSION` | Versão da Graph API suportada pela conta, em formato `vN.N` |
| `WHATSAPP_ENABLED` | `true` apenas após configurar e validar o canal |

O corpo do modelo deve aceitar cinco parâmetros nesta ordem: nome do cliente, contacto do cliente, viatura, assuntos e detalhes. O quinto inclui a contagem de fotografias e a ligação privada para abrir o pedido. O destinatário vem sempre da configuração do servidor. A API exige um identificador `wamid.` válido para marcar a mensagem como aceite.

Antes da ativação: confirmar modelo e idioma aprovados, número emissor e destinatário; efetuar uma validação real deliberada para o próprio Carlos; confirmar o resultado no WhatsApp. Sem esses elementos, o painel indica **WhatsApp automático por configurar**, mantendo os pedidos guardados e os restantes canais independentes.

Documentação: [modelos Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview), [mensagens de modelo](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/template-messages), [Vercel Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk).

## Validação

Executar `npm ci` e `npm test`. As regressões cobrem credenciais e sessões, concorrência e falhas de persistência, isolamento dos canais, confirmação de receção, repetição idêntica, validação de contactos e retomas, stock estruturado, fotografias e privacidade da área administrativa. Os testes usam dados fictícios e fornecedores simulados.

A revisão funcional deve confirmar: pedido geral/pergunta livre → contacto → resumo editável → envio → referência; login privado → consulta do pedido e fotografias; rejeição de acesso sem sessão; stock do Peugeot e-2008 com o ano explícito publicado no anúncio.

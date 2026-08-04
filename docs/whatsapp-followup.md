# Follow-up de LEADS — plano seguro

Estado desta fase: **isolado numa branch, com registo privado e dry-run, sem envio real de WhatsApp**.

## Objetivo

Automatizar até 3 follow-ups para leads comerciais sem alterar o funcionamento atual do Assistente AutoValorPT.

## Regras já implementadas no núcleo

- Follow-up 1: 24 horas após o início da sequência.
- Follow-up 2: 72 horas após o início da sequência.
- Follow-up 3: 168 horas após o início da sequência.
- Qualquer resposta posterior do cliente bloqueia a sequência.
- `doNotContact` / opt-out bloqueia todos os envios.
- Leads fechados, perdidos, vendidos ou sem interesse não recebem mensagens.
- Se a viatura estiver marcada como vendida, o follow-up é bloqueado.
- Aos domingos, em `Europe/Lisbon`, nenhum follow-up é considerado elegível.
- Depois do 3.º follow-up a sequência termina.

## Registo privado já preparado

Os leads recebidos pelo endpoint de notificação podem ser registados num espaço privado do Vercel Blob, em `followups/leads/`.

- O identificador do ficheiro é um hash opaco, não o número de telefone.
- O contacto é normalizado para evitar duplicados por diferenças de formatação.
- Uma notificação repetida do mesmo cliente/viatura não reinicia a sequência nem reabre um lead já fechado.
- Uma falha no registo de follow-up não impede as notificações OneSignal/Slack que já existiam.
- Esta integração está apenas na branch de desenvolvimento; a produção continua inalterada.

## Dry-run já preparado

O módulo `followup-dry-run` lê os leads registados, aplica todas as regras e produz um relatório do que **seria** enviado.

O relatório inclui:

- quantidade total de leads avaliados;
- quantidade de follow-ups que estariam vencidos;
- estágio e template correspondente;
- nome e viatura;
- telefone mascarado;
- motivo agregado para os leads bloqueados.

O relatório fixa sempre `sendEnabled: false`. Não existe qualquer chamada à API de envio do WhatsApp nesta fase.

Existe também um endpoint administrativo `POST /api/followup-dry-run`, mas permanece bloqueado enquanto `FOLLOWUP_DRY_RUN_TOKEN` não estiver configurado na Vercel.

## Templates propostos para aprovação futura na Meta

### lead_followup_1

Bom dia, {{1}} 👋 Carlos por aqui. Estou a dar seguimento ao seu pedido sobre o {{2}}. Continua interessado? Se precisar de alguma informação, simulação ou ajuda com retoma, diga-me e trato disso consigo.

### lead_followup_2

Olá, {{1}}. Só queria confirmar se ainda está a considerar o {{2}}. Se quiser, posso também analisar consigo as possibilidades de financiamento ou retoma. Estou disponível 👍

### lead_followup_3

Olá, {{1}}. Faço apenas um último contacto relativamente ao {{2}}, para não estar a incomodar. Se continuar interessado, responda-me aqui e retomamos o processo. Obrigado 👍

## Próximas fases

1. Validar o registo + dry-run no Preview com leads de teste.
2. Criar a atualização segura de estados: respondeu, negociação, fechado, sem interesse e não contactar.
3. Ligar o webhook oficial do WhatsApp Business Platform para detetar respostas.
4. Configurar os templates aprovados na Meta.
5. Criar um processo agendado que avalia leads elegíveis.
6. Manter esse processo em dry-run durante a validação.
7. Ativar envio real apenas depois de validar tudo e com autorização explícita.
8. Criar um pequeno painel para ver: Aguardar, Respondeu, Negociação, Fechado e Não contactar.

## Variáveis de ambiente previstas

Não guardar segredos no repositório. Quando a integração for ativada, as credenciais devem existir apenas nas variáveis seguras da Vercel, por exemplo:

- `FOLLOWUP_DRY_RUN_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `FOLLOWUP_SEND_ENABLED=false` por defeito

## Estratégia de segurança

O envio real deve exigir simultaneamente:

- credenciais válidas;
- template aprovado;
- lead elegível pelas regras do núcleo;
- `FOLLOWUP_SEND_ENABLED=true`;
- idempotência persistente para impedir duplicados.

Enquanto `FOLLOWUP_SEND_ENABLED` não estiver explicitamente ativo, o sistema deve funcionar apenas em modo de simulação.

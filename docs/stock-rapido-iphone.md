# AutoValorPT — atualização extraordinária no iPhone

URL de acesso: https://autovalorpt-assistente.vercel.app/stock-rapido.html

No iPhone, abrir no **Safari** (não num navegador interno de outra aplicação), autenticar com o código privado do painel e selecionar **Partilhar → Adicionar ao ecrã principal**. O atalho instalado abre sempre o mesmo endereço, sem tokens no URL. A sessão de administração é HttpOnly, Secure, SameSite=Strict e expira ao fim de 7 dias.

## Stock sem espera pela folha

A etapa inicial sincroniza diretamente o inventário completo Standvirtual num registo privado. O histórico da folha Stock é importado apenas na primeira sincronização, preservando viaturas vendidas. Nas seguintes, não é necessária escrita na Google Sheets. A tarefa ChatGPT diária continua a atualizar a folha para consulta. Inventários vazios, parciais ou com quedas suspeitas não autorizam alterações nem publicações.

O catálogo Meta recebe um CSV imutável, identificado pelo hash exato. A importação periódica do mesmo feed só passa a consultar o último snapshot depois de a Meta confirmar a alteração da ligação, sem mudar o intervalo existente. Se a Meta continuar a devolver a ligação antiga da folha, a migração permanece por confirmar e novas importações ficam bloqueadas; não se considera essa dependência resolvida. O endpoint público só devolve os dados comerciais; não pode atualizar stock nem iniciar publicações.

## Operação
1. Publicar a viatura na conta Samucar Premium do Standvirtual e aguardar que o anúncio esteja visível na origem.
2. Abrir **Stock AutoValor** no ecrã principal.
3. Carregar em **Atualizar agora**.
4. Acompanhar o estado por etapas e consultar os resultados em /rotina.html. Manter o ecrã aberto permite retomar automaticamente uma etapa que tenha ficado em fila por falta de tempo de execução. O botão «Continuar verificação» só retoma trabalho não iniciado; não repete a fotografia já publicada.

O botão POST autenticado `action=manual-start` cria um ciclo próprio em `morning-flow/v1/production/manual-AAAA-MM-DD.json`, sem substituir o registo do cron diário `AAAA-MM-DD.json`. Um toque repetido no mesmo dia não cria novo ciclo. O coordenador continua com as etapas stock, catálogo Meta, retiradas, fotografia Instagram, vídeo/Story e verificação final. Mantém validações de inventário completo, locks CAS, confirmação remota e registos de publicação. Não envia mensagens a clientes nem publica no Facebook.

A proteção por data impede repetir o ciclo manual no mesmo dia. A execução manual pode publicar uma nova viatura mesmo após uma publicação da manhã; os históricos Instagram impedem repetir o mesmo anúncio. A rotina agendada mantém o limite diário. Uma etapa em execução noutro ciclo continua protegida; uma etapa apenas em fila há mais de uma hora já não pode arrancar. Uma publicação em estado incerto nunca deve ser repetida automaticamente.

## Estados WhatsApp: execução separada

O botão **Atualizar agora** inicia apenas o ciclo do servidor descrito acima. Não desencadeia a tarefa ChatGPT nem o navegador cloud que publica os Estados. O atalho apresenta esta dependência num bloco próprio e liga a `/estado-whatsapp.html`, onde se consultam o acesso do dispositivo e as publicações observadas. Um Story publicado ou um ciclo do servidor terminado não comprovam um Estado WhatsApp publicado.

A tarefa ChatGPT existente das 08h00 inclui a etapa dos Estados no navegador associado à conta empresarial **+351 965 637 736**, desde que a sessão esteja disponível. Para a executar antes dessa ocorrência, é necessária uma execução no ChatGPT, seguindo `docs/whatsapp-status-device.md`: consulta de tentativas pendentes, verificação de retiradas, reserva do vídeo elegível, revalidação antes do envio e observação da publicação. O atalho não cria outro agendamento nem altera os limites ou registos desta etapa.

Se o navegador cloud se desligar, voltar a associá-lo na aplicação WhatsApp Business do iPhone da conta indicada: **Definições → Dispositivos associados → Associar dispositivo**, lendo o QR apresentado nesse navegador cloud. Associar o Chrome local não restabelece a sessão cloud. A associação e o vídeo preparado não comprovam a publicação; o resultado só é confirmado depois de observado em **Os meus estados** e guardado no painel.

## Proteção do alojamento

Para ambientes protegidos pela Vercel Authentication, os callbacks internos podem levar o cabeçalho `x-vercel-protection-bypass` com `VERCEL_AUTOMATION_BYPASS_SECRET` apenas do servidor para o domínio fixo de produção. O segredo é opcional e **nunca** deve ser inserido no iPhone, no URL, num registo ou no repositório. O cabeçalho Authorization do cron continua obrigatório para callbacks. Caso a organização não autorize criar esse bypass, rever no painel da Vercel a configuração de Deployment Protection e os resultados de execução.


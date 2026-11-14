# Dispositivo privado para Estados WhatsApp

Esta preparação não ativa a publicação agendada nem confirma um Estado no WhatsApp. O estado global da rotina permanece pendente até ao teste completo no dispositivo ligado e numa execução agendada.

## Acesso

Abrir `/estado-whatsapp.html` no navegador persistente que tem a conta WhatsApp `+351965637736` ligada. A sessão administrativa existente permite autorizar esse dispositivo uma vez por 90 dias. A página explica a duração e permite revogar o acesso. A autorização WhatsApp é uma operação separada no próprio WhatsApp.

O cookie `__Host-avpt_wa_status` é opaco, aleatório, `HttpOnly`, `Secure` e `SameSite=Strict`. Apenas o hash fica no Blob privado. Não é devolvido no JSON nem colocado em URLs, armazenamento JavaScript ou instruções de automação. A autorização administrativa continua limitada aos sete dias existentes. Nenhum segredo de ambiente novo é necessário.

Revogar aqui bloqueia apenas os vídeos e registos desta aplicação. Não termina a sessão WhatsApp: para isso, remover o navegador em «Dispositivos associados» no WhatsApp do telemóvel.

O acesso permite consultar um candidato e a própria tentativa, obter o MP4 dessa tentativa e registar a observação da publicação. Não permite administrar o site, aceder ao catálogo, alterar Instagram, renderizar vídeos ou consultar uma lista pública de ficheiros. A troca da chave ou do código administrativo invalida também o acesso do dispositivo.

## Execução por um operador autorizado

1. Abrir a página privada e verificar que este dispositivo está autorizado. Verificar que o WhatsApp está ligado ao número indicado. Se precisar de nova autenticação, parar e avisar o proprietário.
2. Usar «Verificar stock e vídeo». O servidor compara a Samucar com os dois ficheiros e seleciona somente o vídeo mais recente elegível, já publicado no Instagram, com o mesmo conteúdo e preço. Nunca gerar outro vídeo nesta etapa.
3. Usar «Reservar este vídeo» e guardar o identificador da tentativa. O servidor persiste a reserva antes de qualquer interação de publicação. Se existir uma tentativa anterior, verificar o resultado dela antes de continuar; nunca reenviar por causa de um timeout.
4. Descarregar o MP4 reservado. O download faz nova verificação do stock e exige o cookie e a tentativa exata. Preparar esse ficheiro no compositor de Estado do WhatsApp, sem enviar ainda.
5. Confirmar a conta e usar «Iniciar envio no WhatsApp» imediatamente antes de enviar. Isto volta a verificar o stock. Só carregar em enviar depois de a página confirmar o início registado. Se a resposta falhar, atualizar o estado e rever; não presumir que não ficou gravado.
6. Enviar uma vez no WhatsApp. Abrir «O meu estado» e observar o vídeo, identificando carro e preço. Só depois preencher a observação e usar «Guardar publicação observada». Este registo é uma observação do navegador; `providerApiVerified` permanece falso.
7. Se a publicação não puder ser confirmada, usar «Resultado incerto». Não repetir o envio automaticamente, mesmo no dia seguinte. Se o registo de observação falhar depois da publicação, atualizar e reconciliar a mesma tentativa; nunca criar outra publicação.

Um administrador pode encerrar uma tentativa sem confirmação para libertar os outros carros. Esse encerramento mantém o identificador do carro definitivamente processado e não comprova que tenha sido publicado. Revogar o dispositivo nunca elimina uma tentativa pendente. Uma nova autorização só é permitida depois de a tentativa anterior ser reconciliada ou encerrada.

## Persistência e limites

O estado e o acesso ficam juntos em `whatsapp-status/v1/production/state.json`, com ETag e escrita condicional. Assim, uma reserva não pode sobrescrever uma revogação concorrente, nem duas execuções reservar o mesmo trabalho. Resultados ativos ou incertos não expiram para reenvio automático.

A primeira reserva exclui os restantes carros atuais da publicação inicial em massa. Depois disso, apenas identificadores novos são elegíveis; carros já processados, retirados ou reaparecidos não voltam a entrar automaticamente. Há no máximo um início de envio por dia em `Europe/Lisbon`; resultado incerto, revogação ou encerramento manual não libertam essa quota diária. A preparação reutiliza MP4 privados e não altera os históricos Instagram ou consome quota de renderização/publicação Instagram.

Esta primeira implementação impede novos envios de carros retirados ou com dados alterados, mas não reconcilia nem elimina Estados já publicados. Se o stock mudar enquanto o Estado ainda estiver visível, a retirada tem de ser confirmada no WhatsApp. A automação completa de retiradas depende de um passo adicional no executor do navegador e de prova visual da remoção.

As operações usam o router existente `/api/stock?integration=whatsapp-status`, sem aumentar o número de funções Vercel. Consultas são GET; mudanças exigem POST com origem HTTPS igual ao host. A página pública contém apenas a interface, sem dados privados. Os dados e o MP4 exigem autenticação e usam `no-store` e `no-referrer`.

O navegador persistente e a sessão WhatsApp têm de continuar disponíveis ao executor agendado. O código não assegura a disponibilidade da infraestrutura do navegador, não contorna autenticação WhatsApp e não publica por uma API não documentada. Expiração, revogação e ausência de sessão exigem aviso ao proprietário. Até esse fluxo estar testado, `automation` fica `pending_end_to_end_test` e os marcadores da rotina existentes mantêm-se inalterados.

## Verificação

`node --test tests/whatsapp-status.test.mjs` cobre separação de privilégios, 90 dias/revogação/rotação, origem e métodos, falta de stock válido, alteração de preço, identidade Instagram, concorrência com revogação/reserva, ausência de repetição, registo de observação e limite diário. A suíte existente deve continuar a passar antes da implantação.

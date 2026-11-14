# Dispositivo privado para Estados WhatsApp

Esta preparação não ativa a publicação agendada nem confirma um Estado no WhatsApp. Depois de uma publicação observada no dispositivo atual, o painel distingue esse resultado da primeira execução agendada, ainda por validar. Uma eliminação também exige prova visual própria.

## Acesso

Abrir `/estado-whatsapp.html` no navegador persistente que tem a conta WhatsApp `+351965637736` ligada. A sessão administrativa existente permite autorizar esse dispositivo uma vez por 90 dias. A página explica a duração e permite revogar o acesso. A autorização WhatsApp é uma operação separada no próprio WhatsApp.

O cookie `__Host-avpt_wa_status` é opaco, aleatório, `HttpOnly`, `Secure` e `SameSite=Strict`. Apenas o hash fica no Blob privado. Não é devolvido no JSON nem colocado em URLs, armazenamento JavaScript ou instruções de automação. A autorização administrativa continua limitada aos sete dias existentes. Nenhum segredo de ambiente novo é necessário.

Revogar aqui bloqueia apenas os vídeos e registos desta aplicação. Não termina a sessão WhatsApp: para isso, remover o navegador em «Dispositivos associados» no WhatsApp do telemóvel.

O acesso permite consultar um candidato e a própria tentativa, obter o MP4 dessa tentativa e registar a observação da publicação. Permite também preparar e confirmar a retirada das publicações registadas pelo mesmo dispositivo, com as condições abaixo. Não permite administrar o site, aceder ao catálogo, alterar Instagram, renderizar vídeos ou consultar uma lista pública de ficheiros. A troca da chave ou do código administrativo invalida também o acesso do dispositivo.

## Execução por um operador autorizado

1. Abrir a página privada e verificar que este dispositivo está autorizado. Verificar que o WhatsApp está ligado ao número indicado. Se precisar de nova autenticação, parar e avisar o proprietário.
2. Usar «Verificar stock e vídeo». O servidor compara a Samucar com os dois ficheiros e seleciona somente o vídeo mais recente elegível, já publicado no Instagram, com o mesmo conteúdo e preço. Nunca gerar outro vídeo nesta etapa.
3. Usar «Reservar este vídeo» e guardar o identificador da tentativa. O servidor persiste a reserva antes de qualquer interação de publicação. Se existir uma tentativa anterior, verificar o resultado dela antes de continuar; nunca reenviar por causa de um timeout.
4. Descarregar o MP4 reservado. O download faz nova verificação do stock e exige o cookie e a tentativa exata. Preparar esse ficheiro no compositor de Estado do WhatsApp, sem enviar ainda.
5. Confirmar a conta e usar «Iniciar envio no WhatsApp» imediatamente antes de enviar. Isto volta a verificar o stock. Só carregar em enviar depois de a página confirmar o início registado. Se a resposta falhar, atualizar o estado e rever; não presumir que não ficou gravado.
6. Enviar uma vez no WhatsApp. Abrir «O meu estado» e observar o vídeo, identificando carro e preço. Só depois preencher a observação e usar «Guardar publicação observada». Este registo é uma observação do navegador; `providerApiVerified` permanece falso.
7. Se a publicação não puder ser confirmada, usar «Resultado incerto». Não repetir o envio automaticamente, mesmo no dia seguinte. Se o registo de observação falhar depois da publicação, atualizar e reconciliar a mesma tentativa; nunca criar outra publicação.

Um administrador pode encerrar uma tentativa sem confirmação para libertar os outros carros. Esse encerramento mantém o identificador do carro definitivamente processado e não comprova que tenha sido publicado. Revogar o dispositivo nunca elimina uma tentativa pendente. Uma nova autorização só é permitida depois de a tentativa anterior ser reconciliada ou encerrada.

## Retirada de Estados desatualizados

1. Antes de uma nova publicação, usar «Verificar Estados a retirar». A consulta não altera registos nem elimina conteúdos. Considera apenas publicações observadas desta rotina, pertencentes ao dispositivo autorizado e ainda dentro das 24 horas posteriores ao início de envio registado; registos antigos sem esse marcador usam a data de observação. Um administrador pode consultar registos de outros dispositivos, mas a autorização restrita de um dispositivo não permite operar publicações alheias.
2. A mesma auditoria completa da Samucar, Stock e Catalogo tem de confirmar a alteração. Para uma saída, exige-se uma linha explicitamente `out of stock` na folha Stock e ausência entre os disponíveis. A simples ausência de uma linha não autoriza eliminar. Para uma alteração de dados/preço, a impressão digital atual tem de diferir da do vídeo publicado. Uma auditoria incompleta, incoerente, vazia ou desatualizada bloqueia a operação.
3. Preparar a retirada do candidato exato. Isto reserva uma operação com o identificador da publicação original e a sua impressão digital, sem alterar o registo de publicação. Publicações e retiradas usam a mesma exclusão mútua; não podem avançar simultaneamente.
4. Abrir apenas «O meu estado» da conta indicada, localizar o vídeo exato e comparar carro, preço e prova da publicação original. Se o vídeo não estiver visível, se não for identificável sem ambiguidades ou se houver Estados indistinguíveis, não eliminar nem selecionar outro como alternativa. Registar resultado incerto e pedir revisão quando necessária. Não consultar conversas ou Estados de terceiros para procurar correspondências.
5. Descrever a identificação e confirmar as duas opções antes de usar «Registar início da eliminação». O servidor volta a validar o stock, a propriedade do registo e a janela de 24 horas. Só eliminar o Estado no WhatsApp depois da confirmação deste marcador. Uma falha da resposta exige consultar o estado; não repetir a eliminação por causa de um timeout.
6. Eliminar uma vez esse Estado no WhatsApp. Observar a ação concluída e confirmar que o vídeo exato deixou de aparecer em «O meu estado». Só depois usar «Guardar eliminação observada». Ausência isolada, fim da janela de 24 horas ou atualização de um ficheiro não são provas de eliminação.

Um marcador `deleting` encontrado ao retomar uma execução não autoriza outro clique de eliminação: primeiro observar e reconciliar a tentativa existente. Só a primeira resposta confirmada de início, imediatamente seguida da ação no mesmo percurso, permite avançar. Se não for possível determinar se a ação já aconteceu, manter o resultado incerto.

O resultado `observed_removed` conserva a publicação original e acrescenta a observação anterior e posterior da retirada. `providerApiVerified` mantém-se falso. Uma retirada incerta conserva a tentativa e bloqueia repetições. O administrador pode encerrar sem confirmar eliminação; isso não apaga a prova original nem volta a autorizar a mesma retirada.

Quando decorre essa janela de 24 horas, o plano apresenta `window_elapsed`, nunca uma eliminação confirmada, e deixa de selecionar esse Estado. Uma observação tardia após interrupção não prolonga o prazo quando o início de envio está registado. É um limite conservador de seleção, não uma consulta da expiração real no WhatsApp. Uma tentativa já incerta não é automaticamente apagada por este prazo.

## Persistência e limites

O estado e o acesso ficam juntos em `whatsapp-status/v1/production/state.json`, com ETag e escrita condicional. Assim, uma reserva não pode sobrescrever uma revogação concorrente, nem duas execuções reservar o mesmo trabalho. Resultados ativos ou incertos não expiram para reenvio automático.

A primeira reserva exclui os restantes carros atuais da publicação inicial em massa. Depois disso, apenas identificadores novos são elegíveis; carros já processados, retirados ou reaparecidos não voltam a entrar automaticamente. Há no máximo um início de envio por dia em `Europe/Lisbon`; resultado incerto, revogação ou encerramento manual não libertam essa quota diária. A preparação reutiliza MP4 privados e não altera os históricos Instagram ou consome quota de renderização/publicação Instagram.

O código prepara e regista publicações e retiradas; a ação real no WhatsApp é efetuada pelo executor autorizado do navegador. Nenhum endpoint chama uma API não documentada, elimina em massa ou aceita ausência/expiração como confirmação. Não se deve afirmar que as retiradas estão automatizadas até esse percurso estar integrado e testado na execução agendada.

As operações usam o router existente `/api/stock?integration=whatsapp-status`, sem aumentar o número de funções Vercel. Consultas são GET; mudanças exigem POST com origem HTTPS igual ao host. A página pública contém apenas a interface, sem dados privados. Os dados e o MP4 exigem autenticação e usam `no-store` e `no-referrer`.

O navegador persistente e a sessão WhatsApp têm de continuar disponíveis ao executor agendado. O código não assegura a disponibilidade da infraestrutura do navegador, não contorna autenticação WhatsApp e não publica por uma API não documentada. Expiração, revogação e ausência de sessão exigem aviso ao proprietário. Sem uma publicação observada pelo dispositivo atual, `automation` fica `pending_end_to_end_test`; com essa prova, fica `publication_observed_scheduled_test_pending`. Nenhum destes estados comprova a execução agendada. Os marcadores das outras etapas mantêm-se inalterados.

## Verificação

`node --test tests/whatsapp-status.test.mjs` cobre separação de privilégios, 90 dias/revogação/rotação, origem e métodos, falta de stock válido, alteração de preço, identidade Instagram, concorrência com revogação/reserva, ausência de repetição, registo de observação, limite diário, retirada explícita versus ausência, janela decorrida versus eliminação e preservação da prova original. A suíte existente deve continuar a passar antes da implantação.

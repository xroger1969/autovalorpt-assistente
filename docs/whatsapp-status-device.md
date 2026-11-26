# Dispositivo privado para Estados WhatsApp

Em `/rotina.html#estado-whatsapp`, a secção **Estado do WhatsApp** reúne os vídeos de viaturas novas e as dicas já publicadas no Instagram. A aplicação prepara os ficheiros. O proprietário escolhe «O meu estado» no WhatsApp Business, envia e regista o que viu.

## Acesso

Entrar no painel privado. Para os vídeos, abrir **Preparar vídeo de uma viatura nova** e autorizar o dispositivo em `/estado-whatsapp.html`. A autorização dura 90 dias e pode ser revogada. No WhatsApp Business ou WhatsApp Web, usar a conta `+351965637736`.

O cookie `__Host-avpt_wa_status` é opaco, aleatório, `HttpOnly`, `Secure` e `SameSite=Strict`. Apenas o hash fica no Blob privado. Não é devolvido no JSON nem colocado em URLs, armazenamento JavaScript ou instruções de automação. A autorização administrativa continua limitada aos sete dias existentes. Nenhum segredo de ambiente novo é necessário.

Revogar aqui bloqueia apenas os vídeos e registos desta aplicação. Não termina a sessão WhatsApp: para isso, remover o navegador em «Dispositivos associados» no WhatsApp do telemóvel.

O acesso permite consultar um candidato e a própria tentativa, obter o MP4 dessa tentativa e registar a observação da publicação. Permite também preparar e confirmar a retirada das publicações registadas pelo mesmo dispositivo, com as condições abaixo. Não permite administrar o site, aceder ao catálogo, alterar Instagram, renderizar vídeos ou consultar uma lista pública de ficheiros. A troca da chave ou do código administrativo invalida também o acesso do dispositivo.

## Partilhar uma viatura

1. Abrir **Preparar vídeo de uma viatura nova**. A consulta confere os anúncios disponíveis da Samucar e da AutoValorPT com o stock sincronizado e apresenta a origem do anúncio. As viaturas novas com vídeo confirmado entram por ordem de espera. A expiração natural do Story no Instagram permite continuar a usar o MP4 original se os dados e o preço se mantiverem.
2. Selecionar **Reservar este vídeo**. O servidor guarda a reserva antes do envio. Se já existir uma tentativa, abrir o respetivo registo.
3. No iPhone, confirmar o número da conta e preparar o MP4. A aplicação confere o stock e regista o início. A legenda usa o modelo e o preço da viatura. Para a ter à mão, tocar em **Copiar legenda**. Tocar em **Partilhar vídeo no Estado**, escolher WhatsApp Business e depois **O meu estado**. Se o campo da legenda aparecer vazio, colar o texto antes de enviar.
4. Onde a partilha de ficheiros estiver indisponível, descarregar o vídeo reservado. Preparar o Estado no WhatsApp, confirmar o número no painel e tocar em **Registar início do envio** antes de enviar. Se a folha de partilha tiver fechado depois do registo inicial, verificar primeiro o resultado no WhatsApp.
5. Enviar uma vez. Abrir **O meu estado**, verificar o carro e o preço que aparecem no vídeo e usar **Guardar publicação observada**. A aplicação guarda a observação do operador (`providerApiVerified: false`).
6. Se o resultado for incerto, usar **Resultado incerto**. Recuperar a mesma tentativa permite consultar o seu estado mesmo que a ligação ao painel tenha falhado.

Um administrador pode encerrar uma tentativa sem confirmação para libertar os outros carros. Esse encerramento mantém o identificador do carro definitivamente processado e não comprova que tenha sido publicado. Revogar o dispositivo nunca elimina uma tentativa pendente. Uma nova autorização só é permitida depois de a tentativa anterior ser reconciliada ou encerrada.

## Partilhar uma dica

Abrir **Estado do WhatsApp** no painel principal e escolher uma publicação diária ou extra já confirmada no Instagram. A pré-visualização mostra a imagem ou o vídeo e a legenda completa para o Estado. As imagens preparadas para o Estado incluem um resumo da dica.

Tocar em **Preparar dica e copiar legenda**. Se a cópia automática falhar, selecionar e copiar a legenda apresentada. Tocar em **Partilhar no WhatsApp…** e escolher WhatsApp Business → **O meu estado**. A aplicação inclui a legenda com os ficheiros quando o navegador aceita ambos. Se o campo da legenda aparecer vazio, manter o dedo no campo e escolher **Colar**. Para publicar, tocar na seta de envio. Também é possível descarregar os ficheiros e escolher o conteúdo em **Atualizações → Adicionar estado**.

Depois de ver a dica na conta indicada, escolher **Vi esta dica no meu Estado**. Cada publicação tem o seu próprio registo de partilha. A dica diária e a extra podem ser partilhadas no mesmo dia que uma viatura. Essas ações preservam o limite das viaturas e os horários de publicação no Instagram.

## Retirada de Estados desatualizados

1. Antes de uma nova publicação, usar «Verificar Estados a retirar». A consulta não altera registos nem elimina conteúdos. Considera apenas publicações observadas desta rotina, pertencentes ao dispositivo autorizado e ainda dentro das 24 horas posteriores ao início de envio registado; registos antigos sem esse marcador usam a data de observação. Um administrador pode consultar registos de outros dispositivos, mas a autorização restrita de um dispositivo não permite operar publicações alheias.
2. A auditoria dos dois inventários e do stock sincronizado tem de confirmar a alteração. Para uma saída, exige-se uma linha explicitamente `out of stock` no histórico de stock e ausência entre os anúncios disponíveis. A simples ausência de uma linha não autoriza eliminar. Para uma alteração de dados/preço, a impressão digital atual tem de diferir da do vídeo publicado. Uma auditoria incompleta, incoerente, vazia ou desatualizada bloqueia a operação.
3. Preparar a retirada do candidato exato. Isto reserva uma operação com o identificador da publicação original e a sua impressão digital, sem alterar o registo de publicação. Publicações e retiradas usam a mesma exclusão mútua; não podem avançar simultaneamente.
4. Abrir apenas «O meu estado» da conta indicada, localizar o vídeo exato e comparar carro, preço e prova da publicação original. Se o vídeo não estiver visível, se não for identificável sem ambiguidades ou se houver Estados indistinguíveis, não eliminar nem selecionar outro como alternativa. Registar resultado incerto e pedir revisão quando necessária. Não consultar conversas ou Estados de terceiros para procurar correspondências.
5. Descrever a identificação e confirmar as duas opções antes de usar «Registar início da eliminação». O servidor volta a validar o stock, a propriedade do registo e a janela de 24 horas. Só eliminar o Estado no WhatsApp depois da confirmação deste marcador. Uma falha da resposta exige consultar o estado; não repetir a eliminação por causa de um timeout.
6. Eliminar uma vez esse Estado no WhatsApp. Observar a ação concluída e confirmar que o vídeo exato deixou de aparecer em «O meu estado». Só depois usar «Guardar eliminação observada». Ausência isolada, fim da janela de 24 horas ou atualização de um ficheiro não são provas de eliminação.

Um marcador `deleting` encontrado ao retomar uma execução não autoriza outro clique de eliminação: primeiro observar e reconciliar a tentativa existente. Só a primeira resposta confirmada de início, imediatamente seguida da ação no mesmo percurso, permite avançar. Se não for possível determinar se a ação já aconteceu, manter o resultado incerto.

O resultado `observed_removed` conserva a publicação original e acrescenta a observação anterior e posterior da retirada. `providerApiVerified` mantém-se falso. Uma retirada incerta conserva a tentativa e bloqueia repetições. O administrador pode encerrar sem confirmar eliminação; isso não apaga a prova original nem volta a autorizar a mesma retirada.

Quando decorre essa janela de 24 horas, o plano apresenta `window_elapsed`, nunca uma eliminação confirmada, e deixa de selecionar esse Estado. Uma observação tardia após interrupção não prolonga o prazo quando o início de envio está registado. É um limite conservador de seleção, não uma consulta da expiração real no WhatsApp. Uma tentativa já incerta não é automaticamente apagada por este prazo.

## Persistência e limites

O estado e o acesso ficam juntos em `whatsapp-status/v1/production/state.json`, com ETag e escrita condicional. Assim, uma reserva não pode sobrescrever uma revogação concorrente, nem duas execuções reservar o mesmo trabalho. Resultados ativos ou incertos não expiram para reenvio automático.

Na primeira reserva, a fila escolhe um vídeo confirmado nas últimas 24 horas e regista o stock já existente como referência. Se encontrar um vídeo recente indisponível ao procurar o candidato, mantém essa viatura pendente. Nas consultas seguintes, verifica primeiro as viaturas há mais tempo em espera. Um ficheiro em falta ou inválido deixa passar a próxima viatura disponível. Um erro temporário de armazenamento interrompe a consulta. Cada identificador já processado conserva o seu registo, mesmo que a viatura reapareça no stock. Há no máximo um início de envio de viatura por dia em `Europe/Lisbon`. A tentativa conta para o limite mesmo que termine com resultado incerto, revogação ou encerramento manual. A preparação reutiliza MP4 privados e não altera os históricos Instagram ou consome quota de renderização/publicação Instagram.

As retiradas de viaturas são manuais e exigem observação no WhatsApp. Os registos conservam a publicação original e a eventual retirada. Uma ausência ou expiração tem um resultado distinto de uma eliminação confirmada.

A gestão das viaturas usa o router existente `/api/stock?integration=whatsapp-status`. As consultas usam GET. Alterações exigem POST com a mesma origem HTTPS. Os dados e o MP4 exigem autenticação e usam `no-store` e `no-referrer`.

## Verificação

`node --test tests/whatsapp-status.test.mjs` cobre separação de privilégios, 90 dias/revogação/rotação, origem e métodos, falta de stock válido, alteração de preço, identidade Instagram, concorrência com revogação/reserva, ausência de repetição, registo de observação, limite diário, retirada explícita versus ausência, janela decorrida versus eliminação e preservação da prova original. A suíte existente deve continuar a passar antes da implantação.

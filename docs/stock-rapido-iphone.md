# AutoValorPT — atualização extraordinária no iPhone

URL de acesso: https://autovalorpt-assistente.vercel.app/stock-rapido.html

Este endereço abre o painel completo por reescrita interna para `rotina.html`: a barra de endereço permanece em `stock-rapido.html`. O atalho já instalado continua válido. A política de conteúdo permite as imagens originais de stock e os vídeos da própria aplicação, mantendo o acesso privado.

No iPhone, abrir no **Safari** (não num navegador interno de outra aplicação), autenticar com o código privado do painel e selecionar **Partilhar → Adicionar ao ecrã principal**. O atalho instalado abre sempre o mesmo endereço, sem tokens no URL. A sessão de administração é HttpOnly, Secure, SameSite=Strict e expira ao fim de 7 dias.

## Stock sem espera pela folha

A etapa inicial sincroniza diretamente os inventários completos da Samucar Premium e da AutoValorPT no Standvirtual num registo privado. O histórico da folha Stock é importado apenas na primeira sincronização, preservando viaturas vendidas. Nas seguintes, não é necessária escrita na Google Sheets. A tarefa ChatGPT diária continua a atualizar a folha para consulta. Se alguma das contas devolver um inventário vazio, parcial ou com uma queda suspeita, o último catálogo completo é conservado e não se iniciam alterações nem publicações.

O catálogo Meta recebe um CSV imutável, identificado pelo hash exato. A importação periódica do mesmo feed só passa a consultar o último snapshot depois de a Meta confirmar a alteração da ligação, sem mudar o intervalo existente. Se a Meta continuar a devolver a ligação antiga da folha, a migração permanece por confirmar e novas importações ficam bloqueadas; não se considera essa dependência resolvida. O endpoint público só devolve os dados comerciais; não pode atualizar stock nem iniciar publicações.

## Operação
1. Publicar a viatura na conta Samucar Premium ou na conta AutoValorPT do Standvirtual e aguardar que o anúncio esteja visível na origem.
2. Abrir **Stock AutoValor** no ecrã principal.
3. Carregar em **Atualizar tudo**. Se a atualização extra do dia já terminou, o botão **Verificar tudo** consulta os resultados.
4. Acompanhar os resultados no mesmo ecrã. Manter o ecrã aberto permite retomar automaticamente uma etapa que tenha ficado em fila por falta de tempo de execução. O botão **Continuar atualização** retoma a execução existente; não repete a fotografia já publicada.

O botão POST autenticado `action=manual-start` cria um ciclo próprio em `morning-flow/v1/production/manual-AAAA-MM-DD.json`, sem substituir o registo do cron diário `AAAA-MM-DD.json`. Um toque repetido no mesmo dia não cria novo ciclo. O coordenador continua com as etapas stock, catálogo Meta, retiradas, fotografia Instagram, vídeo/Story e verificação final. Mantém validações de inventário completo, locks CAS, confirmação remota e registos de publicação. Não envia mensagens a clientes nem publica no Facebook.

A proteção por data impede repetir o ciclo manual no mesmo dia. A execução manual pode publicar uma nova viatura mesmo após uma publicação da manhã; os históricos Instagram impedem repetir o mesmo anúncio. A rotina agendada mantém o limite diário. Uma etapa em execução noutro ciclo continua protegida; uma etapa apenas em fila há mais de uma hora já não pode arrancar. Uma publicação em estado incerto nunca deve ser repetida automaticamente.

## Estado do WhatsApp

O botão **Atualizar tudo** inicia o ciclo de stock, catálogo e Instagram. A secção **Estado do WhatsApp**, nos resultados do mesmo painel, permite rever os vídeos de viaturas novas e as dicas já publicadas no Instagram.

O painel prepara o conteúdo para a conta **+351 965 637 736**. A publicação requer a ação **Enviar** no WhatsApp Business. Depois de a veres em **O meu estado**, podes registar essa observação no painel. O procedimento e as regras de recuperação de tentativas ficam em [Dispositivo privado para Estados WhatsApp](whatsapp-status-device.md).

## Identidade visual

As novas publicações usam AutoValorPT Premium: azul-marinho, dourado e branco. As seis capas de destaques estão em **Mais detalhes e definições → Identidade visual**, como PNG de 1080 × 1080 para guardar no iPhone. A substituição de uma capa no perfil continua a ser feita no Instagram; descarregar uma imagem não altera o perfil.

Os vetores originais e PNG ficam em `assets/brand/`. Para os reconstruir com a paleta partilhada, executar `node scripts/prepare-brand-covers.mjs`. O script apenas escreve ficheiros locais e não publica conteúdo.

## Proteção do alojamento

Para ambientes protegidos pela Vercel Authentication, os callbacks internos podem levar o cabeçalho `x-vercel-protection-bypass` com `VERCEL_AUTOMATION_BYPASS_SECRET` apenas do servidor para o domínio fixo de produção. O segredo é opcional e **nunca** deve ser inserido no iPhone, no URL, num registo ou no repositório. O cabeçalho Authorization do cron continua obrigatório para callbacks. Caso a organização não autorize criar esse bypass, rever no painel da Vercel a configuração de Deployment Protection e os resultados de execução.


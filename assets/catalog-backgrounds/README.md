# Fundo de referência Samucar — catálogo AutoValorPT

## Referência e preparação

`samucar-2026-11-v1.jpg` é o cenário fixo preparado em 20 de novembro de 2026,
a pedido de Tino, para uniformizar as capas da sua conta Standvirtual no catálogo.
Tem 1200 × 900 píxeis; SHA-256:
`72ed660558e1f704efc5d1da9e0e9659df12426cb713e59df24c03042d2850f4`.

O Imagegen preparou uma imagem vazia a partir das fotografias públicas da Samucar,
preservando a fachada em madeira, o vidro, a palmeira e a cobertura verde. A
fotografia principal foi a capa do Mercedes-Benz GLC 300 (`ID8Q1luY`); a capa do
Tesla Model 3 (`ID8Q19HN`) serviu de referência complementar. Os anúncios foram
consultados em <https://spremium.standvirtual.com/inventory> e os ficheiros de
referência vieram do CDN OLX apresentado por esse inventário.

A primeira edição removeu os veículos e pessoas da cena. A segunda prolongou o
pavimento de blocos até à fachada, evitando que rodas traseiras de fotografias
com outra perspetiva ficassem sobre a faixa de relva. O fundo é, por isso, uma
composição preparada a partir das instalações, não uma fotografia documental
inalterada. A marca de água existente foi conservada. Não foram acrescentados
novos logótipos, placas publicitárias nem dados de veículos.

## Utilização e limites

A preparação automática aplica-se apenas à fotografia principal das viaturas
pertencentes à conta AutoValorPT. A visão identifica imagens de exterior completo,
fotografias já no cenário Samucar, interiores e detalhes. Interiores, detalhes e
fotografias que já mostram as instalações conservam a imagem de origem.

O veículo não é recriado pelo Imagegen: o processador local calcula uma máscara,
mantém os píxeis da fotografia original e compõe-os sobre este fundo. São mantidos
enquadramento, dimensões, cor, matrícula, jantes, luzes e reflexos. A margem do
recorte tem suavização e uma sombra discreta é composta no pavimento. A revisão
visual automática deve aprovar a identidade e integridade do carro, os contornos
e o contacto com o chão antes de a imagem poder ser servida no catálogo.

A visão usa a ligação OpenAI já configurada, com o modelo fixado
`gpt-5.4-mini-2026-03-17`, `store: false` e JSON estruturado. São feitas no máximo
duas chamadas por nova fotografia: classificação e revisão. O recorte usa U2NetP
local, sem um novo serviço pago de remoção de fundo. A documentação e as licenças
do modelo encontram-se em `../models/README.md`.

O resultado é associado ao ID da viatura, URL e hash dos bytes de origem, versão
do fundo e versão do processamento. Uma alteração apenas de preço ou quilómetros
reutiliza a imagem aprovada. Alterar os bytes da fotografia ou a receita cria uma
nova avaliação. Cada sincronização pode preparar no máximo duas capas, dentro de
um orçamento de 85 segundos, reservando pelo menos 30 segundos antes de reclamar
um trabalho novo. Falhas e resultados incertos mantêm a imagem original e ficam
visíveis no diagnóstico, sem repetição automática de um pedido de resultado
desconhecido.

## Entrega ao catálogo

A origem comercial e as galerias Standvirtual ficam guardadas sem substituições.
O ficheiro derivado muda apenas `image_link` nas capas aprovadas. O mesmo endpoint
de feed continua a servir versões imutáveis; URLs antigas e imagens antigas
mantêm-se acessíveis. GET e HEAD públicos apenas leem imagens aprovadas e
verificadas por hash; nunca iniciam processamento nem aceitam URLs arbitrários.

O ciclo privado é: atualizar ambas as contas, preparar as capas elegíveis,
validar novamente a origem e importar o ficheiro. A rotina de catálogo também
confere a URL de imagem e o estado de obtenção devolvidos pela Meta. Uma imagem
pendente não provoca sucessivas importações. A igualdade de IDs, preços e URLs
não é apresentada como prova de visibilidade final no WhatsApp.

Esta alteração não modifica os anúncios Standvirtual nem inicia publicações em
redes sociais. O acesso à conta Meta, a confirmação da agenda de importação e as
restantes verificações de autorização continuam a ser exigidos pelo fluxo existente.

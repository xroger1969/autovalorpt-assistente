# AutoValorPT Assistente

Assistente comercial automóvel da AutoValorPT, com consulta visual do stock e encaminhamento seguro para Carlos Vasconcelos.

## Princípios

- Respostas naturais sobre automóveis.
- Disponibilidade, avaliações de retoma, preços finais e condições concretas de financiamento são sempre confirmados pelo Carlos.
- Não recolhe NIF, IBAN, documentos, cartões ou credenciais.

## Publicação na Vercel

1. Importar este repositório na Vercel.
2. Adicionar `OPENAI_API_KEY` às variáveis de ambiente.
3. Opcionalmente configurar `OPENAI_MODEL` e `STOCK_URL`.
4. Criar e ligar ao projeto um Vercel Blob privado nos ambientes Preview e
   Production. A ligação por OIDC disponibiliza `BLOB_STORE_ID` e
   `BLOB_WEBHOOK_PUBLIC_KEY`; não é necessário copiar manualmente um token para
   receber fotografias de retomas.

O projeto não necessita de comando de build.

## Área privada de retomas

A página `/retomas.html` permite ao proprietário consultar as retomas recebidas
e abrir as fotografias guardadas no Blob privado. O acesso inicial usa um código
privado; depois da validação, é criado um cookie `HttpOnly`, `Secure` e
`SameSite=Strict` com duração de 30 dias.

O repositório contém apenas o resumo SHA-256 do código de acesso, nunca o código
original. A página não está ligada ao percurso público e está marcada para não
ser indexada por motores de pesquisa.

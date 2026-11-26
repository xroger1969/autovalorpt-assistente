# Plano de melhoria de Stock e publicações

O objetivo é tornar previsível a diferença entre consultar, preparar e publicar, e permitir recuperar um pedido quando a ligação ou o navegador falha. O plano parte da auditoria de 26 de novembro de 2026 a `/rotina.html` e ao atalho instalado.

O código inclui as alterações da fase 1, a recuperação de pedidos no servidor e a consulta única da última execução. No Chromium com dados fictícios, o painel foi verificado por teclado, a 200% de zoom e com 291 píxeis CSS de largura. Os ensaios com fornecedores simulados cobrem a recuperação em concorrência e a consulta de uma publicação ambígua.

## 1. Entrada, ações e recuperação

| Melhoria | Critério de aceitação |
| --- | --- |
| Isolar a gestão da sessão dos módulos editoriais. | O formulário continua funcional quando falta um módulo editorial. As ações desse módulo apresentam o estado indisponível. |
| Distinguir consulta, atualização manual e retoma. | «Consultar estado» só faz leituras. O arranque manual pede confirmação e identifica os canais afetados. A retoma de um pedido já autorizado tem uma ação e um estado próprios. |
| Recuperar pedidos de vídeo e Stories. | Uma falha transitória da sessão conserva os pedidos. Dois separadores podem preparar vídeos independentes. A consulta automática tem um limite e é possível retomar a consulta manualmente. |
| Recuperar a partilha para WhatsApp. | Uma falha de ficheiro conserva a seleção e permite nova tentativa. O cancelamento permite reutilizar os ficheiros ou libertar a reserva. A confirmação continua a depender da observação no WhatsApp. |
| Aplicar a mesma proteção à página e ao atalho. | Ambas as rotas enviam os mesmos cabeçalhos privados e carregam estilos externos. Os controlos dos formulários têm contraste adequado. |

## 2. Estado no servidor e desempenho

1. Em «Recuperar pedidos de vídeo e Stories», a consulta autenticada lista registos privados existentes por páginas. A seleção de um vídeo acompanha o pedido original. A seleção de um Story consulta o estado e pode registar uma confirmação observada na Meta. A consulta devolve referências mínimas e o envio continua a exigir a autorização existente no fluxo de publicação.
2. O histórico consulta a última rotina agendada dos sete dias anteriores num só pedido. A apresentação dos canais é progressiva. Mudar a data no histórico consulta apenas essa execução.
3. Avaliar nomes com hash de conteúdo para aplicar cache imutável a recursos estáticos. Medir a entrada e o painel com rede móvel simulada e comparar com os valores anteriores. As miniaturas já usam os vetores originais das capas e os downloads mantêm os PNG.

## 3. Validação integrada

- Usar uma sessão de teste e operações simuladas para rever a entrada, a saída entre separadores, a atualização manual, a seleção de viaturas e a recuperação de envios incertos.
- Rever a página por teclado e leitor de ecrã, a 320 px, a 200% de zoom e em telemóvel na horizontal. Validar as alternativas textuais e as legendas com as peças editoriais reais.
- Num ambiente de ensaio, verificar os cabeçalhos efetivos das duas rotas, incluindo a página aberta pelo atalho instalado. As rotas de recuperação estão condicionadas a produção. Os testes usam armazenamento e fornecedores simulados para verificar o seu comportamento. Para verificar integrações reais e a partilha nativa, usar destinos de ensaio e um aparelho físico.
- Executar os testes do repositório com Node.js 22 antes de integrar as alterações.

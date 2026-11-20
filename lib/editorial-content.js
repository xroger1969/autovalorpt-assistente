// Original AutoValorPT editorial copy. No live stock, customer claims or paid services.
// Keep topic identifiers stable when revising copy; bump the visual version for cache safety.
export const EDITORIAL_VERSION = 'v1';
export const EDITORIAL_START_DATE = '2026-11-21';
const DAY = 86_400_000;
const fail = (code) => Object.assign(new Error(code), { code });

const question = (id, label, title, intro, options, cta) => ({ id, label, title, intro, options, cta, kind: 'question' });
const guide = (id, label, title, intro, points, cta) => ({ id, label, title, intro, points, cta, kind: 'guide' });
const point = (title, body) => ({ title, body });

const TOPICS = [
  question('rotina-primeiro', 'O CARRO E A TUA VIDA', 'O teu próximo carro começa à tua porta.', 'Pensa na viagem que fazes mais vezes. O que tem mesmo de funcionar bem?', ['Cidade', 'Família', 'Viagens'], 'Qual destas rotinas se parece mais com a tua?'),
  guide('bagageira-real', 'CHECKLIST DA BAGAGEIRA', 'Cabe a tua vida toda?', 'Antes da visita, escolhe três objetos que viajam contigo.', [point('O objeto maior', 'Carrinho de bebé, mala ou material de trabalho: confirma as medidas do que realmente usas.'), point('A abertura', 'Observa a largura da entrada e o espaço de que precisas para colocar e retirar os objetos.'), point('A rotina completa', 'Imagina a bagagem com os lugares de que precisas ocupados. Uma fotografia pode não responder a tudo.')], 'Guarda esta lista para a próxima visita.'),
  guide('test-drive-perguntas', 'ANTES DO TEST DRIVE', 'Leva perguntas. Traz respostas.', 'Define o que queres observar antes de iniciar o percurso.', [point('Preparar', 'Com o carro parado, ajusta o banco e identifica os comandos de que vais precisar.'), point('Experimentar', 'Combina um percurso que te permita conhecer o carro em situações próximas da tua rotina.'), point('Conversar', 'No final, aponta as dúvidas e pede esclarecimentos sobre o que sentiste. Um test drive não substitui uma avaliação técnica.')], 'Guarda estas três etapas para o teu test drive.'),
  guide('banco-traseiro', 'PARA QUEM VIAJA CONTIGO', 'Já experimentaste o banco de trás?', 'A escolha também passa pelo lugar dos passageiros.', [point('Entrar e sair', 'Experimenta o acesso aos lugares que serão usados com mais frequência.'), point('Sentar com espaço', 'Coloca primeiro o banco da frente na posição habitual e observa o espaço atrás.'), point('Levar companhia', 'Se for possível, faz a visita com quem partilha contigo as viagens do dia a dia.')], 'Partilha com a pessoa que viaja contigo.'),
  question('estacionamento-rotina', 'UMA PERGUNTA PRÁTICA', 'E quando chegas a casa?', 'O lugar de estacionamento também faz parte da escolha.', ['Garagem', 'Rua', 'Lugar reservado'], 'Onde estacionas na maior parte dos dias?'),
  guide('historico-perguntas', 'CONHECER UM USADO', 'Três perguntas sobre o histórico.', 'Pede informação concreta sobre o automóvel que estás a considerar.', [point('Que registos existem?', 'Pergunta pelos registos de manutenção disponíveis para esse veículo.'), point('O que foi feito?', 'Pede informação sobre intervenções já realizadas, com datas e documentos quando existam.'), point('O que está previsto?', 'Esclarece que manutenção está prevista e quais os elementos que ainda precisam de confirmação.')], 'Guarda as perguntas para a próxima visita.'),
  guide('cadeira-crianca', 'ROTINA EM FAMÍLIA', 'A cadeira também vai à visita.', 'Quando transportas crianças, vale a pena preparar esta parte da escolha.', [point('Identifica a cadeira', 'Leva a referência da cadeira que utilizas e consulta as respetivas instruções.'), point('Confirma a compatibilidade', 'Esclarece a compatibilidade com o veículo e os pontos de fixação indicados pelos fabricantes.'), point('Experimenta o espaço', 'Com acompanhamento adequado, verifica o acesso ao lugar e o espaço disponível para os restantes passageiros.')], 'Partilha esta lista com quem está a escolher carro em família.'),
  question('fim-semana-bagagem', 'MODO FIM DE SEMANA', 'Se a tua bagageira falasse…', 'Qual seria a primeira coisa que te pedia mais espaço para levar?', ['Compras', 'Malas', 'Desporto'], 'O que nunca fica em casa nas tuas saídas?'),
  guide('eletrico-rotina', 'PENSAR NUM ELÉTRICO', 'Começa pelo sítio onde carregas.', 'Antes de escolher, desenha a tua rotina real.', [point('No dia a dia', 'Identifica onde poderias carregar e em que horários terias acesso.'), point('Nas viagens', 'Consulta os locais de carregamento dos percursos que fazes habitualmente.'), point('No carro concreto', 'Confirma a compatibilidade, o equipamento incluído e as condições de carregamento desse veículo.')], 'Guarda estas perguntas para comparar opções.'),
  question('caixa-preferencia', 'QUAL É A TUA PREFERÊNCIA?', 'Manual ou automática?', 'Pensa no trânsito, nos percursos e na experiência que gostas de ter ao volante.', ['Manual', 'Automática', 'Quero experimentar'], 'O que pesa mais na tua escolha?'),
  guide('tres-prioridades', 'ESCOLHER COM CRITÉRIO', 'Três prioridades. Um ponto de partida.', 'Uma lista curta ajuda-te a explicar o que procuras.', [point('O essencial', 'Escreve uma necessidade de que não queres abdicar: espaço, acesso, dimensões ou outra.'), point('A utilização', 'Descreve os percursos, os passageiros e a bagagem que fazem parte da tua semana.'), point('As dúvidas', 'Separa o que já sabes do que precisas de experimentar ou esclarecer na visita.')], 'Guarda este exercício para preparares a tua procura.'),
  question('manha-apressada', 'A VIDA ACONTECE', 'De manhã. Tudo a bordo?', 'Mochilas, compras, casacos e companhia: cada rotina tem a sua lista.', ['Mais espaço', 'Acesso fácil', 'Boa organização'], 'O que te faria mais falta numa manhã apressada?'),
  guide('posicao-conducao', 'EXPERIMENTA COM CALMA', 'Cinco minutos no lugar do condutor.', 'Faz esta observação com o automóvel parado.', [point('Banco e volante', 'Experimenta os ajustes disponíveis e encontra uma posição que te permita utilizar os comandos.'), point('Visibilidade', 'Observa o painel, os espelhos e a vista para o exterior a partir da tua posição.'), point('Comandos', 'Localiza as funções que usas com frequência e esclarece o que não reconheces.')], 'Guarda esta lista para a tua próxima visita.'),
  guide('comandos-parado', 'CONHECER O INTERIOR', 'Que botão é este?', 'A visita é uma boa altura para fazer perguntas simples.', [point('Climatização', 'Pede uma demonstração das funções de climatização e da sua utilização.'), point('Painel', 'Pergunta pelo significado dos símbolos e pelas informações apresentadas no painel.'), point('Funções do dia a dia', 'Com o veículo parado, experimenta os comandos que mais irás utilizar.')], 'Qual é a função que gostas de experimentar primeiro?'),
  guide('entrada-saida', 'CONFORTO NA ROTINA', 'Experimenta entrar. E voltar a sair.', 'Um gesto simples pode merecer mais atenção na visita.', [point('O teu lugar', 'Observa a altura do banco e a abertura da porta enquanto entras e sais.'), point('Os passageiros', 'Experimenta também os lugares usados por quem viaja contigo.'), point('O espaço disponível', 'Imagina o mesmo movimento no lugar onde costumas estacionar.')], 'Partilha com quem está a escolher o próximo carro.'),
  question('tipo-percurso', 'A TUA SEMANA AO VOLANTE', 'Muitos trajetos curtos ou uma viagem longa?', 'Descrever a tua utilização ajuda a tornar a procura mais concreta.', ['Trajetos curtos', 'Viagens longas', 'Um pouco de tudo'], 'Como é uma semana normal para ti?'),
  guide('telemovel-compatibilidade', 'TECNOLOGIA ÚTIL', 'O teu telemóvel entende-se com o carro?', 'Confirma as funções do veículo concreto durante a visita.', [point('O que utilizas', 'Identifica as funções de navegação, música ou chamadas que queres usar.'), point('A ligação', 'Pergunta se a ligação exige cabo, aplicação ou outro requisito específico.'), point('O teste', 'Com o carro parado, pede uma demonstração. No fim, remove os teus dados de um veículo que não é teu.')], 'Guarda esta lista para testares a compatibilidade.'),
  guide('garagem-medidas', 'ANTES DA VISITA', 'A garagem também tem uma palavra a dizer.', 'Leva medidas úteis em vez de confiar apenas numa impressão.', [point('Entrada', 'Mede a largura e a altura disponíveis, incluindo obstáculos ou zonas mais estreitas.'), point('Lugar', 'Anota o comprimento e a largura do espaço de estacionamento.'), point('Movimentos', 'Conta com o espaço necessário para abrir portas, aceder à bagageira e circular à volta.')], 'Guarda esta lista antes de medires a garagem.'),
  guide('fotos-anuncio', 'DO ECRÃ À VISITA', 'Que fotografias te faltam?', 'Usa o anúncio para preparar perguntas sobre o veículo.', [point('Exterior', 'Pede imagens atuais dos ângulos ou detalhes que ainda não consegues observar.'), point('Interior', 'Confirma se consegues ver os lugares, os comandos e a bagageira que te interessam.'), point('Presencialmente', 'Anota o que queres verificar na visita. As fotografias não substituem uma observação do automóvel.')], 'Guarda estas ideias para o próximo anúncio que consultares.'),
  question('carro-tres-palavras', 'DESAFIO RÁPIDO', 'O teu próximo carro em três palavras.', 'Uma escolha começa a ganhar forma quando consegues explicar o que procuras.', ['Espaçoso', 'Prático', 'Confortável'], 'Quais seriam as tuas três palavras?'),
  guide('comparar-dois', 'DUAS OPÇÕES NA LISTA', 'Gostas dos dois. Como comparas?', 'Usa as mesmas perguntas para cada automóvel.', [point('A mesma rotina', 'Compara o espaço, o acesso e as dimensões para as mesmas situações do teu dia a dia.'), point('A mesma informação', 'Pede os dados e os documentos relevantes de cada veículo, sem preencher lacunas com suposições.'), point('A mesma atenção', 'Regista o que experimentaste e o que ainda precisas de confirmar em cada opção.')], 'Guarda esta estrutura para a tua comparação.'),
  guide('material-desporto', 'O CARRO FORA DO TRABALHO', 'Há espaço para o teu passatempo?', 'Bicicleta, prancha ou outro material: começa pelas tuas necessidades.', [point('O que levas', 'Anota as dimensões e a quantidade do material que transportas.'), point('Como transportas', 'Confirma as soluções compatíveis com o veículo e as instruções dos fabricantes.'), point('Quem vai contigo', 'Observa o espaço restante para os passageiros e para a restante bagagem.')], 'Qual é o passatempo que também viaja contigo?'),
  guide('pequenos-objetos', 'OS PEQUENOS DETALHES', 'Onde vais guardar tudo isto?', 'Óculos, garrafa, cabo e chaves também fazem parte da rotina.', [point('À mão', 'Observa os espaços de arrumação que consegues utilizar a partir do teu lugar.'), point('Bem arrumado', 'Experimenta os objetos que levas habitualmente, com o carro parado.'), point('Sem esquecer ninguém', 'Verifica também a arrumação disponível para os restantes passageiros.')], 'Qual é o objeto que nunca falta no teu carro?'),
  question('companhia-visita', 'DECISÕES PARTILHADAS', 'Quem levavas contigo à visita?', 'Uma segunda pessoa pode lembrar-se de uma necessidade diferente da tua.', ['Quem conduz', 'Quem viaja atrás', 'A família'], 'Quem tem sempre uma boa pergunta para fazer?'),
  guide('visita-luz', 'VER COM ATENÇÃO', 'Olha para o carro com tempo.', 'Prepara uma visita em que consigas observar os detalhes que te interessam.', [point('À volta', 'Observa o exterior de vários ângulos e pergunta pelo que te suscitar dúvidas.'), point('Por dentro', 'Dedica tempo aos lugares, revestimentos, comandos e espaços de arrumação.'), point('Sem respostas inventadas', 'Se alguma informação não estiver disponível, anota-a para confirmação posterior.')], 'Guarda estas etapas para uma visita mais completa.'),
  guide('preparar-visita', 'ANTES DE SAÍRES DE CASA', 'Uma visita bem preparada.', 'Três coisas simples para levares contigo.', [point('A referência', 'Guarda o anúncio ou a identificação do veículo que queres conhecer e confirma a disponibilidade.'), point('As perguntas', 'Leva as tuas prioridades e as dúvidas que ficaram por esclarecer.'), point('Os objetos úteis', 'Se precisares, leva as medidas da garagem ou do equipamento que transportas.')], 'Guarda esta lista para o dia da visita.'),
  question('viagem-bagagem', 'VIAGEM A DOIS… OU A CINCO?', 'Quem leva mais bagagem?', 'Há sempre uma mala que parece ter vontade própria.', ['Viajo leve', 'Levo o essencial… e mais', 'Depende da viagem'], 'Em que equipa estás?'),
  guide('semana-real', 'A TUA UTILIZAÇÃO REAL', 'Desenha uma semana ao volante.', 'Um pequeno registo pode ajudar-te a explicar melhor o que procuras.', [point('Percursos', 'Anota os trajetos que fazes habitualmente e a distância aproximada de cada um.'), point('Passageiros', 'Regista quantas pessoas viajam contigo e que lugares costumam ocupar.'), point('Exceções', 'Acrescenta as viagens e os transportes ocasionais de que também precisas.')], 'Guarda este exercício para preparares a tua escolha.'),
  guide('test-drive-depois', 'DEPOIS DO TEST DRIVE', 'Antes de dizeres «gostei»…', 'Reserva um momento para organizar as tuas impressões.', [point('O que funcionou', 'Anota os aspetos que se ajustaram à tua rotina e que conseguiste experimentar.'), point('O que faltou', 'Regista as funções ou situações que ainda não tiveste oportunidade de conhecer.'), point('O que perguntar', 'Partilha as dúvidas com o vendedor. Se precisares de avaliação técnica, procura um profissional.')], 'Guarda estas perguntas para o final do test drive.'),
  question('primeiro-detalhe', 'OLHAR DE QUEM ESCOLHE', 'Qual é o primeiro detalhe que vês?', 'Cada pessoa começa a conhecer um carro de uma maneira diferente.', ['Exterior', 'Interior', 'Bagageira'], 'Por onde começa a tua visita?'),
  guide('passageiros-acesso', 'PENSAR EM TODA A GENTE', 'O lugar certo para cada passageiro.', 'Experimenta os acessos de acordo com quem vai utilizar o carro.', [point('Portas', 'Observa a abertura e o espaço necessário para entrar e sair.'), point('Lugares', 'Experimenta os bancos que serão usados com mais frequência.'), point('Necessidades próprias', 'Explica as necessidades concretas dos passageiros para poderes confirmar o que se adequa.')], 'Partilha esta lista com quem viaja contigo.'),
  guide('espelhos-visibilidade', 'OBSERVAR ANTES DE ARRANCAR', 'Já encontraste a tua posição?', 'Faz esta preparação com o automóvel parado.', [point('Ajustar', 'Experimenta os ajustes do banco, do volante e dos espelhos disponíveis no veículo.'), point('Observar', 'Verifica como vês o painel e o exterior a partir da tua posição.'), point('Perguntar', 'Pede uma demonstração das funções de apoio existentes e esclarece as suas limitações.')], 'Guarda estas três etapas para o próximo test drive.'),
  question('compras-bagageira', 'UM TESTE DO DIA A DIA', 'Compras da semana: tudo a bordo?', 'A bagageira que procuras tem de fazer sentido para o que transportas.', ['Poucos sacos', 'Um carrinho cheio', 'Compras e mais coisas'], 'Como é a tua viagem de regresso das compras?'),
  guide('carregar-bagageira', 'UM DETALHE PRÁTICO', 'Não é só caber. É conseguir colocar.', 'Observa como utilizarias a bagageira no dia a dia.', [point('A altura', 'Experimenta o movimento de colocar e retirar um objeto que costumas transportar.'), point('A abertura', 'Confirma se a forma da entrada permite passar o teu equipamento.'), point('O acesso', 'Observa o espaço necessário para abrir a bagageira onde estacionas habitualmente.')], 'Guarda esta ideia para a próxima visita.'),
  guide('carro-partilhado', 'QUANDO O CARRO É PARTILHADO', 'Duas pessoas. Duas rotinas.', 'Preparem juntos as necessidades de quem vai conduzir.', [point('O que é comum', 'Identifiquem os percursos, os passageiros e a bagagem que partilham.'), point('O que muda', 'Cada pessoa deve experimentar os ajustes e os comandos de que precisa.'), point('O acordo', 'Juntem as prioridades numa lista e confirmem os pontos em que ainda existem dúvidas.')], 'Partilha com a pessoa com quem divides o volante.'),
  guide('carregamento-perguntas', 'PERGUNTAS SOBRE CARREGAMENTO', 'Que equipamento vem com o carro?', 'Confirma os elementos do veículo concreto que estás a considerar.', [point('O material incluído', 'Pergunta pelos cabos e outros equipamentos que acompanham esse automóvel.'), point('A compatibilidade', 'Esclarece quais as ligações compatíveis com o veículo e os locais que pretendes usar.'), point('A demonstração', 'Pede uma explicação da utilização e consulta as instruções correspondentes.')], 'Guarda esta lista para a tua próxima conversa.'),
  guide('dados-visita', 'TECNOLOGIA NA VISITA', 'Ligaste o telemóvel? Fecha bem o teste.', 'Se experimentares uma ligação pessoal, trata também dos teus dados.', [point('Antes', 'Pergunta que dados a ligação poderá partilhar com o sistema do veículo.'), point('Durante', 'Utiliza apenas as funções que precisas de testar, com o automóvel parado.'), point('No fim', 'Remove o emparelhamento e os dados pessoais guardados no veículo, com ajuda se necessário.')], 'Guarda este lembrete para a próxima visita.'),
  guide('informacao-pendente', 'PERGUNTAR É PARTE DA ESCOLHA', 'O que ainda falta confirmar?', 'Uma dúvida anotada é mais fácil de retomar.', [point('Identificação', 'Confirma que a informação recebida corresponde ao automóvel que estás a ver.'), point('Documentos', 'Pergunta que documentação e registos estão disponíveis para consulta.'), point('Seguimento', 'Combina como receberás a informação que ainda estiver pendente antes de decidir.')], 'Guarda esta lista para organizares as tuas dúvidas.'),
  guide('chaves-incluidas', 'OS DETALHES DA ENTREGA', 'Já perguntaste pelas chaves?', 'Uma lista de entrega começa com perguntas concretas.', [point('Quantidade', 'Confirma quantas chaves acompanham o veículo.'), point('Funcionamento', 'Pede uma demonstração das funções das chaves e do acesso ao automóvel.'), point('Restantes elementos', 'Esclarece que manuais, acessórios e equipamentos serão entregues com esse carro.')], 'Guarda estas perguntas para a tua conversa com o vendedor.'),
  question('rota-preferida', 'A TUA ROTA', 'Cidade, estrada ou um pouco de tudo?', 'Imagina os percursos que o teu próximo carro vai conhecer contigo.', ['Cidade', 'Estrada', 'Misto'], 'Onde passas mais tempo ao volante?'),
  guide('essencial-desejavel', 'DAR ORDEM À LISTA', 'O que usarias todas as semanas?', 'Olha para o equipamento a partir da tua utilização.', [point('Frequente', 'Identifica as funções que já sabes que utilizarás no dia a dia.'), point('Ocasional', 'Separa o que te será útil em viagens ou situações menos frequentes.'), point('Por descobrir', 'Pede uma demonstração das funções que ainda não conheces antes de as valorizares na escolha.')], 'Guarda este exercício para comparares equipamentos.'),
  question('proxima-pergunta', 'A TUA DÚVIDA CONTA', 'Que pergunta ainda não fizeste?', 'Escolher um usado também é ter espaço para esclarecer o que te preocupa.', ['Histórico', 'Espaço', 'Equipamento'], 'Sobre qual destes temas gostavas de ver a próxima publicação?'),
];

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fail('editorial_date_invalid');
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw fail('editorial_date_invalid');
  return time;
}

export const EDITORIAL_TOPIC_COUNT = TOPICS.length;

// Existing, user-authorized motion clips; never include the Reel already published on 20 November.
const REELS = {
  '2026-11-22': {
    topicId: 'reel-carro-rotina', title: 'O carro cabe na tua rotina?', label: 'UM CARRO PARA A TUA VIDA',
    body: 'Passageiros, bagageira e posição de condução: pensa no que vais usar todos os dias.',
    videoPath: '/assets/editorial/rotina-web-v1.mp4',
    caption: 'O carro cabe na tua rotina?\n\nAntes da visita, pensa em quem viaja contigo e no que transportas. Experimenta o acesso aos lugares de trás, observa a bagageira e encontra a tua posição ao volante com o veículo parado.\n\nGuarda este vídeo para preparares a próxima visita.\n\nImagens ilustrativas criadas com IA.\n\nAutoValorPT · Almada\n#AutoValorPT #CarrosUsados #Almada',
  },
  '2026-11-29': {
    topicId: 'reel-test-drive', title: 'O que observas num test drive?', label: 'EXPERIMENTAR COM ATENÇÃO',
    body: 'Leva as tuas perguntas. No final do percurso, anota o que queres esclarecer.',
    videoPath: '/assets/editorial/test-drive-web-v1.mp4',
    caption: 'O que observas num test drive?\n\nPensa nas situações que fazem parte da tua rotina e combina um percurso adequado. No final, organiza as tuas impressões e esclarece as dúvidas. Um test drive não substitui uma avaliação técnica.\n\nGuarda este vídeo para a tua próxima visita.\n\nImagens ilustrativas criadas com IA.\n\nAutoValorPT · Almada\n#AutoValorPT #CarrosUsados #Almada',
  },
};

export function editorialPlan(date) {
  const time = parseDate(date);
  const start = parseDate(EDITORIAL_START_DATE);
  if (time < start) throw fail('editorial_date_before_start');
  const day = Math.floor((time - start) / DAY);
  if (REELS[date]) {
    const reel = REELS[date];
    return {
      id: `editorial-${date}-${reel.topicId}`, version: EDITORIAL_VERSION, date,
      topicId: reel.topicId, topic: reel.label, title: reel.title, format: 'REELS',
      videoPath: reel.videoPath, aiGenerated: true, caption: reel.caption,
      slides: [{ kind: 'cover', label: reel.label, title: reel.title, body: reel.body,
        cta: 'Vê o vídeo e guarda as ideias.', layout: day % 3,
        altText: `AutoValorPT. Capa do vídeo: ${reel.title} ${reel.body} Imagens ilustrativas criadas com IA.` }],
    };
  }
  const topic = TOPICS[day % TOPICS.length];
  const sequence = day % 3;
  const slides = topic.kind === 'question' ? [{
    kind: 'question', label: topic.label, title: topic.title, body: topic.intro,
    options: [...topic.options], cta: topic.cta, layout: sequence,
  }] : [{
    kind: 'cover', label: topic.label, title: topic.title, body: topic.intro,
    cta: 'Desliza para ver as três ideias.', layout: sequence,
  }, ...topic.points.map((entry, index) => ({
    kind: 'detail', label: topic.label, title: entry.title, body: entry.body,
    number: index + 1, cta: index === topic.points.length - 1 ? topic.cta : '', layout: sequence,
  }))];
  for (const [index, slide] of slides.entries()) {
    slide.altText = `AutoValorPT. ${slide.label}. ${slide.title} ${slide.body}${slide.options ? ` Opções: ${slide.options.join(', ')}.` : ''}${slide.cta ? ` ${slide.cta}` : ''} Imagem ${index + 1} de ${slides.length}.`;
  }
  const caption = [
    topic.title,
    topic.intro,
    topic.kind === 'guide' ? topic.points.map((entry, i) => `${i + 1}. ${entry.title}: ${entry.body}`).join('\n\n') : `Podes começar por pensar em: ${topic.options.join(', ').toLowerCase()}.`,
    topic.cta,
    'AutoValorPT · Almada\n#AutoValorPT #CarrosUsados #Almada',
  ].join('\n\n');
  return {
    id: `editorial-${date}-${topic.id}`, version: EDITORIAL_VERSION, date,
    topicId: topic.id, topic: topic.label, title: topic.title,
    format: slides.length === 1 ? 'IMAGE' : 'CAROUSEL', caption, slides,
  };
}

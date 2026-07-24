import '../validation-core.js';
import chatHandler from './chat.js';

function invokeChat(body) {
  return new Promise((resolve) => {
    let statusCode = 200;
    const req = { method: 'POST', body };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { resolve({ statusCode, data }); return this; }
    };
    Promise.resolve(chatHandler(req, res)).catch((error) => resolve({ statusCode: 500, data: { error: error.message } }));
  });
}

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex');
  const V = globalThis.AutoValorValidation;
  const base = {
    contexto: { viatura: 'Viatura de teste' },
    lead: { nome: '', telefone: '', viatura: 'Viatura de teste', financiamento: '', retoma: '', visita: '', observacoes: '' },
    history: []
  };

  const direct = V.validateVisit('Dia 23 às 17');
  const ambiguous = V.validateVisit('amanhã 17');
  const sunday = V.validateVisit('domingo às 10');
  const exactChat = await invokeChat({ ...base, intent: 'visita', message: 'Dia 23 às 17' });
  const incompleteChat = await invokeChat({ ...base, intent: 'visita', message: 'dia 23' });
  const naturalChat = await invokeChat({ ...base, intent: 'visita', message: 'amanhã 17' });
  const clientFinalValue = direct.ok ? direct.normalized : exactChat.data?.lead?.visita;

  const checks = [
    ['local aceita Dia 23 às 17', direct.ok === true && direct.normalized === 'Dia 23 às 17h'],
    ['ambígua segue para IA', ambiguous.ok === false && ambiguous.hardReject === false && ambiguous.plausible === true],
    ['domingo é bloqueio objetivo', sunday.hardReject === true],
    ['API aceita Dia 23 às 17', Boolean(exactChat.data?.lead?.visita)],
    ['fluxo final preserva Dia 23 às 17h', clientFinalValue === 'Dia 23 às 17h'],
    ['API não aceita apenas dia', !incompleteChat.data?.lead?.visita],
    ['IA interpreta amanhã 17', Boolean(naturalChat.data?.lead?.visita) && /17h/i.test(naturalChat.data.lead.visita)]
  ];

  const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
  return res.status(failures.length ? 500 : 200).json({
    ok: failures.length === 0,
    checks: Object.fromEntries(checks),
    failures,
    samples: {
      localExact: direct,
      exact: exactChat.data,
      incomplete: incompleteChat.data,
      natural: naturalChat.data
    }
  });
}
globalThis.AutoValorValidation = (() => {
  const CONTACT_BLOCKED_WORDS = new Set([
    'fiat', 'uno', 'renault', 'clio', 'megane', 'tesla', 'dacia', 'spring', 'mg', 'mg4',
    'skoda', 'enyaq', 'audi', 'bmw', 'mercedes', 'volkswagen', 'vw', 'volvo', 'peugeot',
    'citroen', 'citroën', 'nissan', 'toyota', 'ford', 'opel', 'seat', 'kia', 'hyundai',
    'carro', 'viatura', 'retoma', 'modelo', 'marca', 'ano', 'km', 'kms', 'quilometros',
    'quilómetros', 'contacto', 'telefone', 'telemovel', 'telemóvel', 'whatsapp', 'nome',
    'sou', 'chamo', 'me', 'o', 'meu', 'a', 'minha', 'e', 'é'
  ]);

  const TRADE_IN_BLOCKED_WORDS = new Set([
    'carro', 'viatura', 'retoma', 'marca', 'modelo', 'ano', 'km', 'kms',
    'quilometro', 'quilometros', 'mil'
  ]);

  function normalizeText(value = '') {
    return String(value)
      .toLocaleLowerCase('pt-PT')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function formatName(value = '') {
    const particles = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
    return String(value).split(/\s+/).filter(Boolean).map((word, index) => {
      const lower = word.toLocaleLowerCase('pt-PT');
      if (index > 0 && particles.has(lower)) return lower;
      return lower.charAt(0).toLocaleUpperCase('pt-PT') + lower.slice(1);
    }).join(' ');
  }

  function validContactName(value = '') {
    const candidate = String(value)
      .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!candidate || candidate.length > 80 || !/^[A-Za-zÀ-ÿ'’\- ]+$/u.test(candidate)) return '';
    const words = candidate.split(' ').filter(Boolean);
    if (!words.length || words.length > 6) return '';
    const relevant = words.filter((word) => !['da', 'das', 'de', 'do', 'dos', 'e'].includes(normalizeText(word)));
    if (!relevant.length || relevant.some((word) => CONTACT_BLOCKED_WORDS.has(normalizeText(word)))) return '';
    return formatName(candidate);
  }

  function contactNumberCandidate(compact = '') {
    const sequences = String(compact).match(/(?:(?:\+|00)?351[\s.-]*)?\d[\d\s.-]{6,16}/g) || [];
    if (!sequences.length) return '';
    let digits = sequences[sequences.length - 1].replace(/\D/g, '');
    if (digits.startsWith('00351')) digits = digits.slice(5);
    else if (digits.startsWith('351') && digits.length > 9) digits = digits.slice(3);
    return digits;
  }

  function extractFlexibleContact(text = '') {
    const compact = String(text).replace(/\s+/g, ' ').trim();
    const phoneMatch = compact.match(/(?:(?:\+|00)?351[\s.-]*)?(9\d{2}[\s.-]?\d{3}[\s.-]?\d{3})/);
    const telefone = phoneMatch ? phoneMatch[1].replace(/\D/g, '') : '';
    let nome = '';

    if (phoneMatch) {
      let before = compact.slice(0, phoneMatch.index)
        .replace(/^(?:o\s+)?meu\s+nome\s+(?:é|e)\s*/i, ' ')
        .replace(/^(?:nome|sou|chamo-me)\s*[:=-]?\s*/i, ' ')
        .replace(/\b(?:e\s+)?(?:o\s+)?(?:contacto|telefone|telemóvel|telemovel|whatsapp)\s*(?:é|e|:|=|-)?\s*$/gi, ' ')
        .replace(/[,;|/\\]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const lastNumber = [...before.matchAll(/\d+/g)].at(-1);
      if (lastNumber) before = before.slice((lastNumber.index || 0) + lastNumber[0].length).trim();

      const words = before.match(/[A-Za-zÀ-ÿ'’\-]+/gu) || [];
      for (let size = Math.min(6, words.length); size >= 1; size -= 1) {
        const candidate = validContactName(words.slice(-size).join(' '));
        if (candidate) {
          nome = candidate;
          break;
        }
      }
    }

    return { nome, telefone, candidateDigits: contactNumberCandidate(compact) };
  }

  function validateFinancing(text = '') {
    const clean = normalizeText(text);
    const euroValues = [...String(text).matchAll(/\b\d[\d .]*\s*€/g)].map((match) => match[0]);
    const hasTerm = /\b\d{1,3}\s*(mes|meses|ano|anos)\b/.test(clean) || /\bprazo\b/.test(clean);
    const hasMonthly = /\b(mensalidade|prestacao|renda|por\s+mes|mensais?)\b/.test(clean) || euroValues.length >= 2;
    const hasEntry = /\bentrada\b/.test(clean)
      || /\bsem entrada\b/.test(clean)
      || euroValues.length >= 2
      || (euroValues.length >= 1 && hasTerm);
    return {
      ok: Boolean(hasEntry && (hasTerm || hasMonthly)),
      retry: 'Falta completar o financiamento. Indique a entrada e o prazo ou mensalidade, por exemplo: 3 000 € de entrada e 84 meses.'
    };
  }

  function validateTradeIn(text = '') {
    const clean = String(text).trim();
    const yearMatches = [...clean.matchAll(/\b(19|20)\d{2}\b/g)];
    const year = yearMatches.at(-1)?.[0] || '';
    let withoutYear = clean;
    if (year) {
      const index = clean.lastIndexOf(year);
      withoutYear = `${clean.slice(0, index)} ${clean.slice(index + year.length)}`;
    }

    const normalized = normalizeText(withoutYear);
    const labelledMileage = /\b\d{1,6}(?:[ .]\d{3})*\s*(?:mil\s*)?(?:km|kms|quilometros?)\b/.test(normalized);
    const numericValues = [...withoutYear.matchAll(/\b\d[\d .]{2,}\b/g)]
      .map((match) => Number(match[0].replace(/\D/g, '')))
      .filter(Number.isFinite);
    const unlabelledMileage = numericValues.some((value) => value >= 5000);

    const tokens = withoutYear.match(/\b[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9'’\-]*\b/gu) || [];
    const meaningfulTokens = tokens.filter((token) => !TRADE_IN_BLOCKED_WORDS.has(normalizeText(token)));
    const numericModelTokens = [...withoutYear.matchAll(/\b\d{3,4}\b/g)]
      .map((match) => match[0])
      .filter((value) => Number(value) < 5000);

    return {
      ok: Boolean(year && (labelledMileage || unlabelledMileage) && meaningfulTokens.length + numericModelTokens.length >= 2),
      retry: 'Faltam dados da retoma. Indique marca, modelo, ano e quilómetros, por exemplo: Renault Clio, 2019, 85 000 km.'
    };
  }

  function validateVisit(text = '') {
    const clean = normalizeText(text);
    if (/\bdomingo\b/.test(clean)) {
      return {
        ok: false,
        retry: 'Não estamos abertos ao domingo. Indique outro dia e horário.'
      };
    }

    const hasDay = /\b(hoje|amanha|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)\b/.test(clean)
      || /\bdia\s+([1-9]|[12]\d|3[01])\b/.test(clean)
      || /\b([1-9]|[12]\d|3[01])\s+(?:as|às)\b/.test(String(text).toLocaleLowerCase('pt-PT'))
      || /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(clean);
    const hasTime = /\b\d{1,2}(?:[:h]\d{0,2})\b/.test(clean)
      || /\b(meio[- ]dia|meia[- ]noite)\b/.test(clean);

    return {
      ok: Boolean(hasDay && hasTime),
      retry: 'Falta indicar o dia e o horário. Pode escrever, por exemplo: dia 28 às 17h.'
    };
  }

  function validateIntent(intent, text) {
    if (intent === 'retoma') return validateTradeIn(text);
    if (intent === 'financiamento') return validateFinancing(text);
    if (intent === 'visita') return validateVisit(text);
    return { ok: true, retry: '' };
  }

  return {
    normalizeText,
    extractFlexibleContact,
    validateFinancing,
    validateTradeIn,
    validateVisit,
    validateIntent
  };
})();
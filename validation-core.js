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
    const ok = Boolean(hasEntry && (hasTerm || hasMonthly));
    return {
      ok,
      plausible: ok || /€|euro|entrada|mes|prazo|mensal|prestacao|renda|financ/.test(clean),
      hardReject: false,
      normalized: String(text).replace(/\s+/g, ' ').trim(),
      retry: 'Falta completar o financiamento. Indique a entrada e o prazo ou mensalidade, por exemplo: 3 000 € de entrada e 84 meses.'
    };
  }

  function validateTradeIn(text = '') {
    const clean = String(text).trim();
    const fourDigitYears = [...clean.matchAll(/\b\d{4}\b/g)].map((match) => match[0]);
    const invalidYear = fourDigitYears.find((value) => Number(value) < 1900 || Number(value) > 2099);
    if (invalidYear) {
      return {
        ok: false,
        plausible: true,
        hardReject: true,
        normalized: clean,
        retry: `O ano ${invalidYear} parece incorreto. Indique um ano válido, por exemplo: 2019.`
      };
    }

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

    const ok = Boolean(year && (labelledMileage || unlabelledMileage) && meaningfulTokens.length + numericModelTokens.length >= 2);
    return {
      ok,
      plausible: ok || Boolean(year || labelledMileage || unlabelledMileage || meaningfulTokens.length),
      hardReject: false,
      normalized: clean.replace(/\s+/g, ' '),
      retry: 'Faltam dados da retoma. Indique marca, modelo, ano e quilómetros, por exemplo: Renault Clio, 2019, 85 000 km.'
    };
  }

  function normalizeVisit(text = '') {
    let output = String(text).replace(/\s+/g, ' ').trim();
    output = output.replace(/(^|\s)(as|às|pelas?)\s+([01]?\d|2[0-3])(?!\d)(?!\s*[:h])/giu, (match, spacing, prefix, hour) => {
      const connector = normalizeText(prefix) === 'as' ? 'às' : prefix.toLocaleLowerCase('pt-PT');
      return `${spacing}${connector} ${Number(hour)}h`;
    });
    output = output.replace(/^dia\b/i, 'Dia');
    return output;
  }

  function validateVisit(text = '') {
    const original = String(text).replace(/\s+/g, ' ').trim();
    const clean = normalizeText(original);
    if (/\bdomingo\b/.test(clean)) {
      return {
        ok: false,
        plausible: true,
        hardReject: true,
        normalized: original,
        retry: 'Não estamos abertos ao domingo. Indique outro dia e horário.'
      };
    }

    const invalidClock = clean.match(/\b(?:as|pelas?|por volta (?:das|de))\s+(\d{1,2})(?::(\d{1,2}))?\b/);
    if (invalidClock && (Number(invalidClock[1]) > 23 || (invalidClock[2] && Number(invalidClock[2]) > 59))) {
      return {
        ok: false,
        plausible: true,
        hardReject: true,
        normalized: original,
        retry: 'O horário indicado não parece válido. Escreva, por exemplo: dia 28 às 17h.'
      };
    }

    const hasDay = /\b(hoje|amanha|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)\b/.test(clean)
      || /\bdia\s+([1-9]|[12]\d|3[01])\b/.test(clean)
      || /\b([1-9]|[12]\d|3[01])\s+(?:as|pelas?)\b/.test(clean)
      || /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(clean);

    const explicitTime = /\b([01]?\d|2[0-3])(?::[0-5]\d|h(?:[0-5]\d)?)\b/.test(clean);
    const bareTime = /\b(?:as|pelas?|por volta (?:das|de))\s+([01]?\d|2[0-3])\b/.test(clean);
    const writtenTime = /\b(meio[- ]dia|meia[- ]noite)\b/.test(clean);
    const hasTime = explicitTime || bareTime || writtenTime;
    const ok = Boolean(hasDay && hasTime);

    let retry = 'Falta indicar o dia e o horário. Pode escrever, por exemplo: dia 28 às 17h.';
    if (hasDay && !hasTime) retry = 'Percebi o dia, mas falta indicar a hora. Pode escrever, por exemplo: às 17h.';
    if (!hasDay && hasTime) retry = 'Percebi o horário, mas falta indicar o dia pretendido.';

    return {
      ok,
      plausible: ok || hasDay || hasTime || /visita|marcar|agendar/.test(clean),
      hardReject: false,
      normalized: ok ? normalizeVisit(original) : original,
      retry
    };
  }

  function validateIntent(intent, text) {
    if (intent === 'retoma') return validateTradeIn(text);
    if (intent === 'financiamento') return validateFinancing(text);
    if (intent === 'visita') return validateVisit(text);
    return { ok: true, plausible: true, hardReject: false, normalized: String(text), retry: '' };
  }

  return {
    normalizeText,
    normalizeVisit,
    extractFlexibleContact,
    validateFinancing,
    validateTradeIn,
    validateVisit,
    validateIntent
  };
})();
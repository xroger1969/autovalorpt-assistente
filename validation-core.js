globalThis.AutoValorValidation = (() => {
  const CONTACT_BLOCKED_WORDS = new Set([
    'fiat', 'uno', 'renault', 'clio', 'megane', 'tesla', 'dacia', 'spring', 'mg', 'mg4',
    'skoda', 'enyaq', 'audi', 'bmw', 'mercedes', 'volkswagen', 'vw', 'volvo', 'peugeot',
    'citroen', 'citroën', 'nissan', 'toyota', 'ford', 'opel', 'seat', 'kia', 'hyundai',
    'carro', 'viatura', 'retoma', 'modelo', 'marca', 'ano', 'km', 'kms', 'quilometros',
    'quilómetros', 'contacto', 'telefone', 'telemovel', 'telemóvel', 'whatsapp', 'nome',
    'numero', 'número', 'sou', 'chamo', 'chamo-me', 'me', 'o', 'meu', 'a', 'minha', 'e', 'é'
  ]);

  const TRADE_IN_BLOCKED_WORDS = new Set([
    'carro', 'viatura', 'retoma', 'marca', 'modelo', 'ano', 'km', 'kms',
    'quilometro', 'quilometros', 'mil'
  ]);

  const MONTHS = new Map([
    ['janeiro', 0], ['jan', 0], ['fevereiro', 1], ['fev', 1], ['marco', 2], ['março', 2], ['mar', 2],
    ['abril', 3], ['abr', 3], ['maio', 4], ['mai', 4], ['junho', 5], ['jun', 5],
    ['julho', 6], ['jul', 6], ['agosto', 7], ['ago', 7], ['setembro', 8], ['set', 8],
    ['outubro', 9], ['out', 9], ['novembro', 10], ['nov', 10], ['dezembro', 11], ['dez', 11]
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

  function cleanNameSegment(value = '') {
    return String(value)
      .replace(/[,;|/\\]+/g, ' ')
      .trim()
      .replace(/\b(?:o\s+)?meu\s+(?:numero|número|contacto|telefone|telemóvel|telemovel|whatsapp)\s+(?:é|e)\s*$/giu, ' ')
      .replace(/^(?:e\s+)?(?:o\s+)?(?:meu\s+)?(?:nome\s+(?:é|e)|nome|sou|chamo-me|chamo me)\s*[:=-]?\s*/iu, ' ')
      .replace(/\b(?:e\s+)?(?:o\s+)?(?:contacto|telefone|telemóvel|telemovel|whatsapp|numero|número)\s*(?:é|e|:|=|-)?\s*$/giu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function nameFromSegment(value = '', preferStart = false) {
    let segment = cleanNameSegment(value);
    if (!segment) return '';

    const numbers = [...segment.matchAll(/\d+/g)];
    if (numbers.length && !preferStart) {
      const lastNumber = numbers.at(-1);
      segment = segment.slice((lastNumber.index || 0) + lastNumber[0].length).trim();
    } else if (numbers.length && preferStart) {
      segment = segment.slice(0, numbers[0].index || 0).trim();
    }

    const words = segment.match(/[A-Za-zÀ-ÿ'’\-]+/gu) || [];
    if (!words.length) return '';

    if (preferStart) {
      for (let size = Math.min(6, words.length); size >= 1; size -= 1) {
        const candidate = validContactName(words.slice(0, size).join(' '));
        if (candidate) return candidate;
      }
      return '';
    }

    for (let size = Math.min(6, words.length); size >= 1; size -= 1) {
      const candidate = validContactName(words.slice(-size).join(' '));
      if (candidate) return candidate;
    }
    return '';
  }

  function extractFlexibleContact(text = '') {
    const compact = String(text).replace(/\s+/g, ' ').trim();
    const phoneMatch = compact.match(/(?:(?:\+|00)?351[\s.-]*)?(9\d{2}[\s.-]?\d{3}[\s.-]?\d{3})/);
    const telefone = phoneMatch ? phoneMatch[1].replace(/\D/g, '') : '';
    let nome = '';

    if (phoneMatch && phoneMatch.index != null) {
      const before = compact.slice(0, phoneMatch.index);
      const after = compact.slice(phoneMatch.index + phoneMatch[0].length);
      const explicitAfter = /\b(?:nome|sou|chamo-me|chamo me)\b/i.test(after);
      nome = explicitAfter ? nameFromSegment(after, true) : '';
      if (!nome) nome = nameFromSegment(before, false);
      if (!nome) nome = nameFromSegment(after, true);
    }

    return { nome, telefone, candidateDigits: contactNumberCandidate(compact) };
  }

  function negativeUnknown(clean = '', subjectPattern = '') {
    const subject = `(?:${subjectPattern})`;
    const unknown = '(?:(?:ainda\\s+)?nao\\s+(?:sei|decidi|escolhi|defini)|(?:ainda\\s+)?por\\s+(?:decidir|definir))';
    const separator = '[\\s,;:=-]{0,12}';
    const article = '(?:(?:qual|quanto|o|a|os|as|do|da)\\s+)?';
    const unknownFirst = new RegExp(`${unknown}${separator}${article}${subject}`, 'i');
    const subjectFirst = new RegExp(`${subject}${separator}${unknown}(?=\\s*(?:$|[,.!?]))`, 'i');
    return unknownFirst.test(clean) || subjectFirst.test(clean);
  }

  function validateFinancing(text = '') {
    const original = String(text).replace(/\s+/g, ' ').trim();
    const clean = normalizeText(original);
    const euroValues = [...original.matchAll(/\b\d[\d .]*\s*€/g)].map((match) => match[0]);
    const numericTerm = /\b\d{1,3}\s*(?:mes|meses|ano|anos)\b/.test(clean) || /\bprazo\s*(?:de\s*)?\d{1,3}\b/.test(clean);
    const monthlyLabelWithValue = /\b(?:mensalidade|prestacao|renda)\b.{0,20}\b\d[\d .]*\s*€?/.test(clean)
      || /\b\d[\d .]*\s*€.{0,20}\b(?:por\s+mes|mensais?)\b/.test(clean);
    const hasMonthly = monthlyLabelWithValue || euroValues.length >= 2;
    const explicitEntry = /\bsem\s+entrada\b/.test(clean)
      || /\bentrada\b.{0,20}\b\d[\d .]*\s*€?/.test(clean)
      || /\b\d[\d .]*\s*€.{0,20}\bentrada\b/.test(clean);
    const hasEntry = explicitEntry || euroValues.length >= 2 || (euroValues.length >= 1 && numericTerm);

    const unknownTerm = negativeUnknown(clean, 'prazo|meses?|tempo');
    const unknownMonthly = negativeUnknown(clean, 'mensalidade|prestacao|renda|valor\\s+mensal');
    const unknownEntry = negativeUnknown(clean, 'entrada');

    const termUsable = numericTerm && !unknownTerm;
    const monthlyUsable = hasMonthly && !unknownMonthly;
    const entryUsable = hasEntry && !unknownEntry;
    const ok = Boolean(entryUsable && (termUsable || monthlyUsable));

    let retry = 'Falta completar o financiamento. Indique a entrada e o prazo ou mensalidade, por exemplo: 3 000 € de entrada e 84 meses.';
    if (unknownEntry) retry = 'Percebi que ainda não sabe a entrada. Indique a entrada pretendida, mesmo que seja sem entrada, e o prazo ou mensalidade aproximada.';
    else if (unknownTerm && !monthlyUsable) retry = 'Percebi a entrada, mas o prazo ainda está por decidir. Indique o prazo pretendido ou uma mensalidade aproximada.';
    else if (unknownMonthly && !termUsable) retry = 'Percebi a entrada, mas a mensalidade ainda está por decidir. Indique uma mensalidade aproximada ou o prazo pretendido.';
    else if (entryUsable && !termUsable && !monthlyUsable) retry = 'Percebi a entrada. Falta indicar o prazo pretendido ou a mensalidade aproximada.';
    else if (!entryUsable && (termUsable || monthlyUsable)) retry = 'Percebi o prazo ou a mensalidade. Falta indicar a entrada pretendida, mesmo que seja sem entrada.';

    return {
      ok,
      plausible: ok || /€|euro|entrada|mes|prazo|mensal|prestacao|renda|financ/.test(clean),
      hardReject: Boolean(unknownEntry || unknownTerm || unknownMonthly),
      normalized: original,
      retry
    };
  }

  function mileageNumber(raw = '', hasMil = false) {
    const digits = Number(String(raw).replace(/\D/g, ''));
    if (!Number.isFinite(digits)) return 0;
    return hasMil ? digits * 1000 : digits;
  }

  function uniqueNumbers(values = []) {
    return [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))];
  }

  function validateTradeIn(text = '') {
    const clean = String(text).trim().replace(/\s+/g, ' ');
    const currentYear = new Date().getFullYear();
    const explicitYearMatch = clean.match(/\b(?:ano|de|matriculad[oa]\s+em)\s*[:=-]?\s*(\d{4})\b/i);
    if (explicitYearMatch) {
      const explicitYear = Number(explicitYearMatch[1]);
      if (explicitYear < 1900 || explicitYear > currentYear + 1) {
        return {
          ok: false,
          plausible: true,
          hardReject: true,
          normalized: clean,
          retry: `O ano ${explicitYear} parece incorreto. Indique um ano válido, por exemplo: 2019.`
        };
      }
    }

    const yearLikeModelIndexes = new Set(
      [...clean.matchAll(/\bpeugeot\s+(1007|2008|3008|4007|4008|5008)\b/gi)]
        .map((match) => (match.index || 0) + match[0].toLocaleLowerCase('pt-PT').lastIndexOf(match[1].toLocaleLowerCase('pt-PT')))
    );
    const yearMatches = [...clean.matchAll(/\b(19|20)\d{2}\b/g)]
      .filter((match) => Number(match[0]) <= currentYear + 1 && !yearLikeModelIndexes.has(match.index || 0));
    const yearMatch = yearMatches.at(-1);
    const year = yearMatch?.[0] || '';
    const yearIndex = yearMatch?.index ?? -1;
    let withoutYear = clean;
    if (year) {
      const index = clean.lastIndexOf(year);
      withoutYear = `${clean.slice(0, index)} ${clean.slice(index + year.length)}`;
    }

    const labelledMileageMatches = [...clean.matchAll(/\b(\d{1,3}(?:[ .]\d{3})*|\d{1,7})\s*(mil\s*)?(?:km|kms|quil[oó]metros?)\b/giu)]
      .filter((match) => !(year && match.index === yearIndex && Number(match[1].replace(/\D/g, '')) === Number(year)));
    const labelledMileageValues = labelledMileageMatches.map((match) => mileageNumber(match[1], Boolean(match[2])));

    let afterYear = yearIndex >= 0 ? clean.slice(yearIndex + year.length) : clean;
    for (const match of labelledMileageMatches) afterYear = afterYear.replace(match[0], ' ');
    const unlabelledMileageValues = [...afterYear.matchAll(/\b\d[\d .]{3,}\b/g)]
      .map((match) => Number(match[0].replace(/\D/g, '')))
      .filter((value) => Number.isFinite(value) && value >= 5000);

    const mileageValues = uniqueNumbers([...labelledMileageValues, ...unlabelledMileageValues]);
    const implausible = mileageValues.filter((value) => value > 500000);
    if (implausible.length) {
      const mileage = Math.max(...implausible);
      return {
        ok: false,
        plausible: true,
        hardReject: true,
        normalized: clean,
        retry: `Percebi ${mileage.toLocaleString('pt-PT')} km. É uma quilometragem muito elevada. Confirma esse valor ou indique a quilometragem correta.`
      };
    }

    if (mileageValues.length > 1) {
      const sorted = [...mileageValues].sort((a, b) => a - b);
      if (sorted.at(-1) - sorted[0] > 1000) {
        return {
          ok: false,
          plausible: true,
          hardReject: true,
          normalized: clean,
          retry: `Encontrei mais do que uma quilometragem (${sorted.map((value) => `${value.toLocaleString('pt-PT')} km`).join(' e ')}). Qual é o valor correto?`
        };
      }
    }

    const tokens = withoutYear.match(/\b[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9'’\-]*\b/gu) || [];
    const meaningfulTokens = tokens.filter((token) => !TRADE_IN_BLOCKED_WORDS.has(normalizeText(token)));
    const numericModelTokens = [...withoutYear.matchAll(/\b\d{3,4}\b/g)]
      .map((match) => match[0])
      .filter((value) => Number(value) < 10000 && !mileageValues.includes(Number(value)));

    const hasMileage = mileageValues.length > 0;
    const ok = Boolean(year && hasMileage && meaningfulTokens.length + numericModelTokens.length >= 2);
    let retry = 'Faltam dados da retoma. Indique marca, modelo, ano e quilómetros, por exemplo: Renault Clio, 2019, 85 000 km.';
    if (year && !hasMileage) retry = 'Percebi a viatura e o ano. Falta apenas indicar os quilómetros.';
    if (!year && hasMileage) retry = 'Percebi a quilometragem. Falta indicar a marca, o modelo e o ano.';

    return {
      ok,
      plausible: ok || Boolean(year || hasMileage || meaningfulTokens.length || numericModelTokens.length),
      hardReject: false,
      normalized: clean,
      retry
    };
  }

  function explicitDateFromText(original = '') {
    const normalized = normalizeText(original);
    const now = new Date();
    let day = 0;
    let month = -1;
    let year = 0;

    const numeric = normalized.match(/\b([0-3]?\d)[\/-]([01]?\d)(?:[\/-](\d{2,4}))?\b/);
    if (numeric) {
      day = Number(numeric[1]);
      month = Number(numeric[2]) - 1;
      year = numeric[3] ? Number(numeric[3]) : now.getFullYear();
      if (year < 100) year += 2000;
    } else {
      const textual = normalized.match(/\b(?:dia\s+)?([0-3]?\d)\s+(?:de\s+)?([a-zç]+)(?:\s+(?:de\s+)?(\d{4}))?\b/);
      if (!textual) return null;
      const monthValue = MONTHS.get(textual[2]);
      if (monthValue == null) return null;
      day = Number(textual[1]);
      month = monthValue;
      year = textual[3] ? Number(textual[3]) : now.getFullYear();
    }

    let intendedYear = year;
    let date = new Date(intendedYear, month, day);
    if (!numeric?.[3] && !normalized.match(/\b\d{4}\b/)) {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (date < new Date(today.getTime() - 24 * 60 * 60 * 1000)) {
        intendedYear += 1;
        date = new Date(intendedYear, month, day);
      }
    }

    const valid = date.getFullYear() === intendedYear
      && date.getMonth() === month
      && date.getDate() === day;
    if (!valid) return { invalid: true, date: null };
    return { invalid: false, date };
  }

  function normalizeVisit(text = '') {
    let output = String(text).replace(/\s+/g, ' ').trim();
    output = output.replace(/(^|\s)(as|às|pelas?)\s+([01]?\d|2[0-3])(?!\d)(?!\s*[:h])/giu, (match, spacing, prefix, hour) => {
      const connector = normalizeText(prefix) === 'as' ? 'às' : prefix.toLocaleLowerCase('pt-PT');
      return `${spacing}${connector} ${Number(hour)}h`;
    });
    output = output.replace(/\b(hoje|amanhã|amanha|segunda(?:-feira)?|terça(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sábado|sabado)\s+([01]?\d|2[0-3])\b(?!\s*[:h])/giu,
      (match, day, hour) => `${day} às ${Number(hour)}h`);
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

    const explicitDate = explicitDateFromText(original);
    if (explicitDate?.invalid) {
      return {
        ok: false,
        plausible: true,
        hardReject: true,
        normalized: original,
        retry: 'A data indicada não parece válida. Escreva, por exemplo: dia 28 às 17h.'
      };
    }
    if (explicitDate?.date?.getDay() === 0) {
      return {
        ok: false,
        plausible: true,
        hardReject: true,
        normalized: original,
        retry: 'Essa data calha a um domingo e não estamos abertos ao domingo. Indique outro dia e horário.'
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
      || /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(clean)
      || Boolean(explicitDate?.date);

    const explicitTime = /\b([01]?\d|2[0-3])(?::[0-5]\d|h(?:[0-5]\d)?)\b/.test(clean);
    const bareTime = /\b(?:as|pelas?|por volta (?:das|de))\s+([01]?\d|2[0-3])\b/.test(clean);
    const writtenTime = /\b(meio[- ]dia|meia[- ]noite)\b/.test(clean);
    const naturalBareTime = /\b(?:hoje|amanha|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)\s+([01]?\d|2[0-3])\b/.test(clean);
    const hasTime = explicitTime || bareTime || writtenTime || naturalBareTime;
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

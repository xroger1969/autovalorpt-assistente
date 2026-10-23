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

  function normalizePhone(value = '') {
    const raw = String(value).trim();
    if (!/^(?:\+351|00351|351)?[\d\s().-]+$/.test(raw)) return '';
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('00351')) digits = digits.slice(5);
    else if (digits.startsWith('351') && digits.length >= 12) digits = digits.slice(3);
    if (raw.startsWith('+') && !/^\+351(?:\D|\d)/.test(raw)) return '';
    return /^9\d{8}$/.test(digits) ? digits : '';
  }

  function contactCandidates(compact = '') {
    return [...String(compact).matchAll(/\+?\d[\d\s.()-]*/g)].map((match) => {
      const raw = match[0].trim().replace(/[.()-]+$/, '').trim();
      let candidateDigits = raw.replace(/\D/g, '');
      if (candidateDigits.startsWith('00351')) candidateDigits = candidateDigits.slice(5);
      else if (candidateDigits.startsWith('351') && candidateDigits.length > 9) candidateDigits = candidateDigits.slice(3);
      return { raw, index: match.index, candidateDigits, telefone: normalizePhone(raw) };
    });
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
    const candidates = contactCandidates(compact).filter((item) => item.candidateDigits.length >= 7);
    const candidate = candidates.at(-1);
    const telefone = candidate?.telefone || '';
    let nome = '';
    if (telefone) {
      const before = compact.slice(0, candidate.index);
      const after = compact.slice(candidate.index + candidate.raw.length);
      const explicitAfter = /\b(?:nome|sou|chamo-me|chamo me)\b/i.test(after);
      nome = explicitAfter ? nameFromSegment(after, true) : '';
      if (!nome) nome = nameFromSegment(before, false);
      if (!nome) nome = nameFromSegment(after, true);
    }
    return { nome, telefone, candidateDigits: candidate?.candidateDigits || '' };
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

  function parseTradeInDetails(text = '', previous = {}) {
    const clean = String(text).trim().replace(/\s+/g, ' ');
    const currentYear = new Date().getFullYear();
    const yearLikeModelIndexes = new Set(
      [...clean.matchAll(/\bpeugeot\s+(?:e[-\s]?)?(1007|2008|3008|4007|4008|5008)\b/gi)]
        .map((match) => match.index + match[0].lastIndexOf(match[1]))
    );
    const yearCandidates = [...clean.matchAll(/\b(?:19|20)\d{2}\b/g)]
      .filter((match) => !yearLikeModelIndexes.has(match.index) && !(previous.year && !previous.mileage && /^\d{1,6}$/.test(clean)));
    const explicitYear = clean.match(/\b(?:ano|de|matriculad[oa]\s+em)\s*[:=-]?\s*(\d{4})\b/i);
    const futureYear = yearCandidates.find((match) => Number(match[0]) > currentYear);
    if (futureYear || (explicitYear && (Number(explicitYear[1]) < 1900 || Number(explicitYear[1]) > currentYear))) {
      const year = futureYear?.[0] || explicitYear[1];
      return { ...previous, ok: false, plausible: true, hardReject: true, normalized: clean,
        retry: `O ano ${year} parece incorreto. Indique um ano até ${currentYear}.` };
    }
    const distinctYears = [...new Set(yearCandidates.map((match) => match[0]))];
    if (distinctYears.length > 1) return { ...previous, ok: false, plausible: true, hardReject: true, normalized: clean,
      retry: 'Encontrei mais do que um ano. Qual é o ano da sua viatura?' };
    const yearMatch = yearCandidates.at(-1);
    let working = clean;
    if (yearMatch) working = `${working.slice(0, yearMatch.index)} ${working.slice(yearMatch.index + yearMatch[0].length)}`;

    const labelled = [...working.matchAll(/\b(\d{1,3}(?:[ .]\d{3})+|\d{1,8})\s*(mil\s*)?(?:km|kms|quil[oó]metros?)\b/giu)];
    const thousand = labelled.length ? [] : [...working.matchAll(/\b(\d{1,3})\s*mil\b/gi)];
    const measurements = [...labelled, ...thousand];
    let values = measurements.map((match) => mileageNumber(match[1], Boolean(match[2]) || thousand.includes(match)));
    for (const match of measurements) working = working.replace(match[0], ' ');
    if (!measurements.length) {
      const modelIndexes = new Set([...working.matchAll(/\bpeugeot\s+(?:e[-\s]?)?(1007|2008|3008|4007|4008|5008)\b/gi)].map((match) => match.index + match[0].lastIndexOf(match[1])));
      const implicit = [...working.matchAll(/\b(?:\d{1,3}(?:[ .]\d{3})+|\d{4,8})\b/g)]
        .filter((match) => !modelIndexes.has(match.index) && (Number(match[0].replace(/\D/g, '')) >= 5000 || (!/[A-Za-zÀ-ÿ]/u.test(working) && previous.description)));
      values = implicit.map((match) => mileageNumber(match[0]));
      for (const match of implicit) working = working.replace(match[0], ' ');
    }
    values = [...new Set(values)];
    if (values.some((value) => value > 500000)) return { ...previous, ok: false, plausible: true, hardReject: true, normalized: clean,
      retry: `Percebi ${Math.max(...values).toLocaleString('pt-PT')} km. Verifique a quilometragem e indique o valor correto.` };
    if (values.length > 1) return { ...previous, ok: false, plausible: true, hardReject: true, normalized: clean,
      retry: `Encontrei mais do que uma quilometragem (${values.map((value) => `${value.toLocaleString('pt-PT')} km`).join(' e ')}). Qual é o valor correto?` };

    let description = working
      .replace(/^(?:tenho|é|e)\s+(?:(?:um|uma)\s+)?/i, '')
      .replace(/\b(?:marca|modelo|ano|quil[oó]metros?|kms?|viatura|carro|de|com|matriculad[oa]|em)\b\s*[:=-]?/gi, ' ')
      .replace(/[,;|/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/[A-Za-zÀ-ÿ]/u.test(description)) description = '';
    description = description.split(' ').filter(Boolean).map((word) => {
      if (/^\d+$/.test(word)) return word;
      if (/^[A-ZÀ-Ÿ]{1,3}$/u.test(word) || /^[A-Za-zÀ-ÿ]{1,2}$/u.test(word)) return word.toLocaleUpperCase('pt-PT');
      return word.charAt(0).toLocaleUpperCase('pt-PT') + word.slice(1).toLocaleLowerCase('pt-PT');
    }).join(' ');
    const parts = {
      description: description || String(previous.description || ''),
      year: yearMatch?.[0] || String(previous.year || ''),
      mileage: values.length ? String(values[0]) : String(previous.mileage || '')
    };
    const meaningful = parts.description.split(/\s+/).filter((word) => word && !TRADE_IN_BLOCKED_WORDS.has(normalizeText(word)));
    const hasDescription = meaningful.length >= 2;
    const hasMileage = parts.mileage !== '' && Number(parts.mileage) >= 0;
    const ok = Boolean(hasDescription && parts.year && hasMileage);
    let retry = 'Indique a marca, o modelo, o ano e os quilómetros da sua viatura.';
    if (hasDescription && parts.year && !hasMileage) retry = 'Percebi a viatura e o ano. Falta apenas indicar os quilómetros.';
    else if (hasDescription && !parts.year && hasMileage) retry = 'Percebi a viatura e a quilometragem. Falta apenas indicar o ano.';
    else if (!hasDescription && parts.year && hasMileage) retry = 'Percebi o ano e a quilometragem. Falta indicar a marca e o modelo.';
    const normalized = [parts.description, parts.year, hasMileage ? `${Number(parts.mileage).toLocaleString('pt-PT')} km` : ''].filter(Boolean).join(', ');
    return { ...parts, ok, plausible: Boolean(parts.description || parts.year || hasMileage), hardReject: false, normalized, retry };
  }

  function validateTradeIn(text = '') {
    return parseTradeInDetails(text);
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
    normalizePhone,
    validContactName,
    parseTradeInDetails,
    extractFlexibleContact,
    validateFinancing,
    validateTradeIn,
    validateVisit,
    validateIntent
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  const BLOCKED_CONTACT_WORDS = new Set([
    'fiat', 'uno', 'renault', 'clio', 'megane', 'tesla', 'dacia', 'spring', 'mg', 'mg4',
    'skoda', 'enyaq', 'audi', 'bmw', 'mercedes', 'volkswagen', 'vw', 'volvo', 'peugeot',
    'citroen', 'citroën', 'nissan', 'toyota', 'ford', 'opel', 'seat', 'kia', 'hyundai',
    'carro', 'viatura', 'retoma', 'modelo', 'marca', 'ano', 'km', 'kms', 'quilometros',
    'quilómetros', 'contacto', 'telefone', 'telemovel', 'telemóvel', 'whatsapp', 'nome',
    'sou', 'chamo', 'me', 'o', 'meu', 'a', 'minha', 'e', 'é'
  ]);

  function normalizeContactWord(value = '') {
    return String(value).toLocaleLowerCase('pt-PT').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function formatContactName(value = '') {
    const particles = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
    return value.split(/\s+/).filter(Boolean).map((word, index) => {
      const lower = word.toLocaleLowerCase('pt-PT');
      if (index > 0 && particles.has(lower)) return lower;
      return lower.charAt(0).toLocaleUpperCase('pt-PT') + lower.slice(1);
    }).join(' ');
  }

  function validContactName(value = '') {
    const candidate = String(value).replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!candidate || candidate.length > 60 || !/^[A-Za-zÀ-ÿ'’\- ]+$/u.test(candidate)) return '';
    const words = candidate.split(' ').filter(Boolean);
    if (!words.length || words.length > 4) return '';
    const relevant = words.filter((word) => !['da', 'das', 'de', 'do', 'dos', 'e'].includes(normalizeContactWord(word)));
    if (!relevant.length || relevant.some((word) => BLOCKED_CONTACT_WORDS.has(normalizeContactWord(word)))) return '';
    return formatContactName(candidate);
  }

  function extractFlexibleContact(text) {
    const compact = String(text || '').replace(/\s+/g, ' ').trim();
    const phoneMatch = compact.match(/(?:\+?351[\s.-]*)?(9\d{2}[\s.-]?\d{3}[\s.-]?\d{3})/);
    const telefone = phoneMatch ? phoneMatch[1].replace(/\D/g, '') : '';

    let nome = '';
    if (phoneMatch) {
      let before = compact.slice(0, phoneMatch.index)
        .replace(/\b(?:o\s+meu\s+nome\s+(?:é|e)|meu\s+nome\s+(?:é|e)|nome|contacto|telefone|telemóvel|telemovel|whatsapp|sou|chamo-me)\b\s*[:=-]?/gi, ' ')
        .replace(/[,;|/\\]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const lastNumber = [...before.matchAll(/\d+/g)].at(-1);
      if (lastNumber) before = before.slice((lastNumber.index || 0) + lastNumber[0].length).trim();

      const words = before.match(/[A-Za-zÀ-ÿ'’\-]+/gu) || [];
      for (let size = Math.min(4, words.length); size >= 1; size -= 1) {
        const candidate = validContactName(words.slice(-size).join(' '));
        if (candidate) {
          nome = candidate;
          break;
        }
      }
    }

    const numberCandidates = compact.match(/(?:\+?351[\s.-]*)?9[\d\s.-]{5,12}/g) || [];
    const candidateDigits = numberCandidates.length
      ? numberCandidates[numberCandidates.length - 1].replace(/^351/, '').replace(/\D/g, '')
      : '';

    return { nome, telefone, candidateDigits };
  }

  handleContact = function stableHandleContact(text) {
    const clean = String(text || '').trim();
    document.getElementById('messageInput').value = '';
    addBubble(clean, 'user');

    const { nome, telefone, candidateDigits } = extractFlexibleContact(clean);
    if (!telefone) {
      let message = 'Indique um número de telemóvel português válido com 9 algarismos, por exemplo: 923 445 556.';
      if (candidateDigits && candidateDigits.length !== 9) {
        message = `O número indicado tem ${candidateDigits.length} algarismos. Um telemóvel português deve ter 9, por exemplo: 923 445 556.`;
      } else if (candidateDigits.length === 9 && !candidateDigits.startsWith('9')) {
        message = 'O número de telemóvel deve começar por 9 e ter 9 algarismos.';
      }
      addBubble(message, 'bot');
      state.pendingIntent = 'contacto';
      setComposer(INTENTS.contacto.placeholder);
      return;
    }

    if (!nome) {
      addBubble('O número está correto, mas não consegui identificar o nome. Escreva, por exemplo: Carlos 923 445 556.', 'bot');
      state.pendingIntent = 'contacto';
      setComposer(INTENTS.contacto.placeholder);
      return;
    }

    state.lead.nome = nome;
    state.lead.telefone = telefone;
    state.pendingIntent = '';
    renderSummary();
    renderSelected();
    addConfirmation('contacto');
    advanceIntent();
  };
});

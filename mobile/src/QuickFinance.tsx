import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Vehicle } from './catalogue';
import { colors, Icon } from './ui';
import {
  eligibleTerm, fullSimulatorUrl, QUICK_TERMS, referenceAmount,
  type CreditLimits,
} from './quick-finance';

const CREDIT_API = 'https://credicarros.vercel.app/api';
const euro = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Result = {
  status: 'loading' | 'ready' | 'unavailable' | 'unsupported';
  payment?: number;
  differentAmount?: boolean;
  retrievedAt?: number;
  reference?: number;
  tan?: number;
  taeg?: number;
  mtic?: number;
};
type Quote = {
  amount: number; months: number; vehicleType: string; payment: number;
  tan: number; taeg: number; mtic: number; retrievedAt: string;
};

let configurationCache: { used: CreditLimits; until: number } | null = null;
let configurationPending: Promise<CreditLimits> | null = null;
const quoteCache = new Map<string, { result: Result; until: number }>();

function validLimits(value: unknown): value is CreditLimits {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return ['minAmount', 'maxAmount', 'amountStep', 'minMonths', 'maxMonths', 'monthStep']
    .every(field => typeof item[field] === 'number' && Number.isFinite(item[field]) && (item[field] as number) > 0) &&
    (item.minAmount as number) <= (item.maxAmount as number) &&
    (item.minMonths as number) <= (item.maxMonths as number);
}
async function creditLimits(): Promise<CreditLimits> {
  if (configurationCache && Date.now() < configurationCache.until) return configurationCache.used;
  if (!configurationPending) {
    configurationPending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 16000);
      try {
        const response = await fetch(`${CREDIT_API}/credit-config`, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Configuração indisponível');
        const body = await response.json() as { products?: { used?: CreditLimits } };
        const candidate = body.products?.used;
        if (!validLimits(candidate)) throw new Error('Configuração inválida');
        const used = candidate;
        configurationCache = { used, until: Date.now() + 10 * 60_000 };
        return used;
      } finally { clearTimeout(timer); }
    })().finally(() => { configurationPending = null; });
  }
  return configurationPending;
}
function validQuote(value: unknown, amount: number, months: number): value is Quote {
  if (!value || typeof value !== 'object') return false;
  const q = value as Partial<Quote>;
  const timestamp = Date.parse(q.retrievedAt ?? '');
  return q.amount === amount && q.months === months && q.vehicleType === 'used' &&
    [q.payment, q.tan, q.taeg, q.mtic].every(v => typeof v === 'number' && Number.isFinite(v)) &&
    (q.payment ?? 0) > 0 && (q.tan ?? -1) >= 0 && (q.taeg ?? -1) >= 0 &&
    (q.mtic ?? 0) >= amount && Number.isFinite(timestamp) &&
    Date.now() - timestamp >= -60_000 && Date.now() - timestamp < 5 * 60_000;
}
async function quoteFor(price: number, months: number, signal: AbortSignal): Promise<Result> {
  const limits = await creditLimits();
  if (signal.aborted) return { status: 'unavailable' };
  const reference = referenceAmount(price, limits);
  if (!reference || !eligibleTerm(months, limits)) return { status: 'unsupported' };
  const response = await fetch(`${CREDIT_API}/credit-simulation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ amount: reference.amount, months, vehicleType: 'used' }),
    signal,
  });
  if (!response.ok) return { status: response.status === 422 ? 'unsupported' : 'unavailable' };
  const data = await response.json() as { quote?: Quote };
  const quote = data.quote;
  if (!validQuote(quote, reference.amount, months)) return { status: 'unavailable' };
  const q = quote;
  const payment = q.payment;
  return {
    status: 'ready', payment, differentAmount: reference.differentAmount, retrievedAt: Date.parse(q.retrievedAt),
    reference: reference.amount, tan: q.tan, taeg: q.taeg, mtic: q.mtic,
  };
}

export function QuickFinance({ vehicle, onOpenFull }: {
  vehicle: Vehicle; onOpenFull: (url: string) => void;
}) {
  const [index, setIndex] = useState(2);
  const [response, setResponse] = useState<{ key: string; result: Result } | null>(null);
  const [retry, setRetry] = useState(0);
  const trackWidth = useRef(1);
  const gestureStart = useRef(2);
  const indexRef = useRef(2);
  const months = QUICK_TERMS[index];
  const key = `${vehicle.price}:${months}`;
  const result: Result = response?.key === key ? response.result : { status: 'loading' };
  const chooseIndex = (value: number) => {
    const next = Math.max(0, Math.min(QUICK_TERMS.length - 1, value));
    indexRef.current = next;
    setIndex(next);
  };
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => {
      const relative = event.nativeEvent.locationX / Math.max(1, trackWidth.current);
      const next = Math.round(relative * (QUICK_TERMS.length - 1));
      gestureStart.current = next;
      chooseIndex(next);
    },
    onPanResponderMove: (_, gesture) => {
      const next = gestureStart.current + Math.round(gesture.dx / Math.max(1, trackWidth.current) * (QUICK_TERMS.length - 1));
      chooseIndex(next);
    },
  })).current;

  useEffect(() => {
    const cached = quoteCache.get(key);
    if (cached && Date.now() < cached.until) {
      setResponse({ key, result: cached.result });
      return;
    }
    let live = true;
    const controller = new AbortController();
    setResponse({ key, result: { status: 'loading' } });
    // Avoid starting a request for every intermediate touch position.
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const timer = setTimeout(() => {
      void quoteFor(vehicle.price, months, controller.signal).then(next => {
        if (!live) return;
        setResponse({ key, result: next });
        if (next.status === 'ready') {
          if (quoteCache.size >= 32) quoteCache.delete(quoteCache.keys().next().value as string);
          quoteCache.set(key, { result: next, until: Math.min(Date.now() + 60_000, (next.retrievedAt ?? 0) + 5 * 60_000) });
        }
      }).catch(() => { if (live) setResponse({ key, result: { status: 'unavailable' } }); }).finally(() => clearTimeout(timeout));
    }, 350);
    return () => { live = false; clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
  }, [vehicle.price, months, key, retry]);

  // Do not continue to show an expired financial result while a detail sheet remains open.
  useEffect(() => {
    if (result.status !== 'ready' || result.retrievedAt === undefined) return;
    const expires = result.retrievedAt + 5 * 60_000;
    const timer = setTimeout(() => {
      quoteCache.delete(key);
      setResponse({ key, result: { status: 'unavailable' } });
    }, Math.max(0, expires - Date.now()));
    return () => clearTimeout(timer);
  }, [result.status, result.retrievedAt, key]);

  const selectedPosition = (index / (QUICK_TERMS.length - 1)) * 100;
  const paymentText = result.status === 'ready' && result.payment !== undefined
    ? `${euro.format(result.payment)} €`
    : result.status === 'loading' ? 'A consultar…' : '—';
  return <View style={s.card}>
    <View style={s.heading}>
      <View style={s.headingIcon}><Icon name="calculator-outline" size={19} color={colors.green} /></View>
      <View style={s.headingCopy}><Text style={s.title}>Quanto ficaria por mês?</Text>
        <Text style={s.subtitle}>Simulação rápida · sem entrada</Text></View>
    </View>
    <View style={s.amountRow}>
      <Text style={s.amountLabel}>{result.differentAmount ? 'Prestação de referência (outro montante)' : 'Prestação indicativa'}</Text>
      <View style={s.amountValue}>
        {result.status === 'loading' && <ActivityIndicator size="small" color={colors.green} />}
        <Text accessibilityLiveRegion="polite" style={s.payment}>{paymentText}</Text>
        {result.status === 'ready' && <Text style={s.perMonth}>/mês</Text>}
      </View>
    </View>
    {result.status === 'ready' && <View style={s.quoteDetails}>
      <Text style={s.quoteDetail}>Financiamento: {euro.format(result.reference ?? vehicle.price)} € · {months} meses</Text>
      <Text style={s.quoteDetail}>TAEG {percent.format(result.taeg ?? 0)}%</Text>
      {result.differentAmount && <Text style={s.disclaimer}>Referência para um montante diferente do preço de {euro.format(vehicle.price)} €. Não é uma simulação exata desta viatura sem entrada.</Text>}
      <Text style={s.disclaimer}>TAN {percent.format(result.tan ?? 0)}% · MTIC {euro.format(result.mtic ?? 0)} € · Fonte: Banco Credibom (CREDICARROS).</Text>
    </View>}
    <Text style={s.termLabel}>Escolhe o prazo: <Text style={s.termSelected}>{months} meses</Text></Text>
    <View style={s.slider}
      onLayout={event => { trackWidth.current = event.nativeEvent.layout.width; }}
      accessibilityRole="adjustable" accessibilityLabel="Prazo do financiamento"
      accessibilityValue={{ min: 60, max: 120, now: months, text: `${months} meses` }}
      accessibilityActions={[{ name: 'increment', label: 'Prazo seguinte' }, { name: 'decrement', label: 'Prazo anterior' }]}
      onAccessibilityAction={event => {
        if (event.nativeEvent.actionName === 'increment') chooseIndex(indexRef.current + 1);
        if (event.nativeEvent.actionName === 'decrement') chooseIndex(indexRef.current - 1);
      }}
      {...responder.panHandlers}>
      <View pointerEvents="none" style={s.sliderBackground} />
      <View pointerEvents="none" style={[s.sliderFilled, { width: `${selectedPosition}%` }]} />
      <View pointerEvents="none" style={[s.sliderThumb, { left: `${selectedPosition}%` }]} />
    </View>
    <View style={s.terms}>
      {QUICK_TERMS.map((value, position) => <Pressable key={value} onPress={() => chooseIndex(position)}
        accessibilityRole="button" accessibilityState={{ selected: index === position }}
        accessibilityLabel={`Simular ${value} meses`}
        style={s.termTouch}><Text style={[s.termValue, index === position && s.termActive]}>{value}</Text></Pressable>)}
    </View>
    {result.status === 'ready' && <Text style={s.disclaimer}>
      Simulação indicativa, sujeita a análise, aprovação e condições finais.
    </Text>}
    {result.status === 'unsupported' && <Text style={s.disclaimer}>
      O prazo ou o montante sem entrada não são aceites nesta consulta. Confirma outras condições no simulador completo.
    </Text>}
    {result.status === 'unavailable' && <View>
      <Text style={s.disclaimer}>Não foi possível confirmar uma prestação atual. Tenta novamente ou abre o simulador completo.</Text>
      <Pressable onPress={() => setRetry(value => value + 1)} accessibilityRole="button" style={s.retry}><Text style={s.openText}>Atualizar simulação</Text></Pressable>
    </View>}
    <Pressable style={({ pressed }) => [s.openLink, pressed && { opacity: 0.6 }]}
      accessibilityRole="link" accessibilityLabel="Abrir simulador completo CREDICARROS"
      onPress={() => onOpenFull(fullSimulatorUrl(vehicle.price, months, vehicle.year))}>
      <Text style={s.openText}>Personalizar no simulador completo</Text>
      <Icon name="arrow-forward-outline" size={17} color={colors.green} />
    </Pressable>
  </View>;
}

const s = StyleSheet.create({
  card: { padding: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white,
    borderRadius: 18, gap: 8 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headingIcon: { width: 32, height: 32, borderRadius: 11, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.greenLight },
  headingCopy: { flex: 1 },
  title: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 3 },
  amountRow: { gap: 3, paddingVertical: 2 },
  amountLabel: { color: colors.muted, fontSize: 12 },
  amountValue: { flexDirection: 'row', alignItems: 'baseline', gap: 6, minHeight: 34 },
  payment: { color: colors.green, fontSize: 25, fontWeight: '800', letterSpacing: -0.5 },
  perMonth: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  termLabel: { fontSize: 12, color: colors.muted, marginTop: 2 },
  termSelected: { fontSize: 13, fontWeight: '800', color: colors.navy },
  slider: { height: 44, justifyContent: 'center', marginHorizontal: 10 },
  sliderBackground: { height: 6, backgroundColor: colors.line, borderRadius: 6 },
  sliderFilled: { position: 'absolute', height: 6, backgroundColor: colors.green, borderRadius: 6 },
  sliderThumb: { position: 'absolute', width: 25, height: 25, borderRadius: 13,
    backgroundColor: colors.white, borderWidth: 3, borderColor: colors.green,
    transform: [{ translateX: -12.5 }], shadowColor: colors.navy, shadowOpacity: 0.15,
    shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  terms: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -7 },
  termTouch: { minWidth: 48, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  termValue: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  termActive: { color: colors.green, fontWeight: '800' },
  disclaimer: { fontSize: 12, lineHeight: 17, color: colors.muted },
  openLink: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 9,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44 },
  quoteDetails: { gap: 4 },
  quoteDetail: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  retry: { minHeight: 44, justifyContent: 'center' },
  openText: { color: colors.green, fontSize: 13, fontWeight: '700', flexShrink: 1 },
});

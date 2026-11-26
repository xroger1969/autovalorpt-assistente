import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';

export const colors = {
  navy: '#0B2030', navyLight: '#17364A', gold: '#D6B36A', paper: '#F8F7F4',
  white: '#FFFFFF', ink: '#102A3B', muted: '#596E7A', line: '#DCE3E4',
  green: '#225E49', greenLight: '#EAF4EE', amber: '#76521B', amberLight: '#FFF3D9',
};
export function BrandMark({ size = 42, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  return <View accessible={false} style={[{
    width: size, height: size, borderRadius: Math.round(size * 0.28),
    overflow: 'hidden', backgroundColor: colors.navy,
  }, style]}>
    <Image source={require('../assets/icon.png')} contentFit="contain" transition={0}
      accessible={false} style={StyleSheet.absoluteFill} />
  </View>;
}
export type IconName = keyof typeof Ionicons.glyphMap;
export function Icon({ name, size = 22, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} accessible={false} />;
}
export function IconButton({ name, label, onPress, selected = false, light = false, disabled = false }: {
  name: IconName; label: string; onPress: () => void; selected?: boolean; light?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.iconButton, light && s.iconButtonLight, pressed && s.pressed, disabled && s.disabled]}>
    <Icon name={name} color={selected ? colors.green : light ? colors.white : colors.ink} />
  </Pressable>;
}
export function Button({ title, icon, onPress, variant = 'primary', disabled = false, style }: {
  title: string; icon?: IconName; onPress: () => void; variant?: 'primary' | 'secondary' | 'whatsapp'; disabled?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const dark = variant === 'primary' || variant === 'whatsapp';
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
    accessibilityState={{ disabled }} style={({ pressed }) => [s.button, dark ? s.buttonPrimary : s.buttonSecondary,
      variant === 'whatsapp' && s.buttonWhatsapp, pressed && s.pressed, disabled && s.disabled, style]}>
    {icon && <Icon name={icon} size={20} color={dark ? colors.white : colors.ink} />}
    <Text style={[s.buttonText, dark && s.buttonTextLight]}>{title}</Text>
  </Pressable>;
}
export function Chip({ title, selected, onPress, icon }: { title: string; selected: boolean; onPress: () => void; icon?: IconName }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}
    style={({ pressed }) => [s.chip, selected && s.chipSelected, pressed && s.pressed]}>
    {icon && <Icon name={icon} size={16} color={selected ? colors.white : colors.muted} />}
    <Text style={[s.chipText, selected && s.chipTextSelected]}>{title}</Text>
  </Pressable>;
}
export function VehicleImage({ uri, title, style }: { uri: string; title: string; style?: StyleProp<ViewStyle> }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [uri]);
  return <View style={[s.imageFrame, style]}>
    {failed ? <View style={s.imageFallback}><Icon name="image-outline" size={34} color={colors.muted} />
      <Text style={s.imageFallbackText}>Fotografia indisponível</Text>
      <Pressable onPress={event => { event.stopPropagation(); setFailed(false); }} accessibilityRole="button" style={s.imageRetry}>
        <Text style={s.imageRetryText}>Tentar novamente</Text>
      </Pressable></View> :
      <Image key={uri} source={{ uri }} recyclingKey={uri} accessibilityLabel={title} accessible
        contentFit="contain" cachePolicy="disk" transition={0} style={StyleSheet.absoluteFill} onError={() => setFailed(true)} />}
  </View>;
}
export function EmptyState({ icon = 'car-outline', title, message, action, onAction, loading = false }: {
  icon?: IconName; title: string; message: string; action?: string; onAction?: () => void; loading?: boolean;
}) {
  return <View style={s.empty}>
    <View style={s.emptyIcon}>{loading ? <ActivityIndicator size="large" color={colors.navy} /> : <Icon name={icon} size={36} color={colors.muted} />}</View>
    <Text style={s.emptyTitle}>{title}</Text><Text style={s.emptyMessage}>{message}</Text>
    {action && onAction && <Button title={action} onPress={onAction} variant="secondary" />}
  </View>;
}
export function Notice({ message, warning = false }: { message: string; warning?: boolean }) {
  return <View accessibilityRole="text" style={[s.notice, warning && s.noticeWarning]}>
    <Icon name={warning ? 'alert-circle-outline' : 'information-circle-outline'} size={18} color={warning ? colors.amber : colors.green} />
    <Text style={[s.noticeText, warning && { color: colors.amber }]}>{message}</Text>
  </View>;
}
const s = StyleSheet.create({
  pressed: { opacity: 0.7 }, disabled: { opacity: 0.45 },
  iconButton: { minWidth: 44, minHeight: 44, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  iconButtonLight: { backgroundColor: colors.navyLight },
  button: { minHeight: 50, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', gap: 9, justifyContent: 'center', alignItems: 'center' },
  buttonPrimary: { backgroundColor: colors.navy }, buttonWhatsapp: { backgroundColor: colors.green },
  buttonSecondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  buttonText: { fontSize: 15, fontWeight: '700', textAlign: 'center', color: colors.ink, flexShrink: 1 }, buttonTextLight: { color: colors.white },
  chip: { minHeight: 42, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  chipSelected: { backgroundColor: colors.navy, borderColor: colors.navy }, chipText: { fontSize: 13, fontWeight: '600', color: colors.muted }, chipTextSelected: { color: colors.white },
  imageFrame: { aspectRatio: 1.5, width: '100%', backgroundColor: '#EAF0EE', overflow: 'hidden' },
  imageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }, imageFallbackText: { fontSize: 13, color: colors.muted },
  imageRetry: { minHeight: 44, padding: 12, justifyContent: 'center' }, imageRetryText: { fontSize: 13, color: colors.green, fontWeight: '700' },
  empty: { paddingHorizontal: 28, paddingVertical: 40, alignItems: 'center', gap: 15, maxWidth: 480, alignSelf: 'center' },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#E9EEEB', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.ink, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  emptyMessage: { color: colors.muted, fontSize: 15, lineHeight: 23, textAlign: 'center' },
  notice: { borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: colors.greenLight },
  noticeWarning: { backgroundColor: colors.amberLight }, noticeText: { fontSize: 13, lineHeight: 19, flex: 1, color: colors.green },
});

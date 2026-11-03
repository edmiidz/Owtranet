import React from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View, ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radius } from '@/theme';
import { absoluteUrl } from '@/api/client';
import { initials } from '@/lib/format';

export function Screen({ children, scroll = true, refreshing, onRefresh, padded = true, style, edges }: {
  children: React.ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; padded?: boolean; style?: any;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  const t = useTheme();
  const inner = padded ? { padding: spacing.lg } : undefined;
  return (
    <SafeAreaView edges={edges ?? ['left', 'right']} style={[{ flex: 1, backgroundColor: t.bg }, style]}>
      {scroll ? (
        // automaticallyAdjustKeyboardInsets makes iOS inset the scroll view by the
        // keyboard AND scroll the focused field above it, so a field at the end of a
        // form (the forum reply box, the last input on "new task") is reachable
        // instead of sitting behind the keyboard. Android does this natively via
        // windowSoftInputMode=adjustResize.
        <ScrollView contentContainerStyle={[inner, { paddingBottom: 40 }]} keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.muted} /> : undefined}>
          {children}
        </ScrollView>
      ) : <View style={[{ flex: 1 }, inner]}>{children}</View>}
    </SafeAreaView>
  );
}

export function Card({ children, style, ...rest }: ViewProps) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.card, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, padding: spacing.lg, marginBottom: spacing.md }, style]} {...rest}>{children}</View>;
}

export function H1({ children, style }: { children: React.ReactNode; style?: any }) {
  const t = useTheme();
  return <Text style={[{ fontSize: 26, fontWeight: '700', color: t.text, marginBottom: spacing.md }, style]}>{children}</Text>;
}
export function H2({ children, style }: { children: React.ReactNode; style?: any }) {
  const t = useTheme();
  return <Text style={[{ fontSize: 17, fontWeight: '700', color: t.text, marginBottom: spacing.sm, marginTop: spacing.sm }, style]}>{children}</Text>;
}
export function P({ children, muted, style, numberOfLines }: { children: React.ReactNode; muted?: boolean; style?: any; numberOfLines?: number }) {
  const t = useTheme();
  return <Text numberOfLines={numberOfLines} style={[{ fontSize: 15, lineHeight: 22, color: muted ? t.muted : t.text }, style]}>{children}</Text>;
}
export function Small({ children, style }: { children: React.ReactNode; style?: any }) {
  const t = useTheme();
  return <Text style={[{ fontSize: 12.5, color: t.muted }, style]}>{children}</Text>;
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style }: {
  title: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; loading?: boolean; disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap; style?: any;
}) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.primary : variant === 'danger' ? t.danger : variant === 'secondary' ? t.chip : 'transparent';
  const fg = variant === 'primary' || variant === 'danger' ? t.primaryText : variant === 'secondary' ? t.chipText : t.primary;
  return (
    <Pressable onPress={onPress} disabled={disabled || loading}
      style={({ pressed }) => [{ backgroundColor: bg, paddingVertical: 12, paddingHorizontal: 16, borderRadius: radius.md, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '600', fontSize: 15 }}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ name, onPress, size = 22, color, style }: { name: keyof typeof Ionicons.glyphMap; onPress?: () => void; size?: number; color?: string; style?: any }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={10} style={({ pressed }) => [{ padding: 6, opacity: pressed ? 0.6 : 1 }, style]}>
      <Ionicons name={name} size={size} color={color || t.text} />
    </Pressable>
  );
}

export function Input({ label, style, ...props }: TextInputProps & { label?: string }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Text style={{ color: t.muted, fontSize: 13, marginBottom: 6, fontWeight: '600' }}>{label}</Text> : null}
      <TextInput placeholderTextColor={t.muted}
        style={[{ backgroundColor: t.input, color: t.text, borderWidth: 1, borderColor: t.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 }, props.multiline && { minHeight: 110, textAlignVertical: 'top' }, style]}
        {...props} />
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ backgroundColor: active ? t.primary : t.chip, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, marginRight: 6, marginBottom: 6 }}>
      <Text style={{ color: active ? t.primaryText : t.chipText, fontSize: 12.5, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ value }: { value?: number }) {
  const t = useTheme();
  if (!value) return null;
  return <View style={{ backgroundColor: t.danger, borderRadius: 999, minWidth: 20, paddingHorizontal: 6, paddingVertical: 2, alignItems: 'center' }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{value > 99 ? '99+' : value}</Text></View>;
}

export function StatusPill({ status }: { status?: string | null }) {
  const t = useTheme();
  const s = (status || '').toLowerCase();
  const color = ['approved', 'paid', 'signed', 'completed', 'answered'].includes(s) ? t.success
    : ['rejected', 'cancelled', 'voided'].includes(s) ? t.danger
    : ['pending', 'pending_review', 'under_review', 'negotiating', 'open'].includes(s) ? t.warning
    : ['in_progress', 'active'].includes(s) ? t.primary : t.muted;
  return <View style={{ borderColor: color, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}><Text style={{ color, fontSize: 11.5, fontWeight: '700', textTransform: 'capitalize' }}>{(status || '').replace(/_/g, ' ')}</Text></View>;
}

export function Avatar({ uri, name, size = 36, workspaceUrl }: { uri?: string | null; name?: string | null; size?: number; workspaceUrl?: string }) {
  const t = useTheme();
  const src = absoluteUrl(uri, workspaceUrl);
  if (src) return <Image source={{ uri: src }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.chip }} />;
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.chipText, fontWeight: '700', fontSize: size * 0.38 }}>{initials(name)}</Text></View>;
}

export function Row({ title, subtitle, right, onPress, icon, avatar, chevron = true }: {
  title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; icon?: keyof typeof Ionicons.glyphMap;
  avatar?: { uri?: string | null; name?: string | null }; chevron?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: spacing.lg, backgroundColor: pressed ? t.chip : t.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border, gap: 12 })}>
      {avatar ? <Avatar uri={avatar.uri} name={avatar.name} /> : icon ? <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={20} color={t.chipText} /></View> : null}
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: t.text, fontSize: 15.5, fontWeight: '600' }}>{title}</Text>
        {subtitle ? <Text numberOfLines={2} style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>{subtitle}</Text> : null}
      </View>
      {right}
      {onPress && chevron ? <Ionicons name="chevron-forward" size={18} color={t.muted} /> : null}
    </Pressable>
  );
}

export function Empty({ icon = 'file-tray-outline', title, hint }: { icon?: keyof typeof Ionicons.glyphMap; title: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: 32 }}>
      <Ionicons name={icon} size={40} color={t.muted} />
      <Text style={{ color: t.text, fontWeight: '600', marginTop: 12, fontSize: 16 }}>{title}</Text>
      {hint ? <Text style={{ color: t.muted, textAlign: 'center', marginTop: 4 }}>{hint}</Text> : null}
    </View>
  );
}

export function Loading() {
  const t = useTheme();
  return <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={t.primary} /></View>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme();
  return (
    <Card style={{ borderColor: t.danger }}>
      <P>{message}</P>
      {onRetry ? <Button title="Retry" variant="secondary" onPress={onRetry} style={{ marginTop: 10 }} /> : null}
    </Card>
  );
}

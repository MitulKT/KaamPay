import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/lib/i18n';
import { useQueue } from '@/lib/hooks';
import { C, R, SP, STATUS_COLORS } from '@/lib/theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

export const haptic = {
  ok: () => Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  err: () => Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  tap: () => Platform.OS !== 'web' && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
};

export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  padded = true,
  footer,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  footer?: React.ReactNode;
}) {
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[padded && { padding: SP.lg }, { paddingBottom: 120 }]}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, padded && { padding: SP.lg }]}>{children}</View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['left', 'right']}>
      <OfflineBanner />
      {body}
      {footer ? <View style={s.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function OfflineBanner() {
  const q = useQueue();
  if (!q.length) return null;
  return (
    <View style={{ backgroundColor: C.amber, padding: SP.sm, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Ionicons name="cloud-offline" size={18} color="#fff" />
      <Text style={{ color: '#fff', fontWeight: '700' }}>
        {t('offline')} · {q.length} {t('pendingSync')}
      </Text>
    </View>
  );
}

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: ViewStyle; onPress?: () => void }) {
  if (!onPress) return <View style={[s.card, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, style, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

export function Btn({
  title,
  onPress,
  icon,
  color = C.primary,
  outline,
  big,
  disabled,
  loading,
  style,
  small,
}: {
  title: string;
  onPress?: () => void;
  icon?: IconName;
  color?: string;
  outline?: boolean;
  big?: boolean;
  small?: boolean;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const h = big ? 64 : small ? 36 : 48;
  const fg = outline ? color : '#fff';
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          minHeight: h,
          borderRadius: R.card,
          paddingHorizontal: small ? 12 : 18,
          backgroundColor: outline ? 'transparent' : color,
          borderWidth: outline ? 2 : 0,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={big ? 26 : 18} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: big ? 22 : small ? 13 : 16, fontWeight: '700' }}>{title}</Text>
    </Pressable>
  );
}

/** Big square-ish picker tile: icon + label (+ sub). */
export function Tile({
  label,
  sub,
  icon,
  selected,
  disabled,
  onPress,
  width = '48%',
  big,
  badge,
}: {
  label: string;
  sub?: string;
  icon?: IconName;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  width?: ViewStyle['width'];
  big?: boolean;
  badge?: string | number;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      style={[
        s.tile,
        { width, minHeight: big ? 96 : 76 },
        selected && { borderColor: C.primary, backgroundColor: C.primaryLight },
        disabled && { opacity: 0.4 },
      ]}
    >
      {icon ? <Ionicons name={icon} size={big ? 30 : 24} color={selected ? C.primary : C.muted} /> : null}
      <Text numberOfLines={2} style={{ fontSize: big ? 22 : 16, fontWeight: '700', color: C.text, textAlign: 'center' }}>
        {label}
      </Text>
      {sub ? <Text style={{ fontSize: 12, color: C.muted, textAlign: 'center' }}>{sub}</Text> : null}
      {badge !== undefined && badge !== 0 ? (
        <View style={s.badge}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{badge}</Text>
        </View>
      ) : null}
      {selected ? <Ionicons name="checkmark-circle" size={20} color={C.primary} style={{ position: 'absolute', top: 6, right: 6 }} /> : null}
    </Pressable>
  );
}

export function StatusChip({ status, label, big }: { status: string; label?: string; big?: boolean }) {
  const bg = STATUS_COLORS[status] || C.muted;
  return (
    <View style={{ backgroundColor: bg, borderRadius: R.chip, paddingHorizontal: big ? 12 : 8, paddingVertical: big ? 5 : 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: '#fff', fontSize: big ? 15 : 11, fontWeight: '700' }}>{label ?? status}</Text>
    </View>
  );
}

export function ColourChip({
  code,
  selected,
  taken,
  onPress,
  size = 44,
  sub,
}: {
  code: string;
  selected?: boolean;
  taken?: boolean;
  onPress?: () => void;
  size?: number;
  sub?: string;
}) {
  return (
    <Pressable
      disabled={taken}
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      style={{ alignItems: 'center', margin: 4 }}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: selected ? C.primary : C.border,
          backgroundColor: selected ? C.primary : taken ? '#E2E8F0' : '#fff',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontSize: code.length > 1 ? 13 : 18,
            fontWeight: '800',
            color: selected ? '#fff' : taken ? '#94A3B8' : C.text,
            textDecorationLine: taken ? 'line-through' : 'none',
          }}
        >
          {code}
        </Text>
      </View>
      {sub ? <Text style={{ fontSize: 10, color: C.muted, maxWidth: 64 }} numberOfLines={1}>{sub}</Text> : null}
    </Pressable>
  );
}

export function Kpi({ label, value, color = C.text, sub, onPress, style }: { label: string; value: string | number; color?: string; sub?: string; onPress?: () => void; style?: ViewStyle }) {
  return (
    <Card style={{ flex: 1, minWidth: 140, ...style }} onPress={onPress}>
      <Text style={{ fontSize: 12, color: C.muted, fontWeight: '600' }}>{label}</Text>
      <Text style={{ fontSize: 22, fontWeight: '800', color, marginTop: 2 }}>{value}</Text>
      {sub ? <Text style={{ fontSize: 12, color: C.muted }}>{sub}</Text> : null}
    </Card>
  );
}

export function Progress({ pct, color = C.green, height = 8 }: { pct: number; color?: string; height?: number }) {
  return (
    <View style={{ height, backgroundColor: C.border, borderRadius: height, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height, backgroundColor: color }} />
    </View>
  );
}

export function Empty({ text, icon = 'file-tray-outline', action }: { text: string; icon?: IconName; action?: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', padding: 40, gap: 12 }}>
      <Ionicons name={icon} size={56} color="#CBD5E1" />
      <Text style={{ fontSize: 16, color: C.muted, textAlign: 'center' }}>{text}</Text>
      {action}
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ padding: 40 }}>
      <ActivityIndicator size="large" color={C.primary} />
    </View>
  );
}

export function ErrorText({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <View style={{ backgroundColor: '#FEE2E2', padding: SP.md, borderRadius: R.card, marginBottom: SP.md }}>
      <Text style={{ color: C.red, fontWeight: '600' }}>{error}</Text>
    </View>
  );
}

export function H({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[{ fontSize: 18, fontWeight: '800', color: C.text, marginTop: SP.lg, marginBottom: SP.sm }, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[{ fontSize: 13, color: C.muted }, style]}>{children}</Text>;
}

export function Row({ children, style, gap = SP.sm }: { children: React.ReactNode; style?: ViewStyle; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Wrap({ children, gap = SP.sm, style }: { children: React.ReactNode; gap?: number; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap }, style]}>{children}</View>;
}

export function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ marginBottom: SP.md }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: C.muted, marginBottom: 4 }}>{label}</Text>
      <TextInput placeholderTextColor="#94A3B8" style={[s.input, style]} {...props} />
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: C.border, borderRadius: R.card, padding: 3, marginBottom: SP.md }}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          style={{ flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: value === o.value ? '#fff' : 'transparent', alignItems: 'center' }}
        >
          <Text style={{ fontWeight: '700', color: value === o.value ? C.primary : C.muted, fontSize: 13 }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' }} onPress={onClose} />
      <View style={s.sheet}>{children}</View>
    </Modal>
  );
}

export function Pill({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: R.chip,
        backgroundColor: active ? C.primary : '#fff',
        borderWidth: 1,
        borderColor: active ? C.primary : C.border,
      }}
    >
      <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function Line({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 5 }}>
      <Text style={{ fontSize: bold ? 17 : 15, color: C.muted, fontWeight: bold ? '700' : '400' }}>{label}</Text>
      <Text style={{ fontSize: bold ? 19 : 15, color: color || C.text, fontWeight: bold ? '800' : '600' }}>{value}</Text>
    </Row>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: R.card,
    padding: SP.lg,
    marginBottom: SP.md,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  tile: {
    backgroundColor: '#fff',
    borderRadius: R.card,
    borderWidth: 2,
    borderColor: C.border,
    padding: SP.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  badge: { position: 'absolute', top: 6, left: 6, backgroundColor: C.primary, borderRadius: 10, minWidth: 20, paddingHorizontal: 5, alignItems: 'center' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, color: C.text },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: SP.lg, backgroundColor: 'rgba(248,250,252,0.97)', borderTopWidth: 1, borderColor: C.border },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: SP.xl, paddingBottom: 40 },
});

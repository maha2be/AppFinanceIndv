import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Transaction } from '../types';
import { Fonts, Space } from '../utils/theme';
import { createThemedStyles, useTheme } from '../services/theme';
import { formatDateIndo } from '../utils/formatRupiah';
import { Amount } from './ui/Amount';

interface TransactionCardProps {
  transaction: Transaction;
  onPress?: () => void;
}

/** One ledger line: type mark, label, signed amount, date. */
export function TransactionCard({ transaction, onPress }: TransactionCardProps) {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useStyles(theme);
  const typeMeta = {
    income: { icon: 'arrow-down' as const, tone: 'income' as const, color: colors.income, tint: colors.incomeTint },
    expense: { icon: 'arrow-up' as const, tone: 'expense' as const, color: colors.expense, tint: colors.expenseTint },
    investment: {
      icon: 'trending-up' as const,
      tone: 'investment' as const,
      color: colors.investment,
      tint: colors.investmentTint,
    },
  };
  const meta = typeMeta[transaction.type] ?? typeMeta.expense;
  const sign = transaction.type === 'income' ? 1 : transaction.type === 'expense' ? -1 : 1;

  const title =
    transaction.category_name || (transaction.asset_name ? transaction.asset_name : 'Lainnya');
  const asset = transaction.asset_name?.trim() || '';
  const note = transaction.note?.trim() || '';
  const detailParts: string[] = [];
  if (asset && asset.toLowerCase() !== title.toLowerCase()) {
    detailParts.push(asset);
  }
  if (note && note.toLowerCase() !== asset.toLowerCase()) {
    detailParts.push(note);
  }
  const subtitle = detailParts.join(' · ') || formatDateIndo(transaction.transaction_date);
  const a11yDetail = detailParts.length ? `, ${detailParts.join(', ')}` : '';

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${title}${a11yDetail}, ${formatDateIndo(transaction.transaction_date)}`}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.pressed : null]}
    >
      <View style={[styles.mark, { backgroundColor: meta.tint }]}>
        <Ionicons name={meta.icon} size={16} color={meta.color} />
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>

      <View style={styles.amountCol}>
        <Amount value={sign * transaction.amount} tone={meta.tone} signed />
        <Text style={styles.date}>{formatDateIndo(transaction.transaction_date)}</Text>
      </View>
    </Pressable>
  );
}

const useStyles = createThemedStyles(({ colors }) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
    minHeight: 60,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  pressed: {
    opacity: 0.7,
  },
  mark: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: Fonts.medium,
    fontSize: 15,
    lineHeight: 20,
    color: colors.ink,
  },
  meta: {
    fontFamily: Fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.inkMuted,
    marginTop: 1,
  },
  amountCol: {
    alignItems: 'flex-end',
  },
  date: {
    fontFamily: Fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    color: colors.inkMuted,
    marginTop: 2,
  },
}));
import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle } from 'react-native';
import { Fonts } from '../../utils/theme';
import { useTheme } from '../../services/theme';
import { formatRupiah } from '../../utils/formatRupiah';

interface AmountProps {
  value: number;
  /** Renders a leading sign and colors the value. */
  tone?: 'neutral' | 'income' | 'expense' | 'investment' | 'debt' | 'receivable';
  size?: 'body' | 'large' | 'hero';
  /** Show + / - before the figure. */
  signed?: boolean;
  style?: StyleProp<TextStyle>;
}

/**
 * Money figure with tabular digits, so columns line up across rows.
 * Sign is rendered as text, never color alone.
 */
export function Amount({ value, tone = 'neutral', size = 'body', signed = false, style }: AmountProps) {
  const { colors } = useTheme();
  const sign = signed ? (value > 0 ? '+' : value < 0 ? '−' : '') : '';
  const magnitude = Math.abs(value);
  const toneColor: Record<NonNullable<AmountProps['tone']>, string> = {
    neutral: colors.ink,
    income: colors.income,
    expense: colors.expense,
    investment: colors.investment,
    debt: colors.debt,
    receivable: colors.receivable,
  };

  return (
    <Text
      style={[styles.base, styles[size], { color: toneColor[tone] }, style]}
      accessibilityLabel={`${sign}${formatRupiah(magnitude)}`}
      numberOfLines={1}
      ellipsizeMode="tail"
      allowFontScaling
    >
      {sign}
      {formatRupiah(magnitude).replace('-', '')}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: Fonts.semibold,
    fontVariant: ['tabular-nums'],
  },
  body: {
    fontSize: 15,
    lineHeight: 20,
  },
  large: {
    fontSize: 17,
    lineHeight: 22,
  },
  hero: {
    fontFamily: Fonts.semibold,
    fontSize: 22,
    lineHeight: 28,
  },
});
import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { createThemedStyles, useTheme } from '../../services/theme';

interface ProgressProps {
  /** 0-100. Clamped. */
  value: number;
  color?: string;
  height?: number;
  style?: ViewStyle;
}

/** Hairline-height progress rule, sized for dense ledger rows. */
export function Progress({ value, color, height = 4, style }: ProgressProps) {
  const theme = useTheme();
  const styles = useStyles(theme);
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

  return (
    <View
      style={[styles.track, { height }, style]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
    >
      <View style={[styles.fill, { width: `${clamped}%`, backgroundColor: color ?? theme.colors.ink, height }]} />
    </View>
  );
}

const useStyles = createThemedStyles(({ colors }) => StyleSheet.create({
  track: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 999,
    overflow: 'hidden',
  },
  fill: {
    borderRadius: 999,
  },
}));
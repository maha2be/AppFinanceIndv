import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { Radius, Space } from '../../utils/theme';
import { createThemedStyles, useTheme } from '../../services/theme';

type Variant = 'surface' | 'inset' | 'plain';

interface CardProps extends ViewProps {
  variant?: Variant;
  /** Padding override; defaults to Space.lg. */
  padded?: boolean;
  children: React.ReactNode;
}

/** A raised paper block. Used sparingly: sheets, hero blocks, forms. */
export function Card({ variant = 'surface', padded = true, style, children, ...props }: CardProps) {
  const theme = useTheme();
  const styles = useStyles(theme);
  return (
    <View
      style={[
        styles.base,
        padded && styles.padded,
        variant === 'surface' && styles.surface,
        variant === 'inset' && styles.inset,
        variant === 'plain' && styles.plain,
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

/** 1px ledger rule. */
export function Rule({ style }: { style?: ViewProps['style'] }) {
  const theme = useTheme();
  const styles = useStyles(theme);
  return <View style={[styles.rule, style]} />;
}

const useStyles = createThemedStyles(({ colors, shadow }) => StyleSheet.create({
  base: {
    borderRadius: Radius.block,
  },
  padded: {
    padding: Space.lg,
  },
  surface: {
    backgroundColor: colors.surface,
    ...shadow.raised,
  },
  inset: {
    backgroundColor: colors.surfaceAlt,
  },
  plain: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.line,
  },
  rule: {
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: colors.line,
  },
}));
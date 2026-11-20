import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Fonts, Space } from '../../utils/theme';
import { createThemedStyles, useTheme } from '../../services/theme';

interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  actionUnderlined?: boolean;
  style?: object;
}

/** Section title with an optional text action on the right. */
export function SectionHeader({
  title,
  actionLabel,
  onAction,
  actionUnderlined = false,
  style,
}: SectionHeaderProps) {
  const theme = useTheme();
  const styles = useStyles(theme);
  return (
    <View style={[styles.row, style]}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={12}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={[styles.actionText, actionUnderlined && styles.actionTextUnderlined]}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles(({ colors }) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Space.md,
  },
  title: {
    fontFamily: Fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink,
  },
  action: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginVertical: -12,
    paddingLeft: Space.sm,
  },
  actionText: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.inkSoft,
  },
  actionTextUnderlined: {
    textDecorationLine: 'underline',
  },
}));

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Radius, Space } from '../../utils/theme';
import { createThemedStyles, useTheme } from '../../services/theme';
import { Button } from './Button';

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

/** Inline error panel: cause on one line, retry as the next action. */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useStyles(theme);
  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <Button
          title="Coba lagi"
          variant="secondary"
          onPress={onRetry}
          fullWidth={false}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles(({ colors }) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: colors.dangerTint,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: Radius.block,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
    marginBottom: Space.lg,
  },
  message: {
    flex: 1,
    fontFamily: Fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.danger,
  },
  action: {
    paddingHorizontal: Space.md,
    minHeight: 36,
  },
}));
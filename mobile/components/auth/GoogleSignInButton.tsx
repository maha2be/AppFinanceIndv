import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Space } from '../../utils/theme';
import { createThemedStyles, useTheme } from '../../services/theme';
import { Button } from '../ui/Button';

interface GoogleSignInButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}

/**
 * Google sign-in entry point.
 *
 * Uses the app's own control rather than the native branded widget so busy and
 * disabled state stay consistent with the rest of the ledger UI. The visible
 * label and Google mark keep the provider recognisable.
 */
export function GoogleSignInButton({
  title,
  onPress,
  loading = false,
  disabled = false,
}: GoogleSignInButtonProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <Button
        title={title}
        variant="secondary"
        size="lg"
        loading={loading}
        disabled={disabled}
        onPress={onPress}
      />
      <View style={styles.mark} pointerEvents="none">
        <Ionicons name="logo-google" size={17} color={colors.inkSoft} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    marginTop: Space.md,
  },
  mark: {
    position: 'absolute',
    left: Space.lg,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
});

const useSeparatorStyles = createThemedStyles(({ colors, type }) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Space.xl,
    gap: Space.md,
  },
  rule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line,
  },
  label: {
    ...type.micro,
    fontFamily: Fonts.medium,
    textTransform: 'uppercase',
  },
}));

export function GoogleSeparator({ label = 'atau' }: { label?: string }) {
  const theme = useTheme();
  const separatorStyles = useSeparatorStyles(theme);
  return (
    <View style={separatorStyles.row}>
      <View style={separatorStyles.rule} />
      <Text style={separatorStyles.label}>{label}</Text>
      <View style={separatorStyles.rule} />
    </View>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import * as RN from 'react-native';
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radius, Space } from '../../utils/theme';
import { buildPageTokens, parsePageJump } from '../../utils/transactionBrowser';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';

const ScrollView = (RN.ScrollView ?? 'ScrollView') as typeof RN.ScrollView;
const TextInput = (RN.TextInput ?? 'TextInput') as typeof RN.TextInput;

export interface TransactionPaginationProps {
  currentPage: number;
  totalPages: number;
  disabled?: boolean;
  onSelectPage: (page: number) => void;
}

/**
 * Accessible numbered pager with previous/next controls, a horizontally
 * scrollable token strip, and an ellipsis-triggered direct page jump Sheet.
 */
export function TransactionPagination({
  currentPage,
  totalPages,
  disabled = false,
  onSelectPage,
}: TransactionPaginationProps) {
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpText, setJumpText] = useState('');
  const [jumpError, setJumpError] = useState<string | null>(null);

  const stripRef = useRef<{ scrollTo?: (options: { x?: number; y?: number; animated?: boolean }) => void } | null>(null);
  const stripWidthRef = useRef(0);
  const tokenOffsetsRef = useRef<Record<string, { x: number; width: number }>>({});

  const safeTotal = Number.isFinite(totalPages) ? Math.max(0, Math.floor(totalPages)) : 0;
  const safeCurrent =
    safeTotal > 0 ? Math.min(Math.max(1, Math.floor(currentPage) || 1), safeTotal) : 1;
  const tokens = buildPageTokens(safeCurrent, safeTotal);

  useEffect(() => {
    if (safeTotal <= 1 && jumpOpen) {
      setJumpOpen(false);
      setJumpText('');
      setJumpError(null);
    }
  }, [jumpOpen, safeTotal]);

  useEffect(() => {
    const selectedLayout = tokenOffsetsRef.current[String(safeCurrent)];
    const strip = stripRef.current;
    if (!selectedLayout || !strip || typeof strip.scrollTo !== 'function') {
      return;
    }
    const viewWidth = stripWidthRef.current;
    if (viewWidth <= 0) {
      return;
    }
    const targetX = Math.max(
      0,
      selectedLayout.x - Math.max(0, (viewWidth - selectedLayout.width) / 2)
    );
    strip.scrollTo({ x: targetX, animated: true });
  }, [safeCurrent, safeTotal]);

  if (safeTotal < 1 || tokens.length === 0) {
    return null;
  }

  // The required strip is `1 2 3 ... 99` on page 1 and `1 ... 97 98 99` on the
  // last page, so a boundary chevron is absent rather than shown dimmed.
  const showPrev = safeCurrent > 1;
  const showNext = safeCurrent < safeTotal;

  const openJumpSheet = () => {
    if (disabled) return;
    setJumpText('');
    setJumpError(null);
    setJumpOpen(true);
  };

  const closeJumpSheet = () => {
    setJumpOpen(false);
    setJumpText('');
    setJumpError(null);
  };

  const handleSelectPage = (targetPage: number) => {
    if (disabled) return;
    if (targetPage < 1 || targetPage > safeTotal || targetPage === safeCurrent) {
      return;
    }
    onSelectPage(targetPage);
  };

  const handleJumpSubmit = () => {
    if (disabled) return;
    const parsed = parsePageJump(jumpText, safeTotal);
    if (parsed === null) {
      setJumpError(`Masukkan halaman 1 sampai ${safeTotal}.`);
      return;
    }
    setJumpError(null);
    setJumpOpen(false);
    setJumpText('');
    if (parsed === safeCurrent) {
      return;
    }
    onSelectPage(parsed);
  };

  const handleStripLayout = (event: LayoutChangeEvent) => {
    stripWidthRef.current = event?.nativeEvent?.layout?.width ?? 0;
  };

  const handleTokenLayout = (key: string, event: LayoutChangeEvent) => {
    const layout = event?.nativeEvent?.layout;
    if (layout) {
      tokenOffsetsRef.current[key] = { x: layout.x, width: layout.width };
    }
  };

  return (
    <View style={styles.container}>
      {jumpOpen ? (
        <Sheet
          visible={jumpOpen}
          onClose={closeJumpSheet}
          title="Ke halaman"
        >
          <View style={styles.jumpBody}>
            <Text style={styles.jumpHint}>
              Masukkan nomor halaman antara <Text style={styles.jumpBounds}>1-{safeTotal}</Text>.
            </Text>

            <View style={styles.jumpRow}>
              <View
                style={[
                  styles.jumpInputWrap,
                  jumpError ? styles.jumpInputWrapError : null,
                ]}
              >
                <TextInput
                  testID="page-jump-input"
                  value={jumpText}
                  onChangeText={(value) => {
                    setJumpText(value);
                    if (jumpError) setJumpError(null);
                  }}
                  onSubmitEditing={handleJumpSubmit}
                  keyboardType="number-pad"
                  returnKeyType="go"
                  placeholder={`1-${safeTotal}`}
                  placeholderTextColor={Colors.inkMuted}
                  selectionColor={Colors.ink}
                  accessibilityLabel="Masukkan nomor halaman"
                  style={styles.jumpInput}
                  autoFocus
                  allowFontScaling
                />
              </View>

              <Pressable
                testID="page-jump-submit"
                onPress={handleJumpSubmit}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel="Ke halaman"
                accessibilityState={{ disabled, busy: disabled }}
                style={({ pressed }) => [
                  styles.jumpSubmitButton,
                  disabled && styles.buttonDisabled,
                  pressed && !disabled ? styles.buttonPressed : null,
                ]}
              >
                <Ionicons name="return-down-back" size={18} color={Colors.onInk} />
              </Pressable>
            </View>

            {jumpError ? (
              <Text
                testID="page-jump-error"
                style={styles.jumpError}
                accessibilityLiveRegion="polite"
              >
                {jumpError}
              </Text>
            ) : null}

            <View style={styles.jumpFooter}>
              <Button
                title="Batal"
                variant="secondary"
                onPress={closeJumpSheet}
              />
            </View>
          </View>
        </Sheet>
      ) : null}

      <View style={styles.bar}>
        {showPrev ? (
          <Pressable
            testID="page-prev"
            onPress={() => handleSelectPage(safeCurrent - 1)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Halaman sebelumnya"
            accessibilityState={{ disabled, busy: disabled }}
            style={({ pressed }) => [
              styles.navButton,
              disabled && styles.buttonDisabled,
              pressed && !disabled ? styles.buttonPressed : null,
            ]}
          >
            <Ionicons name="chevron-back" size={18} color={Colors.ink} />
          </Pressable>
        ) : null}

        <ScrollView
          ref={stripRef as any}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stripContent}
          style={styles.strip}
          onLayout={handleStripLayout}
          keyboardShouldPersistTaps="handled"
        >
          {tokens.map((token) => {
            if (token === 'ellipsis-left' || token === 'ellipsis-right') {
              const testID =
                token === 'ellipsis-left' ? 'page-ellipsis-left' : 'page-ellipsis-right';
              return (
                <Pressable
                  key={token}
                  testID={testID}
                  onPress={openJumpSheet}
                  disabled={disabled}
                  onLayout={(event) => handleTokenLayout(token, event)}
                  accessibilityRole="button"
                  accessibilityLabel="Masukkan nomor halaman"
                  accessibilityHint={`Pilih halaman 1 sampai ${safeTotal}`}
                  accessibilityState={{ disabled, busy: disabled }}
                  style={({ pressed }) => [
                    styles.tokenButton,
                    styles.ellipsisButton,
                    disabled && styles.buttonDisabled,
                    pressed && !disabled ? styles.buttonPressed : null,
                  ]}
                >
                  <Text style={styles.ellipsisText}>...</Text>
                </Pressable>
              );
            }

            const selected = token === safeCurrent;
            const tokenDisabled = disabled;
            return (
              <Pressable
                key={`page-${token}`}
                testID={`page-${token}`}
                onPress={() => handleSelectPage(token)}
                disabled={tokenDisabled}
                onLayout={(event) => handleTokenLayout(String(token), event)}
                accessibilityRole="button"
                accessibilityLabel={`Halaman ${token}`}
                accessibilityState={{
                  selected,
                  disabled: tokenDisabled,
                  busy: disabled,
                }}
                style={({ pressed }) => [
                  styles.tokenButton,
                  selected && styles.tokenSelected,
                  tokenDisabled && !selected && styles.buttonDisabled,
                  pressed && !tokenDisabled && !selected ? styles.buttonPressed : null,
                ]}
              >
                <Text style={[styles.tokenText, selected && styles.tokenTextSelected]}>
                  {token}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {showNext ? (
          <Pressable
            testID="page-next"
            onPress={() => handleSelectPage(safeCurrent + 1)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Halaman berikutnya"
            accessibilityState={{ disabled, busy: disabled }}
            style={({ pressed }) => [
              styles.navButton,
              disabled && styles.buttonDisabled,
              pressed && !disabled ? styles.buttonPressed : null,
            ]}
          >
            <Ionicons name="chevron-forward" size={18} color={Colors.ink} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: Space.lg,
    paddingBottom: Space.md,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
  },
  strip: {
    flexGrow: 0,
    flexShrink: 1,
  },
  stripContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingVertical: 2,
  },
  navButton: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tokenButton: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: Space.md,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ellipsisButton: {
    borderStyle: 'dashed',
  },
  tokenSelected: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonPressed: {
    backgroundColor: Colors.surfaceAlt,
  },
  tokenText: {
    fontFamily: Fonts.medium,
    fontSize: 14,
    lineHeight: 18,
    color: Colors.ink,
    fontVariant: ['tabular-nums'],
  },
  tokenTextSelected: {
    fontFamily: Fonts.semibold,
    color: Colors.onInk,
  },
  ellipsisText: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    lineHeight: 18,
    color: Colors.inkSoft,
    letterSpacing: 1,
  },
  jumpBody: {
    paddingTop: Space.sm,
    paddingBottom: Space.sm,
    gap: Space.md,
  },
  jumpHint: {
    fontFamily: Fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.inkSoft,
  },
  jumpBounds: {
    fontFamily: Fonts.semibold,
    color: Colors.ink,
    fontVariant: ['tabular-nums'],
  },
  jumpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  jumpInputWrap: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.control,
    backgroundColor: Colors.surface,
    paddingHorizontal: Space.md,
    justifyContent: 'center',
  },
  jumpInputWrapError: {
    borderColor: Colors.danger,
  },
  jumpInput: {
    minHeight: 44,
    fontFamily: Fonts.semibold,
    fontSize: 16,
    lineHeight: 22,
    color: Colors.ink,
    fontVariant: ['tabular-nums'],
  },
  jumpSubmitButton: {
    minWidth: 48,
    minHeight: 48,
    borderRadius: Radius.control,
    backgroundColor: Colors.ink,
    borderWidth: 1,
    borderColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jumpError: {
    fontFamily: Fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.danger,
  },
  jumpFooter: {
    borderTopWidth: 1,
    borderTopColor: Colors.line,
    paddingTop: Space.md,
  },
});

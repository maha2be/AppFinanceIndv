import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuickInputPreview } from '../types';
import { Fonts, Radius, Space } from '../utils/theme';
import { createThemedStyles, useTheme } from '../services/theme';
import { formatRupiah } from '../utils/formatRupiah';
import { transactionApi } from '../services/transactions';
import { describeApiError } from '../services/auth';

interface QuickInputBarProps {
  onSuccess?: () => void;
}

/** Free-text entry: parse on the fly, confirm inline. */
export function QuickInputBar({ onSuccess }: QuickInputBarProps) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<QuickInputPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const theme = useTheme();
  const { colors } = theme;
  const styles = useStyles(theme);

  const handleTextChange = async (value: string) => {
    setText(value);
    setError(null);

    if (value.trim().length <= 3) {
      setPreview(null);
      return;
    }

    setLoading(true);
    try {
      const res = await transactionApi.previewQuickInput(value);
      if (res.is_valid) {
        setPreview(res);
        setError(null);
      } else {
        setPreview(null);
      }
    } catch {
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await transactionApi.confirmQuickInput(text);
      setText('');
      setPreview(null);
      onSuccess?.();
    } catch (err) {
      setError(describeApiError(err, 'Gagal menyimpan transaksi.'));
    } finally {
      setSaving(false);
    }
  };

  const typeTone = {
    income: colors.income,
    expense: colors.expense,
    investment: colors.investment,
  } as const;
  const typeTint = {
    income: colors.incomeTint,
    expense: colors.expenseTint,
    investment: colors.investmentTint,
  } as const;
  const tone = preview?.type ? typeTone[preview.type] : colors.ink;

  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        <Ionicons name="pencil-outline" size={16} color={colors.inkMuted} />
        <TextInput
          value={text}
          onChangeText={handleTextChange}
          placeholder={'Coba "makan 25000" atau "gaji 5jt"'}
          placeholderTextColor={colors.inkMuted}
          style={styles.input}
          returnKeyType="done"
          onSubmitEditing={handleSave}
          accessibilityLabel="Input cepat transaksi"
          autoCorrect={false}
        />
        {loading ? (
          <ActivityIndicator size="small" color={colors.inkMuted} />
        ) : text.trim() ? (
          <Pressable
            onPress={() => {
              setText('');
              setPreview(null);
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Bersihkan input"
            style={styles.clear}
          >
            <Ionicons name="close-circle" size={18} color={colors.inkMuted} />
          </Pressable>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {preview?.is_valid ? (() => {
        const previewCategory = preview.category_name || preview.asset_name || 'Lainnya';
        const previewAsset = preview.asset_name?.trim() || '';
        const previewNote = preview.note?.trim() || '';
        const previewDetails: string[] = [];
        if (previewAsset && previewAsset.toLowerCase() !== previewCategory.toLowerCase()) {
          previewDetails.push(previewAsset);
        }
        if (previewNote && previewNote.toLowerCase() !== previewAsset.toLowerCase()) {
          previewDetails.push(previewNote);
        }
        const previewDetailText = previewDetails.join(' · ');

        return (
        <View style={styles.preview}>
          <View style={styles.previewInfo}>
            <View
              style={[
                styles.typeTag,
                { backgroundColor: preview.type ? typeTint[preview.type] : colors.inkTint },
              ]}
            >
              <Text style={[styles.typeTagText, { color: tone }]}>
                {preview.type_label || preview.type}
              </Text>
            </View>
            <View style={styles.previewTextWrap}>
              <Text style={styles.previewCategory} numberOfLines={1}>
                {previewCategory}
              </Text>
              {previewDetailText ? (
                <Text style={styles.previewDetail} numberOfLines={1}>
                  {previewDetailText}
                </Text>
              ) : null}
            </View>
            <Text style={styles.previewAmount}>{formatRupiah(preview.amount || 0)}</Text>
          </View>

          <Pressable
            onPress={handleSave}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Simpan transaksi cepat"
            accessibilityState={{ busy: saving }}
            style={({ pressed }) => [styles.save, pressed && styles.pressed]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.onInk} />
            ) : (
              <Ionicons name="arrow-forward" size={18} color={colors.onInk} />
            )}
          </Pressable>
        </View>
        );
      })() : null}
    </View>
  );
}

const useStyles = createThemedStyles(({ colors }) => StyleSheet.create({
  container: {
    marginBottom: Space.lg,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineStrong,
  },
  input: {
    flex: 1,
    minHeight: 48,
    paddingVertical: Space.sm,
    fontFamily: Fonts.regular,
    fontSize: 15,
    color: colors.ink,
  },
  clear: {
    width: 32,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    marginTop: Space.sm,
    fontFamily: Fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.danger,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    marginTop: Space.md,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: Radius.block,
  },
  previewInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    flex: 1,
    minWidth: 0,
  },
  typeTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeTagText: {
    fontFamily: Fonts.semibold,
    fontSize: 10,
    lineHeight: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.04,
  },
  previewTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  previewCategory: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink,
  },
  previewDetail: {
    fontFamily: Fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    color: colors.inkMuted,
  },
  previewAmount: {
    fontFamily: Fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  save: {
    width: 44,
    height: 44,
    borderRadius: Radius.control,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.8,
  },
}));
import React, { useEffect, useRef, useState } from 'react';
import * as RN from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Category, TransactionBrowserFilters, TransactionType } from '../../types';
import { Colors, Fonts, Space } from '../../utils/theme';
import {
  EMPTY_FILTER_DRAFT,
  MAX_SEARCH_LENGTH,
  TYPE_OPTIONS,
  TransactionFilterDraft,
  draftToFilters,
  filtersToDraft,
  validateFilterDraft,
} from '../../utils/transactionBrowser';
import { Sheet } from '../ui/Sheet';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { ErrorState } from '../ui/ErrorState';
import { Skeleton } from '../ui/Skeleton';

const ScrollView = (RN.ScrollView ?? 'ScrollView') as typeof RN.ScrollView;

export interface TransactionFiltersProps {
  visible: boolean;
  filters: TransactionBrowserFilters;
  categories: Category[];
  loadingCategories?: boolean;
  categoryError?: string | null;
  onRetryCategories?: () => void;
  onApply: (filters: TransactionBrowserFilters) => void;
  onReset?: () => void;
  onClose: () => void;
}

/**
 * Draft-based filter Sheet for the transaction browser.
 *
 * Edits remain local until "Terapkan" succeeds validation; closing discards
 * uncommitted draft edits.
 */
export function TransactionFilters({
  visible,
  filters,
  categories,
  loadingCategories = false,
  categoryError = null,
  onRetryCategories,
  onApply,
  onReset,
  onClose,
}: TransactionFiltersProps) {
  const [draft, setDraft] = useState<TransactionFilterDraft>(() => filtersToDraft(filters));
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Parent renders must not wipe typed input. Re-seed only when the sheet opens,
  // reading the newest applied filters through a ref.
  const latestFiltersRef = useRef(filters);
  latestFiltersRef.current = filters;

  useEffect(() => {
    if (!visible) {
      return;
    }
    setDraft(filtersToDraft(latestFiltersRef.current));
    setErrors({});
  }, [visible]);

  if (!visible) {
    return null;
  }

  const updateField = <K extends keyof TransactionFilterDraft>(
    key: K,
    value: TransactionFilterDraft[K]
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSelectType = (nextType: TransactionType | '') => {
    setDraft((prev) => {
      if (prev.type === nextType) {
        return prev;
      }
      return {
        ...prev,
        type: nextType,
        categoryId: null,
      };
    });
    setErrors((prev) => {
      if (!prev.type && !prev.categoryId) return prev;
      const next = { ...prev };
      delete next.type;
      delete next.categoryId;
      return next;
    });
  };

  const handleSelectCategory = (categoryId: number | null) => {
    updateField('categoryId', categoryId);
  };

  const handleApply = () => {
    const validationErrors = validateFilterDraft(draft);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    onApply(draftToFilters(draft));
  };

  const handleReset = () => {
    setDraft({ ...EMPTY_FILTER_DRAFT });
    setErrors({});
    onReset?.();
  };

  const handleCancel = () => {
    setDraft(filtersToDraft(filters));
    setErrors({});
    onClose();
  };

  const visibleCategories = draft.type
    ? categories.filter((cat) => !cat.type || cat.type === draft.type)
    : categories;

  return (
    <Sheet
      visible={visible}
      onClose={handleCancel}
      title="Filter transaksi"
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Input
          testID="filter-search"
          label="Kata kunci"
          placeholder="Cari catatan, kategori, atau aset"
          value={draft.q}
          onChangeText={(value) => updateField('q', value)}
          maxLength={MAX_SEARCH_LENGTH + 20}
          error={errors.q ?? null}
          returnKeyType="done"
        />

        <View style={styles.dateRow}>
          <View style={styles.dateCol}>
            <Input
              testID="filter-start-date"
              label="Tanggal mulai"
              placeholder="YYYY-MM-DD"
              value={draft.startDate}
              onChangeText={(value) => updateField('startDate', value)}
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              error={errors.startDate ?? null}
            />
          </View>
          <View style={styles.dateCol}>
            <Input
              testID="filter-end-date"
              label="Tanggal akhir"
              placeholder="YYYY-MM-DD"
              value={draft.endDate}
              onChangeText={(value) => updateField('endDate', value)}
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              error={errors.endDate ?? null}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Jenis transaksi</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            keyboardShouldPersistTaps="handled"
          >
            {TYPE_OPTIONS.map((option) => (
              <Chip
                key={option.key || 'all'}
                label={option.label}
                selected={draft.type === option.key}
                onPress={() => handleSelectType(option.key)}
              />
            ))}
          </ScrollView>
          {errors.type ? (
            <Text style={styles.fieldError} accessibilityLiveRegion="polite">
              {errors.type}
            </Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Kategori</Text>
            {draft.categoryId !== null ? (
              <Pressable
                onPress={() => handleSelectCategory(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Reset pilihan kategori"
              >
                <Text style={styles.clearLink}>Semua kategori</Text>
              </Pressable>
            ) : null}
          </View>

          {categoryError ? (
            <ErrorState message={categoryError} onRetry={onRetryCategories} />
          ) : loadingCategories ? (
            <View style={styles.chips}>
              {[96, 112, 84].map((width) => (
                <Skeleton key={width} width={width} height={44} radius={999} />
              ))}
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
              keyboardShouldPersistTaps="handled"
            >
              <Chip
                label="Semua kategori"
                selected={draft.categoryId === null}
                onPress={() => handleSelectCategory(null)}
              />
              {visibleCategories.map((cat) => (
                <Chip
                  key={cat.id}
                  label={cat.name}
                  selected={draft.categoryId === cat.id}
                  onPress={() => handleSelectCategory(cat.id)}
                />
              ))}
            </ScrollView>
          )}
          {errors.categoryId ? (
            <Text style={styles.fieldError} accessibilityLiveRegion="polite">
              {errors.categoryId}
            </Text>
          ) : null}
        </View>

        <View style={styles.dateRow}>
          <View style={styles.dateCol}>
            <Input
              testID="filter-min-amount"
              label="Nominal minimum"
              placeholder="0"
              leading="Rp"
              value={draft.minAmount}
              onChangeText={(value) => updateField('minAmount', value)}
              keyboardType="numeric"
              error={errors.minAmount ?? null}
            />
          </View>
          <View style={styles.dateCol}>
            <Input
              testID="filter-max-amount"
              label="Nominal maksimum"
              placeholder="Tanpa batas"
              leading="Rp"
              value={draft.maxAmount}
              onChangeText={(value) => updateField('maxAmount', value)}
              keyboardType="numeric"
              error={errors.maxAmount ?? null}
            />
          </View>
        </View>
      </ScrollView>

      <View style={styles.footerWrap}>
        <View style={styles.footerActions}>
          <Button
            title="Atur ulang"
            variant="secondary"
            onPress={handleReset}
            fullWidth={false}
            style={styles.footerSecondary}
          />
          <Button
            title="Terapkan"
            variant="primary"
            onPress={handleApply}
            fullWidth={false}
            style={styles.footerPrimary}
          />
        </View>
        <Button
          title="Batal"
          variant="ghost"
          onPress={handleCancel}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  content: {
    paddingTop: Space.sm,
    paddingBottom: Space.sm,
  },
  dateRow: {
    flexDirection: 'row',
    gap: Space.md,
  },
  dateCol: {
    flex: 1,
  },
  section: {
    marginBottom: Space.lg,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Space.xs,
  },
  sectionLabel: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.inkSoft,
    marginBottom: Space.xs,
  },
  clearLink: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.inkSoft,
    textDecorationLine: 'underline',
  },
  chips: {
    flexDirection: 'row',
    gap: Space.sm,
    paddingVertical: Space.xs,
  },
  fieldError: {
    marginTop: Space.xs,
    fontFamily: Fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.danger,
  },
  footerWrap: {
    borderTopWidth: 1,
    borderTopColor: Colors.line,
    paddingTop: Space.md,
    gap: Space.xs,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  footerSecondary: {
    flex: 1,
  },
  footerPrimary: {
    flex: 1,
  },
});

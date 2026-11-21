import { AppAlert as Alert } from '../services/appAlert';
import React, { useCallback, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Radius, Space } from '../utils/theme';
import { createThemedStyles, useTheme } from '../services/theme';
import { BudgetOverview, BudgetProgress, Category } from '../types';
import { budgetApi } from '../services/budgets';
import { categoryApi } from '../services/categories';
import { describeApiError } from '../services/auth';
import { formatRupiah } from '../utils/formatRupiah';
import {
  budgetStatusLabel,
  clampedBudgetPercent,
  formatMonthYearIndo,
  shiftMonth,
} from '../utils/budgets';
import { parseOptionalAmountInput } from '../utils/shoppingLists';
import { Screen } from '../components/ui/Screen';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { Input } from '../components/ui/Input';
import { Progress } from '../components/ui/Progress';
import { Sheet } from '../components/ui/Sheet';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { SkeletonRows } from '../components/ui/Skeleton';
import { FadeIn } from '../components/ui/FadeIn';

const THRESHOLD_OPTIONS = [75, 80, 90] as const;

export default function BudgetsScreen() {
  const now = new Date();
  const [period, setPeriod] = useState(() => ({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  }));
  const [overview, setOverview] = useState<BudgetOverview | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [threshold, setThreshold] = useState<number>(80);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const busyRef = useRef(false);
  const theme = useTheme();
  const { colors } = theme;
  const styles = useStyles(theme);

  const loadData = useCallback(async () => {
    try {
      const [overviewRes, catsRes] = await Promise.all([
        budgetApi.getOverview({ year: period.year, month: period.month }),
        categoryApi.getCategories('expense'),
      ]);
      setOverview(overviewRes);
      setCategories(catsRes);
      setError(null);
    } catch (err) {
      setError(describeApiError(err, 'Gagal memuat anggaran pribadi.'));
    }
  }, [period.month, period.year]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const openCreateSheet = (presetCategoryId: number | null = null) => {
    if (busyRef.current) return;
    const existing =
      presetCategoryId === null
        ? overview?.overall_budget ?? null
        : overview?.category_budgets.find((b) => b.category_id === presetCategoryId) ?? null;
    setEditingId(existing?.id ?? null);
    setSelectedCategoryId(presetCategoryId);
    setAmountInput(existing ? String(existing.amount) : '');
    setThreshold(existing?.alert_threshold ?? 80);
    setFormError(null);
    setSheetOpen(true);
  };

  const openEditProgress = (item: BudgetProgress) => {
    if (busyRef.current) return;
    setEditingId(item.id);
    setSelectedCategoryId(item.category_id ?? null);
    setAmountInput(String(item.amount));
    setThreshold(item.alert_threshold);
    setFormError(null);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    if (saving) return;
    setSheetOpen(false);
    setFormError(null);
  };

  const handleSave = async () => {
    if (busyRef.current || saving) return;
    const parsedAmount = parseOptionalAmountInput(amountInput);
    if (!parsedAmount || parsedAmount <= 0) {
      setFormError('Nominal anggaran harus lebih dari 0.');
      return;
    }

    busyRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      await budgetApi.upsert({
        category_id: selectedCategoryId,
        amount: parsedAmount,
        alert_threshold: threshold,
      });
      setSheetOpen(false);
      await loadData();
    } catch (err) {
      setFormError(describeApiError(err, 'Gagal menyimpan anggaran.'));
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (editingId === null || saving) return;
    const targetId = editingId;
    const targetLabel =
      selectedCategoryId === null
        ? 'Total pengeluaran bulanan'
        : categories.find((c) => c.id === selectedCategoryId)?.name || 'kategori ini';
    Alert.alert('Hapus anggaran', `Hapus batas anggaran untuk ${targetLabel}?`, [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: async () => {
          if (busyRef.current) return;
          busyRef.current = true;
          setSaving(true);
          try {
            await budgetApi.remove(targetId);
            setSheetOpen(false);
            await loadData();
          } catch (err) {
            Alert.alert('Gagal menghapus', describeApiError(err, 'Coba lagi.'));
          } finally {
            busyRef.current = false;
            setSaving(false);
          }
        },
      },
    ]);
  };

  const statusColor = (status: BudgetProgress['status']) => {
    if (status === 'exceeded') return colors.expense;
    if (status === 'warning') return colors.investment;
    return colors.income;
  };

  return (
    <Screen
      bottomInset
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        <View style={styles.footer}>
          <Button
            title="Atur anggaran"
            icon="add"
            size="lg"
            onPress={() => openCreateSheet(categories[0]?.id ?? null)}
          />
        </View>
      }
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Kembali"
        >
          <Ionicons name="arrow-back" size={20} color={colors.ink} />
        </Pressable>
        <Text style={styles.title}>Anggaran pribadi</Text>
      </View>

      <FadeIn>
        <View style={styles.monthBar}>
          <Pressable
            onPress={() => setPeriod((prev) => shiftMonth(prev.year, prev.month, -1))}
            disabled={false}
            hitSlop={8}
            style={styles.monthArrow}
            accessibilityRole="button"
            accessibilityLabel="Bulan sebelumnya"
          >
            <Ionicons name="chevron-back" size={18} color={colors.ink} />
          </Pressable>
          <Text style={styles.monthLabel}>
            {formatMonthYearIndo(period.year, period.month)}
          </Text>
          <Pressable
            onPress={() => setPeriod((prev) => shiftMonth(prev.year, prev.month, 1))}
            disabled={false}
            hitSlop={8}
            style={styles.monthArrow}
            accessibilityRole="button"
            accessibilityLabel="Bulan berikutnya"
          >
            <Ionicons name="chevron-forward" size={18} color={colors.ink} />
          </Pressable>
        </View>
      </FadeIn>

      {error ? <ErrorState message={error} onRetry={loadData} /> : null}

      {overview === null ? (
        <View style={styles.loadingBlock}>
          <SkeletonRows count={4} />
        </View>
      ) : (
        <>
          <Card style={styles.heroCard}>
            <View style={styles.heroTop}>
              <View style={styles.heroTitleCol}>
                <Text style={styles.heroEyebrow}>Total pengeluaran bulan ini</Text>
                <Text style={styles.heroFigure}>{formatRupiah(overview.total_expense)}</Text>
              </View>
              <Pressable
                onPress={() => openCreateSheet(null)}
                disabled={false}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={
                  overview.overall_budget
                    ? 'Edit batas total bulanan'
                    : 'Pasang batas total bulanan'
                }
                style={({ pressed }) => [styles.heroEditBtn, pressed && styles.pressed]}
              >
                <Text style={styles.heroEditText}>
                  {overview.overall_budget ? 'Ubah batas' : 'Pasang batas'}
                </Text>
              </Pressable>
            </View>

            {overview.overall_budget ? (
              <View style={styles.heroProgress}>
                <Progress
                  value={clampedBudgetPercent(overview.overall_budget.percentage)}
                  color={statusColor(overview.overall_budget.status)}
                />
                <View style={styles.progressLabels}>
                  <Text style={styles.progressCaption}>
                    {`Batas ${formatRupiah(overview.overall_budget.amount)} · ${Math.round(overview.overall_budget.percentage)}%`}
                  </Text>
                  <Text
                    style={[
                      styles.progressStatus,
                      { color: statusColor(overview.overall_budget.status) },
                    ]}
                  >
                    {overview.overall_budget.remaining >= 0
                      ? `Sisa ${formatRupiah(overview.overall_budget.remaining)}`
                      : `Lebih ${formatRupiah(Math.abs(overview.overall_budget.remaining))}`}
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={styles.heroHint}>
                Belum ada batas total pengeluaran bulanan. Ketuk “Pasang batas” untuk memantau
                pengeluaran keseluruhan.
              </Text>
            )}
          </Card>

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Anggaran per kategori</Text>
            {overview.allocated_category_total > 0 ? (
              <Text style={styles.sectionMeta}>
                {`Total alokasi ${formatRupiah(overview.allocated_category_total)}`}
              </Text>
            ) : null}
          </View>

          {overview.category_budgets.length === 0 ? (
            <EmptyState
              icon="pie-chart-outline"
              title="Belum ada anggaran kategori"
              message="Tetapkan batas bulanan untuk kategori seperti Makan & Minum atau Transportasi agar muncul peringatan sebelum boros."
              actionLabel="Atur anggaran kategori"
              onAction={() => openCreateSheet(categories[0]?.id ?? null)}
            />
          ) : (
            <View style={styles.stack}>
              {overview.category_budgets.map((item) => {
                const tone = statusColor(item.status);
                return (
                  <Card key={item.id} style={styles.budgetCard}>
                    <Pressable
                      onPress={() => openEditProgress(item)}
                      disabled={false}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit anggaran ${item.category_name || 'Kategori'}`}
                      style={({ pressed }) => [styles.budgetPress, pressed && styles.pressed]}
                    >
                      <View style={styles.budgetHead}>
                        <View style={styles.budgetNameCol}>
                          <Text style={styles.budgetName}>
                            {item.category_name || 'Kategori'}
                          </Text>
                          <Text style={styles.budgetMeta}>
                            {`${formatRupiah(item.spent)} / ${formatRupiah(item.amount)} · Peringatan ${item.alert_threshold}%`}
                          </Text>
                        </View>
                        <View style={[styles.statusBadge, { borderColor: tone }]}>
                          <Text style={[styles.statusText, { color: tone }]}>
                            {budgetStatusLabel(item.status)}
                          </Text>
                        </View>
                      </View>

                      <Progress
                        value={clampedBudgetPercent(item.percentage)}
                        color={tone}
                      />

                      <View style={styles.progressLabels}>
                        <Text style={styles.progressCaption}>
                          {`${Math.round(item.percentage)}% terpakai`}
                        </Text>
                        <Text style={[styles.progressStatus, { color: tone }]}>
                          {item.remaining >= 0
                            ? `Sisa ${formatRupiah(item.remaining)}`
                            : `Lebih ${formatRupiah(Math.abs(item.remaining))}`}
                        </Text>
                      </View>
                    </Pressable>
                  </Card>
                );
              })}
            </View>
          )}
        </>
      )}

      <Sheet
        visible={sheetOpen}
        onClose={closeSheet}
        title={editingId !== null ? 'Ubah anggaran' : 'Atur anggaran'}
        footer={
          <>
            <Button title="Simpan" loading={saving} onPress={handleSave} size="lg" />
            {editingId !== null ? (
              <Button
                title="Hapus anggaran"
                variant="danger"
                onPress={handleDelete}
                disabled={saving}
              />
            ) : null}
            <Button title="Batal" variant="ghost" onPress={closeSheet} disabled={saving} />
          </>
        }
      >
        <ScrollView
          style={styles.sheetScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {formError ? (
            <Text style={styles.formError} accessibilityLiveRegion="polite">
              {formError}
            </Text>
          ) : null}

          <Text style={styles.fieldLabel}>Target anggaran</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            keyboardShouldPersistTaps="handled"
          >
            <Chip
              label="Total bulanan"
              selected={selectedCategoryId === null}
              onPress={() => {
                setSelectedCategoryId(null);
                const existing = overview?.overall_budget;
                setEditingId(existing?.id ?? null);
                if (existing) {
                  setAmountInput(String(existing.amount));
                  setThreshold(existing.alert_threshold);
                }
              }}
            />
            {categories.map((cat) => (
              <Chip
                key={cat.id}
                label={cat.name}
                selected={selectedCategoryId === cat.id}
                onPress={() => {
                  setSelectedCategoryId(cat.id);
                  const existing = overview?.category_budgets.find(
                    (b) => b.category_id === cat.id
                  );
                  setEditingId(existing?.id ?? null);
                  if (existing) {
                    setAmountInput(String(existing.amount));
                    setThreshold(existing.alert_threshold);
                  }
                }}
              />
            ))}
          </ScrollView>

          <Input
            label="Batas bulanan"
            placeholder="1500000"
            value={amountInput}
            onChangeText={setAmountInput}
            keyboardType="numeric"
            leading="Rp"
            editable={!saving}
            accessibilityLabel="Nominal batas anggaran"
          />

          <Text style={styles.fieldLabel}>Peringatkan saat pemakaian mencapai</Text>
          <View style={styles.thresholdRow}>
            {THRESHOLD_OPTIONS.map((pct) => (
              <Chip
                key={pct}
                label={`${pct}%`}
                selected={threshold === pct}
                onPress={() => setThreshold(pct)}
              />
            ))}
          </View>
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

const useStyles = createThemedStyles(({ colors, type }) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      marginBottom: Space.md,
    },
    back: {
      width: 44,
      height: 44,
      alignItems: 'flex-start',
      justifyContent: 'center',
      marginLeft: -Space.sm,
    },
    title: {
      ...type.h2,
    },
    monthBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderRadius: Radius.block,
      borderWidth: 1,
      borderColor: colors.line,
      paddingHorizontal: Space.sm,
      minHeight: 46,
      marginBottom: Space.lg,
    },
    monthArrow: {
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
    },
    monthLabel: {
      ...type.bodyStrong,
    },
    loadingBlock: {
      paddingTop: Space.lg,
    },
    heroCard: {
      marginBottom: Space.xl,
      gap: Space.md,
    },
    heroTop: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    heroTitleCol: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    heroEyebrow: {
      ...type.micro,
      textTransform: 'uppercase',
    },
    heroFigure: {
      fontFamily: Fonts.serif,
      fontSize: 28,
      lineHeight: 34,
      color: colors.ink,
    },
    heroEditBtn: {
      minHeight: 36,
      paddingHorizontal: Space.md,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroEditText: {
      fontFamily: Fonts.medium,
      fontSize: 12,
      lineHeight: 16,
      color: colors.ink,
    },
    heroProgress: {
      gap: Space.xs,
    },
    heroHint: {
      ...type.caption,
      color: colors.inkSoft,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: Space.sm,
      marginBottom: Space.md,
    },
    sectionTitle: {
      ...type.title,
    },
    sectionMeta: {
      ...type.caption,
      fontVariant: ['tabular-nums'],
    },
    stack: {
      gap: Space.md,
    },
    budgetCard: {
      padding: Space.lg,
    },
    budgetPress: {
      gap: Space.sm,
    },
    pressed: {
      opacity: 0.75,
    },
    budgetHead: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    budgetNameCol: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    budgetName: {
      ...type.bodyStrong,
    },
    budgetMeta: {
      ...type.caption,
      fontVariant: ['tabular-nums'],
    },
    statusBadge: {
      borderWidth: 1,
      borderRadius: Radius.pill,
      paddingHorizontal: Space.sm,
      paddingVertical: 3,
      flexShrink: 0,
    },
    statusText: {
      fontFamily: Fonts.semibold,
      fontSize: 11,
      lineHeight: 14,
    },
    progressLabels: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    progressCaption: {
      ...type.caption,
      fontVariant: ['tabular-nums'],
    },
    progressStatus: {
      fontFamily: Fonts.semibold,
      fontSize: 12,
      lineHeight: 16,
      fontVariant: ['tabular-nums'],
    },
    footer: {
      paddingHorizontal: Space.gutter,
      paddingTop: Space.md,
      paddingBottom: Space.md,
      borderTopWidth: 1,
      borderTopColor: colors.line,
      backgroundColor: colors.paper,
    },
    sheetScroll: {
      flexGrow: 0,
      flexShrink: 1,
    },
    formError: {
      ...type.caption,
      color: colors.danger,
      marginBottom: Space.md,
    },
    fieldLabel: {
      fontFamily: Fonts.medium,
      fontSize: 12,
      lineHeight: 16,
      color: colors.inkSoft,
      marginBottom: Space.xs,
    },
    chips: {
      flexDirection: 'row',
      gap: Space.sm,
      paddingBottom: Space.md,
    },
    thresholdRow: {
      flexDirection: 'row',
      gap: Space.sm,
      paddingBottom: Space.sm,
    },
  })
);

import { AppAlert as Alert } from '../services/appAlert';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { ShoppingListSummary } from '../types';
import { shoppingListApi } from '../services/shoppingLists';
import { describeApiError } from '../services/auth';
import { formatRupiah } from '../utils/formatRupiah';
import {
  computeBudgetProgress,
  defaultMonthlyListTitle,
  parseOptionalAmountInput,
} from '../utils/shoppingLists';
import { Screen } from '../components/ui/Screen';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Progress } from '../components/ui/Progress';
import { Sheet } from '../components/ui/Sheet';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { SkeletonRows } from '../components/ui/Skeleton';
import { FadeIn } from '../components/ui/FadeIn';

export default function ShoppingListsScreen() {
  const [lists, setLists] = useState<ShoppingListSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [budgetInput, setBudgetInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);

  const busyRef = useRef(false);
  const theme = useTheme();
  const { colors } = theme;
  const styles = useStyles(theme);

  const loadData = useCallback(async () => {
    try {
      const data = await shoppingListApi.list();
      setLists(data);
      setError(null);
    } catch (err) {
      setError(describeApiError(err, 'Gagal memuat daftar belanja.'));
    }
  }, []);

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

  const openCreateSheet = () => {
    if (busyRef.current) return;
    setTitle(defaultMonthlyListTitle());
    setBudgetInput('');
    setNotesInput('');
    setFormError(null);
    setCreateOpen(true);
  };

  const closeCreateSheet = () => {
    if (saving) return;
    setCreateOpen(false);
    setFormError(null);
  };

  const handleCreate = async () => {
    if (busyRef.current || saving) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError('Judul daftar belanja harus diisi.');
      return;
    }
    const parsedBudget = parseOptionalAmountInput(budgetInput);
    if (budgetInput.trim() && (parsedBudget === null || parsedBudget <= 0)) {
      setFormError('Target budget harus lebih dari 0.');
      return;
    }

    busyRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      const created = await shoppingListApi.create({
        title: trimmedTitle,
        budget_amount: parsedBudget,
        notes: notesInput.trim() || null,
      });
      setCreateOpen(false);
      await loadData();
      router.push(`/shopping-list/${created.id}`);
    } catch (err) {
      setFormError(describeApiError(err, 'Gagal membuat daftar belanja.'));
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  const handleDuplicate = async (item: ShoppingListSummary) => {
    if (busyRef.current || duplicatingId !== null) return;
    busyRef.current = true;
    setDuplicatingId(item.id);
    try {
      const cloned = await shoppingListApi.duplicate(item.id);
      await loadData();
      router.push(`/shopping-list/${cloned.id}`);
    } catch (err) {
      Alert.alert('Gagal menyalin', describeApiError(err, 'Coba lagi sebentar lagi.'));
    } finally {
      busyRef.current = false;
      setDuplicatingId(null);
    }
  };

  return (
    <Screen
      bottomInset
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        <View style={styles.footer}>
          <Button
            title="Buat daftar belanja"
            icon="add"
            size="lg"
            onPress={openCreateSheet}
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
        <Text style={styles.title}>Daftar belanja</Text>
      </View>

      <FadeIn>
        <Text style={styles.intro}>
          Rencanakan belanja bulanan berdasarkan kategori kebutuhan, ceklis saat belanja, dan
          catat langsung ke pengeluaran tanpa mengetik ulang.
        </Text>
      </FadeIn>

      {error ? <ErrorState message={error} onRetry={loadData} /> : null}

      {lists === null ? (
        <View style={styles.loadingBlock}>
          <SkeletonRows count={4} />
        </View>
      ) : lists.length === 0 ? (
        <EmptyState
          icon="cart-outline"
          title="Belum ada daftar belanja"
          message="Buat daftar belanja bulanan pertama lengkap dengan target budget dan catatan stok."
          actionLabel="Buat daftar belanja"
          onAction={openCreateSheet}
        />
      ) : (
        <View style={styles.listStack}>
          {lists.map((item) => {
            const budget = computeBudgetProgress(item.planned_total, item.budget_amount);
            const isDuplicating = duplicatingId === item.id;
            return (
              <Card key={item.id} style={styles.card}>
                <Pressable
                  onPress={() => router.push(`/shopping-list/${item.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Buka ${item.title}`}
                  style={({ pressed }) => [styles.cardPress, pressed && styles.pressed]}
                >
                  <View style={styles.cardTop}>
                    <View style={styles.cardMain}>
                      <Text style={styles.cardTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <Text style={styles.cardMeta}>
                        {`${item.checked_count}/${item.item_count} item dibeli`}
                        {item.recorded_total > 0
                          ? ` · Tercatat ${formatRupiah(item.recorded_total)}`
                          : ''}
                      </Text>
                    </View>
                    <Text style={styles.cardTotal}>{formatRupiah(item.planned_total)}</Text>
                  </View>

                  {budget.hasBudget && item.budget_amount ? (
                    <View style={styles.budgetBox}>
                      <Progress
                        value={budget.percent}
                        color={budget.overBudget ? colors.expense : colors.income}
                      />
                      <View style={styles.budgetLabels}>
                        <Text style={styles.budgetCaption}>
                          Budget {formatRupiah(item.budget_amount)}
                        </Text>
                        <Text
                          style={[
                            styles.budgetStatus,
                            { color: budget.overBudget ? colors.expense : colors.income },
                          ]}
                        >
                          {budget.overBudget
                            ? `Lebih ${formatRupiah(budget.difference)}`
                            : `Sisa ${formatRupiah(budget.difference)}`}
                        </Text>
                      </View>
                    </View>
                  ) : null}

                  {item.notes ? (
                    <Text style={styles.cardNotes} numberOfLines={2}>
                      {item.notes}
                    </Text>
                  ) : null}
                </Pressable>

                <View style={styles.cardActions}>
                  <Pressable
                    onPress={() => void handleDuplicate(item)}
                    disabled={duplicatingId !== null}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`Salin ${item.title}`}
                    accessibilityState={{ disabled: duplicatingId !== null, busy: isDuplicating }}
                    style={({ pressed }) => [styles.copyAction, pressed && styles.pressed]}
                  >
                    {isDuplicating ? (
                      <ActivityIndicator size="small" color={colors.inkSoft} />
                    ) : (
                      <Ionicons name="copy-outline" size={15} color={colors.inkSoft} />
                    )}
                    <Text style={styles.copyActionText}>Salin daftar</Text>
                  </Pressable>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      <Sheet
        visible={createOpen}
        onClose={closeCreateSheet}
        title="Daftar belanja baru"
        footer={
          <>
            <Button title="Buat daftar" loading={saving} onPress={handleCreate} size="lg" />
            <Button title="Batal" variant="ghost" onPress={closeCreateSheet} disabled={saving} />
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

          <Input
            label="Judul"
            placeholder="List Belanja Bulanan"
            value={title}
            onChangeText={setTitle}
            maxLength={100}
            editable={!saving}
            accessibilityLabel="Judul daftar belanja"
          />
          <Input
            label="Target budget (opsional)"
            placeholder="500000"
            value={budgetInput}
            onChangeText={setBudgetInput}
            keyboardType="numeric"
            leading="Rp"
            editable={!saving}
            hint="Kosongkan jika tidak memakai batas budget."
            accessibilityLabel="Target budget"
          />
          <Input
            label="Catatan stok / pengingat (opsional)"
            placeholder="Misalnya: Masih ada deodorant & tisu. Budget di luar beras."
            value={notesInput}
            onChangeText={setNotesInput}
            multiline
            maxLength={1000}
            editable={!saving}
            accessibilityLabel="Catatan daftar belanja"
          />
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => StyleSheet.create({
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
  intro: {
    ...type.caption,
    marginBottom: Space.lg,
  },
  loadingBlock: {
    paddingTop: Space.lg,
  },
  listStack: {
    gap: Space.md,
  },
  card: {
    padding: Space.lg,
    gap: Space.md,
  },
  cardPress: {
    gap: Space.md,
  },
  pressed: {
    opacity: 0.75,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  cardTitle: {
    ...type.title,
  },
  cardMeta: {
    ...type.caption,
  },
  cardTotal: {
    ...type.amountLarge,
    fontVariant: ['tabular-nums'],
  },
  budgetBox: {
    gap: Space.xs,
  },
  budgetLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  budgetCaption: {
    ...type.micro,
  },
  budgetStatus: {
    fontFamily: Fonts.medium,
    fontSize: 11,
    lineHeight: 15,
    fontVariant: ['tabular-nums'],
  },
  cardNotes: {
    ...type.caption,
    color: colors.inkSoft,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: Space.sm,
  },
  copyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.control,
  },
  copyActionText: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.inkSoft,
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
}));

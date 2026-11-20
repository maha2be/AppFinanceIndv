import { AppAlert as Alert } from '../../services/appAlert';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Radius, Space } from '../../utils/theme';
import { createThemedStyles, useTheme } from '../../services/theme';
import { ShoppingListDetail, ShoppingListItem } from '../../types';
import { shoppingListApi } from '../../services/shoppingLists';
import { describeApiError } from '../../services/auth';
import { formatRupiah } from '../../utils/formatRupiah';
import { localTodayIso } from '../../utils/date';
import {
  computeBudgetProgress,
  DEFAULT_SHOPPING_GROUPS,
  groupShoppingItems,
  parseOptionalAmountInput,
} from '../../utils/shoppingLists';
import { Screen } from '../../components/ui/Screen';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Input } from '../../components/ui/Input';
import { Progress } from '../../components/ui/Progress';
import { Sheet } from '../../components/ui/Sheet';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { FadeIn } from '../../components/ui/FadeIn';

export default function ShoppingListDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const listId = Number.parseInt(String(rawId ?? ''), 10);
  const validId = Number.isSafeInteger(listId) && listId > 0;

  const [detail, setDetail] = useState<ShoppingListDetail | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  // Item add/edit sheet state
  const [itemSheetOpen, setItemSheetOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ShoppingListItem | null>(null);
  const [itemGroup, setItemGroup] = useState('Kebutuhan Dapur');
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemError, setItemError] = useState<string | null>(null);
  const [itemSaving, setItemSaving] = useState(false);

  // List metadata edit sheet state
  const [metaSheetOpen, setMetaSheetOpen] = useState(false);
  const [metaTitle, setMetaTitle] = useState('');
  const [metaBudget, setMetaBudget] = useState('');
  const [metaNotes, setMetaNotes] = useState('');
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaSaving, setMetaSaving] = useState(false);

  const actionBusyRef = useRef(false);
  const theme = useTheme();
  const { colors } = theme;
  const styles = useStyles(theme);

  const loadDetail = useCallback(async () => {
    if (!validId) {
      setError('Daftar belanja tidak valid.');
      return;
    }
    try {
      const next = await shoppingListApi.get(listId);
      setDetail(next);
      setError(null);
    } catch (err) {
      setError(describeApiError(err, 'Gagal memuat detail daftar belanja.'));
    }
  }, [listId, validId]);

  useFocusEffect(
    useCallback(() => {
      void loadDetail();
    }, [loadDetail])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDetail();
    setRefreshing(false);
  };

  const handleToggleItem = async (item: ShoppingListItem) => {
    if (togglingId !== null || recording || itemSaving || metaSaving) return;
    setTogglingId(item.id);
    try {
      await shoppingListApi.updateItem(listId, item.id, {
        is_checked: !item.is_checked,
      });
      await loadDetail();
    } catch (err) {
      Alert.alert('Gagal mengubah item', describeApiError(err, 'Coba lagi.'));
    } finally {
      setTogglingId(null);
    }
  };

  const openAddItem = (presetGroup?: string) => {
    if (actionBusyRef.current) return;
    const existingGroups = detail ? groupShoppingItems(detail.items).map((g) => g.groupName) : [];
    setEditingItem(null);
    setItemGroup(presetGroup ?? existingGroups[0] ?? DEFAULT_SHOPPING_GROUPS[0]);
    setItemName('');
    setItemPrice('');
    setItemError(null);
    setItemSheetOpen(true);
  };

  const openEditItem = (item: ShoppingListItem) => {
    if (actionBusyRef.current) return;
    setEditingItem(item);
    setItemGroup(item.group_name);
    setItemName(item.name);
    setItemPrice(item.price != null ? String(item.price) : '');
    setItemError(null);
    setItemSheetOpen(true);
  };

  const closeItemSheet = () => {
    if (itemSaving) return;
    setItemSheetOpen(false);
    setItemError(null);
  };

  const handleSaveItem = async () => {
    if (actionBusyRef.current || itemSaving) return;
    const cleanedName = itemName.trim();
    if (!cleanedName) {
      setItemError('Nama item tidak boleh kosong.');
      return;
    }
    const cleanedGroup = itemGroup.trim() || 'Umum';
    const parsedPrice = parseOptionalAmountInput(itemPrice);

    actionBusyRef.current = true;
    setItemSaving(true);
    setItemError(null);
    try {
      if (editingItem) {
        await shoppingListApi.updateItem(listId, editingItem.id, {
          group_name: cleanedGroup,
          name: cleanedName,
          price: parsedPrice,
        });
      } else {
        await shoppingListApi.addItem(listId, {
          group_name: cleanedGroup,
          name: cleanedName,
          price: parsedPrice,
        });
      }
      setItemSheetOpen(false);
      await loadDetail();
    } catch (err) {
      setItemError(describeApiError(err, 'Gagal menyimpan item belanja.'));
    } finally {
      actionBusyRef.current = false;
      setItemSaving(false);
    }
  };

  const handleDeleteItem = () => {
    if (!editingItem || itemSaving) return;
    const target = editingItem;
    Alert.alert('Hapus item', `Hapus "${target.name}" dari daftar belanja?`, [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: async () => {
          if (actionBusyRef.current) return;
          actionBusyRef.current = true;
          setItemSaving(true);
          try {
            await shoppingListApi.removeItem(listId, target.id);
            setItemSheetOpen(false);
            await loadDetail();
          } catch (err) {
            Alert.alert('Gagal menghapus', describeApiError(err, 'Coba lagi.'));
          } finally {
            actionBusyRef.current = false;
            setItemSaving(false);
          }
        },
      },
    ]);
  };

  const openMetaSheet = () => {
    if (!detail || actionBusyRef.current) return;
    setMetaTitle(detail.title);
    setMetaBudget(detail.budget_amount != null ? String(detail.budget_amount) : '');
    setMetaNotes(detail.notes ?? '');
    setMetaError(null);
    setMetaSheetOpen(true);
  };

  const closeMetaSheet = () => {
    if (metaSaving) return;
    setMetaSheetOpen(false);
    setMetaError(null);
  };

  const handleSaveMeta = async () => {
    if (actionBusyRef.current || metaSaving) return;
    const trimmedTitle = metaTitle.trim();
    if (!trimmedTitle) {
      setMetaError('Judul daftar belanja harus diisi.');
      return;
    }
    const parsedBudget = parseOptionalAmountInput(metaBudget);
    if (metaBudget.trim() && (parsedBudget === null || parsedBudget <= 0)) {
      setMetaError('Target budget harus lebih dari 0.');
      return;
    }

    actionBusyRef.current = true;
    setMetaSaving(true);
    setMetaError(null);
    try {
      const updated = await shoppingListApi.update(listId, {
        title: trimmedTitle,
        budget_amount: parsedBudget,
        notes: metaNotes.trim() || null,
      });
      setDetail(updated);
      setMetaSheetOpen(false);
    } catch (err) {
      setMetaError(describeApiError(err, 'Gagal menyimpan perubahan daftar.'));
    } finally {
      actionBusyRef.current = false;
      setMetaSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!detail || actionBusyRef.current || duplicating) return;
    actionBusyRef.current = true;
    setDuplicating(true);
    try {
      const cloned = await shoppingListApi.duplicate(detail.id);
      router.replace(`/shopping-list/${cloned.id}`);
    } catch (err) {
      Alert.alert('Gagal menyalin', describeApiError(err, 'Coba lagi sebentar lagi.'));
    } finally {
      actionBusyRef.current = false;
      setDuplicating(false);
    }
  };

  const handleDeleteList = () => {
    if (!detail || actionBusyRef.current) return;
    Alert.alert(
      'Hapus daftar belanja',
      `Hapus "${detail.title}"? Transaksi pengeluaran yang sudah tercatat tetap aman.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: async () => {
            if (actionBusyRef.current) return;
            actionBusyRef.current = true;
            try {
              await shoppingListApi.remove(detail.id);
              router.back();
            } catch (err) {
              Alert.alert('Gagal menghapus', describeApiError(err, 'Coba lagi.'));
            } finally {
              actionBusyRef.current = false;
            }
          },
        },
      ]
    );
  };

  const handleRecordExpense = () => {
    if (!detail || detail.unrecorded_checked_total <= 0 || actionBusyRef.current || recording) {
      return;
    }
    const amountText = formatRupiah(detail.unrecorded_checked_total);
    Alert.alert(
      'Catat ke pengeluaran',
      `Catat ${amountText} dari item yang sudah dicentang sebagai transaksi kategori Belanja?`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Catat sekarang',
          onPress: async () => {
            if (actionBusyRef.current || recording) return;
            actionBusyRef.current = true;
            setRecording(true);
            try {
              const res = await shoppingListApi.recordExpense(detail.id, localTodayIso());
              setDetail(res.shopping_list);
              Alert.alert(
                'Tercatat ke pengeluaran',
                `Transaksi Belanja sebesar ${formatRupiah(res.transaction.amount)} berhasil disimpan.`
              );
            } catch (err) {
              Alert.alert('Gagal mencatat', describeApiError(err, 'Coba lagi sebentar lagi.'));
            } finally {
              actionBusyRef.current = false;
              setRecording(false);
            }
          },
        },
      ]
    );
  };

  const groups = detail ? groupShoppingItems(detail.items) : [];
  const budget = detail
    ? computeBudgetProgress(detail.planned_total, detail.budget_amount)
    : computeBudgetProgress(0, null);
  const groupSuggestions = Array.from(
    new Set([
      ...groups.map((g) => g.groupName),
      ...DEFAULT_SHOPPING_GROUPS,
    ])
  );

  return (
    <Screen
      bottomInset
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        detail ? (
          <View style={styles.footer}>
            {detail.unrecorded_checked_total > 0 ? (
              <Button
                title={`Catat ke pengeluaran (${formatRupiah(detail.unrecorded_checked_total)})`}
                icon="checkmark-done-outline"
                loading={recording}
                onPress={handleRecordExpense}
                size="lg"
              />
            ) : null}
            <Button
              title="Tambah item"
              variant={detail.unrecorded_checked_total > 0 ? 'secondary' : 'primary'}
              icon="add"
              onPress={() => openAddItem()}
              disabled={recording}
            />
          </View>
        ) : undefined
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
        <Text style={styles.title} numberOfLines={2}>
          {detail?.title || 'Daftar belanja'}
        </Text>
        {detail ? (
          <View style={styles.headerActions}>
            <Pressable
              onPress={openMetaSheet}
              hitSlop={8}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel="Edit info daftar"
            >
              <Ionicons name="create-outline" size={19} color={colors.inkSoft} />
            </Pressable>
            <Pressable
              onPress={handleDuplicate}
              disabled={duplicating}
              hitSlop={8}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel="Salin daftar"
              accessibilityState={{ busy: duplicating }}
            >
              {duplicating ? (
                <ActivityIndicator size="small" color={colors.inkSoft} />
              ) : (
                <Ionicons name="copy-outline" size={18} color={colors.inkSoft} />
              )}
            </Pressable>
            <Pressable
              onPress={handleDeleteList}
              hitSlop={8}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel="Hapus daftar"
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {error ? <ErrorState message={error} onRetry={loadDetail} /> : null}

      {detail === null && !error ? (
        <View style={styles.loadingBlock}>
          <SkeletonRows count={5} />
        </View>
      ) : detail ? (
        <>
          <FadeIn>
            <Card style={styles.summaryCard}>
              <View style={styles.summaryTop}>
                <View style={styles.summaryCol}>
                  <Text style={styles.summaryLabel}>Total rencana</Text>
                  <Text style={styles.summaryFigure}>{formatRupiah(detail.planned_total)}</Text>
                </View>
                <View style={styles.summaryColRight}>
                  <Text style={styles.summaryLabel}>Sudah dibeli</Text>
                  <Text style={styles.summaryChecked}>{formatRupiah(detail.checked_total)}</Text>
                </View>
              </View>

              {budget.hasBudget && detail.budget_amount ? (
                <View style={styles.budgetSection}>
                  <Progress
                    value={budget.percent}
                    color={budget.overBudget ? colors.expense : colors.income}
                  />
                  <View style={styles.budgetLabels}>
                    <Text style={styles.budgetCaption}>
                      Target budget {formatRupiah(detail.budget_amount)}
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

              {detail.recorded_total > 0 ? (
                <View style={styles.recordedBanner}>
                  <Ionicons name="checkmark-circle-outline" size={15} color={colors.income} />
                  <Text style={styles.recordedText}>
                    Sudah masuk transaksi Belanja: {formatRupiah(detail.recorded_total)}
                  </Text>
                </View>
              ) : null}
            </Card>
          </FadeIn>

          {groups.length === 0 ? (
            <EmptyState
              icon="list-outline"
              title="Belum ada item belanja"
              message="Tambahkan item seperti Beras 10 kg, Detergen, atau Sabun muka sesuai kategori kebutuhan."
              actionLabel="Tambah item pertama"
              onAction={() => openAddItem()}
            />
          ) : (
            groups.map((group) => (
              <View key={group.groupName} style={styles.groupSection}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupTitle}>{group.groupName}</Text>
                  <Text style={styles.groupSubtotal}>{formatRupiah(group.subtotal)}</Text>
                </View>
                <Card style={styles.groupCard} padded={false}>
                  {group.items.map((item, idx) => {
                    const isLast = idx === group.items.length - 1;
                    const busy = togglingId === item.id;
                    return (
                      <View
                        key={item.id}
                        style={[styles.itemRow, isLast && styles.lastRow]}
                      >
                        <Pressable
                          onPress={() => void handleToggleItem(item)}
                          disabled={busy}
                          style={styles.checkHit}
                          accessibilityRole="checkbox"
                          accessibilityLabel={`Centang ${item.name}`}
                          accessibilityState={{ checked: item.is_checked, busy }}
                        >
                          <View style={[styles.checkBox, item.is_checked && styles.checkBoxChecked]}>
                            {busy ? (
                              <ActivityIndicator
                                size="small"
                                color={item.is_checked ? colors.onInk : colors.inkMuted}
                              />
                            ) : item.is_checked ? (
                              <Ionicons name="checkmark" size={14} color={colors.onInk} />
                            ) : null}
                          </View>
                        </Pressable>

                        <Pressable
                          onPress={() => openEditItem(item)}
                          style={styles.itemBody}
                          accessibilityRole="button"
                          accessibilityLabel={`Edit ${item.name}`}
                        >
                          <View style={styles.itemNameCol}>
                            <Text
                              style={[
                                styles.itemName,
                                item.is_checked && styles.itemNameChecked,
                              ]}
                              numberOfLines={2}
                            >
                              {item.name}
                            </Text>
                            {item.transaction_id !== null && item.transaction_id !== undefined ? (
                              <Text style={styles.itemBadge}>Tercatat</Text>
                            ) : null}
                          </View>
                          <Text
                            style={[
                              styles.itemPrice,
                              item.price == null && styles.itemPriceMuted,
                            ]}
                          >
                            {item.price != null ? formatRupiah(item.price) : 'Rp -'}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </Card>
              </View>
            ))
          )}

          <Card variant="inset" style={styles.notesCard}>
            <View style={styles.notesHeader}>
              <Text style={styles.notesTitle}>Catatan</Text>
              <Pressable
                onPress={openMetaSheet}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Ubah catatan"
              >
                <Text style={styles.notesEdit}>Ubah</Text>
              </Pressable>
            </View>
            <Text style={styles.notesBody}>
              {detail.notes || 'Belum ada catatan stok atau budget.'}
            </Text>
          </Card>
        </>
      ) : null}

      {/* Add / Edit Item Sheet */}
      <Sheet
        visible={itemSheetOpen}
        onClose={closeItemSheet}
        title={editingItem ? 'Edit item' : 'Tambah item'}
        footer={
          <>
            <Button title="Simpan" loading={itemSaving} onPress={handleSaveItem} size="lg" />
            {editingItem ? (
              <Button
                title="Hapus item"
                variant="danger"
                onPress={handleDeleteItem}
                disabled={itemSaving}
              />
            ) : null}
            <Button title="Batal" variant="ghost" onPress={closeItemSheet} disabled={itemSaving} />
          </>
        }
      >
        <ScrollView
          style={styles.sheetScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {itemError ? (
            <Text style={styles.formError} accessibilityLiveRegion="polite">
              {itemError}
            </Text>
          ) : null}

          <Text style={styles.chipLabel}>Grup kebutuhan</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            keyboardShouldPersistTaps="handled"
          >
            {groupSuggestions.map((g) => (
              <Chip
                key={g}
                label={g}
                selected={itemGroup.trim() === g}
                onPress={() => setItemGroup(g)}
              />
            ))}
          </ScrollView>

          <Input
            label="Nama grup"
            placeholder="Misalnya: Kebutuhan Dapur"
            value={itemGroup}
            onChangeText={setItemGroup}
            maxLength={60}
            editable={!itemSaving}
            accessibilityLabel="Nama grup item"
          />
          <Input
            label="Nama item & takaran"
            placeholder="Misalnya: Beras 10 kg"
            value={itemName}
            onChangeText={setItemName}
            maxLength={120}
            editable={!itemSaving}
            accessibilityLabel="Nama item belanja"
          />
          <Input
            label="Harga perkiraan / aktual (opsional)"
            placeholder="Kosongkan jika belum ada harga"
            value={itemPrice}
            onChangeText={setItemPrice}
            keyboardType="numeric"
            leading="Rp"
            editable={!itemSaving}
            accessibilityLabel="Harga item belanja"
          />
        </ScrollView>
      </Sheet>

      {/* Edit List Metadata Sheet */}
      <Sheet
        visible={metaSheetOpen}
        onClose={closeMetaSheet}
        title="Edit daftar belanja"
        footer={
          <>
            <Button title="Simpan" loading={metaSaving} onPress={handleSaveMeta} size="lg" />
            <Button title="Batal" variant="ghost" onPress={closeMetaSheet} disabled={metaSaving} />
          </>
        }
      >
        <ScrollView
          style={styles.sheetScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {metaError ? (
            <Text style={styles.formError} accessibilityLiveRegion="polite">
              {metaError}
            </Text>
          ) : null}

          <Input
            label="Judul"
            value={metaTitle}
            onChangeText={setMetaTitle}
            maxLength={100}
            editable={!metaSaving}
            accessibilityLabel="Edit judul daftar"
          />
          <Input
            label="Target budget (opsional)"
            placeholder="500000"
            value={metaBudget}
            onChangeText={setMetaBudget}
            keyboardType="numeric"
            leading="Rp"
            editable={!metaSaving}
            accessibilityLabel="Edit target budget"
          />
          <Input
            label="Catatan stok / pengingat"
            placeholder="Masih ada: deodorant, tisu..."
            value={metaNotes}
            onChangeText={setMetaNotes}
            multiline
            maxLength={1000}
            editable={!metaSaving}
            accessibilityLabel="Edit catatan daftar"
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
    flex: 1,
    minWidth: 0,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBtn: {
    width: 38,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingBlock: {
    paddingTop: Space.lg,
  },
  summaryCard: {
    marginBottom: Space.xl,
    gap: Space.md,
  },
  summaryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  summaryCol: {
    flex: 1,
    gap: 2,
  },
  summaryColRight: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  summaryLabel: {
    ...type.micro,
    textTransform: 'uppercase',
  },
  summaryFigure: {
    fontFamily: Fonts.serif,
    fontSize: 28,
    lineHeight: 32,
    color: colors.ink,
  },
  summaryChecked: {
    fontFamily: Fonts.semibold,
    fontSize: 18,
    lineHeight: 24,
    color: colors.income,
    fontVariant: ['tabular-nums'],
  },
  budgetSection: {
    gap: Space.xs,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: Space.sm,
  },
  budgetLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  budgetCaption: {
    ...type.caption,
  },
  budgetStatus: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  recordedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.incomeTint,
    paddingVertical: Space.xs,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.control,
  },
  recordedText: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.income,
    flex: 1,
  },
  groupSection: {
    marginBottom: Space.lg,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Space.xs,
  },
  groupTitle: {
    ...type.caption,
    fontFamily: Fonts.semibold,
    color: colors.ink,
  },
  groupSubtotal: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.inkSoft,
    fontVariant: ['tabular-nums'],
  },
  groupCard: {
    overflow: 'hidden',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  checkHit: {
    width: 48,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: Radius.control - 2,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxChecked: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  itemBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    paddingRight: Space.md,
    paddingVertical: Space.sm,
  },
  itemNameCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  itemName: {
    ...type.body,
  },
  itemNameChecked: {
    color: colors.inkMuted,
    textDecorationLine: 'line-through',
  },
  itemBadge: {
    fontFamily: Fonts.medium,
    fontSize: 10,
    lineHeight: 14,
    color: colors.income,
  },
  itemPrice: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    lineHeight: 18,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  itemPriceMuted: {
    color: colors.inkMuted,
    fontFamily: Fonts.regular,
  },
  notesCard: {
    marginTop: Space.sm,
    marginBottom: Space.md,
    gap: Space.xs,
  },
  notesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notesTitle: {
    ...type.caption,
    fontFamily: Fonts.semibold,
    color: colors.ink,
  },
  notesEdit: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.inkSoft,
    textDecorationLine: 'underline',
  },
  notesBody: {
    ...type.body,
    color: colors.inkSoft,
  },
  footer: {
    paddingHorizontal: Space.gutter,
    paddingTop: Space.md,
    paddingBottom: Space.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
    gap: Space.sm,
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
  chipLabel: {
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
}));

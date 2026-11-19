import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as RN from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as ExpoRouter from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  Category,
  Transaction,
  TransactionBrowserFilters,
  TransactionSort,
} from '../types';
import { Colors, Fonts, Radius, Space, Type } from '../utils/theme';
import {
  SORT_OPTIONS,
  buildTransactionPageQuery,
  describeResultRange,
  hasActiveFilters,
} from '../utils/transactionBrowser';
import { formatDateIndo, formatRupiah } from '../utils/formatRupiah';
import { isValidIsoDate, transactionTypeLabel } from '../utils/transactions';
import { transactionApi } from '../services/transactions';
import { categoryApi } from '../services/categories';
import { describeApiError } from '../services/auth';
import { Screen } from '../components/ui/Screen';
import { Sheet } from '../components/ui/Sheet';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { SkeletonRows } from '../components/ui/Skeleton';
import { TransactionCard } from '../components/TransactionCard';
import { TransactionPagination } from '../components/transactions/TransactionPagination';
import { TransactionFilters } from '../components/transactions/TransactionFilters';

const TextInput = (RN.TextInput ?? 'TextInput') as typeof RN.TextInput;
const RefreshControl = (RN.RefreshControl ?? 'RefreshControl') as typeof RN.RefreshControl;
const FlatList = (RN.FlatList ?? 'FlatList') as typeof RN.FlatList;

const SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 20;




function formatNumberIndo(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Math.max(0, Math.round(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function extractValidIsoDate(raw: unknown): string | undefined {
  const single = Array.isArray(raw) ? raw[0] : raw;
  if (typeof single !== 'string') return undefined;
  const trimmed = single.trim();
  return isValidIsoDate(trimmed) ? trimmed : undefined;
}

function resolveIncomingDateFilters(
  startRaw: unknown,
  endRaw: unknown
): TransactionBrowserFilters {
  const startDate = extractValidIsoDate(startRaw);
  const endDate = extractValidIsoDate(endRaw);
  if (startDate && endDate && startDate > endDate) {
    return {};
  }
  const initial: TransactionBrowserFilters = {};
  if (startDate) initial.start_date = startDate;
  if (endDate) initial.end_date = endDate;
  return initial;
}

function serializeQuerySignature(
  filters: TransactionBrowserFilters,
  sort: TransactionSort,
  page: number
): string {
  return JSON.stringify({
    q: filters.q ?? '',
    start_date: filters.start_date ?? '',
    end_date: filters.end_date ?? '',
    type: filters.type ?? '',
    category_id: filters.category_id ?? null,
    min_amount: filters.min_amount ?? null,
    max_amount: filters.max_amount ?? null,
    sort,
    page,
  });
}

export interface TransactionsScreenProps {
  start_date?: string;
  end_date?: string;
}

export default function TransactionsScreen(props: TransactionsScreenProps = {}) {
  const routeParams =
    typeof ExpoRouter.useLocalSearchParams === 'function'
      ? ExpoRouter.useLocalSearchParams<{
          start_date?: string | string[];
          end_date?: string | string[];
        }>()
      : {};

  const rawStartDate = routeParams?.start_date ?? props?.start_date;
  const rawEndDate = routeParams?.end_date ?? props?.end_date;
  const incomingFilters = resolveIncomingDateFilters(rawStartDate, rawEndDate);
  const incomingScopeKey = `${incomingFilters.start_date ?? ''}|${incomingFilters.end_date ?? ''}`;

  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<TransactionBrowserFilters>(() => incomingFilters);
  const [sort, setSort] = useState<TransactionSort>('date_desc');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalPages, setTotalPages] = useState(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const focusedRef = useRef(true);
  const requestGenRef = useRef(0);
  const categoryGenRef = useRef(0);
  const loadingRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchTextRef = useRef('');
  const filtersRef = useRef<TransactionBrowserFilters>(incomingFilters);
  const sortRef = useRef<TransactionSort>('date_desc');
  const pageRef = useRef(1);
  const lastDispatchedSignatureRef = useRef<string>('');
  const lastScopeKeyRef = useRef(incomingScopeKey);
  const listRef = useRef<{ scrollToOffset?: (params: { offset: number; animated?: boolean }) => void } | null>(null);

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      focusedRef.current = false;
      requestGenRef.current += 1;
      categoryGenRef.current += 1;
      loadingRef.current = false;
      clearDebounce();
    };
  }, [clearDebounce]);

  const loadCategories = useCallback(async () => {
    if (typeof categoryApi?.getCategories !== 'function') {
      return;
    }
    const gen = ++categoryGenRef.current;
    setLoadingCategories(true);
    setCategoryError(null);
    try {
      const list = await categoryApi.getCategories();
      if (!mountedRef.current || gen !== categoryGenRef.current) return;
      setCategories(Array.isArray(list) ? list : []);
    } catch (err) {
      if (!mountedRef.current || gen !== categoryGenRef.current) return;
      setCategoryError(describeApiError(err, 'Gagal memuat daftar kategori.'));
    } finally {
      if (mountedRef.current && gen === categoryGenRef.current) {
        setLoadingCategories(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const executeFetch = useCallback(
    async (
      targetFilters: TransactionBrowserFilters,
      targetSort: TransactionSort,
      targetPage: number,
      options?: {
        clearRows?: boolean;
        resetTotals?: boolean;
        scrollToTop?: boolean;
        isRefresh?: boolean;
      }
    ) => {
      const gen = ++requestGenRef.current;
      loadingRef.current = true;
      lastDispatchedSignatureRef.current = serializeQuerySignature(
        targetFilters,
        targetSort,
        targetPage
      );

      if (options?.isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      if (options?.clearRows) {
        setItems([]);
      }
      if (options?.resetTotals) {
        setTotal(0);
        setTotalPages(0);
      }

      const query = buildTransactionPageQuery(targetFilters, targetSort, targetPage);

      try {
        const result = await transactionApi.getTransactionPage(query);
        if (!mountedRef.current || !focusedRef.current || gen !== requestGenRef.current) {
          return;
        }

        const nextItems = Array.isArray(result?.items) ? result.items : [];
        const nextTotal = typeof result?.total === 'number' ? result.total : 0;
        const nextPageSize =
          typeof result?.page_size === 'number' && result.page_size > 0
            ? result.page_size
            : DEFAULT_PAGE_SIZE;
        const nextTotalPages =
          typeof result?.total_pages === 'number' ? result.total_pages : 0;
        const effectivePage =
          typeof result?.page === 'number' && result.page >= 1 ? result.page : targetPage;

        pageRef.current = effectivePage;
        setPage(effectivePage);
        setItems(nextItems);
        setTotal(nextTotal);
        setPageSize(nextPageSize);
        setTotalPages(nextTotalPages);
        setError(null);
        lastDispatchedSignatureRef.current = serializeQuerySignature(
          targetFilters,
          targetSort,
          effectivePage
        );

        if (options?.scrollToTop && listRef.current) {
          listRef.current.scrollToOffset?.({ offset: 0, animated: true });
        }
      } catch (err) {
        if (!mountedRef.current || !focusedRef.current || gen !== requestGenRef.current) {
          return;
        }
        setItems([]);
        setError(describeApiError(err, 'Gagal memuat daftar transaksi.'));
      } finally {
        if (mountedRef.current && focusedRef.current && gen === requestGenRef.current) {
          loadingRef.current = false;
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (incomingScopeKey === lastScopeKeyRef.current) {
      return;
    }
    lastScopeKeyRef.current = incomingScopeKey;
    clearDebounce();
    const nextFilters = resolveIncomingDateFilters(rawStartDate, rawEndDate);
    searchTextRef.current = '';
    filtersRef.current = nextFilters;
    sortRef.current = 'date_desc';
    pageRef.current = 1;
    setSearchText('');
    setFilters(nextFilters);
    setSort('date_desc');
    setPage(1);
    void executeFetch(nextFilters, 'date_desc', 1, {
      clearRows: true,
      resetTotals: true,
      scrollToTop: true,
    });
  }, [clearDebounce, executeFetch, incomingScopeKey, rawEndDate, rawStartDate]);

  ExpoRouter.useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      void executeFetch(filtersRef.current, sortRef.current, pageRef.current, {
        clearRows: false,
        resetTotals: false,
        scrollToTop: false,
      });

      return () => {
        focusedRef.current = false;
        requestGenRef.current += 1;
        loadingRef.current = false;
        clearDebounce();
      };
    }, [clearDebounce, executeFetch])
  );

  const handleSearchChange = (text: string) => {
    searchTextRef.current = text;
    setSearchText(text);
    clearDebounce();

    // Immediately invalidate any in-flight request and clear stale rows
    requestGenRef.current += 1;
    loadingRef.current = true;
    pageRef.current = 1;
    setPage(1);
    setLoading(true);
    setError(null);
    setItems([]);
    setTotal(0);
    setTotalPages(0);

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      if (!mountedRef.current || !focusedRef.current) return;
      const trimmed = searchTextRef.current.trim();
      const nextFilters: TransactionBrowserFilters = { ...filtersRef.current };
      if (trimmed) {
        nextFilters.q = trimmed;
      } else {
        delete nextFilters.q;
      }
      filtersRef.current = nextFilters;
      setFilters(nextFilters);
      pageRef.current = 1;
      setPage(1);
      void executeFetch(nextFilters, sortRef.current, 1, {
        clearRows: true,
        resetTotals: true,
        scrollToTop: true,
      });
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleSearchSubmit = () => {
    clearDebounce();
    const trimmed = searchTextRef.current.trim();
    const nextFilters: TransactionBrowserFilters = { ...filtersRef.current };
    if (trimmed) {
      nextFilters.q = trimmed;
    } else {
      delete nextFilters.q;
    }
    filtersRef.current = nextFilters;
    setFilters(nextFilters);
    pageRef.current = 1;
    setPage(1);
    void executeFetch(nextFilters, sortRef.current, 1, {
      clearRows: true,
      resetTotals: true,
      scrollToTop: true,
    });
  };

  const handleClearSearch = () => {
    clearDebounce();
    searchTextRef.current = '';
    setSearchText('');
    const nextFilters: TransactionBrowserFilters = { ...filtersRef.current };
    delete nextFilters.q;
    filtersRef.current = nextFilters;
    setFilters(nextFilters);
    pageRef.current = 1;
    setPage(1);
    void executeFetch(nextFilters, sortRef.current, 1, {
      clearRows: true,
      resetTotals: true,
      scrollToTop: true,
    });
  };

  const handleOpenFilters = () => {
    if (categories.length === 0 && !loadingCategories) {
      void loadCategories();
    }
    setFilterSheetOpen(true);
  };

  const handleApplyFilters = (nextFilters: TransactionBrowserFilters) => {
    clearDebounce();
    setFilterSheetOpen(false);
    const nextSearch = nextFilters.q ?? '';
    searchTextRef.current = nextSearch;
    setSearchText(nextSearch);
    filtersRef.current = nextFilters;
    setFilters(nextFilters);
    pageRef.current = 1;
    setPage(1);

    const nextSig = serializeQuerySignature(nextFilters, sortRef.current, 1);
    if (loadingRef.current && nextSig === lastDispatchedSignatureRef.current) {
      return;
    }

    void executeFetch(nextFilters, sortRef.current, 1, {
      clearRows: true,
      resetTotals: true,
      scrollToTop: true,
    });
  };

  const handleResetAll = () => {
    clearDebounce();
    const emptyFilters: TransactionBrowserFilters = {};
    searchTextRef.current = '';
    filtersRef.current = emptyFilters;
    sortRef.current = 'date_desc';
    pageRef.current = 1;

    setSearchText('');
    setFilters(emptyFilters);
    setSort('date_desc');
    setPage(1);

    void executeFetch(emptyFilters, 'date_desc', 1, {
      clearRows: true,
      resetTotals: true,
      scrollToTop: true,
    });
  };

  const handleSelectSort = (nextSort: TransactionSort) => {
    clearDebounce();
    setSortSheetOpen(false);
    sortRef.current = nextSort;
    setSort(nextSort);
    pageRef.current = 1;
    setPage(1);
    void executeFetch(filtersRef.current, nextSort, 1, {
      clearRows: true,
      resetTotals: true,
      scrollToTop: true,
    });
  };

  const handleSelectPage = (nextPage: number) => {
    if (loadingRef.current) {
      return;
    }
    if (nextPage === pageRef.current || nextPage < 1) {
      return;
    }
    if (totalPages > 0 && nextPage > totalPages) {
      return;
    }
    clearDebounce();
    pageRef.current = nextPage;
    setPage(nextPage);
    void executeFetch(filtersRef.current, sortRef.current, nextPage, {
      clearRows: true,
      resetTotals: false,
      scrollToTop: true,
    });
  };

  const handleRefresh = async () => {
    clearDebounce();
    await executeFetch(filtersRef.current, sortRef.current, pageRef.current, {
      clearRows: false,
      resetTotals: false,
      scrollToTop: false,
      isRefresh: true,
    });
  };

  const handleRetry = () => {
    clearDebounce();
    void executeFetch(filtersRef.current, sortRef.current, pageRef.current, {
      clearRows: true,
      resetTotals: false,
      scrollToTop: false,
    });
  };

  const currentSortLabel =
    SORT_OPTIONS.find((item) => item.key === sort)?.label ?? 'Terbaru';
  const filtersActive = hasActiveFilters(filters);
  const canResetAny = filtersActive || sort !== 'date_desc';

  const summaryParts: string[] = [];
  if (filters.start_date && filters.end_date) {
    if (filters.start_date === filters.end_date) {
      summaryParts.push(
        `Tanggal: ${formatDateIndo(filters.start_date)} (${filters.start_date})`
      );
    } else {
      summaryParts.push(
        `Periode: ${formatDateIndo(filters.start_date)} - ${formatDateIndo(filters.end_date)} (${filters.start_date} s/d ${filters.end_date})`
      );
    }
  } else if (filters.start_date) {
    summaryParts.push(`Mulai: ${formatDateIndo(filters.start_date)} (${filters.start_date})`);
  } else if (filters.end_date) {
    summaryParts.push(`Sampai: ${formatDateIndo(filters.end_date)} (${filters.end_date})`);
  }
  if (filters.type) {
    summaryParts.push(`Jenis: ${transactionTypeLabel(filters.type)}`);
  }
  if (filters.category_id !== undefined) {
    const matchedCat = categories.find((cat) => cat.id === filters.category_id);
    summaryParts.push(
      `Kategori: ${matchedCat ? matchedCat.name : `#${filters.category_id}`}`
    );
  }
  if (filters.min_amount !== undefined && filters.max_amount !== undefined) {
    summaryParts.push(
      `Nominal: ${formatRupiah(filters.min_amount)} - ${formatRupiah(filters.max_amount)}`
    );
  } else if (filters.min_amount !== undefined) {
    summaryParts.push(`Min: ${formatRupiah(filters.min_amount)}`);
  } else if (filters.max_amount !== undefined) {
    summaryParts.push(`Maks: ${formatRupiah(filters.max_amount)}`);
  }
  if (filters.q) {
    summaryParts.push(`Cari: "${filters.q}"`);
  }

  const range = describeResultRange(page, pageSize, total);
  const resultRangeLabel =
    total > 0
      ? `Menampilkan ${formatNumberIndo(range.from)}-${formatNumberIndo(range.to)} dari ${formatNumberIndo(total)} transaksi`
      : 'Menampilkan 0 dari 0 transaksi';

  const safeTotalPages = Number.isFinite(totalPages) ? Math.max(0, Math.floor(totalPages)) : 0;
  const safeCurrentPage =
    safeTotalPages > 0 ? Math.min(Math.max(1, Math.floor(page) || 1), safeTotalPages) : 1;

  const listHeader = (
    <View style={styles.listHeader}>
      <View style={styles.header}>
        <Pressable
          onPress={() => ExpoRouter.router.back()}
          disabled={false}
          hitSlop={8}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Kembali"
        >
          <Ionicons name="arrow-back" size={20} color={Colors.ink} />
        </Pressable>

        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          Seluruh Transaksi
        </Text>

        <Pressable
          onPress={() => ExpoRouter.router.push('/transaction-history')}
          disabled={false}
          hitSlop={8}
          style={({ pressed }) => [styles.historyLink, pressed ? styles.pressed : null]}
          accessibilityRole="button"
          accessibilityLabel="Riwayat perubahan"
        >
          <Text style={styles.historyLinkText}>Riwayat perubahan</Text>
        </Pressable>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color={Colors.inkMuted} />
        <TextInput
          testID="transaction-search"
          value={searchText}
          onChangeText={handleSearchChange}
          onSubmitEditing={handleSearchSubmit}
          placeholder="Cari catatan, kategori, atau aset"
          placeholderTextColor={Colors.inkMuted}
          selectionColor={Colors.ink}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Cari catatan, kategori, atau aset"
          style={styles.searchInput}
          allowFontScaling
        />
        {searchText.length > 0 ? (
          <Pressable
            testID="clear-search"
            onPress={handleClearSearch}
            disabled={false}
            hitSlop={8}
            style={styles.clearSearchButton}
            accessibilityRole="button"
            accessibilityLabel="Hapus pencarian"
          >
            <Ionicons name="close-circle" size={18} color={Colors.inkSoft} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.controlsRow}>
        <Pressable
          testID="open-filters"
          onPress={handleOpenFilters}
          disabled={false}
          accessibilityRole="button"
          accessibilityLabel="Filter"
          style={({ pressed }) => [
            styles.controlButton,
            filtersActive && styles.controlButtonActive,
            pressed ? styles.pressed : null,
          ]}
        >
          <Ionicons
            name="options-outline"
            size={16}
            color={filtersActive ? Colors.onInk : Colors.inkSoft}
          />
          <Text
            style={[
              styles.controlButtonText,
              filtersActive && styles.controlButtonTextActive,
            ]}
          >
            Filter
          </Text>
          {summaryParts.length > 0 ? (
            <View
              style={[
                styles.filterBadge,
                filtersActive && styles.filterBadgeActive,
              ]}
            >
              <Text
                style={[
                  styles.filterBadgeText,
                  filtersActive && styles.filterBadgeTextActive,
                ]}
              >
                {summaryParts.length}
              </Text>
            </View>
          ) : null}
        </Pressable>

        <Pressable
          testID="open-sort"
          onPress={() => setSortSheetOpen(true)}
          disabled={false}
          accessibilityRole="button"
          accessibilityLabel="Urutkan"
          style={({ pressed }) => [
            styles.controlButton,
            styles.sortButton,
            pressed ? styles.pressed : null,
          ]}
        >
          <Ionicons name="swap-vertical-outline" size={16} color={Colors.inkSoft} />
          <Text style={styles.controlButtonLabel}>Urutkan:</Text>
          <Text style={styles.controlButtonValue} numberOfLines={1}>
            {currentSortLabel}
          </Text>
        </Pressable>
      </View>

      {summaryParts.length > 0 || canResetAny ? (
        <View style={styles.summaryBar}>
          <Text style={styles.summaryText}>
            {summaryParts.length > 0 ? summaryParts.join(' · ') : `Urutan: ${currentSortLabel}`}
          </Text>
          <Pressable
            testID="reset-filters"
            onPress={handleResetAll}
            disabled={false}
            hitSlop={8}
            style={styles.inlineResetButton}
            accessibilityRole="button"
            accessibilityLabel="Atur ulang filter"
          >
            <Text style={styles.inlineResetText}>Atur ulang</Text>
          </Pressable>
        </View>
      ) : null}

      {!loading && !error ? (
        <Text testID="result-range" style={styles.resultRange}>
          {resultRangeLabel}
        </Text>
      ) : null}

      {error ? <ErrorState message={error} onRetry={handleRetry} /> : null}
    </View>
  );

  const listEmpty =
    loading && !refreshing ? (
      <View style={styles.skeletonWrap}>
        <SkeletonRows count={6} />
      </View>
    ) : error ? undefined : canResetAny ? (
      <View style={styles.emptyWrap}>
        <EmptyState
          icon="search-outline"
          title="Tidak ada transaksi yang cocok"
          message="Ubah kata kunci atau rentang filter untuk melihat catatan lainnya."
        />
        <Pressable
          testID="reset-filters"
          onPress={handleResetAll}
          disabled={false}
          accessibilityRole="button"
          accessibilityLabel="Atur ulang filter"
          style={({ pressed }) => [styles.resetActionBtn, pressed ? styles.pressed : null]}
        >
          <Text style={styles.resetActionBtnText}>Atur ulang filter</Text>
        </Pressable>
      </View>
    ) : (
      <EmptyState
        icon="receipt-outline"
        title="Belum ada transaksi tercatat"
        message="Transaksi yang kamu catat akan tampil di halaman ini."
        actionLabel="Catat transaksi"
        onAction={() => ExpoRouter.router.push('/(tabs)/add')}
      />
    );

  const listFooter =
    !error && safeTotalPages >= 1 ? (
      <View style={styles.paginationFooter}>
        <TransactionPagination
          currentPage={safeCurrentPage}
          totalPages={safeTotalPages}
          disabled={loading}
          onSelectPage={handleSelectPage}
        />
      </View>
    ) : undefined;

  return (
    <Screen scroll={false} bottomInset contentStyle={styles.screenContent}>
      <FlatList
        ref={listRef as any}
        testID="transaction-list"
        data={loading && !refreshing ? [] : items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <TransactionCard
            transaction={item}
            onPress={() => ExpoRouter.router.push(`/transaction/${item.id}`)}
          />
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={listFooter}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        refreshControl={
          RefreshControl ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.ink}
              colors={[Colors.ink]}
              progressBackgroundColor={Colors.surface}
            />
          ) : undefined
        }
      />

      <TransactionFilters
        visible={filterSheetOpen}
        filters={filters}
        categories={categories}
        loadingCategories={loadingCategories}
        categoryError={categoryError}
        onRetryCategories={loadCategories}
        onApply={handleApplyFilters}
        onReset={handleResetAll}
        onClose={() => setFilterSheetOpen(false)}
      />

      {sortSheetOpen ? (
        <Sheet
          visible={sortSheetOpen}
          onClose={() => setSortSheetOpen(false)}
          title="Urutkan transaksi"
        >
          <View style={styles.sortList}>
            {SORT_OPTIONS.map((option) => {
              const selected = sort === option.key;
              return (
                <Pressable
                  key={option.key}
                  testID={`sort-${option.key}`}
                  onPress={() => handleSelectSort(option.key)}
                  disabled={false}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.sortOption,
                    selected && styles.sortOptionSelected,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.sortOptionText,
                      selected && styles.sortOptionTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                  {selected ? (
                    <Ionicons name="checkmark" size={18} color={Colors.ink} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </Sheet>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingBottom: 0,
  },
  listContent: {
    paddingBottom: Space.xxl,
  },
  listHeader: {
    marginBottom: Space.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    marginBottom: Space.md,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginLeft: -Space.xs,
  },
  title: {
    ...Type.h2,
    flex: 1,
  },
  historyLink: {
    minHeight: 44,
    paddingLeft: Space.sm,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  historyLinkText: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.inkSoft,
    textDecorationLine: 'underline',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 46,
    paddingHorizontal: Space.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.control,
    marginBottom: Space.sm,
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    paddingVertical: Space.xs,
    fontFamily: Fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.ink,
  },
  clearSearchButton: {
    width: 44,
    height: 44,
    marginRight: -Space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    marginBottom: Space.sm,
  },
  controlButton: {
    minHeight: 44,
    paddingHorizontal: Space.md,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    backgroundColor: Colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  controlButtonActive: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  controlButtonText: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.ink,
  },
  controlButtonTextActive: {
    color: Colors.onInk,
  },
  filterBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeActive: {
    backgroundColor: Colors.onInk,
  },
  filterBadgeText: {
    fontFamily: Fonts.semibold,
    fontSize: 11,
    lineHeight: 14,
    color: Colors.ink,
  },
  filterBadgeTextActive: {
    color: Colors.ink,
  },
  sortButton: {
    flex: 1,
  },
  controlButtonLabel: {
    fontFamily: Fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.inkSoft,
  },
  controlButtonValue: {
    fontFamily: Fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.ink,
    flexShrink: 1,
  },
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    paddingVertical: Space.xs,
    paddingHorizontal: Space.md,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.control,
    marginBottom: Space.sm,
  },
  summaryText: {
    ...Type.caption,
    color: Colors.inkSoft,
    flex: 1,
  },
  inlineResetButton: {
    minHeight: 36,
    paddingHorizontal: Space.xs,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  inlineResetText: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.ink,
    textDecorationLine: 'underline',
  },
  resultRange: {
    ...Type.caption,
    color: Colors.inkMuted,
    marginBottom: Space.xs,
    fontVariant: ['tabular-nums'],
  },
  skeletonWrap: {
    paddingVertical: Space.lg,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingBottom: Space.xl,
  },
  resetActionBtn: {
    minHeight: 44,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetActionBtnText: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    lineHeight: 19,
    color: Colors.ink,
  },
  paginationFooter: {
    paddingTop: Space.lg,
    paddingBottom: Space.md,
  },
  sortList: {
    paddingVertical: Space.xs,
  },
  sortOption: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Space.sm,
    paddingHorizontal: Space.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  sortOptionSelected: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.control,
  },
  sortOptionText: {
    fontFamily: Fonts.regular,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.ink,
  },
  sortOptionTextSelected: {
    fontFamily: Fonts.semibold,
  },
  pressed: {
    opacity: 0.75,
  },
});

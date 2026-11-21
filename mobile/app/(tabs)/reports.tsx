import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Radius, Space } from '../../utils/theme';
import { createThemedStyles, useTheme } from '../../services/theme';
import { BudgetOverview, CashFlowReport, PeriodReport, Transaction } from '../../types';
import { ReportSummaryCard } from '../../components/ReportSummaryCard';
import { FinancialStabilityCharts } from '../../components/reports/FinancialStabilityCharts';
import { CashFlowStatementCard } from '../../components/reports/CashFlowStatementCard';
import { TransactionCard } from '../../components/TransactionCard';
import { Screen } from '../../components/ui/Screen';
import { Segmented } from '../../components/ui/Segmented';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Progress } from '../../components/ui/Progress';
import { Amount } from '../../components/ui/Amount';
import { Card } from '../../components/ui/Card';
import { Skeleton, SkeletonRows } from '../../components/ui/Skeleton';
import { FadeIn } from '../../components/ui/FadeIn';
import { TutorialTarget } from '../../components/tutorial/TutorialTarget';
import { reportApi } from '../../services/reports';
import { budgetApi } from '../../services/budgets';
import { transactionApi } from '../../services/transactions';
import { describeApiError } from '../../services/auth';
import { formatRupiah } from '../../utils/formatRupiah';
import { budgetStatusLabel, clampedBudgetPercent } from '../../utils/budgets';

type Period = 'daily' | 'weekly' | 'monthly';

const PERIOD_ITEMS = [
  { key: 'daily' as const, label: 'Hari ini' },
  { key: 'weekly' as const, label: 'Minggu ini' },
  { key: 'monthly' as const, label: 'Bulan ini' },
];

export default function ReportsScreen() {
  const [period, setPeriod] = useState<Period>('monthly');
  const [report, setReport] = useState<PeriodReport | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowReport | null>(null);
  const [budgetOverview, setBudgetOverview] = useState<BudgetOverview | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const requestSeqRef = useRef(0);
  const theme = useTheme();
  const { colors } = theme;
  const styles = useStyles(theme);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchReport = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    try {
      let reportData: PeriodReport;
      if (period === 'daily') {
        reportData = await reportApi.getDailyReport();
      } else if (period === 'weekly') {
        reportData = await reportApi.getWeeklyReport();
      } else {
        reportData = await reportApi.getMonthlyReport();
      }
      if (!mountedRef.current || seq !== requestSeqRef.current) {
        return;
      }
      setReport(reportData);

      const fetchCashFlow =
        typeof reportApi.getCashFlowReport === 'function'
          ? reportApi.getCashFlowReport({ period })
          : Promise.resolve<CashFlowReport | null>(null);
      const fetchBudgets =
        typeof budgetApi?.getOverview === 'function'
          ? budgetApi.getOverview()
          : Promise.resolve<BudgetOverview | null>(null);

      const [txs, cfResult, budgetResult] = await Promise.all([
        transactionApi.getTransactions({
          start_date: reportData.start_date,
          end_date: reportData.end_date,
          limit: 10,
        }),
        fetchCashFlow.catch(() => null),
        fetchBudgets.catch(() => null),
      ]);
      if (!mountedRef.current || seq !== requestSeqRef.current) {
        return;
      }
      setTransactions(txs);
      setCashFlow(cfResult);
      setBudgetOverview(budgetResult);
      setError(null);
    } catch (err) {
      if (!mountedRef.current || seq !== requestSeqRef.current) {
        return;
      }
      setError(describeApiError(err, 'Gagal memuat laporan.'));
    }
  }, [period]);

  useFocusEffect(
    useCallback(() => {
      fetchReport();
    }, [fetchReport])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchReport();
    setRefreshing(false);
  };

  return (
    <Screen tutorialScrollId="reports" refreshing={refreshing} onRefresh={onRefresh}>
      <FadeIn>
        <Text style={styles.title}>Laporan</Text>
        <Segmented items={PERIOD_ITEMS} value={period} onChange={setPeriod} label="Periode laporan" />
      </FadeIn>

      {error ? <ErrorState message={error} onRetry={fetchReport} /> : null}

      <FadeIn delay={60}>
        <ReportSummaryCard report={report} />
      </FadeIn>

      <FadeIn delay={75}>
        <TutorialTarget id="reports.cashflow" trimBottom={Space.xl}>
          <SectionHeader title="Arus kas pribadi" />
          <CashFlowStatementCard report={cashFlow} />
        </TutorialTarget>
      </FadeIn>

      <FadeIn delay={90}>
        <SectionHeader title="Kestabilan finansial" />
        <FinancialStabilityCharts report={report} />
      </FadeIn>

      <FadeIn delay={105}>
        <SectionHeader
          title="Anggaran bulan ini"
          actionLabel="Kelola"
          onAction={() => router.push('/budgets')}
        />
        {budgetOverview && (budgetOverview.overall_budget || budgetOverview.category_budgets.length > 0) ? (
          <Card style={styles.budgetCard}>
            {[
              ...(budgetOverview.overall_budget ? [budgetOverview.overall_budget] : []),
              ...budgetOverview.category_budgets.slice(0, 3),
            ].map((item, idx, arr) => {
              const tone =
                item.status === 'exceeded'
                  ? colors.expense
                  : item.status === 'warning'
                  ? colors.investment
                  : colors.income;
              return (
                <Pressable
                  key={`b-${item.id}`}
                  onPress={() => router.push('/budgets')}
                  disabled={false}
                  accessibilityRole="button"
                  accessibilityLabel={`Lihat anggaran ${item.category_name || 'Total bulanan'}`}
                  style={[
                    styles.budgetRow,
                    idx === arr.length - 1 && styles.lastRow,
                  ]}
                >
                  <View style={styles.categoryHead}>
                    <Text style={styles.categoryName} numberOfLines={1}>
                      {item.category_name || 'Total pengeluaran bulanan'}
                    </Text>
                    <Text style={[styles.budgetPct, { color: tone }]}>
                      {`${Math.round(item.percentage)}% · ${budgetStatusLabel(item.status)}`}
                    </Text>
                  </View>
                  <Progress value={clampedBudgetPercent(item.percentage)} color={tone} />
                  <Text style={styles.categoryPct}>
                    {`${formatRupiah(item.spent)} dari ${formatRupiah(item.amount)}`}
                  </Text>
                </Pressable>
              );
            })}
          </Card>
        ) : (
          <EmptyState
            icon="wallet-outline"
            title="Belum ada anggaran pribadi"
            message="Tetapkan batas pengeluaran bulanan atau per kategori untuk memantau pemakaian."
            actionLabel="Atur anggaran"
            onAction={() => router.push('/budgets')}
          />
        )}
      </FadeIn>

      <FadeIn delay={120}>
        <SectionHeader title="Pengeluaran per kategori" />
        {!report ? (
          <View style={styles.block}>
            <SkeletonRows count={3} />
          </View>
        ) : report.top_expense_categories.length === 0 ? (
          <EmptyState
            icon="pie-chart-outline"
            title="Belum ada pengeluaran"
            message="Pengeluaran yang tercatat di periode ini akan muncul di sini."
          />
        ) : (
          <View style={styles.block}>
            {report.top_expense_categories.map((cat, index) => (
              <View
                key={`${cat.name}-${index}`}
                style={[
                  styles.categoryRow,
                  index === report.top_expense_categories.length - 1 && styles.lastRow,
                ]}
              >
                <View style={styles.categoryHead}>
                  <Text style={styles.categoryName} numberOfLines={1}>
                    {cat.name}
                  </Text>
                  <Amount value={cat.amount} tone="expense" />
                </View>
                <Progress value={cat.percentage} color={colors.expense} />
                <Text style={styles.categoryPct}>{Math.round(cat.percentage)}% dari pengeluaran</Text>
              </View>
            ))}
          </View>
        )}
      </FadeIn>

      <FadeIn delay={180}>
        <SectionHeader
          title="Pratinjau transaksi (maks. 10 terbaru)"
          actionLabel="Seluruh Transaksi"
          actionUnderlined
          onAction={() =>
            router.push(
              report
                ? {
                    pathname: '/transactions',
                    params: {
                      start_date: report.start_date,
                      end_date: report.end_date,
                    },
                  }
                : '/transactions'
            )
          }
        />
        {transactions.length === 0 ? (
          <EmptyState
            icon="receipt-outline"
            title="Tidak ada transaksi"
            message="Belum ada catatan di periode ini."
            actionLabel="Riwayat perubahan"
            onAction={() => router.push('/transaction-history')}
          />
        ) : (
          <View>
            {transactions.map((tx) => (
              <TransactionCard
                key={tx.id}
                transaction={tx}
                onPress={() => router.push(`/transaction/${tx.id}`)}
              />
            ))}
          </View>
        )}

        <Pressable
          onPress={() => router.push('/transaction-history')}
          disabled={false}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Riwayat perubahan"
          style={({ pressed }) => [styles.auditLinkRow, pressed ? styles.pressed : null]}
        >
          <Ionicons name="time-outline" size={16} color={colors.inkSoft} />
          <Text style={styles.auditLinkText}>Riwayat perubahan</Text>
          <Ionicons name="chevron-forward" size={15} color={colors.inkMuted} />
        </Pressable>
      </FadeIn>
    </Screen>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => StyleSheet.create({
  title: {
    ...type.h1,
    marginBottom: Space.lg,
  },
  block: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.xs,
    marginBottom: Space.xl,
  },
  budgetCard: {
    marginBottom: Space.xl,
    paddingVertical: Space.xs,
  },
  budgetRow: {
    paddingVertical: Space.md,
    gap: Space.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  budgetPct: {
    fontFamily: Fonts.semibold,
    fontSize: 11,
    lineHeight: 15,
    fontVariant: ['tabular-nums'],
  },
  categoryRow: {
    paddingVertical: Space.md,
    gap: Space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  categoryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  categoryName: {
    ...type.bodyStrong,
    flex: 1,
  },
  categoryPct: {
    ...type.micro,
    letterSpacing: 0,
  },
  auditLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    minHeight: 44,
    paddingVertical: Space.sm,
    marginTop: Space.xs,
  },
  auditLinkText: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSoft,
    flex: 1,
  },
  pressed: {
    opacity: 0.85,
  },
}));

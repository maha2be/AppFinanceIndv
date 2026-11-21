import React, { useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CashFlowReport } from '../../types';
import { Fonts, Radius, Space } from '../../utils/theme';
import { createThemedStyles, useTheme } from '../../services/theme';
import { formatRupiah } from '../../utils/formatRupiah';
import { buildCashFlowShareText, formatSignedCurrency } from '../../utils/budgets';
import { Card } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';

interface CashFlowStatementCardProps {
  report: CashFlowReport | null;
}

export function CashFlowStatementCard({ report }: CashFlowStatementCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const theme = useTheme();
  const { colors } = theme;
  const styles = useStyles(theme);

  if (!report) {
    return (
      <Card style={styles.card}>
        <Skeleton width="48%" height={12} />
        <Skeleton width="64%" height={28} style={styles.skeletonSpacer} />
        <Skeleton width="100%" height={14} style={styles.skeletonSpacer} />
        <Skeleton width="100%" height={14} style={styles.skeletonSpacer} />
        <Skeleton width="100%" height={14} style={styles.skeletonSpacer} />
      </Card>
    );
  }

  const { current, comparison } = report;
  const netTone =
    current.net_cash_flow > 0
      ? colors.income
      : current.net_cash_flow < 0
      ? colors.expense
      : colors.ink;
  const deltaPositive = comparison.net_delta >= 0;
  const deltaText =
    comparison.net_delta === 0
      ? `Sama dengan ${report.previous_title}`
      : `${formatSignedCurrency(comparison.net_delta, formatRupiah)} vs ${report.previous_title}`;

  const handleShare = async () => {
    try {
      await Share.share({
        title: report.title,
        message: buildCashFlowShareText(report, formatRupiah),
      });
    } catch {
      // User cancelled share sheet or platform unavailable.
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.cardTitle}>Arus kas bersih</Text>
          <Text style={[styles.netFigure, { color: netTone }]}>
            {formatSignedCurrency(current.net_cash_flow, formatRupiah)}
          </Text>
        </View>
        <View style={styles.actionGroup}>
          <View style={styles.ratePill}>
            <Text style={styles.ratePillText}>
              {`Saving rate ${current.saving_rate_pct}%`}
            </Text>
          </View>
          <Pressable
            onPress={() => void handleShare()}
            disabled={false}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Bagikan laporan arus kas"
            style={({ pressed }) => [styles.shareBtn, pressed && styles.pressed]}
          >
            <Ionicons name="share-outline" size={16} color={colors.inkSoft} />
          </Pressable>
        </View>
      </View>

      <View style={styles.deltaRow}>
        <Ionicons
          name={deltaPositive ? 'trending-up-outline' : 'trending-down-outline'}
          size={15}
          color={deltaPositive ? colors.income : colors.expense}
        />
        <Text
          style={[
            styles.deltaText,
            { color: deltaPositive ? colors.income : colors.expense },
          ]}
        >
          {deltaText}
        </Text>
      </View>

      <View style={styles.sectionList}>
        <View style={styles.flowRow}>
          <View style={styles.flowLabelWrap}>
            <Text style={styles.flowTitle}>1. Arus kas operasional</Text>
            <Text style={styles.flowSub}>
              {`Masuk ${formatRupiah(current.operating_inflow)} · Keluar ${formatRupiah(current.operating_outflow)}`}
            </Text>
          </View>
          <Text
            style={[
              styles.flowAmount,
              { color: current.operating_net >= 0 ? colors.income : colors.expense },
            ]}
          >
            {formatSignedCurrency(current.operating_net, formatRupiah)}
          </Text>
        </View>

        <View style={styles.flowRow}>
          <View style={styles.flowLabelWrap}>
            <Text style={styles.flowTitle}>2. Arus kas investasi</Text>
            <Text style={styles.flowSub}>Penempatan dana ke aset & instrumen</Text>
          </View>
          <Text
            style={[
              styles.flowAmount,
              { color: current.investing_outflow > 0 ? colors.investment : colors.inkMuted },
            ]}
          >
            {current.investing_outflow > 0
              ? `−${formatRupiah(current.investing_outflow)}`
              : formatRupiah(0)}
          </Text>
        </View>

        <View style={[styles.flowRow, styles.lastFlowRow]}>
          <View style={styles.flowLabelWrap}>
            <Text style={styles.flowTitle}>3. Arus kas hutang & piutang</Text>
            <Text style={styles.flowSub}>
              {`Masuk ${formatRupiah(current.financing_inflow)} · Keluar ${formatRupiah(current.financing_outflow)}`}
            </Text>
          </View>
          <Text
            style={[
              styles.flowAmount,
              {
                color:
                  current.financing_net > 0
                    ? colors.debt
                    : current.financing_net < 0
                    ? colors.expense
                    : colors.inkMuted,
              },
            ]}
          >
            {formatSignedCurrency(current.financing_net, formatRupiah)}
          </Text>
        </View>
      </View>

      <Pressable
        onPress={() => setShowDetails((prev) => !prev)}
        disabled={false}
        accessibilityRole="button"
        accessibilityLabel={showDetails ? 'Tutup rincian arus kas' : 'Lihat rincian arus kas'}
        style={({ pressed }) => [styles.toggleBtn, pressed && styles.pressed]}
      >
        <Text style={styles.toggleText}>
          {showDetails ? 'Sembunyikan rincian pos' : 'Lihat rincian pos operasional'}
        </Text>
        <Ionicons
          name={showDetails ? 'chevron-up' : 'chevron-down'}
          size={15}
          color={colors.inkSoft}
        />
      </Pressable>

      {showDetails ? (
        <View style={styles.breakdownWrap}>
          <View style={styles.breakdownGroup}>
            <Text style={styles.breakdownHeading}>Sumber kas masuk operasional</Text>
            {current.operating_income_breakdown.length === 0 ? (
              <Text style={styles.breakdownEmpty}>Belum ada pemasukan operasional.</Text>
            ) : (
              current.operating_income_breakdown.map((item) => (
                <View key={`in-${item.name}`} style={styles.breakdownRow}>
                  <Text style={styles.breakdownName}>{item.name}</Text>
                  <Text style={[styles.breakdownAmt, { color: colors.income }]}>
                    {`${formatRupiah(item.amount)} (${Math.round(item.percentage)}%)`}
                  </Text>
                </View>
              ))
            )}
          </View>

          <View style={styles.breakdownGroup}>
            <Text style={styles.breakdownHeading}>Pos kas keluar operasional</Text>
            {current.operating_expense_breakdown.length === 0 ? (
              <Text style={styles.breakdownEmpty}>Belum ada pengeluaran operasional.</Text>
            ) : (
              current.operating_expense_breakdown.slice(0, 5).map((item) => (
                <View key={`out-${item.name}`} style={styles.breakdownRow}>
                  <Text style={styles.breakdownName}>{item.name}</Text>
                  <Text style={[styles.breakdownAmt, { color: colors.expense }]}>
                    {`${formatRupiah(item.amount)} (${Math.round(item.percentage)}%)`}
                  </Text>
                </View>
              ))
            )}
          </View>
        </View>
      ) : null}
    </Card>
  );
}

const useStyles = createThemedStyles(({ colors, type }) =>
  StyleSheet.create({
    card: {
      marginBottom: Space.xl,
      gap: Space.md,
    },
    skeletonSpacer: {
      marginTop: Space.sm,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    titleBlock: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    cardTitle: {
      ...type.micro,
      textTransform: 'uppercase',
    },
    netFigure: {
      fontFamily: Fonts.serif,
      fontSize: 28,
      lineHeight: 34,
    },
    actionGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    ratePill: {
      paddingHorizontal: Space.sm + 2,
      paddingVertical: 5,
      borderRadius: Radius.pill,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.line,
    },
    ratePillText: {
      fontFamily: Fonts.medium,
      fontSize: 11,
      lineHeight: 14,
      color: colors.ink,
    },
    shareBtn: {
      width: 36,
      height: 36,
      borderRadius: Radius.control,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deltaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    deltaText: {
      fontFamily: Fonts.medium,
      fontSize: 12,
      lineHeight: 16,
      fontVariant: ['tabular-nums'],
    },
    sectionList: {
      borderTopWidth: 1,
      borderTopColor: colors.line,
      paddingTop: Space.xs,
    },
    flowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
      paddingVertical: Space.sm + 2,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    lastFlowRow: {
      borderBottomWidth: 0,
    },
    flowLabelWrap: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    flowTitle: {
      ...type.bodyStrong,
    },
    flowSub: {
      ...type.caption,
      fontVariant: ['tabular-nums'],
    },
    flowAmount: {
      fontFamily: Fonts.semibold,
      fontSize: 14,
      lineHeight: 18,
      fontVariant: ['tabular-nums'],
      flexShrink: 0,
    },
    toggleBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: 38,
      borderRadius: Radius.control,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.line,
    },
    toggleText: {
      fontFamily: Fonts.medium,
      fontSize: 12,
      lineHeight: 16,
      color: colors.inkSoft,
    },
    pressed: {
      opacity: 0.75,
    },
    breakdownWrap: {
      gap: Space.md,
      borderTopWidth: 1,
      borderTopColor: colors.line,
      paddingTop: Space.md,
    },
    breakdownGroup: {
      gap: 6,
    },
    breakdownHeading: {
      ...type.micro,
      textTransform: 'uppercase',
      color: colors.inkSoft,
    },
    breakdownEmpty: {
      ...type.caption,
    },
    breakdownRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    breakdownName: {
      ...type.caption,
      color: colors.ink,
      flex: 1,
    },
    breakdownAmt: {
      fontFamily: Fonts.medium,
      fontSize: 12,
      lineHeight: 16,
      fontVariant: ['tabular-nums'],
    },
  })
);

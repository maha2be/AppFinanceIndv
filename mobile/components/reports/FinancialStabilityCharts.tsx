import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { PeriodReport } from '../../types';
import { Fonts, Radius, Space } from '../../utils/theme';
import { createThemedStyles, useTheme } from '../../services/theme';
import { formatRupiah } from '../../utils/formatRupiah';
import {
  assessFinancialStability,
  buildCurveGeometry,
  buildDonutBreakdown,
  ChartColorKey,
  CurveMetric,
  DonutMode,
} from '../../utils/reportCharts';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { TutorialTarget } from '../tutorial/TutorialTarget';

interface FinancialStabilityChartsProps {
  report: PeriodReport | null;
}

const CURVE_HEIGHT = 148;
const DONUT_SIZE = 148;
const DONUT_OUTER_RADIUS = 64;
const DONUT_INNER_RADIUS = 42;

export function FinancialStabilityCharts({ report }: FinancialStabilityChartsProps) {
  const [curveMetric, setCurveMetric] = useState<CurveMetric>('cumulative');
  const [donutMode, setDonutMode] = useState<DonutMode>('flow');
  const [chartWidth, setChartWidth] = useState(280);

  const { width, fontScale } = useWindowDimensions();
  const stackDonut = width < 360 || fontScale > 1.3;
  const theme = useTheme();
  const { colors } = theme;
  const styles = useStyles(theme);

  const colorMap: Record<ChartColorKey, string> = {
    income: colors.income,
    expense: colors.expense,
    investment: colors.investment,
    debt: colors.debt,
    receivable: colors.receivable,
    inkSoft: colors.inkSoft,
  };

  if (!report) {
    return (
      <View style={styles.stack}>
        <TutorialTarget id="reports.stability">
          <Card style={styles.card}>
            <Skeleton width="44%" height={12} />
            <Skeleton width="72%" height={11} style={styles.skeletonSpacer} />
            <Skeleton width="100%" height={CURVE_HEIGHT} style={styles.skeletonChart} />
          </Card>
        </TutorialTarget>
        <Card style={styles.card}>
          <Skeleton width="46%" height={12} />
          <View style={styles.donutSkeletonRow}>
            <Skeleton width={DONUT_SIZE} height={DONUT_SIZE} radius={DONUT_SIZE / 2} />
            <View style={styles.donutSkeletonLegend}>
              <Skeleton width="80%" height={12} />
              <Skeleton width="65%" height={12} />
              <Skeleton width="72%" height={12} />
            </View>
          </View>
        </Card>
      </View>
    );
  }

  const stability = assessFinancialStability(report);
  const timeline = report.timeline ?? [];
  const curve = buildCurveGeometry(timeline, curveMetric, {
    width: chartWidth,
    height: CURVE_HEIGHT,
  });
  const donut = buildDonutBreakdown(report, donutMode, {
    size: DONUT_SIZE,
    outerRadius: DONUT_OUTER_RADIUS,
    innerRadius: DONUT_INNER_RADIUS,
  });

  const stabilityColor =
    stability.tone === 'income'
      ? colors.income
      : stability.tone === 'expense'
      ? colors.expense
      : colors.inkSoft;
  const stabilityTint =
    stability.tone === 'income'
      ? colors.incomeTint
      : stability.tone === 'expense'
      ? colors.expenseTint
      : colors.inkTint;

  const finalNet = timeline.length > 0 ? timeline[timeline.length - 1].cumulative_net : report.net;
  const cumulativeColor = finalNet >= 0 ? colors.income : colors.expense;
  const primaryColor = curveMetric === 'cumulative' ? cumulativeColor : colors.income;

  return (
    <View style={styles.stack}>
      <TutorialTarget id="reports.stability">
        <Card style={styles.card}>
          <View style={styles.cardTop}>
          <View style={styles.titleBlock}>
            <Text style={styles.cardTitle}>Kurva kestabilan</Text>
            <View style={[styles.statusBadge, { backgroundColor: stabilityTint }]}>
              <Text style={[styles.statusBadgeText, { color: stabilityColor }]}>
                {stability.status}
              </Text>
            </View>
          </View>

          <View
            style={styles.modeSwitch}
            accessibilityRole="tablist"
            accessibilityLabel="Tampilan kurva kestabilan"
          >
            {(
              [
                { key: 'cumulative', label: 'Saldo' },
                { key: 'cashflow', label: 'Arus' },
              ] as const
            ).map((option) => {
              const active = curveMetric === option.key;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => setCurveMetric(option.key)}
                  disabled={false}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Kurva ${option.label}`}
                  style={[styles.modePill, active && styles.modePillActive]}
                >
                  <Text style={[styles.modePillText, active && styles.modePillTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text style={styles.stabilityDetail}>{stability.detail}</Text>

        {!curve.hasData || !curve.hasActivity ? (
          <EmptyState
            icon="analytics-outline"
            title="Belum ada kurva transaksi"
            message="Catat transaksi pada rentang periode ini untuk melihat pergerakan kestabilan."
          />
        ) : (
          <View style={styles.curveWrap}>
            <View
              style={styles.curvePlotRow}
              onLayout={(event) => {
                const w = event?.nativeEvent?.layout?.width;
                if (typeof w === 'number' && w > 80) {
                  setChartWidth(Math.floor(w));
                }
              }}
            >
              <View style={styles.yAxis}>
                <Text style={styles.axisText} numberOfLines={1}>{curve.yLabels.max}</Text>
                {curve.minValue < 0 && curve.maxValue > 0 ? (
                  <Text style={styles.axisText} numberOfLines={1}>{curve.yLabels.zero}</Text>
                ) : null}
                <Text style={styles.axisText} numberOfLines={1}>{curve.yLabels.min}</Text>
              </View>

              <View style={styles.svgContainer}>
                <Svg width="100%" height={CURVE_HEIGHT} viewBox={`0 0 ${chartWidth} ${CURVE_HEIGHT}`}>
                  <Defs>
                    <LinearGradient id="stabilityArea" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0%" stopColor={primaryColor} stopOpacity={0.22} />
                      <Stop offset="100%" stopColor={primaryColor} stopOpacity={0.02} />
                    </LinearGradient>
                  </Defs>

                  <Line
                    x1={0}
                    y1={curve.zeroY}
                    x2={chartWidth}
                    y2={curve.zeroY}
                    stroke={colors.lineStrong}
                    strokeWidth={1}
                    strokeDasharray="4,4"
                  />

                  {curveMetric === 'cumulative' && curve.areaPath ? (
                    <Path d={curve.areaPath} fill="url(#stabilityArea)" />
                  ) : null}

                  {curveMetric === 'cashflow' && curve.secondaryPath ? (
                    <Path
                      d={curve.secondaryPath}
                      fill="none"
                      stroke={colors.expense}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}

                  {curve.primaryPath ? (
                    <Path
                      d={curve.primaryPath}
                      fill="none"
                      stroke={primaryColor}
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}

                  {curve.primaryPoints.length <= 10
                    ? curve.primaryPoints.map((pt) => (
                        <Circle
                          key={`p-${pt.date}`}
                          cx={pt.x}
                          cy={pt.y}
                          r={3.5}
                          fill={colors.surface}
                          stroke={primaryColor}
                          strokeWidth={2}
                        />
                      ))
                    : curve.primaryPoints.length > 0
                    ? (
                        <Circle
                          cx={curve.primaryPoints[curve.primaryPoints.length - 1].x}
                          cy={curve.primaryPoints[curve.primaryPoints.length - 1].y}
                          r={4}
                          fill={primaryColor}
                        />
                      )
                    : null}
                </Svg>
              </View>
            </View>

            <View style={styles.xAxisRow}>
              <Text style={styles.axisText}>{curve.xLabels.start}</Text>
              {curve.xLabels.middle ? (
                <Text style={styles.axisText}>{curve.xLabels.middle}</Text>
              ) : null}
              {curve.xLabels.end ? (
                <Text style={styles.axisText}>{curve.xLabels.end}</Text>
              ) : null}
            </View>

            <View style={styles.curveLegend}>
              {curveMetric === 'cumulative' ? (
                <LegendDot
                  color={primaryColor}
                  label="Saldo bersih kumulatif"
                  styles={styles}
                />
              ) : (
                <>
                  <LegendDot color={colors.income} label="Pemasukan" styles={styles} />
                  <LegendDot
                    color={colors.expense}
                    label="Pengeluaran & investasi"
                    styles={styles}
                  />
                </>
              )}
            </View>
          </View>
        )}
      </Card>
      </TutorialTarget>

      <Card style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.cardTitle}>Diagram lingkaran</Text>
          <View
            style={styles.modeSwitch}
            accessibilityRole="tablist"
            accessibilityLabel="Tampilan diagram lingkaran"
          >
            {(
              [
                { key: 'flow', label: 'Arus' },
                { key: 'categories', label: 'Kategori' },
              ] as const
            ).map((option) => {
              const active = donutMode === option.key;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => setDonutMode(option.key)}
                  disabled={false}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Diagram ${option.label}`}
                  style={[styles.modePill, active && styles.modePillActive]}
                >
                  <Text style={[styles.modePillText, active && styles.modePillTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {!donut.hasData ? (
          <EmptyState
            icon="pie-chart-outline"
            title={
              donutMode === 'flow'
                ? 'Belum ada komposisi arus'
                : 'Belum ada kategori pengeluaran'
            }
            message="Data transaksi pada periode ini akan membentuk proporsi diagram secara otomatis."
          />
        ) : (
          <View style={[styles.donutBody, stackDonut && styles.donutBodyStacked]}>
            <View
              style={styles.donutGraphic}
              accessible
              accessibilityLabel={`Diagram ${donutMode === 'flow' ? 'arus keuangan' : 'kategori pengeluaran'}, ${donut.centerLabel} ${donut.centerValue}`}
            >
              <Svg width={DONUT_SIZE} height={DONUT_SIZE} viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}>
                {donut.slices.map((slice) => {
                  const fill = colorMap[slice.colorKey];
                  if (slice.isFullCircle) {
                    const ringRadius = (DONUT_OUTER_RADIUS + DONUT_INNER_RADIUS) / 2;
                    const strokeWidth = DONUT_OUTER_RADIUS - DONUT_INNER_RADIUS;
                    return (
                      <Circle
                        key={slice.key}
                        cx={DONUT_SIZE / 2}
                        cy={DONUT_SIZE / 2}
                        r={ringRadius}
                        fill="none"
                        stroke={fill}
                        strokeWidth={strokeWidth}
                      />
                    );
                  }
                  return <Path key={slice.key} d={slice.path} fill={fill} />;
                })}
              </Svg>
              <View style={styles.donutCenter} pointerEvents="none">
                <Text style={styles.donutCenterLabel} numberOfLines={1}>
                  {donut.centerLabel}
                </Text>
                <Text style={styles.donutCenterValue} numberOfLines={1}>
                  {donut.centerValue}
                </Text>
              </View>
            </View>

            <View style={styles.donutLegend}>
              {donut.slices.map((slice) => (
                <View key={slice.key} style={styles.legendRow}>
                  <View style={styles.legendNameRow}>
                    <View
                      style={[styles.legendDot, { backgroundColor: colorMap[slice.colorKey] }]}
                    />
                    <Text style={styles.legendLabel} numberOfLines={1}>
                      {slice.label}
                    </Text>
                  </View>
                  <View style={styles.legendNumbers}>
                    <Text style={styles.legendPct}>{slice.percentage}%</Text>
                    <Text style={styles.legendAmount} numberOfLines={1}>
                      {formatRupiah(slice.amount)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
      </Card>
    </View>
  );
}

function LegendDot({
  color,
  label,
  styles,
}: {
  color: string;
  label: string;
  styles: ReturnType<typeof useStyles>;
}) {
  return (
    <View style={styles.curveLegendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.curveLegendText}>{label}</Text>
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => StyleSheet.create({
  stack: {
    gap: Space.lg,
    marginBottom: Space.xl,
  },
  card: {
    paddingVertical: Space.lg,
    paddingHorizontal: Space.lg,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Space.sm,
    marginBottom: Space.sm,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: Space.xs,
    alignItems: 'flex-start',
  },
  cardTitle: {
    ...type.title,
  },
  statusBadge: {
    paddingHorizontal: Space.sm,
    paddingVertical: 3,
    borderRadius: Radius.control,
  },
  statusBadgeText: {
    fontFamily: Fonts.semibold,
    fontSize: 11,
    lineHeight: 15,
  },
  stabilityDetail: {
    ...type.caption,
    color: colors.inkSoft,
    marginBottom: Space.md,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 2,
    flexShrink: 0,
  },
  modePill: {
    minHeight: 32,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modePillActive: {
    backgroundColor: colors.ink,
  },
  modePillText: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.inkSoft,
  },
  modePillTextActive: {
    color: colors.onInk,
    fontFamily: Fonts.semibold,
  },
  curveWrap: {
    gap: Space.xs,
  },
  curvePlotRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Space.sm,
  },
  yAxis: {
    justifyContent: 'space-between',
    paddingVertical: 6,
    minWidth: 52,
  },
  svgContainer: {
    flex: 1,
    minWidth: 0,
  },
  xAxisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: 60,
  },
  axisText: {
    fontFamily: Fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    color: colors.inkMuted,
    fontVariant: ['tabular-nums'],
  },
  curveLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.md,
    marginTop: Space.sm,
    paddingTop: Space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  curveLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  curveLegendText: {
    ...type.caption,
    color: colors.inkSoft,
  },
  donutBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
    marginTop: Space.sm,
  },
  donutBodyStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  donutGraphic: {
    width: DONUT_SIZE,
    height: DONUT_SIZE,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  donutCenter: {
    position: 'absolute',
    width: DONUT_INNER_RADIUS * 1.7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutCenterLabel: {
    fontFamily: Fonts.regular,
    fontSize: 10,
    lineHeight: 13,
    color: colors.inkMuted,
  },
  donutCenterValue: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    lineHeight: 18,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  donutLegend: {
    flex: 1,
    minWidth: 0,
    gap: Space.sm,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  legendNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  legendLabel: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.ink,
    flexShrink: 1,
  },
  legendNumbers: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  legendPct: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  legendAmount: {
    fontFamily: Fonts.regular,
    fontSize: 11,
    lineHeight: 14,
    color: colors.inkMuted,
    fontVariant: ['tabular-nums'],
  },
  skeletonSpacer: {
    marginTop: Space.sm,
  },
  skeletonChart: {
    marginTop: Space.md,
  },
  donutSkeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
    marginTop: Space.md,
  },
  donutSkeletonLegend: {
    flex: 1,
    gap: Space.sm,
  },
}));

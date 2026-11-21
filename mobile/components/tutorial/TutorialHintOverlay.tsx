import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Animated,
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Fonts, Motion, Radius, Space } from '../../utils/theme';
import { createThemedStyles, useTheme } from '../../services/theme';
import { useReducedMotion } from '../../utils/motion';
import {
  resolveStepTitle,
  TAB_SPOTLIGHT_ITEMS,
  TUTORIAL_STEPS,
} from '../../utils/tutorialSteps';
import {
  dismissTutorialHint,
  getTutorialHintState,
  goToTutorialStep,
  nextTutorialStep,
  prevTutorialStep,
  subscribeTutorialHint,
} from '../../services/tutorialHint';
import {
  getTutorialScrollArea,
  measureTutorialTarget,
  SpotlightRect,
  subscribeTutorialTargets,
} from '../../services/tutorialTargets';
import {
  buildSpotlightMaskPath,
  computeScrollTargetY,
  computeSpotlightPlacement,
} from '../../utils/tutorialLayout';
import { Button } from '../ui/Button';

interface TutorialHintOverlayProps {
  authed: boolean;
  gated: boolean;
  inAuthGroup: boolean;
  onNavigateTab: (route: string) => void;
}

interface MeasurableView {
  measureInWindow?: (
    callback: (x: number, y: number, width: number, height: number) => void
  ) => void;
}

export function TutorialHintOverlay({
  authed,
  gated,
  inAuthGroup,
  onNavigateTab,
}: TutorialHintOverlayProps) {
  const tutorial = useSyncExternalStore(
    subscribeTutorialHint,
    getTutorialHintState,
    getTutorialHintState
  );
  const active = tutorial.visible && authed && !gated && !inAuthGroup;
  const stepIndex = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, tutorial.stepIndex));
  const step = TUTORIAL_STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TUTORIAL_STEPS.length - 1;

  const theme = useTheme();
  const { colors, isDark } = theme;
  const styles = useStyles(theme);
  const insets = useSafeAreaInsets();
  const windowDims = useWindowDimensions();
  const reduced = useReducedMotion();

  const [targetRect, setTargetRect] = useState<SpotlightRect | null>(null);
  const [measuredCardHeight, setMeasuredCardHeight] = useState(248);
  const [overlaySize, setOverlaySize] = useState<{ width: number; height: number } | null>(
    null
  );

  const overlayRef = useRef<React.ComponentRef<typeof View> | null>(null);
  const enter = useRef(new Animated.Value(0)).current;
  const measureSeqRef = useRef(0);
  const scrolledStepRef = useRef<string | null>(null);
  const wasActiveRef = useRef(false);
  const lastTriggerRef = useRef(tutorial.trigger);

  const bottomInset = Platform.OS === 'web' ? 8 : Math.max(insets.bottom, 8);
  const topInset = Platform.OS === 'web' ? Space.md : Math.max(insets.top, Space.sm);
  const spotlightBarHeight = 58 + bottomInset;

  const viewportWidth = overlaySize?.width || windowDims.width || 390;
  const viewportHeight = overlaySize?.height || windowDims.height || 844;
  const viewport = {
    width: viewportWidth,
    height: viewportHeight,
    topInset,
    bottomReserve: spotlightBarHeight + 6,
  };

  useEffect(() => {
    if (active) {
      lastTriggerRef.current = tutorial.trigger;
    }
  }, [active, tutorial.trigger]);

  useEffect(() => {
    if (active) {
      wasActiveRef.current = true;
      onNavigateTab(step.tabRoute);
      return;
    }
    if (wasActiveRef.current) {
      wasActiveRef.current = false;
      setTargetRect(null);
      scrolledStepRef.current = null;
      if (authed && !inAuthGroup) {
        onNavigateTab(lastTriggerRef.current === 'manual' ? '/(tabs)/me' : '/(tabs)');
      }
    }
  }, [active, authed, inAuthGroup, onNavigateTab, step.tabRoute]);

  const measureOverlayOrigin = useCallback((): Promise<{ x: number; y: number }> => {
    const node = overlayRef.current as unknown as MeasurableView | null;
    if (!node || typeof node.measureInWindow !== 'function') {
      return Promise.resolve({ x: 0, y: 0 });
    }
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ x: 0, y: 0 });
        }
      }, 200);
      try {
        node.measureInWindow?.((x, y) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            x: Number.isFinite(x) ? x : 0,
            y: Number.isFinite(y) ? y : 0,
          });
        });
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ x: 0, y: 0 });
        }
      }
    });
  }, []);

  const runTargetMeasurement = useCallback(
    async (allowScroll: boolean) => {
      if (!active) return;
      const seq = ++measureSeqRef.current;
      const [rawRect, origin] = await Promise.all([
        measureTutorialTarget(step.targetId),
        measureOverlayOrigin(),
      ]);
      if (seq !== measureSeqRef.current) return;

      if (!rawRect) {
        setTargetRect(null);
        return;
      }

      const relRect: SpotlightRect = {
        x: rawRect.x - origin.x,
        y: rawRect.y - origin.y,
        width: rawRect.width,
        height: rawRect.height,
      };

      if (allowScroll && scrolledStepRef.current !== step.id) {
        const scrollArea = getTutorialScrollArea(step.scrollId);
        if (scrollArea) {
          const nextScrollY = computeScrollTargetY(
            relRect,
            {
              width: viewportWidth,
              height: viewportHeight,
              topInset,
              bottomReserve: spotlightBarHeight + 6,
            },
            scrollArea.getScrollY()
          );
          if (nextScrollY !== null) {
            scrolledStepRef.current = step.id;
            scrollArea.scrollTo(nextScrollY);
            setTimeout(() => {
              if (seq === measureSeqRef.current) {
                void runTargetMeasurement(false);
              }
            }, 260);
            return;
          }
        }
      }

      setTargetRect(relRect);
    },
    [
      active,
      measureOverlayOrigin,
      spotlightBarHeight,
      step.id,
      step.scrollId,
      step.targetId,
      topInset,
      viewportHeight,
      viewportWidth,
    ]
  );

  useEffect(() => {
    if (!active) {
      setTargetRect(null);
      return;
    }
    scrolledStepRef.current = null;
    setTargetRect(null);

    const initialTimer = setTimeout(() => {
      void runTargetMeasurement(true);
    }, 150);

    const unsubTargets = subscribeTutorialTargets(() => {
      void runTargetMeasurement(scrolledStepRef.current !== step.id);
    });

    return () => {
      clearTimeout(initialTimer);
      measureSeqRef.current += 1;
      unsubTargets();
    };
  }, [active, runTargetMeasurement, step.id]);

  useEffect(() => {
    if (!active) {
      enter.setValue(0);
      return;
    }
    if (reduced) {
      enter.setValue(1);
      return;
    }
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: Motion.base,
      useNativeDriver: true,
    }).start();
  }, [active, enter, reduced, step.id]);

  useEffect(() => {
    if (!active) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stepIndex > 0) {
        prevTutorialStep();
      } else {
        dismissTutorialHint();
      }
      return true;
    });
    return () => listener.remove();
  }, [active, stepIndex]);

  if (!active) {
    return null;
  }

  const placement = computeSpotlightPlacement(targetRect, viewport, measuredCardHeight);
  const hasCutout = placement.cutout.width > 0 && placement.cutout.height > 0;
  const maskPath = buildSpotlightMaskPath(
    viewportWidth,
    viewportHeight,
    hasCutout ? placement.cutout : null
  );
  const scrimColor = isDark ? 'rgba(6, 8, 6, 0.78)' : 'rgba(18, 21, 17, 0.64)';
  const ringColor = isDark ? colors.ink : colors.surface;
  const title = resolveStepTitle(step, tutorial.trigger === 'register');

  return (
    <View
      ref={overlayRef}
      collapsable={false}
      onLayout={(event) => {
        const w = event?.nativeEvent?.layout?.width;
        const h = event?.nativeEvent?.layout?.height;
        if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
          setOverlaySize((prev) =>
            prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }
          );
        }
      }}
      style={styles.overlay}
      accessibilityViewIsModal
      accessibilityLabel="Panduan fitur aplikasi"
    >
      {/* Dimmed backdrop with SVG spotlight cutout */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={viewportWidth} height={viewportHeight}>
          <Path d={maskPath} fillRule="evenodd" fill={scrimColor} />
        </Svg>
      </View>

      {/* Highlight ring framing the target element */}
      {hasCutout ? (
        <View
          pointerEvents="none"
          accessibilityLabel={`Sorotan ${step.badge}`}
          style={[
            styles.highlightRing,
            {
              left: placement.cutout.x,
              top: placement.cutout.y,
              width: placement.cutout.width,
              height: placement.cutout.height,
              borderColor: ringColor,
            },
          ]}
        />
      ) : null}

      {/* Floating pop-up coach-mark card positioned above or below the highlight */}
      <Animated.View
        onLayout={(event) => {
          const h = event?.nativeEvent?.layout?.height;
          if (typeof h === 'number' && h > 80) {
            const rounded = Math.round(h);
            setMeasuredCardHeight((prev) => (Math.abs(prev - rounded) > 4 ? rounded : prev));
          }
        }}
        style={[
          styles.popupCard,
          {
            top: placement.cardTop,
            left: placement.cardLeft,
            width: placement.cardWidth,
            maxHeight: placement.cardMaxHeight,
            opacity: enter,
            transform: [
              {
                translateY: enter.interpolate({
                  inputRange: [0, 1],
                  outputRange: [placement.placement === 'above' ? -10 : 10, 0],
                }),
              },
            ],
          },
        ]}
      >
        {placement.arrowDirection === 'up' && placement.arrowLeft !== null ? (
          <View
            pointerEvents="none"
            style={[
              styles.arrowUp,
              {
                left: Math.max(
                  16,
                  Math.min(placement.cardWidth - 32, placement.arrowLeft - placement.cardLeft - 8)
                ),
                borderBottomColor: colors.paper,
              },
            ]}
          />
        ) : null}

        <View style={styles.topRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {`${stepIndex + 1} / ${TUTORIAL_STEPS.length} · ${step.badge}`}
            </Text>
          </View>
          <Pressable
            onPress={dismissTutorialHint}
            disabled={false}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Lewati tutorial"
            style={({ pressed }) => [styles.skipBtn, pressed && styles.pressed]}
          >
            <Text style={styles.skipText}>Lewati</Text>
          </Pressable>
        </View>

        <View
          style={styles.progressTrack}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 1, max: TUTORIAL_STEPS.length, now: stepIndex + 1 }}
        >
          {TUTORIAL_STEPS.map((item, idx) => (
            <View
              key={item.id}
              style={[
                styles.progressSegment,
                idx <= stepIndex ? styles.progressSegmentActive : styles.progressSegmentIdle,
              ]}
            />
          ))}
        </View>

        <ScrollView
          style={styles.scrollBody}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.heroRow}>
            <View style={styles.iconCircle}>
              <Ionicons
                name={step.icon as keyof typeof Ionicons.glyphMap}
                size={19}
                color={colors.ink}
              />
            </View>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
          </View>

          <Text style={styles.summary}>{step.summary}</Text>

          {step.examples && step.examples.length > 0 ? (
            <View style={styles.exampleBox}>
              <Text style={styles.exampleHeading}>Contoh ketikan cepat</Text>
              <View style={styles.exampleChips}>
                {step.examples.map((example) => (
                  <View key={example} style={styles.exampleChip}>
                    <Text style={styles.exampleChipText}>{`"${example}"`}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {step.tip ? (
            <View style={styles.tipBox}>
              <Ionicons name="bulb-outline" size={15} color={colors.inkSoft} />
              <Text style={styles.tipText}>{step.tip}</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.footerSecondary}>
            {isFirst ? (
              <Button title="Lewati" variant="ghost" onPress={dismissTutorialHint} />
            ) : (
              <Button title="Sebelumnya" variant="secondary" onPress={prevTutorialStep} />
            )}
          </View>
          <View style={styles.footerPrimary}>
            <Button
              title={isLast ? 'Mulai gunakan' : 'Lanjut'}
              variant="primary"
              onPress={nextTutorialStep}
            />
          </View>
        </View>

        {placement.arrowDirection === 'down' && placement.arrowLeft !== null ? (
          <View
            pointerEvents="none"
            style={[
              styles.arrowDown,
              {
                left: Math.max(
                  16,
                  Math.min(placement.cardWidth - 32, placement.arrowLeft - placement.cardLeft - 8)
                ),
                borderTopColor: colors.paper,
              },
            ]}
          />
        ) : null}
      </Animated.View>

      {/* Bottom 4-tab spotlight bar */}
      <View
        style={[
          styles.spotlightBar,
          {
            height: spotlightBarHeight,
            paddingBottom: bottomInset,
          },
        ]}
      >
        {TAB_SPOTLIGHT_ITEMS.map((tab) => {
          const focused = tab.index === step.tabIndex;
          return (
            <Pressable
              key={tab.label}
              onPress={() => goToTutorialStep(tab.targetStepIndex)}
              disabled={false}
              accessibilityRole="button"
              accessibilityLabel={`Lihat panduan tab ${tab.label}`}
              accessibilityState={{ selected: focused }}
              style={[
                styles.spotlightTab,
                focused ? styles.spotlightTabActive : styles.spotlightTabIdle,
              ]}
            >
              <Ionicons
                name={tab.icon as keyof typeof Ionicons.glyphMap}
                size={19}
                color={focused ? colors.ink : colors.inkMuted}
              />
              <Text
                style={[styles.spotlightLabel, focused && styles.spotlightLabelActive]}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, shadow, type }) =>
  StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFill,
      zIndex: 50,
    },
    highlightRing: {
      position: 'absolute',
      borderRadius: 14,
      borderWidth: 2,
    },
    popupCard: {
      position: 'absolute',
      backgroundColor: colors.paper,
      borderRadius: Radius.sheet,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      paddingHorizontal: Space.lg,
      paddingTop: Space.md,
      paddingBottom: Space.md,
      gap: Space.sm + 2,
      ...shadow.sheet,
    },
    arrowUp: {
      position: 'absolute',
      top: -8,
      width: 0,
      height: 0,
      borderLeftWidth: 8,
      borderRightWidth: 8,
      borderBottomWidth: 8,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
    },
    arrowDown: {
      position: 'absolute',
      bottom: -8,
      width: 0,
      height: 0,
      borderLeftWidth: 8,
      borderRightWidth: 8,
      borderTopWidth: 8,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    badge: {
      paddingHorizontal: Space.sm + 2,
      paddingVertical: 4,
      borderRadius: Radius.pill,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.line,
    },
    badgeText: {
      ...type.micro,
      color: colors.ink,
    },
    skipBtn: {
      minHeight: 36,
      paddingHorizontal: Space.sm,
      justifyContent: 'center',
      alignItems: 'flex-end',
    },
    skipText: {
      fontFamily: Fonts.medium,
      fontSize: 13,
      lineHeight: 18,
      color: colors.inkSoft,
    },
    pressed: {
      opacity: 0.7,
    },
    progressTrack: {
      flexDirection: 'row',
      gap: 5,
    },
    progressSegment: {
      flex: 1,
      height: 3.5,
      borderRadius: 2,
    },
    progressSegmentActive: {
      backgroundColor: colors.ink,
    },
    progressSegmentIdle: {
      backgroundColor: colors.line,
    },
    scrollBody: {
      flexShrink: 1,
    },
    scrollContent: {
      gap: Space.sm + 2,
      paddingBottom: 2,
    },
    heroRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm + 2,
    },
    iconCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    title: {
      fontFamily: Fonts.serif,
      fontSize: 20,
      lineHeight: 24,
      color: colors.ink,
      flex: 1,
      minWidth: 0,
    },
    summary: {
      ...type.body,
      fontSize: 14,
      lineHeight: 20,
      color: colors.inkSoft,
    },
    exampleBox: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: Radius.block,
      padding: Space.sm + 2,
      gap: Space.xs + 2,
    },
    exampleHeading: {
      ...type.micro,
      textTransform: 'uppercase',
      color: colors.inkSoft,
    },
    exampleChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.xs + 2,
    },
    exampleChip: {
      backgroundColor: colors.surface,
      borderRadius: Radius.control,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      paddingHorizontal: Space.sm,
      paddingVertical: 4,
    },
    exampleChipText: {
      fontFamily: Fonts.medium,
      fontSize: 12,
      lineHeight: 16,
      color: colors.ink,
    },
    tipBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Space.xs + 2,
      backgroundColor: colors.surfaceAlt,
      borderRadius: Radius.block,
      padding: Space.sm + 2,
    },
    tipText: {
      ...type.caption,
      color: colors.inkSoft,
      flex: 1,
    },
    footer: {
      flexDirection: 'row',
      gap: Space.sm,
      borderTopWidth: 1,
      borderTopColor: colors.line,
      paddingTop: Space.sm + 2,
    },
    footerSecondary: {
      flex: 1,
    },
    footerPrimary: {
      flex: 1.35,
    },
    spotlightBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.lineStrong,
      paddingTop: 6,
      paddingHorizontal: Space.xs,
      gap: Space.xs,
    },
    spotlightTab: {
      flex: 1,
      minHeight: 44,
      borderRadius: Radius.control,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 4,
    },
    spotlightTabActive: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1.5,
      borderColor: colors.ink,
    },
    spotlightTabIdle: {
      opacity: 0.55,
    },
    spotlightLabel: {
      fontFamily: Fonts.medium,
      fontSize: 10,
      lineHeight: 14,
      color: colors.inkMuted,
      marginTop: 2,
    },
    spotlightLabelActive: {
      fontFamily: Fonts.semibold,
      color: colors.ink,
    },
  })
);

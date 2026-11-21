import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  Animated,
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
import { Button } from '../ui/Button';

interface TutorialHintOverlayProps {
  authed: boolean;
  gated: boolean;
  inAuthGroup: boolean;
  onNavigateTab: (route: string) => void;
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
  const { colors } = theme;
  const styles = useStyles(theme);
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;
  const wasActiveRef = useRef(false);
  const lastTriggerRef = useRef(tutorial.trigger);
  const bottomInset = Platform.OS === 'web' ? 8 : Math.max(insets.bottom, 8);
  const topInset = Platform.OS === 'web' ? Space.lg : Math.max(insets.top, Space.md);

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
      if (authed && !inAuthGroup) {
        onNavigateTab(lastTriggerRef.current === 'manual' ? '/(tabs)/me' : '/(tabs)');
      }
    }
  }, [active, authed, inAuthGroup, onNavigateTab, step.tabRoute]);

  useEffect(() => {
    if (!active) {
      enter.setValue(0);
      return;
    }
    if (reduced) {
      enter.setValue(1);
      return;
    }
    Animated.timing(enter, {
      toValue: 1,
      duration: Motion.base,
      useNativeDriver: true,
    }).start();
  }, [active, enter, reduced]);

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

  const title = resolveStepTitle(step, tutorial.trigger === 'register');

  return (
    <View
      style={styles.overlay}
      accessibilityViewIsModal
      accessibilityLabel="Panduan fitur aplikasi"
    >
      <View
        style={[
          styles.stage,
          {
            paddingTop: topInset,
            paddingBottom: Space.md,
          },
        ]}
      >
        <Animated.View
          style={[
            styles.card,
            {
              opacity: enter,
              transform: [
                {
                  translateY: enter.interpolate({
                    inputRange: [0, 1],
                    outputRange: [18, 0],
                  }),
                },
              ],
            },
          ]}
        >
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
                  size={22}
                  color={colors.ink}
                />
              </View>
              <View style={styles.heroCopy}>
                <Text style={styles.title} accessibilityRole="header">
                  {title}
                </Text>
              </View>
            </View>

            <Text style={styles.summary}>{step.summary}</Text>

            <View style={styles.clueList}>
              {step.clues.map((clue) => (
                <View key={clue.lead} style={styles.clueRow}>
                  <View style={styles.clueBullet}>
                    <Ionicons name="checkmark" size={13} color={colors.onInk} />
                  </View>
                  <Text style={styles.clueText}>
                    <Text style={styles.clueLead}>{clue.lead}</Text>
                    {` ${clue.detail}`}
                  </Text>
                </View>
              ))}
            </View>

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
                <Ionicons name="bulb-outline" size={16} color={colors.inkSoft} />
                <Text style={styles.tipText}>{step.tip}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.footerSecondary}>
              {isFirst ? (
                <Button
                  title="Lewati"
                  variant="ghost"
                  onPress={dismissTutorialHint}
                />
              ) : (
                <Button
                  title="Sebelumnya"
                  variant="secondary"
                  onPress={prevTutorialStep}
                />
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
        </Animated.View>
      </View>

      <View
        style={[
          styles.spotlightBar,
          {
            height: 58 + bottomInset,
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
                style={[
                  styles.spotlightLabel,
                  focused && styles.spotlightLabelActive,
                ]}
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
      backgroundColor: colors.scrim,
      justifyContent: 'space-between',
    },
    stage: {
      flex: 1,
      justifyContent: 'flex-end',
      paddingHorizontal: Space.gutter,
    },
    card: {
      width: '100%',
      maxWidth: 520,
      maxHeight: '88%',
      alignSelf: 'center',
      backgroundColor: colors.paper,
      borderRadius: Radius.sheet,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      paddingHorizontal: Space.lg,
      paddingTop: Space.lg,
      paddingBottom: Space.md,
      gap: Space.md,
      ...shadow.sheet,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    badge: {
      paddingHorizontal: Space.sm + 2,
      paddingVertical: 5,
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
      minHeight: 44,
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
      gap: 6,
    },
    progressSegment: {
      flex: 1,
      height: 4,
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
      gap: Space.md,
      paddingBottom: Space.xs,
    },
    heroRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
    },
    iconCircle: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    heroCopy: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      fontFamily: Fonts.serif,
      fontSize: 23,
      lineHeight: 28,
      color: colors.ink,
    },
    summary: {
      ...type.body,
      color: colors.inkSoft,
    },
    clueList: {
      gap: Space.sm + 2,
    },
    clueRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Space.sm + 2,
    },
    clueBullet: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.ink,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
      flexShrink: 0,
    },
    clueText: {
      ...type.body,
      color: colors.inkSoft,
      flex: 1,
    },
    clueLead: {
      fontFamily: Fonts.semibold,
      color: colors.ink,
    },
    exampleBox: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: Radius.block,
      padding: Space.md,
      gap: Space.sm,
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
      paddingHorizontal: Space.sm + 2,
      paddingVertical: 5,
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
      gap: Space.sm,
      backgroundColor: colors.surfaceAlt,
      borderRadius: Radius.block,
      padding: Space.md,
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
      paddingTop: Space.md,
    },
    footerSecondary: {
      flex: 1,
    },
    footerPrimary: {
      flex: 1.4,
    },
    spotlightBar: {
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

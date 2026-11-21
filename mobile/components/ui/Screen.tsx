import React, { useEffect, useRef } from 'react';
import {
  KeyboardAvoidingView,
  KeyboardAvoidingViewProps,
  Platform,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Space } from '../../utils/theme';
import { createThemedStyles, useTheme } from '../../services/theme';
import {
  registerTutorialScrollArea,
  TutorialScrollId,
} from '../../services/tutorialTargets';

interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  /** Suspend touch scrolling without unmounting the scroll content. */
  scrollEnabled?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Sticky block rendered after the scroll area (FAB, CTA bar). */
  footer?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  /** Include the bottom safe-area inset (stack screens). Tabs handle it. */
  bottomInset?: boolean;
  /** Override height avoidance for keyboards that repeatedly resize secure fields. */
  keyboardBehavior?: KeyboardAvoidingViewProps['behavior'];
  /** Optional scroll registration ID used by spotlight tutorial hints. */
  tutorialScrollId?: TutorialScrollId;
}

/** Paper background + safe area + optional pull-to-refresh. */
export function Screen({
  children,
  scroll = true,
  scrollEnabled = true,
  refreshing = false,
  onRefresh,
  footer,
  contentStyle,
  bottomInset = false,
  keyboardBehavior = Platform.OS === 'ios' ? 'padding' : 'height',
  tutorialScrollId,
}: ScreenProps) {
  const theme = useTheme();
  const { colors } = theme;
  const styles = useStyles(theme);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  const scrollYRef = useRef(0);

  useEffect(() => {
    if (!scroll || !tutorialScrollId) return;
    return registerTutorialScrollArea(tutorialScrollId, {
      scrollTo: (y: number) => {
        scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: true });
      },
      getScrollY: () => scrollYRef.current,
    });
  }, [scroll, tutorialScrollId]);

  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      style={styles.flex}
      contentContainerStyle={[styles.content, contentStyle]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      scrollEnabled={scrollEnabled}
      onScroll={(event) => {
        const y = event?.nativeEvent?.contentOffset?.y;
        if (typeof y === 'number' && Number.isFinite(y)) {
          scrollYRef.current = y;
        }
      }}
      scrollEventThrottle={16}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.ink}
            colors={[colors.ink]}
            progressBackgroundColor={colors.surface}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, styles.flex, contentStyle]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={bottomInset ? ['top', 'left', 'right', 'bottom'] : ['top', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={keyboardBehavior}
        style={styles.flex}
      >
        {body}
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles(({ colors }) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    paddingHorizontal: Space.gutter,
    paddingTop: Space.md,
    paddingBottom: Space.xxl,
  },
  flex: {
    flex: 1,
  },
}));

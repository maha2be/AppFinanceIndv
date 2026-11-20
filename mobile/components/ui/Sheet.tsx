import React, { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Motion, Radius, Space } from '../../utils/theme';
import { createThemedStyles, useTheme } from '../../services/theme';
import { useReducedMotion } from '../../utils/motion';
import { getAppLockState, subscribeAppLock } from '../../services/appLock';
import { clearSession, isAuthenticated, subscribeSession } from '../../services/session';
import { AppLockView } from '../security/AppLockView';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppAlertHost } from '../security/AppAlertHost';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Sticky action area under the scroll body. */
  footer?: React.ReactNode;
  /** Accessibility label for the close control. */
  closeLabel?: string;
}

/** Bottom sheet on paper: drag handle, ink title, optional sticky footer. */
export function Sheet({ visible, onClose, title, children, footer, closeLabel = 'Tutup' }: SheetProps) {
  const reduced = useReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;
  const lock = useSyncExternalStore(subscribeAppLock, getAppLockState, getAppLockState);
  const authenticated = useSyncExternalStore(subscribeSession, isAuthenticated, isAuthenticated);
  const theme = useTheme();
  const { colors } = theme;
  const styles = useStyles(theme);
  const gated = authenticated && (!lock.ready || lock.locked || lock.covered);
  const host = useId();

  useEffect(() => {
    if (!visible) {
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
  }, [enter, reduced, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => { if (!gated) onClose(); }}
      statusBarTranslucent
    >
      <View style={styles.root}>
      <View style={styles.modalBody} pointerEvents={gated ? 'none' : 'auto'}
        accessibilityElementsHidden={gated}
        importantForAccessibility={gated ? 'no-hide-descendants' : 'auto'}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Tutup panel"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          pointerEvents="box-none"
          style={styles.dock}
        >
          <Animated.View
            style={[
              styles.panel,
              {
                transform: [
                  {
                    translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }),
                  },
                ],
                opacity: enter,
              },
            ]}
          >
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title} accessibilityRole="header">
                {title}
              </Text>
              <Pressable
                onPress={onClose}
                hitSlop={12}
                style={styles.close}
                accessibilityRole="button"
                accessibilityLabel={closeLabel}
              >
                <Ionicons name="close" size={20} color={colors.inkSoft} />
              </Pressable>
            </View>
            <View style={styles.body}>{children}</View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
      {gated ? (
        <View style={styles.lockCover} accessibilityViewIsModal>
          <SafeAreaProvider>
            <AppLockView onSignOut={clearSession} />
          </SafeAreaProvider>
        </View>
      ) : null}
      <AppAlertHost host={host} active={visible} />
      </View>
    </Modal>
  );
}

const useStyles = createThemedStyles(({ colors, shadow }) => StyleSheet.create({
  modalBody: { flex: 1 },
  lockCover: { ...StyleSheet.absoluteFill, backgroundColor: colors.paper, zIndex: 100 },
  root: {
    flex: 1,
    backgroundColor: colors.scrim,
  },
  dock: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  panel: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingHorizontal: Space.gutter,
    paddingBottom: Space.lg,
    maxHeight: '92%',
    ...shadow.sheet,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginTop: Space.sm,
    marginBottom: Space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 24,
    lineHeight: 29,
    color: colors.ink,
    flex: 1,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  body: {
    flexShrink: 1,
    paddingBottom: Space.sm,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: Space.md,
    gap: Space.sm,
  },
}));

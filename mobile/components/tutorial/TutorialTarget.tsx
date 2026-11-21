import React, { useCallback, useEffect, useRef } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import {
  notifyTutorialTargetsChanged,
  registerTutorialTarget,
  SpotlightRect,
  TutorialTargetId,
} from '../../services/tutorialTargets';

interface TutorialTargetProps {
  id: TutorialTargetId;
  children: React.ReactNode;
  /** Trim trailing margin inside wrapped cards/sections so the highlight hugs content. */
  trimBottom?: number;
  style?: StyleProp<ViewStyle>;
}

interface MeasurableNode {
  measureInWindow?: (
    callback: (x: number, y: number, width: number, height: number) => void
  ) => void;
}

export function TutorialTarget({
  id,
  children,
  trimBottom = 0,
  style,
}: TutorialTargetProps) {
  const viewRef = useRef<React.ComponentRef<typeof View> | null>(null);
  const trimBottomRef = useRef(trimBottom);
  trimBottomRef.current = trimBottom;

  const measure = useCallback((): Promise<SpotlightRect | null> => {
    const node = viewRef.current as unknown as MeasurableNode | null;
    if (!node || typeof node.measureInWindow !== 'function') {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, 250);
      try {
        node.measureInWindow?.((x, y, width, height) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            !Number.isFinite(width) ||
            !Number.isFinite(height) ||
            width <= 0 ||
            height <= 0
          ) {
            resolve(null);
            return;
          }
          const trimmedHeight = Math.max(24, height - Math.max(0, trimBottomRef.current));
          resolve({ x, y, width, height: trimmedHeight });
        });
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      }
    });
  }, []);

  useEffect(() => {
    return registerTutorialTarget(id, measure);
  }, [id, measure]);

  return (
    <View
      ref={viewRef}
      collapsable={false}
      onLayout={() => notifyTutorialTargetsChanged()}
      style={style}
    >
      {children}
    </View>
  );
}

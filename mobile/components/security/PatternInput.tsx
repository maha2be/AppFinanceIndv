import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Colors, Fonts, Radius, Space, Type } from '../../utils/theme';
import { appendPatternNode } from '../../utils/lockPattern';

export interface PatternInputProps {
  value: number[];
  onChange: (value: number[]) => void;
  /** Let a scrollable parent suspend scrolling while a node-started drag is active. */
  onDrawingChange?: (drawing: boolean) => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
  accessibilityLabel?: string;
}

const NODES = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

const DEFAULT_BOARD_SIZE = 240;
const MAX_BOARD_SIZE = 260;
const NODE_HIT_RATIO = 0.38;
const NODE_OUTER_SIZE = 44;
const NODE_OUTER_RADIUS = NODE_OUTER_SIZE / 2;

function clampBoardSize(size: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    return DEFAULT_BOARD_SIZE;
  }
  return Math.min(MAX_BOARD_SIZE, Math.round(size));
}

function resolveHitNode(x: number, y: number, boardSize: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || boardSize <= 0) {
    return null;
  }
  if (x < 0 || y < 0 || x > boardSize || y > boardSize) {
    return null;
  }

  const cellSize = boardSize / 3;
  const maxDistance = cellSize * NODE_HIT_RATIO;

  for (let index = 0; index < NODES.length; index += 1) {
    const row = Math.floor(index / 3);
    const col = index % 3;
    const centerX = (col + 0.5) * cellSize;
    const centerY = (row + 0.5) * cellSize;
    const distance = Math.hypot(x - centerX, y - centerY);
    if (distance <= maxDistance) {
      return index;
    }
  }

  return null;
}

function getNodeCenter(node: number, boardSize: number): { x: number; y: number } {
  const cellSize = boardSize / 3;
  const row = Math.floor(node / 3);
  const col = node % 3;
  return {
    x: (col + 0.5) * cellSize,
    y: (row + 0.5) * cellSize,
  };
}

function samePattern(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

export function PatternInput({
  value,
  onChange,
  onDrawingChange,
  disabled = false,
  label,
  hint,
  accessibilityLabel = 'Pola kunci 3x3',
}: PatternInputProps) {
  const [boardSize, setBoardSize] = useState(DEFAULT_BOARD_SIZE);
  const [isDrawing, setIsDrawing] = useState(false);
  const activePatternRef = useRef<number[]>(value);
  const drawingRef = useRef(false);
  const drawingChangeRef = useRef(onDrawingChange);

  activePatternRef.current = value;
  drawingChangeRef.current = onDrawingChange;

  const setDrawing = useCallback((drawing: boolean) => {
    if (drawingRef.current === drawing) return;
    drawingRef.current = drawing;
    setIsDrawing(drawing);
    drawingChangeRef.current?.(drawing);
  }, []);

  useEffect(() => () => {
    activePatternRef.current = [];
    if (drawingRef.current) {
      drawingRef.current = false;
      drawingChangeRef.current?.(false);
    }
  }, []);

  useEffect(() => {
    if (disabled || value.length === 0) {
      setDrawing(false);
    }
  }, [disabled, value.length, setDrawing]);

  const handleBoardLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) {
      setBoardSize(clampBoardSize(width));
    }
  }, []);

  const appendAtCoordinates = useCallback(
    (x: number, y: number, basePattern: readonly number[]) => {
      const hit = resolveHitNode(x, y, boardSize);
      if (hit === null) {
        return;
      }
      const next = appendPatternNode(basePattern, hit);
      if (!samePattern(basePattern, next)) {
        activePatternRef.current = next;
        onChange(next);
      }
    },
    [boardSize, onChange]
  );

  const handleResponderGrant = useCallback(
    (event: GestureResponderEvent) => {
      if (disabled) {
        return;
      }
      const { locationX, locationY } = event.nativeEvent;
      const hit = resolveHitNode(locationX, locationY, boardSize);
      if (hit !== null) {
        setDrawing(true);
        const next = appendPatternNode([], hit);
        activePatternRef.current = next;
        onChange(next);
      }
    },
    [boardSize, disabled, onChange, setDrawing]
  );

  const handleResponderMove = useCallback(
    (event: GestureResponderEvent) => {
      if (disabled || !drawingRef.current) {
        return;
      }
      const { locationX, locationY } = event.nativeEvent;
      appendAtCoordinates(locationX, locationY, activePatternRef.current);
    },
    [appendAtCoordinates, disabled]
  );

  const handleResponderRelease = useCallback(() => {
    setDrawing(false);
  }, [setDrawing]);

  const handleResponderTerminate = useCallback(() => {
    if (!drawingRef.current) {
      return;
    }
    setDrawing(false);
    if (activePatternRef.current.length > 0) {
      activePatternRef.current = [];
      onChange([]);
    }
  }, [onChange, setDrawing]);

  const handleClear = useCallback(() => {
    if (disabled || value.length === 0) {
      return;
    }
    setDrawing(false);
    activePatternRef.current = [];
    onChange([]);
  }, [disabled, onChange, value.length, setDrawing]);

  const shouldStartDrawing = useCallback((event: GestureResponderEvent) =>
    !disabled && resolveHitNode(event.nativeEvent.locationX, event.nativeEvent.locationY, boardSize) !== null,
  [boardSize, disabled]);

  const selectedSet = new Set(value);
  const startNode = value.length > 0 ? value[0] : null;
  const endNode = value.length > 0 ? value[value.length - 1] : null;

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      <View style={styles.boardWrap} onLayout={handleBoardLayout}>
        <View
          accessible
          accessibilityLabel={`${accessibilityLabel}. ${value.length} dari minimal 4 titik terhubung. Tarik garis antar titik, atau gunakan PIN 6 digit sebagai alternatif aksesibel jika gestur tarik sulit dilakukan.`}
          accessibilityHint="Sentuh salah satu titik lalu tarik tanpa melepas jari untuk menghubungkan minimal 4 titik."
          onStartShouldSetResponder={shouldStartDrawing}
          onStartShouldSetResponderCapture={shouldStartDrawing}
          onMoveShouldSetResponder={() => false}
          onResponderTerminationRequest={() => false}
          onResponderGrant={handleResponderGrant}
          onResponderMove={handleResponderMove}
          onResponderRelease={handleResponderRelease}
          onResponderTerminate={handleResponderTerminate}
          style={[
            styles.board,
            { width: boardSize, height: boardSize },
            disabled && styles.boardDisabled,
          ]}
        >
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {value.map((node, index) => {
              if (index === 0) {
                return null;
              }
              const from = getNodeCenter(value[index - 1], boardSize);
              const to = getNodeCenter(node, boardSize);
              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const length = Math.hypot(dx, dy);
              const angleRad = Math.atan2(dy, dx);
              const midX = (from.x + to.x) / 2;
              const midY = (from.y + to.y) / 2;

              return (
                <View
                  key={`seg-${value[index - 1]}-${node}`}
                  style={[
                    styles.segment,
                    {
                      width: length,
                      left: midX - length / 2,
                      top: midY - 1,
                      transform: [{ rotate: `${angleRad}rad` }],
                    },
                  ]}
                />
              );
            })}

            {NODES.map((node) => {
              const center = getNodeCenter(node, boardSize);
              const selected = selectedSet.has(node);
              const isEndpoint = node === startNode || node === endNode;
              const isActiveHead = isDrawing && node === endNode;

              return (
                <View
                  key={`node-${node}`}
                  style={[
                    styles.nodeOuter,
                    {
                      left: center.x - NODE_OUTER_RADIUS,
                      top: center.y - NODE_OUTER_RADIUS,
                    },
                    selected && styles.nodeOuterSelected,
                    isActiveHead && styles.nodeOuterActiveHead,
                  ]}
                >
                  <View
                    style={[
                      styles.nodeDot,
                      selected && styles.nodeDotSelected,
                      isEndpoint && styles.nodeDotEndpoint,
                    ]}
                  />
                </View>
              );
            })}
          </View>
        </View>
      </View>

      <View style={styles.footerRow}>
        <Text style={styles.counterText} accessibilityLiveRegion="polite">
          {value.length === 0
            ? 'Sentuh titik lalu tarik garis (minimal 4 titik)'
            : value.length < 4
            ? `${value.length} titik dipilih (minimal 4 titik)`
            : `${value.length} titik dipilih`}
        </Text>
        <Pressable
          onPress={handleClear}
          disabled={disabled || value.length === 0}
          accessibilityRole="button"
          accessibilityLabel="Hapus pola"
          accessibilityState={{ disabled: disabled || value.length === 0 }}
          style={({ pressed }) => [
            styles.clearButton,
            (disabled || value.length === 0) && styles.controlDisabled,
            pressed && !disabled && value.length > 0 && styles.clearButtonPressed,
          ]}
        >
          <Text style={styles.clearButtonText}>Ulangi pola</Text>
        </Pressable>
      </View>

      <Text style={styles.a11yCaption}>
        Kesulitan menggambar pola? Gunakan PIN 6 digit sebagai alternatif yang ramah pembaca layar.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Space.sm,
  },
  label: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.inkSoft,
  },
  hint: {
    ...Type.caption,
    color: Colors.inkMuted,
  },
  boardWrap: {
    width: '100%',
    maxWidth: MAX_BOARD_SIZE,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Space.xs,
  },
  board: {
    position: 'relative',
  },
  boardDisabled: {
    opacity: 0.45,
  },
  nodeOuter: {
    position: 'absolute',
    width: NODE_OUTER_SIZE,
    height: NODE_OUTER_SIZE,
    borderRadius: NODE_OUTER_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeOuterSelected: {
    backgroundColor: Colors.inkTint,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  nodeOuterActiveHead: {
    borderColor: Colors.ink,
    borderWidth: 1.5,
  },
  nodeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.lineStrong,
    borderWidth: 1.5,
    borderColor: Colors.inkSoft,
  },
  nodeDotSelected: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.ink,
    borderWidth: 0,
  },
  nodeDotEndpoint: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.ink,
    borderWidth: 0,
  },
  segment: {
    position: 'absolute',
    height: 2,
    borderRadius: 1,
    backgroundColor: Colors.ink,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    paddingTop: Space.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  counterText: {
    ...Type.caption,
    color: Colors.inkMuted,
    flex: 1,
    fontVariant: ['tabular-nums'],
  },
  clearButton: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: Space.md,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonPressed: {
    backgroundColor: Colors.surfaceAlt,
  },
  clearButtonText: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.ink,
  },
  a11yCaption: {
    ...Type.caption,
    color: Colors.inkMuted,
  },
  controlDisabled: {
    opacity: 0.45,
  },
});

export default PatternInput;

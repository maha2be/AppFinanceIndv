/**
 * Registry of live UI target measurements and scrollable Screen containers
 * for spotlight coach-mark tutorial hints.
 */

export type TutorialTargetId =
  | 'home.summary'
  | 'home.quickInput'
  | 'add.type'
  | 'reports.cashflow'
  | 'reports.stability'
  | 'me.features'
  | 'me.settings';

export type TutorialScrollId = 'home' | 'add' | 'reports' | 'me';

export interface SpotlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TutorialScrollController {
  scrollTo: (y: number) => void;
  getScrollY: () => number;
}

type TargetMeasurer = () => Promise<SpotlightRect | null>;

const targets = new Map<TutorialTargetId, TargetMeasurer>();
const scrollAreas = new Map<TutorialScrollId, TutorialScrollController>();
const listeners = new Set<() => void>();

export function subscribeTutorialTargets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyTutorialTargetsChanged(): void {
  listeners.forEach((listener) => listener());
}

export function registerTutorialTarget(
  id: TutorialTargetId,
  measure: TargetMeasurer
): () => void {
  targets.set(id, measure);
  notifyTutorialTargetsChanged();
  return () => {
    if (targets.get(id) === measure) {
      targets.delete(id);
    }
  };
}

export async function measureTutorialTarget(
  id: TutorialTargetId
): Promise<SpotlightRect | null> {
  const measure = targets.get(id);
  if (!measure) return null;
  try {
    const rect = await measure();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return rect;
  } catch {
    return null;
  }
}

export function registerTutorialScrollArea(
  id: TutorialScrollId,
  controller: TutorialScrollController
): () => void {
  scrollAreas.set(id, controller);
  return () => {
    if (scrollAreas.get(id) === controller) {
      scrollAreas.delete(id);
    }
  };
}

export function getTutorialScrollArea(
  id: TutorialScrollId
): TutorialScrollController | undefined {
  return scrollAreas.get(id);
}

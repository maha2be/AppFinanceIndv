/**
 * Session-scoped tutorial hint store.
 *
 * Queues the guided tutorial only on explicit login or registration
 * (never when restoring an existing session on cold app start or app unlock).
 */
import { TUTORIAL_STEPS } from '../utils/tutorialSteps';

export type TutorialTrigger = 'login' | 'register' | 'manual';

export interface TutorialHintState {
  visible: boolean;
  pendingAfterUnlock: boolean;
  stepIndex: number;
  trigger: TutorialTrigger;
}

const TOTAL_STEPS = TUTORIAL_STEPS.length;

let state: TutorialHintState = {
  visible: false,
  pendingAfterUnlock: false,
  stepIndex: 0,
  trigger: 'login',
};

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeTutorialHint(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTutorialHintState(): TutorialHintState {
  return state;
}

/** Queue the tutorial to appear once the signed-in user enters the unlocked app tabs. */
export function queueTutorialOnSignIn(trigger: 'login' | 'register' = 'login'): void {
  state = {
    visible: false,
    pendingAfterUnlock: true,
    stepIndex: 0,
    trigger,
  };
  emit();
}

/** Activate a queued login/register tutorial once inside unlocked tabs. */
export function activatePendingTutorial(): void {
  if (!state.pendingAfterUnlock) return;
  state = {
    ...state,
    visible: true,
    pendingAfterUnlock: false,
    stepIndex: 0,
  };
  emit();
}

/** Open the tutorial manually on demand (e.g. from Saya -> Panduan aplikasi). */
export function openTutorialGuide(): void {
  state = {
    visible: true,
    pendingAfterUnlock: false,
    stepIndex: 0,
    trigger: 'manual',
  };
  emit();
}

export function nextTutorialStep(): void {
  if (!state.visible) return;
  if (state.stepIndex + 1 >= TOTAL_STEPS) {
    dismissTutorialHint();
    return;
  }
  state = {
    ...state,
    stepIndex: state.stepIndex + 1,
  };
  emit();
}

export function prevTutorialStep(): void {
  if (!state.visible || state.stepIndex <= 0) return;
  state = {
    ...state,
    stepIndex: state.stepIndex - 1,
  };
  emit();
}

export function goToTutorialStep(index: number): void {
  if (!state.visible) return;
  const clamped = Math.max(0, Math.min(TOTAL_STEPS - 1, Math.trunc(index)));
  if (clamped === state.stepIndex) return;
  state = {
    ...state,
    stepIndex: clamped,
  };
  emit();
}

export function dismissTutorialHint(): void {
  if (!state.visible && !state.pendingAfterUnlock && state.stepIndex === 0) return;
  state = {
    ...state,
    visible: false,
    pendingAfterUnlock: false,
    stepIndex: 0,
  };
  emit();
}

export function resetTutorialHint(): void {
  if (
    !state.visible &&
    !state.pendingAfterUnlock &&
    state.stepIndex === 0 &&
    state.trigger === 'login'
  ) {
    return;
  }
  state = {
    visible: false,
    pendingAfterUnlock: false,
    stepIndex: 0,
    trigger: 'login',
  };
  emit();
}

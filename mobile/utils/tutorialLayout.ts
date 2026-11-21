/** Pure geometry helpers for spotlight cutout masking, auto-scrolling, and pop-up placement. */

import type { SpotlightRect } from '../services/tutorialTargets';

export interface SpotlightViewport {
  width: number;
  height: number;
  topInset: number;
  bottomReserve: number;
}

export interface SpotlightPlacement {
  cutout: SpotlightRect;
  placement: 'above' | 'below' | 'center';
  cardTop: number;
  cardLeft: number;
  cardWidth: number;
  cardMaxHeight: number;
  arrowLeft: number | null;
  arrowDirection: 'up' | 'down' | null;
}

const DEFAULT_PADDING = 6;
const CUTOUT_RADIUS = 14;
const CARD_GAP = 12;
const SIDE_MARGIN = 16;
const MAX_CARD_WIDTH = 420;
const MIN_POPUP_SPACE = 176;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

/** Expand the target rectangle slightly and clamp inside the visible viewport. */
export function computePaddedCutout(
  target: SpotlightRect,
  viewport: SpotlightViewport,
  padding = DEFAULT_PADDING
): SpotlightRect {
  const minX = 6;
  const maxRight = Math.max(minX + 1, viewport.width - 6);
  const minY = Math.max(4, viewport.topInset + 2);
  const maxBottom = Math.max(minY + 1, viewport.height - viewport.bottomReserve - 4);

  const left = clamp(target.x - padding, minX, maxRight - 1);
  const top = clamp(target.y - padding, minY, maxBottom - 1);
  const right = clamp(target.x + target.width + padding, left + 1, maxRight);
  const bottom = clamp(target.y + target.height + padding, top + 1, maxBottom);

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

/** Return the target ScrollView offset if the highlighted element needs scrolling into view. */
export function computeScrollTargetY(
  target: SpotlightRect,
  viewport: SpotlightViewport,
  currentScrollY: number
): number | null {
  const safeTop = viewport.topInset + 12;
  const safeBottom = viewport.height - viewport.bottomReserve - 12;
  const availableHeight = Math.max(120, safeBottom - safeTop);

  const targetBottom = target.y + target.height;
  const inVerticalBounds = target.y >= safeTop && targetBottom <= safeBottom;
  const spaceAbove = target.y - safeTop;
  const spaceBelow = safeBottom - targetBottom;
  const hasPopupRoom = Math.max(spaceAbove, spaceBelow) >= MIN_POPUP_SPACE;

  if (inVerticalBounds && (hasPopupRoom || target.height > availableHeight * 0.65)) {
    return null;
  }

  // Position target either comfortably near top (leaving room below) or cleanly in view.
  const desiredTop = safeTop + 16;
  const delta = target.y - desiredTop;
  if (Math.abs(delta) < 12) return null;
  return Math.max(0, Math.round(currentScrollY + delta));
}

/** Build an SVG path string with an outer viewport rect and an inner rounded cutout hole. */
export function buildSpotlightMaskPath(
  viewportWidth: number,
  viewportHeight: number,
  cutout: SpotlightRect | null,
  radius = CUTOUT_RADIUS
): string {
  const w = Math.max(1, Math.round(viewportWidth));
  const h = Math.max(1, Math.round(viewportHeight));
  const outer = `M 0 0 H ${w} V ${h} H 0 Z`;
  if (!cutout || cutout.width <= 0 || cutout.height <= 0) {
    return outer;
  }

  const r = Math.max(0, Math.min(radius, cutout.width / 2, cutout.height / 2));
  const x = cutout.x;
  const y = cutout.y;
  const cw = cutout.width;
  const ch = cutout.height;
  const x2 = x + cw;
  const y2 = y + ch;

  const inner =
    `M ${x + r} ${y} ` +
    `H ${x2 - r} ` +
    `A ${r} ${r} 0 0 1 ${x2} ${y + r} ` +
    `V ${y2 - r} ` +
    `A ${r} ${r} 0 0 1 ${x2 - r} ${y2} ` +
    `H ${x + r} ` +
    `A ${r} ${r} 0 0 1 ${x} ${y2 - r} ` +
    `V ${y + r} ` +
    `A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;

  return `${outer} ${inner}`;
}

/** Position the floating pop-up card above or below the highlighted cutout with pointer arrow. */
export function computeSpotlightPlacement(
  target: SpotlightRect | null,
  viewport: SpotlightViewport,
  measuredCardHeight = 250
): SpotlightPlacement {
  const cardWidth = Math.min(MAX_CARD_WIDTH, Math.max(240, viewport.width - SIDE_MARGIN * 2));
  const cardLeft = Math.round((viewport.width - cardWidth) / 2);
  const safeTop = viewport.topInset + 8;
  const safeBottom = Math.max(safeTop + 160, viewport.height - viewport.bottomReserve - 10);
  const fullAvailableHeight = Math.max(160, safeBottom - safeTop);
  const estimatedHeight = Math.min(fullAvailableHeight, Math.max(150, measuredCardHeight));

  if (!target || target.width <= 0 || target.height <= 0) {
    const centeredTop = Math.round(safeTop + Math.max(0, (fullAvailableHeight - estimatedHeight) / 2));
    return {
      cutout: { x: 0, y: 0, width: 0, height: 0 },
      placement: 'center',
      cardTop: clamp(centeredTop, safeTop, safeBottom - estimatedHeight),
      cardLeft,
      cardWidth,
      cardMaxHeight: fullAvailableHeight,
      arrowLeft: null,
      arrowDirection: null,
    };
  }

  const cutout = computePaddedCutout(target, viewport);
  const spaceBelow = safeBottom - (cutout.y + cutout.height + CARD_GAP);
  const spaceAbove = cutout.y - CARD_GAP - safeTop;

  const targetCenterX = cutout.x + cutout.width / 2;
  const arrowLeft = Math.round(clamp(targetCenterX, cardLeft + 24, cardLeft + cardWidth - 24));

  if (spaceBelow >= estimatedHeight || (spaceBelow >= spaceAbove && spaceBelow >= MIN_POPUP_SPACE)) {
    const cardMaxHeight = Math.max(150, Math.round(spaceBelow));
    const clampedHeight = Math.min(estimatedHeight, cardMaxHeight);
    const cardTop = Math.round(
      clamp(cutout.y + cutout.height + CARD_GAP, safeTop, safeBottom - clampedHeight)
    );
    return {
      cutout,
      placement: 'below',
      cardTop,
      cardLeft,
      cardWidth,
      cardMaxHeight,
      arrowLeft,
      arrowDirection: 'up',
    };
  }

  if (spaceAbove >= estimatedHeight || spaceAbove >= MIN_POPUP_SPACE) {
    const cardMaxHeight = Math.max(150, Math.round(spaceAbove));
    const clampedHeight = Math.min(estimatedHeight, cardMaxHeight);
    const cardTop = Math.round(
      clamp(cutout.y - CARD_GAP - clampedHeight, safeTop, safeBottom - clampedHeight)
    );
    return {
      cutout,
      placement: 'above',
      cardTop,
      cardLeft,
      cardWidth,
      cardMaxHeight,
      arrowLeft,
      arrowDirection: 'down',
    };
  }

  // Fallback for very tall targets: dock cleanly at bottom or top of safe area.
  const placeBottom = spaceBelow >= spaceAbove;
  const cardTop = placeBottom
    ? Math.round(safeBottom - Math.min(estimatedHeight, fullAvailableHeight))
    : Math.round(safeTop);
  return {
    cutout,
    placement: 'center',
    cardTop,
    cardLeft,
    cardWidth,
    cardMaxHeight: fullAvailableHeight,
    arrowLeft: null,
    arrowDirection: null,
  };
}

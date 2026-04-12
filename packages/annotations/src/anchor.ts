import type {
  AnnotationAnchor,
  AnnotationContainerFingerprint,
  AnnotationLinkedElement,
  AnnotationPoint,
  AnnotationRect,
  AnnotationScrollChainNode,
  AnnotationThread,
} from "./annotation-plugin";

export interface ResolvedAnnotationPosition {
  anchored: boolean;
  confidence: number;
  top: number;
  left: number;
}

export const BUBBLE_SIZE = 24;
export const BUBBLE_RADIUS = BUBBLE_SIZE / 2;
const BUBBLE_EDGE_MARGIN = 8;
const VISIBLE_BOUNDS_EPSILON = 1;

interface BoundsRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface AxisRange {
  min: number;
  max: number;
}

function rectRight(rect: Pick<DOMRect, "left" | "width" | "right">): number {
  return Number.isFinite(rect.right) ? Number(rect.right) : rect.left + rect.width;
}

function rectBottom(rect: Pick<DOMRect, "top" | "height" | "bottom">): number {
  return Number.isFinite(rect.bottom) ? Number(rect.bottom) : rect.top + rect.height;
}

function toClassTokens(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => token.length < 40)
    .slice(0, 6);
}

function normalizeTextContent(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function getSiblingIndex(element: HTMLElement): number {
  let index = 0;
  let sibling: Element | null = element.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === element.tagName) {
      index += 1;
    }
    sibling = sibling.previousElementSibling;
  }
  return index;
}

function buildDomPath(element: HTMLElement): string {
  const parts: string[] = [];
  let cursor: HTMLElement | null = element;

  while (cursor && parts.length < 4) {
    const tag = cursor.tagName.toLowerCase();
    parts.push(`${tag}:nth(${getSiblingIndex(cursor)})`);
    cursor = cursor.parentElement;
  }

  return parts.reverse().join(">");
}

function getContainerFingerprint(element: HTMLElement): AnnotationContainerFingerprint {
  const dataAttributes: Record<string, string> = {};

  for (const key of ["data-testid", "data-test", "data-qa", "data-cy"]) {
    const value = element.getAttribute(key);
    if (value) {
      dataAttributes[key] = value;
    }
  }

  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || undefined,
    role: element.getAttribute("role") || undefined,
    classTokens: toClassTokens(element.className || ""),
    dataAttributes: Object.keys(dataAttributes).length > 0 ? dataAttributes : undefined,
    domPath: buildDomPath(element),
  };
}

function getLinkedElement(element: HTMLElement): AnnotationLinkedElement {
  const textPreview = normalizeTextContent(element.textContent || "");
  return {
    fingerprint: getContainerFingerprint(element),
    tagName: element.tagName.toLowerCase(),
    id: element.id || undefined,
    className: toClassTokens(element.className || "").join(" ") || undefined,
    role: element.getAttribute("role") || undefined,
    textPreview: textPreview || undefined,
  };
}

function isScrollableElement(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const overflowY = style.overflowY;
  const overflowX = style.overflowX;

  const yScrollable =
    (overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight;
  const xScrollable =
    (overflowX === "auto" || overflowX === "scroll") && element.scrollWidth > element.clientWidth;

  return yScrollable || xScrollable;
}

function isAnnotationUiElement(element: Element): boolean {
  return Boolean(element.closest("[data-deshlo-annotation-ui='1']"));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toRelativeOffset(element: HTMLElement, point: AnnotationPoint): AnnotationPoint {
  const rect = element.getBoundingClientRect();
  return {
    x: point.x - rect.left + element.scrollLeft,
    y: point.y - rect.top + element.scrollTop,
  };
}

function toBubblePosition(point: AnnotationPoint): AnnotationPoint {
  return {
    x: clamp(
      point.x - BUBBLE_RADIUS,
      BUBBLE_EDGE_MARGIN,
      Math.max(window.innerWidth - BUBBLE_SIZE - BUBBLE_EDGE_MARGIN, BUBBLE_EDGE_MARGIN)
    ),
    y: clamp(
      point.y - BUBBLE_RADIUS,
      BUBBLE_EDGE_MARGIN,
      Math.max(window.innerHeight - BUBBLE_SIZE - BUBBLE_EDGE_MARGIN, BUBBLE_EDGE_MARGIN)
    ),
  };
}

function clampBubbleToContainer(position: AnnotationPoint, rect: BoundsRect): AnnotationPoint {
  const minLeft = rect.left;
  const minTop = rect.top;
  const maxLeft = rect.left + rect.width - BUBBLE_SIZE;
  const maxTop = rect.top + rect.height - BUBBLE_SIZE;

  return {
    x: clamp(position.x, minLeft, maxLeft < minLeft ? minLeft : maxLeft),
    y: clamp(position.y, minTop, maxTop < minTop ? minTop : maxTop),
  };
}

function normalizeAxisRange(range: AxisRange): AxisRange {
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) {
    return { min: 0, max: 0 };
  }
  if (range.max < range.min) {
    return {
      min: range.min,
      max: range.min,
    };
  }
  return range;
}

function toBubbleAxisRange(minEdge: number, maxEdge: number): AxisRange {
  return normalizeAxisRange({
    min: minEdge,
    max: maxEdge - BUBBLE_SIZE,
  });
}

function collapseAxisToNearestEdge(current: AxisRange, clip: AxisRange): AxisRange {
  if (current.max <= clip.min + VISIBLE_BOUNDS_EPSILON) {
    return { min: clip.min, max: clip.min };
  }
  if (current.min >= clip.max - VISIBLE_BOUNDS_EPSILON) {
    return { min: clip.max, max: clip.max };
  }

  const center = (current.min + current.max) / 2;
  const nearest =
    Math.abs(center - clip.min) <= Math.abs(center - clip.max) ? clip.min : clip.max;
  return { min: nearest, max: nearest };
}

function intersectAxisRange(current: AxisRange, clip: AxisRange): AxisRange {
  const overlapMin = Math.max(current.min, clip.min);
  const overlapMax = Math.min(current.max, clip.max);
  if (overlapMax - overlapMin >= VISIBLE_BOUNDS_EPSILON) {
    return {
      min: overlapMin,
      max: overlapMax,
    };
  }
  return collapseAxisToNearestEdge(current, clip);
}

function resolveVisibleBounds(container: HTMLElement): BoundsRect {
  const containerRect = container.getBoundingClientRect();
  const clipValues = new Set(["hidden", "scroll", "auto", "clip"]);

  let xRange = toBubbleAxisRange(containerRect.left, rectRight(containerRect));
  let yRange = toBubbleAxisRange(containerRect.top, rectBottom(containerRect));

  let cursor: HTMLElement | null = container.parentElement;
  while (cursor) {
    const style = getComputedStyle(cursor);
    const clipX = clipValues.has(style.overflowX);
    const clipY = clipValues.has(style.overflowY);
    if (clipX || clipY) {
      const rect = cursor.getBoundingClientRect();
      if (clipX) {
        xRange = intersectAxisRange(xRange, toBubbleAxisRange(rect.left, rectRight(rect)));
      }
      if (clipY) {
        yRange = intersectAxisRange(yRange, toBubbleAxisRange(rect.top, rectBottom(rect)));
      }
    }

    cursor = cursor.parentElement;
  }

  xRange = intersectAxisRange(xRange, toBubbleAxisRange(0, window.innerWidth));
  yRange = intersectAxisRange(yRange, toBubbleAxisRange(0, window.innerHeight));

  return {
    left: xRange.min,
    top: yRange.min,
    width: Math.max(BUBBLE_SIZE, xRange.max - xRange.min + BUBBLE_SIZE),
    height: Math.max(BUBBLE_SIZE, yRange.max - yRange.min + BUBBLE_SIZE),
  };
}

function getScrollableAncestors(element: HTMLElement): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  let cursor: HTMLElement | null = element;

  while (cursor) {
    if (isScrollableElement(cursor)) {
      ancestors.push(cursor);
    }

    cursor = cursor.parentElement;
  }

  return ancestors;
}

function scoreElementAgainstFingerprint(
  element: HTMLElement,
  fingerprint: AnnotationContainerFingerprint
): number {
  let score = 0;

  if (fingerprint.tagName === element.tagName.toLowerCase()) {
    score += 2;
  }

  if (fingerprint.id && fingerprint.id === element.id) {
    score += 6;
  }

  if (fingerprint.role && fingerprint.role === element.getAttribute("role")) {
    score += 2;
  }

  const classList = new Set(toClassTokens(element.className || ""));
  if (fingerprint.classTokens) {
    for (const token of fingerprint.classTokens) {
      if (classList.has(token)) {
        score += 1;
      }
    }
  }

  if (fingerprint.dataAttributes) {
    for (const [key, value] of Object.entries(fingerprint.dataAttributes)) {
      if (element.getAttribute(key) === value) {
        score += 4;
      }
    }
  }

  if (fingerprint.domPath && buildDomPath(element) === fingerprint.domPath) {
    score += 2;
  }

  return score;
}

export function findElementByFingerprint(
  fingerprint: AnnotationContainerFingerprint
): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  if (fingerprint.id) {
    const byId = document.getElementById(fingerprint.id);
    if (byId instanceof HTMLElement) {
      return byId;
    }
  }

  const selector = fingerprint.tagName || "*";
  const candidates = Array.from(document.querySelectorAll(selector)).filter(
    (node): node is HTMLElement => node instanceof HTMLElement
  );

  let best: HTMLElement | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = scoreElementAgainstFingerprint(candidate, fingerprint);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return bestScore >= 3 ? best : null;
}

export function resolveDeepestTargetAtPoint(point: AnnotationPoint): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  if (typeof document.elementsFromPoint === "function") {
    const candidates = document.elementsFromPoint(point.x, point.y);
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement)) {
        continue;
      }
      if (isAnnotationUiElement(candidate)) {
        continue;
      }
      return candidate;
    }
  }

  const candidate = document.elementFromPoint(point.x, point.y);
  if (candidate instanceof HTMLElement && !isAnnotationUiElement(candidate)) {
    return candidate;
  }
  return null;
}

export function captureAnnotationAnchor(target: HTMLElement, point: AnnotationPoint): AnnotationAnchor {
  const targetRect = target.getBoundingClientRect();
  const safeWidth = targetRect.width <= 0 ? 1 : targetRect.width;
  const safeHeight = targetRect.height <= 0 ? 1 : targetRect.height;

  const scrollChain: AnnotationScrollChainNode[] = getScrollableAncestors(target).map((container) => {
    const relativePoint = toRelativeOffset(container, point);

    return {
      fingerprint: getContainerFingerprint(container),
      scrollTop: container.scrollTop,
      scrollLeft: container.scrollLeft,
      offsetX: relativePoint.x,
      offsetY: relativePoint.y,
    };
  });

  return {
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    pageScroll: {
      x: window.scrollX,
      y: window.scrollY,
    },
    targetRect: {
      left: targetRect.left,
      top: targetRect.top,
      width: targetRect.width,
      height: targetRect.height,
    },
    targetPoint: {
      x: point.x,
      y: point.y,
    },
    normalized: {
      viewportXRatio: point.x / Math.max(window.innerWidth, 1),
      viewportYRatio: point.y / Math.max(window.innerHeight, 1),
      rectXRatio: (point.x - targetRect.left) / safeWidth,
      rectYRatio: (point.y - targetRect.top) / safeHeight,
    },
    scrollChain,
    linkedElement: getLinkedElement(target),
  };
}

function resolveFromScrollChain(anchor: AnnotationAnchor): ResolvedAnnotationPosition | null {
  if (anchor.scrollChain.length === 0) {
    return null;
  }

  const nearest = anchor.scrollChain[0];
  const container = findElementByFingerprint(nearest.fingerprint);
  if (!container) {
    return null;
  }

  const rect = container.getBoundingClientRect();
  const point = {
    x: rect.left + nearest.offsetX - container.scrollLeft,
    y: rect.top + nearest.offsetY - container.scrollTop,
  };

  const visibleBounds = resolveVisibleBounds(container);
  const bubble = clampBubbleToContainer(toBubblePosition(point), visibleBounds);
  return {
    anchored: true,
    confidence: 0.92,
    left: bubble.x,
    top: bubble.y,
  };
}

function resolveFromViewport(anchor: AnnotationAnchor): ResolvedAnnotationPosition {
  const point = {
    x: anchor.normalized.viewportXRatio * window.innerWidth,
    y: anchor.normalized.viewportYRatio * window.innerHeight,
  };

  const bubble = toBubblePosition(point);

  return {
    anchored: true,
    confidence: 0.4,
    left: bubble.x,
    top: bubble.y,
  };
}

function applyPresentationOffset(
  base: ResolvedAnnotationPosition,
  anchor: AnnotationAnchor
): ResolvedAnnotationPosition {
  if (anchor.presentation?.mode !== "detached") {
    return base;
  }

  const offsetX = Number.isFinite(anchor.presentation.offsetX) ? Number(anchor.presentation.offsetX) : 0;
  const offsetY = Number.isFinite(anchor.presentation.offsetY) ? Number(anchor.presentation.offsetY) : 0;

  return {
    ...base,
    left: base.left + offsetX,
    top: base.top + offsetY,
  };
}

export function resolveAnnotationPosition(anchor: AnnotationAnchor): ResolvedAnnotationPosition {
  const byContainer = resolveFromScrollChain(anchor);
  if (byContainer) {
    return applyPresentationOffset(byContainer, anchor);
  }

  if (anchor.scrollChain.length > 0) {
    return {
      anchored: false,
      confidence: 0,
      left: 0,
      top: 0,
    };
  }

  return applyPresentationOffset(resolveFromViewport(anchor), anchor);
}

export function resolveThreadPositions(
  threads: AnnotationThread[]
): Record<string, ResolvedAnnotationPosition> {
  const positions: Record<string, ResolvedAnnotationPosition> = {};

  for (const thread of threads) {
    positions[thread.threadId] = resolveAnnotationPosition(thread.anchor);
  }

  return positions;
}

export function toPointFromMouseEvent(event: MouseEvent): AnnotationPoint {
  return {
    x: event.clientX,
    y: event.clientY,
  };
}

export function toRectFromElement(element: HTMLElement): AnnotationRect {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export function resolveAnchorLinkedElement(anchor: AnnotationAnchor): HTMLElement | null {
  if (anchor.linkedElement?.fingerprint) {
    const byLinkedFingerprint = findElementByFingerprint(anchor.linkedElement.fingerprint);
    if (byLinkedFingerprint) {
      return byLinkedFingerprint;
    }
  }

  if (anchor.scrollChain.length > 0) {
    return findElementByFingerprint(anchor.scrollChain[0].fingerprint);
  }

  return null;
}

export function resolveLinkedElementCenter(anchor: AnnotationAnchor): AnnotationPoint | null {
  const element = resolveAnchorLinkedElement(anchor);
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

export function resolveAnchorTargetPoint(anchor: AnnotationAnchor): AnnotationPoint | null {
  if (typeof window === "undefined") {
    return anchor.targetPoint || null;
  }

  if (anchor.scrollChain.length > 0) {
    const nearest = anchor.scrollChain[0];
    const container = findElementByFingerprint(nearest.fingerprint);
    if (container) {
      const rect = container.getBoundingClientRect();
      return {
        x: rect.left + nearest.offsetX - container.scrollLeft,
        y: rect.top + nearest.offsetY - container.scrollTop,
      };
    }
  }

  const viewportX = anchor.normalized?.viewportXRatio;
  const viewportY = anchor.normalized?.viewportYRatio;
  if (Number.isFinite(viewportX) && Number.isFinite(viewportY)) {
    return {
      x: Number(viewportX) * window.innerWidth,
      y: Number(viewportY) * window.innerHeight,
    };
  }

  if (anchor.targetPoint) {
    return anchor.targetPoint;
  }

  return null;
}

export function formatLinkedElementLabel(anchor: AnnotationAnchor): string {
  const linked = anchor.linkedElement;
  if (!linked) {
    return "unknown element";
  }

  const parts: string[] = [linked.tagName || "element"];
  if (linked.id) {
    parts.push(`#${linked.id}`);
  }
  if (linked.className) {
    const firstClass = linked.className.split(/\s+/).find(Boolean);
    if (firstClass) {
      parts.push(`.${firstClass}`);
    }
  }
  if (linked.textPreview) {
    parts.push(`"${linked.textPreview}"`);
  }
  return parts.join(" ");
}

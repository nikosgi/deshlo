import { describe, expect, it } from "vitest";

import { captureAnnotationAnchor, resolveAnnotationPosition } from "./anchor";

interface FakeElement extends Partial<HTMLElement> {
  tagName: string;
  parentElement: HTMLElement | null;
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
  className: string;
  id: string;
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => DOMRect;
  previousElementSibling: Element | null;
}

function createFakeElement(params: {
  tagName: string;
  parent?: HTMLElement | null;
  rect: { left: number; top: number; width: number; height: number };
  id?: string;
  className?: string;
  role?: string;
  overflowY?: string;
  overflowX?: string;
  scrollTop?: number;
  scrollLeft?: number;
  scrollHeight?: number;
  clientHeight?: number;
  scrollWidth?: number;
  clientWidth?: number;
}): HTMLElement {
  const attrs = new Map<string, string>();
  if (params.role) {
    attrs.set("role", params.role);
  }

  const fake: FakeElement = {
    tagName: params.tagName.toUpperCase(),
    parentElement: params.parent || null,
    scrollTop: params.scrollTop || 0,
    scrollLeft: params.scrollLeft || 0,
    scrollHeight: params.scrollHeight || params.rect.height,
    clientHeight: params.clientHeight || params.rect.height,
    scrollWidth: params.scrollWidth || params.rect.width,
    clientWidth: params.clientWidth || params.rect.width,
    className: params.className || "",
    id: params.id || "",
    previousElementSibling: null,
    getAttribute(name: string) {
      return attrs.get(name) || null;
    },
    getBoundingClientRect() {
      return {
        x: params.rect.left,
        y: params.rect.top,
        left: params.rect.left,
        top: params.rect.top,
        width: params.rect.width,
        height: params.rect.height,
        right: params.rect.left + params.rect.width,
        bottom: params.rect.top + params.rect.height,
        toJSON: () => ({}),
      } as DOMRect;
    },
  };

  (fake as any).__overflowY = params.overflowY || "visible";
  (fake as any).__overflowX = params.overflowX || "visible";

  return fake as HTMLElement;
}

describe("annotation anchor", () => {
  it("captures viewport and nested scroll-chain metadata", () => {
    (globalThis as any).window = {
      innerWidth: 1280,
      innerHeight: 720,
      scrollX: 0,
      scrollY: 0,
    };
    (globalThis as any).getComputedStyle = (element: any) => ({
      overflowY: element.__overflowY || "visible",
      overflowX: element.__overflowX || "visible",
    });

    const container = createFakeElement({
      tagName: "div",
      id: "scroll-pane",
      className: "content-pane",
      rect: { left: 40, top: 80, width: 600, height: 300 },
      overflowY: "auto",
      scrollTop: 180,
      scrollHeight: 1200,
      clientHeight: 300,
    });

    const target = createFakeElement({
      tagName: "p",
      parent: container,
      rect: { left: 100, top: 150, width: 320, height: 50 },
    });

    const anchor = captureAnnotationAnchor(target, { x: 180, y: 170 });

    expect(anchor.viewport.width).toBe(1280);
    expect(anchor.viewport.height).toBe(720);
    expect(anchor.scrollChain).toHaveLength(1);
    expect(anchor.scrollChain[0].fingerprint.id).toBe("scroll-pane");
  });

  it("falls back to viewport ratios when there is no scroll-chain", () => {
    (globalThis as any).window = {
      innerWidth: 1000,
      innerHeight: 600,
      scrollX: 0,
      scrollY: 0,
    };

    const resolved = resolveAnnotationPosition({
      viewport: { width: 1000, height: 600 },
      pageScroll: { x: 0, y: 0 },
      targetRect: { left: 10, top: 20, width: 200, height: 30 },
      targetPoint: { x: 100, y: 120 },
      normalized: {
        viewportXRatio: 0.5,
        viewportYRatio: 0.5,
        rectXRatio: 0.2,
        rectYRatio: 0.4,
      },
      scrollChain: [],
    });

    expect(resolved.anchored).toBe(true);
    expect(resolved.confidence).toBe(0.4);
  });

  it("marks unanchored when scroll-chain exists but cannot be resolved", () => {
    (globalThis as any).window = {
      innerWidth: 1000,
      innerHeight: 600,
      scrollX: 0,
      scrollY: 0,
    };
    (globalThis as any).document = undefined;

    const resolved = resolveAnnotationPosition({
      viewport: { width: 1000, height: 600 },
      pageScroll: { x: 0, y: 0 },
      targetRect: { left: 10, top: 20, width: 200, height: 30 },
      targetPoint: { x: 100, y: 120 },
      normalized: {
        viewportXRatio: 0.5,
        viewportYRatio: 0.5,
        rectXRatio: 0.2,
        rectYRatio: 0.4,
      },
      scrollChain: [
        {
          fingerprint: {
            tagName: "div",
            id: "missing",
          },
          scrollTop: 20,
          scrollLeft: 0,
          offsetX: 100,
          offsetY: 80,
        },
      ],
    });

    expect(resolved.anchored).toBe(false);
    expect(resolved.confidence).toBe(0);
  });
});

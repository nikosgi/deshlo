import { describe, expect, it } from "vitest";

import { BUBBLE_SIZE, captureAnnotationAnchor, resolveAnnotationPosition } from "./anchor";

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

  it("clamps scroll-chain bubble position within nearest container bounds", () => {
    (globalThis as any).window = {
      innerWidth: 1000,
      innerHeight: 1000,
      scrollX: 0,
      scrollY: 0,
    };

    class FakeHTMLElement {}
    const OriginalHTMLElement = (globalThis as any).HTMLElement;
    (globalThis as any).HTMLElement = FakeHTMLElement;

    const container = new FakeHTMLElement() as any;
    container.scrollTop = 0;
    container.scrollLeft = 0;
    container.getBoundingClientRect = () =>
      ({
        left: 120,
        top: 250,
        width: 420,
        height: 500,
      }) as DOMRect;

    (globalThis as any).document = {
      getElementById(id: string) {
        return id === "scroll-pane" ? container : null;
      },
    };

    const resolved = resolveAnnotationPosition({
      viewport: { width: 1000, height: 1000 },
      pageScroll: { x: 0, y: 0 },
      targetRect: { left: 140, top: 280, width: 120, height: 30 },
      targetPoint: { x: 180, y: 310 },
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
            id: "scroll-pane",
          },
          scrollTop: 0,
          scrollLeft: 0,
          offsetX: 180,
          offsetY: 2200,
        },
      ],
    });

    expect(resolved.anchored).toBe(true);
    expect(resolved.top).toBe(250 + 500 - BUBBLE_SIZE);
    expect(resolved.left).toBeGreaterThanOrEqual(120);
    expect(resolved.left).toBeLessThanOrEqual(120 + 420 - BUBBLE_SIZE);

    (globalThis as any).HTMLElement = OriginalHTMLElement;
  });

  it("keeps bubble visible in viewport when nearest container is fully offscreen", () => {
    (globalThis as any).window = {
      innerWidth: 1000,
      innerHeight: 1000,
      scrollX: 0,
      scrollY: 0,
    };

    class FakeHTMLElement {}
    const OriginalHTMLElement = (globalThis as any).HTMLElement;
    (globalThis as any).HTMLElement = FakeHTMLElement;

    const container = new FakeHTMLElement() as any;
    container.scrollTop = 0;
    container.scrollLeft = 0;
    container.getBoundingClientRect = () =>
      ({
        left: 120,
        top: -900,
        width: 420,
        height: 500,
      }) as DOMRect;

    (globalThis as any).document = {
      getElementById(id: string) {
        return id === "scroll-pane-offscreen" ? container : null;
      },
    };

    const resolved = resolveAnnotationPosition({
      viewport: { width: 1000, height: 1000 },
      pageScroll: { x: 0, y: 0 },
      targetRect: { left: 140, top: 280, width: 120, height: 30 },
      targetPoint: { x: 180, y: 310 },
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
            id: "scroll-pane-offscreen",
          },
          scrollTop: 0,
          scrollLeft: 0,
          offsetX: 180,
          offsetY: 1200,
        },
      ],
    });

    expect(resolved.anchored).toBe(true);
    expect(resolved.top).toBe(0);
    expect(resolved.left).toBeGreaterThanOrEqual(0);
    expect(resolved.left).toBeLessThanOrEqual(1000 - BUBBLE_SIZE);

    (globalThis as any).HTMLElement = OriginalHTMLElement;
  });

  it("pins to viewport edge when nested clipping ancestors move fully out of view", () => {
    (globalThis as any).window = {
      innerWidth: 1000,
      innerHeight: 900,
      scrollX: 0,
      scrollY: 0,
    };
    (globalThis as any).getComputedStyle = (element: any) => ({
      overflowY: element.__overflowY || "visible",
      overflowX: element.__overflowX || "visible",
    });

    class FakeHTMLElement {}
    const OriginalHTMLElement = (globalThis as any).HTMLElement;
    (globalThis as any).HTMLElement = FakeHTMLElement;

    const outer = new FakeHTMLElement() as any;
    outer.__overflowY = "auto";
    outer.__overflowX = "hidden";
    outer.parentElement = null;
    outer.getBoundingClientRect = () =>
      ({
        left: 260,
        top: -210,
        width: 500,
        height: 120,
      }) as DOMRect;

    const inner = new FakeHTMLElement() as any;
    inner.scrollTop = 0;
    inner.scrollLeft = 0;
    inner.parentElement = outer;
    inner.__overflowY = "auto";
    inner.__overflowX = "hidden";
    inner.getBoundingClientRect = () =>
      ({
        left: 285.5,
        top: -190,
        width: 235.5,
        height: 300,
      }) as DOMRect;

    (globalThis as any).document = {
      getElementById(id: string) {
        return id === "nested-inner-offscreen" ? inner : null;
      },
    };

    const resolved = resolveAnnotationPosition({
      viewport: { width: 1000, height: 900 },
      pageScroll: { x: 0, y: 0 },
      targetRect: { left: 300, top: 40, width: 120, height: 30 },
      targetPoint: { x: 320, y: 44 },
      normalized: {
        viewportXRatio: 0.3,
        viewportYRatio: 0.1,
        rectXRatio: 0.2,
        rectYRatio: 0.4,
      },
      scrollChain: [
        {
          fingerprint: {
            tagName: "div",
            id: "nested-inner-offscreen",
          },
          scrollTop: 0,
          scrollLeft: 0,
          offsetX: 30,
          offsetY: 2500,
        },
      ],
    });

    expect(resolved.anchored).toBe(true);
    expect(resolved.top).toBe(0);
    expect(resolved.left).toBeGreaterThanOrEqual(260);
    expect(resolved.left).toBeLessThanOrEqual(1000 - BUBBLE_SIZE);

    (globalThis as any).HTMLElement = OriginalHTMLElement;
  });

  it("treats sub-epsilon visibility as offscreen and pins to nearest edge", () => {
    (globalThis as any).window = {
      innerWidth: 1000,
      innerHeight: 900,
      scrollX: 0,
      scrollY: 0,
    };

    class FakeHTMLElement {}
    const OriginalHTMLElement = (globalThis as any).HTMLElement;
    (globalThis as any).HTMLElement = FakeHTMLElement;

    const container = new FakeHTMLElement() as any;
    container.scrollTop = 0;
    container.scrollLeft = 0;
    container.getBoundingClientRect = () =>
      ({
        left: 285.5,
        top: -224,
        width: 235.5,
        height: 248.1,
      }) as DOMRect;

    (globalThis as any).document = {
      getElementById(id: string) {
        return id === "tiny-visible-pane" ? container : null;
      },
    };

    const resolved = resolveAnnotationPosition({
      viewport: { width: 1000, height: 900 },
      pageScroll: { x: 0, y: 0 },
      targetRect: { left: 285.5, top: 0, width: 120, height: 30 },
      targetPoint: { x: 300, y: 10 },
      normalized: {
        viewportXRatio: 0.3,
        viewportYRatio: 0.1,
        rectXRatio: 0.2,
        rectYRatio: 0.4,
      },
      scrollChain: [
        {
          fingerprint: {
            tagName: "div",
            id: "tiny-visible-pane",
          },
          scrollTop: 0,
          scrollLeft: 0,
          offsetX: 50,
          offsetY: 248.1,
        },
      ],
    });

    expect(resolved.anchored).toBe(true);
    expect(resolved.top).toBe(0);

    (globalThis as any).HTMLElement = OriginalHTMLElement;
  });
});

"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  buildOverlaySubmitInput,
  normalizeOverlayText,
  toOverlayErrorResult,
  type OverlayBatchSubmitHandler,
  type OverlayProposedChange,
  type OverlaySelection,
  type OverlaySubmitHandler,
  type OverlaySubmitResult,
  type TriggerKey,
} from "./overlay-plugin";
import { useOverlayPlugin } from "./overlay-plugin-provider";
import {
  SourceInspectorProvider,
  type OverlayBubbleAnchor,
  type OverlayBubbleMode,
  type OverlayStagedChange,
  type SourceInspectorContextValue,
} from "./source-inspector-context";
import {
  hasMixedKnownRevisions,
  removeStagedChangeBySourceLoc,
  toBatchSubmitInput,
  updateStagedChangeProposedText,
  upsertStagedChanges,
} from "./staged-changes";
import { resolveSubmitHandler } from "./submit-handler";

const DEFAULT_ATTRIBUTE_NAME = "data-src-loc";
const DEFAULT_REVISION_ATTRIBUTE_NAME = "data-src-rev";
const DEFAULT_TRIGGER_KEY: TriggerKey = "alt";

function resolveCurrentRevision(
  selection: OverlaySelection | null,
  attributeName: string
): string | null {
  if (selection?.commitSha && selection.commitSha !== "unknown") {
    return selection.commitSha;
  }

  if (typeof document === "undefined") {
    return null;
  }

  const revisionElement = document.querySelector(
    `[${attributeName}][${DEFAULT_REVISION_ATTRIBUTE_NAME}]`
  ) as HTMLElement | null;
  const revisionValue = revisionElement?.getAttribute(DEFAULT_REVISION_ATTRIBUTE_NAME)?.trim();

  if (!revisionValue || revisionValue === "unknown") {
    return null;
  }

  return revisionValue;
}

function isTriggerPressed(event: MouseEvent, triggerKey: TriggerKey): boolean {
  switch (triggerKey) {
    case "alt":
      return event.altKey;
    case "shift":
      return event.shiftKey;
    case "meta":
      return event.metaKey;
    case "ctrl":
      return event.ctrlKey;
    default:
      return false;
  }
}

function buildStagedChange(selection: OverlaySelection, proposedText: string): OverlayStagedChange {
  return {
    ...buildOverlaySubmitInput(selection, proposedText),
    stagedAt: new Date().toISOString(),
  };
}

function escapeAttributeValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/\\/g, "\\\\").replace(/\"/g, '\\\"');
}

function findSourceElement(attributeName: string, sourceLoc: string): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  const selector = `[${attributeName}="${escapeAttributeValue(sourceLoc)}"]`;
  return document.querySelector(selector) as HTMLElement | null;
}

function resolveBubbleAnchors(
  stagedChanges: OverlayStagedChange[],
  attributeName: string
): Record<string, OverlayBubbleAnchor> {
  if (typeof window === "undefined") {
    return {};
  }

  const nextAnchors: Record<string, OverlayBubbleAnchor> = {};

  for (const stagedChange of stagedChanges) {
    const sourceLoc = stagedChange.sourceLoc;
    const sourceElement = findSourceElement(attributeName, sourceLoc);

    if (!sourceElement) {
      nextAnchors[sourceLoc] = {
        sourceLoc,
        anchored: false,
        top: 0,
        left: 0,
      };
      continue;
    }

    const rect = sourceElement.getBoundingClientRect();
    const top = Math.max(8, Math.min(rect.top + Math.min(rect.height * 0.5, 18), window.innerHeight - 34));
    const left = Math.max(8, Math.min(rect.right + 8, window.innerWidth - 32));

    nextAnchors[sourceLoc] = {
      sourceLoc,
      anchored: true,
      top,
      left,
    };
  }

  return nextAnchors;
}

export interface SourceInspectorProps {
  children: ReactNode;
  enabled?: boolean;
  bubbleMode?: OverlayBubbleMode;
  attributeName?: string;
  triggerKey?: TriggerKey;
  onSubmit?: OverlaySubmitHandler;
  onSubmitBatch?: OverlayBatchSubmitHandler;
  onSelectionChange?: (selection: OverlaySelection | null) => void;
  onSubmitStart?: (selection: OverlaySelection) => void;
  onSubmitComplete?: (result: OverlaySubmitResult, selection: OverlaySelection) => void;
  onSubmitError?: (result: OverlaySubmitResult, selection: OverlaySelection) => void;
}

export default function SourceInspector({
  children,
  enabled,
  bubbleMode = "staged",
  attributeName = DEFAULT_ATTRIBUTE_NAME,
  triggerKey = DEFAULT_TRIGGER_KEY,
  onSubmit,
  onSubmitBatch,
  onSelectionChange,
  onSubmitStart,
  onSubmitComplete,
  onSubmitError,
}: SourceInspectorProps) {
  const inspectorEnabled =
    typeof enabled === "boolean"
      ? enabled
      : process.env.NEXT_PUBLIC_SOURCE_INSPECTOR === "1";

  const bubbleUiEnabled = bubbleMode === "staged";

  const wrapperPlugin = useOverlayPlugin();
  const resolvedSubmit = resolveSubmitHandler(wrapperPlugin, onSubmit, onSubmitBatch);

  const [selection, setSelection] = useState<OverlaySelection | null>(null);
  const [selectionWarning, setSelectionWarning] = useState<string>("");
  const [proposedText, setProposedTextState] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [result, setResult] = useState<OverlaySubmitResult | null>(null);
  const [stagedChanges, setStagedChanges] = useState<OverlayStagedChange[]>([]);
  const [changes, setChanges] = useState<OverlayProposedChange[]>([]);
  const [changesLoading, setChangesLoading] = useState<boolean>(false);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [changesTab, setChangesTab] = useState<"current" | "all">("current");
  const [bubbleAnchors, setBubbleAnchors] = useState<Record<string, OverlayBubbleAnchor>>({});
  const [expandedBubbles, setExpandedBubbles] = useState<Record<string, boolean>>({});

  const currentRevision = resolveCurrentRevision(selection, attributeName);
  const highlightedElement = useRef<HTMLElement | null>(null);

  const stagedBySourceLoc = useMemo(() => {
    const map = new Map<string, OverlayStagedChange>();
    for (const stagedChange of stagedChanges) {
      map.set(stagedChange.sourceLoc, stagedChange);
    }
    return map;
  }, [stagedChanges]);

  function applySelectionFromElement(
    element: HTMLElement,
    sourceLoc: string,
    preferredProposedText?: string
  ): void {
    const commitSha = element.getAttribute(DEFAULT_REVISION_ATTRIBUTE_NAME) || "unknown";

    if (highlightedElement.current) {
      highlightedElement.current.style.outline = "";
    }

    element.style.outline = "2px solid #f59e0b";
    highlightedElement.current = element;

    const selectedText = normalizeOverlayText(element.textContent || "");
    const tagName = element.tagName.toLowerCase();

    setResult(null);

    if (!selectedText) {
      setSelection(null);
      setProposedTextState("");
      setSelectionWarning(
        "Selected element has no plain text content. Select an element with direct text."
      );
      return;
    }

    const stagedChange = stagedBySourceLoc.get(sourceLoc);

    setSelectionWarning("");
    setSelection({
      sourceLoc,
      tagName,
      selectedText,
      commitSha,
    });
    setProposedTextState(preferredProposedText ?? stagedChange?.proposedText ?? selectedText);

    if (stagedChange) {
      setExpandedBubbles((previous) => ({
        ...previous,
        [sourceLoc]: true,
      }));
    }
  }

  useEffect(() => {
    onSelectionChange?.(selection);
  }, [onSelectionChange, selection]);

  useEffect(() => {
    if (!inspectorEnabled) {
      return;
    }

    const onClick = (event: MouseEvent) => {
      if (!isTriggerPressed(event, triggerKey)) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const element = target.closest(`[${attributeName}]`) as HTMLElement | null;
      if (!element) {
        return;
      }

      const sourceLoc = element.getAttribute(attributeName) || "";
      if (!sourceLoc) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      applySelectionFromElement(element, sourceLoc);
    };

    window.addEventListener("click", onClick, true);

    return () => {
      window.removeEventListener("click", onClick, true);
      if (highlightedElement.current) {
        highlightedElement.current.style.outline = "";
      }
    };
  }, [attributeName, inspectorEnabled, triggerKey, stagedBySourceLoc]);

  useEffect(() => {
    setExpandedBubbles((previous) => {
      const next: Record<string, boolean> = {};
      for (const stagedChange of stagedChanges) {
        if (previous[stagedChange.sourceLoc]) {
          next[stagedChange.sourceLoc] = true;
        }
      }
      return next;
    });
  }, [stagedChanges]);

  useEffect(() => {
    if (!inspectorEnabled || !bubbleUiEnabled) {
      setBubbleAnchors({});
      return;
    }

    const updateBubbleAnchors = () => {
      setBubbleAnchors(resolveBubbleAnchors(stagedChanges, attributeName));
    };

    updateBubbleAnchors();

    const onViewportChange = () => {
      updateBubbleAnchors();
    };

    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);

    const observer =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            updateBubbleAnchors();
          })
        : null;

    if (observer && document.body) {
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    }

    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      observer?.disconnect();
    };
  }, [attributeName, bubbleUiEnabled, inspectorEnabled, stagedChanges]);

  function setProposedText(value: string): void {
    setProposedTextState(value);
    setResult(null);
  }

  function addOrUpdateStagedChange(): void {
    if (!selection) {
      setResult({
        ok: false,
        message: "Select an element with direct text first.",
      });
      return;
    }

    const trimmedProposedText = proposedText.trim();
    if (!trimmedProposedText) {
      setResult({
        ok: false,
        message: "Proposed changes cannot be empty.",
      });
      return;
    }

    const nextStagedChange = buildStagedChange(selection, trimmedProposedText);

    setStagedChanges((previous) => upsertStagedChanges(previous, nextStagedChange));
    setExpandedBubbles((previous) => ({
      ...previous,
      [nextStagedChange.sourceLoc]: true,
    }));

    setResult(null);
  }

  function removeStagedChange(sourceLoc: string): void {
    setStagedChanges((previous) => removeStagedChangeBySourceLoc(previous, sourceLoc));
    setExpandedBubbles((previous) => {
      const next = { ...previous };
      delete next[sourceLoc];
      return next;
    });
    setResult(null);
  }

  function setStagedChangeProposedText(sourceLoc: string, nextProposedText: string): void {
    setStagedChanges((previous) =>
      updateStagedChangeProposedText(previous, sourceLoc, nextProposedText)
    );
    if (selection?.sourceLoc === sourceLoc) {
      setProposedTextState(nextProposedText);
    }
    setResult(null);
  }

  function clearStagedChanges(): void {
    setStagedChanges([]);
    setExpandedBubbles({});
    setResult(null);
  }

  function jumpToStagedChange(sourceLoc: string): void {
    const sourceElement = findSourceElement(attributeName, sourceLoc);

    if (!sourceElement) {
      setResult({
        ok: false,
        message: `Could not find source element for ${sourceLoc}.`,
      });
      return;
    }

    sourceElement.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    setExpandedBubbles((previous) => ({
      ...previous,
      [sourceLoc]: true,
    }));
    setResult(null);
  }

  function focusStagedChange(sourceLoc: string): void {
    const sourceElement = findSourceElement(attributeName, sourceLoc);

    if (!sourceElement) {
      setResult({
        ok: false,
        message: `Could not find source element for ${sourceLoc}.`,
      });
      return;
    }

    sourceElement.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    const stagedChange = stagedBySourceLoc.get(sourceLoc);
    applySelectionFromElement(sourceElement, sourceLoc, stagedChange?.proposedText);
    setExpandedBubbles((previous) => ({
      ...previous,
      [sourceLoc]: true,
    }));
  }

  async function refreshChanges(): Promise<void> {
    if (!wrapperPlugin?.listProposedChanges) {
      setChanges([]);
      setChangesError(null);
      setChangesLoading(false);
      return;
    }

    setChangesLoading(true);
    setChangesError(null);

    try {
      const fetchedChanges = await wrapperPlugin.listProposedChanges({
        host: window.location.host,
      });
      setChanges(fetchedChanges);
    } catch (error) {
      setChanges([]);
      setChangesError(toOverlayErrorResult(error).message);
    } finally {
      setChangesLoading(false);
    }
  }

  useEffect(() => {
    if (!inspectorEnabled) {
      return;
    }

    void refreshChanges();
  }, [inspectorEnabled, wrapperPlugin]);

  async function submitStagedChanges(): Promise<void> {
    if (stagedChanges.length === 0) {
      setResult({
        ok: false,
        message: "Stage at least one change before submitting.",
      });
      return;
    }

    const emptyStagedChange = stagedChanges.find((change) => !change.proposedText.trim());
    if (emptyStagedChange) {
      setResult({
        ok: false,
        message: `PROVIDER_ERROR: Proposed changes cannot be empty (${emptyStagedChange.sourceLoc}).`,
      });
      return;
    }

    if (hasMixedKnownRevisions(stagedChanges)) {
      setResult({
        ok: false,
        message:
          "PROVIDER_ERROR: Staged changes contain mixed commit revisions. Stage changes from one revision only.",
      });
      return;
    }

    const submitBatchHandler = resolvedSubmit.submitBatch;
    if (!submitBatchHandler) {
      const missingHandlerResult: OverlaySubmitResult = {
        ok: false,
        message: "PROVIDER_ERROR: No batch submit handler configured.",
      };
      setResult(missingHandlerResult);
      if (selection) {
        onSubmitError?.(missingHandlerResult, selection);
      }
      return;
    }

    setSubmitting(true);
    setResult(null);
    if (selection) {
      onSubmitStart?.(selection);
    }

    try {
      const submitResult = await submitBatchHandler(toBatchSubmitInput(stagedChanges), {
        host: window.location.host,
      });
      setResult(submitResult);

      if (submitResult.ok) {
        setStagedChanges([]);
        setExpandedBubbles({});
        setBubbleAnchors({});
        await refreshChanges();
        if (selection) {
          onSubmitComplete?.(submitResult, selection);
        }
      } else if (selection) {
        onSubmitError?.(submitResult, selection);
      }
    } catch (error) {
      const errorResult = toOverlayErrorResult(error);
      setResult(errorResult);
      if (selection) {
        onSubmitError?.(errorResult, selection);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function toggleBubble(sourceLoc: string): void {
    setExpandedBubbles((previous) => ({
      ...previous,
      [sourceLoc]: !previous[sourceLoc],
    }));
  }

  const unanchoredStagedChanges = useMemo(
    () =>
      stagedChanges.filter((change) => {
        const anchor = bubbleAnchors[change.sourceLoc];
        return bubbleUiEnabled && (!anchor || !anchor.anchored);
      }),
    [bubbleAnchors, bubbleUiEnabled, stagedChanges]
  );

  const contextValue = useMemo<SourceInspectorContextValue>(
    () => ({
      inspectorEnabled,
      bubbleMode,
      triggerKey,
      pluginId: resolvedSubmit.pluginId,
      currentRevision,
      selection,
      selectionWarning,
      proposedText,
      submitting,
      result,
      stagedChanges,
      changes,
      changesLoading,
      changesError,
      changesTab,
      bubbleAnchors,
      expandedBubbles,
      unanchoredStagedChanges,
      setProposedText,
      addOrUpdateStagedChange,
      removeStagedChange,
      setStagedChangeProposedText,
      clearStagedChanges,
      submitStagedChanges,
      jumpToStagedChange,
      focusStagedChange,
      toggleBubble,
      refreshChanges,
      setChangesTab,
    }),
    [
      inspectorEnabled,
      bubbleMode,
      triggerKey,
      resolvedSubmit.pluginId,
      currentRevision,
      selection,
      selectionWarning,
      proposedText,
      submitting,
      result,
      stagedChanges,
      changes,
      changesLoading,
      changesError,
      changesTab,
      bubbleAnchors,
      expandedBubbles,
      unanchoredStagedChanges,
      wrapperPlugin,
    ]
  );

  return <SourceInspectorProvider value={contextValue}>{children}</SourceInspectorProvider>;
}

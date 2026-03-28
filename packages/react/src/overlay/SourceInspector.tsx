"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  buildOverlaySubmitInput,
  normalizeOverlayText,
  toOverlayErrorResult,
  type OverlayProposedChange,
  type OverlaySelection,
  type OverlaySubmitHandler,
  type OverlaySubmitResult,
  type TriggerKey,
} from "./overlay-plugin";
import { useOverlayPlugin } from "./overlay-plugin-provider";
import {
  SourceInspectorProvider,
  type SourceInspectorContextValue,
} from "./source-inspector-context";
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

export interface SourceInspectorProps {
  children: ReactNode;
  enabled?: boolean;
  attributeName?: string;
  triggerKey?: TriggerKey;
  onSubmit?: OverlaySubmitHandler;
  onSelectionChange?: (selection: OverlaySelection | null) => void;
  onSubmitStart?: (selection: OverlaySelection) => void;
  onSubmitComplete?: (result: OverlaySubmitResult, selection: OverlaySelection) => void;
  onSubmitError?: (result: OverlaySubmitResult, selection: OverlaySelection) => void;
}

export default function SourceInspector({
  children,
  enabled,
  attributeName = DEFAULT_ATTRIBUTE_NAME,
  triggerKey = DEFAULT_TRIGGER_KEY,
  onSubmit,
  onSelectionChange,
  onSubmitStart,
  onSubmitComplete,
  onSubmitError,
}: SourceInspectorProps) {
  const inspectorEnabled =
    typeof enabled === "boolean"
      ? enabled
      : process.env.NEXT_PUBLIC_SOURCE_INSPECTOR === "1";

  const wrapperPlugin = useOverlayPlugin();
  const resolvedSubmit = resolveSubmitHandler(wrapperPlugin, onSubmit);

  const [selection, setSelection] = useState<OverlaySelection | null>(null);
  const [selectionWarning, setSelectionWarning] = useState<string>("");
  const [proposedText, setProposedTextState] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [result, setResult] = useState<OverlaySubmitResult | null>(null);
  const [changes, setChanges] = useState<OverlayProposedChange[]>([]);
  const [changesLoading, setChangesLoading] = useState<boolean>(false);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [changesTab, setChangesTab] = useState<"current" | "all">("current");
  const currentRevision = resolveCurrentRevision(selection, attributeName);

  const highlightedElement = useRef<HTMLElement | null>(null);

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
      const commitSha = element.getAttribute(DEFAULT_REVISION_ATTRIBUTE_NAME) || "unknown";

      event.preventDefault();
      event.stopPropagation();

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

      setSelectionWarning("");
      setSelection({
        sourceLoc,
        tagName,
        selectedText,
        commitSha,
      });
      setProposedTextState(selectedText);
    };

    window.addEventListener("click", onClick, true);

    return () => {
      window.removeEventListener("click", onClick, true);
      if (highlightedElement.current) {
        highlightedElement.current.style.outline = "";
      }
    };
  }, [attributeName, inspectorEnabled, triggerKey]);

  function setProposedText(value: string): void {
    setProposedTextState(value);
    setResult(null);
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

  async function submit(): Promise<void> {
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

    const submitHandler = resolvedSubmit.submit;
    if (!submitHandler) {
      const missingHandlerResult: OverlaySubmitResult = {
        ok: false,
        message: "PROVIDER_ERROR: No submit handler configured.",
      };
      setResult(missingHandlerResult);
      onSubmitError?.(missingHandlerResult, selection);
      return;
    }

    setSubmitting(true);
    setResult(null);
    onSubmitStart?.(selection);

    const submitInput = buildOverlaySubmitInput(selection, trimmedProposedText);

    try {
      const submitResult = await submitHandler(submitInput, {
        host: window.location.host,
      });
      setResult(submitResult);

      if (submitResult.ok) {
        onSubmitComplete?.(submitResult, selection);
        await refreshChanges();
      } else {
        onSubmitError?.(submitResult, selection);
      }
    } catch (error) {
      const errorResult = toOverlayErrorResult(error);
      setResult(errorResult);
      onSubmitError?.(errorResult, selection);
    } finally {
      setSubmitting(false);
    }
  }

  const contextValue = useMemo<SourceInspectorContextValue>(
    () => ({
      inspectorEnabled,
      triggerKey,
      pluginId: resolvedSubmit.pluginId,
      currentRevision,
      selection,
      selectionWarning,
      proposedText,
      submitting,
      result,
      changes,
      changesLoading,
      changesError,
      changesTab,
      setProposedText,
      submit,
      refreshChanges,
      setChangesTab,
    }),
    [
      inspectorEnabled,
      triggerKey,
      resolvedSubmit.pluginId,
      currentRevision,
      selection,
      selectionWarning,
      proposedText,
      submitting,
      result,
      changes,
      changesLoading,
      changesError,
      changesTab,
      wrapperPlugin,
    ]
  );

  return <SourceInspectorProvider value={contextValue}>{children}</SourceInspectorProvider>;
}

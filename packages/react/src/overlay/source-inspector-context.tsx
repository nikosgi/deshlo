import { createContext, useContext, type ReactNode } from "react";

import type {
  OverlayBatchSubmitResult,
  OverlayProposedChange,
  OverlaySubmitInput,
  OverlaySelection,
  OverlaySubmitResult,
  TriggerKey,
} from "./overlay-plugin";

export type OverlayChangesTab = "current" | "all";
export type OverlayBubbleMode = "off" | "staged";

export interface OverlayStagedChange extends OverlaySubmitInput {
  stagedAt: string;
}

export interface OverlayBubbleAnchor {
  sourceLoc: string;
  top: number;
  left: number;
  anchored: boolean;
}

export interface SourceInspectorContextValue {
  inspectorEnabled: boolean;
  bubbleMode: OverlayBubbleMode;
  triggerKey: TriggerKey;
  pluginId: string;
  currentRevision: string | null;
  selection: OverlaySelection | null;
  selectionWarning: string;
  proposedText: string;
  submitting: boolean;
  result: OverlaySubmitResult | OverlayBatchSubmitResult | null;
  stagedChanges: OverlayStagedChange[];
  changes: OverlayProposedChange[];
  changesLoading: boolean;
  changesError: string | null;
  changesTab: OverlayChangesTab;
  bubbleAnchors: Record<string, OverlayBubbleAnchor>;
  expandedBubbles: Record<string, boolean>;
  unanchoredStagedChanges: OverlayStagedChange[];
  setProposedText: (value: string) => void;
  addOrUpdateStagedChange: () => void;
  removeStagedChange: (sourceLoc: string) => void;
  setStagedChangeProposedText: (sourceLoc: string, proposedText: string) => void;
  clearStagedChanges: () => void;
  submitStagedChanges: () => Promise<void>;
  jumpToStagedChange: (sourceLoc: string) => void;
  focusStagedChange: (sourceLoc: string) => void;
  toggleBubble: (sourceLoc: string) => void;
  refreshChanges: () => Promise<void>;
  setChangesTab: (tab: OverlayChangesTab) => void;
}

const SourceInspectorContext = createContext<SourceInspectorContextValue | null>(null);

export function SourceInspectorProvider({
  value,
  children,
}: {
  value: SourceInspectorContextValue;
  children: ReactNode;
}) {
  return (
    <SourceInspectorContext.Provider value={value}>{children}</SourceInspectorContext.Provider>
  );
}

export function useSourceInspectorContext(): SourceInspectorContextValue {
  const context = useContext(SourceInspectorContext);

  if (!context) {
    throw new Error("Source inspector components must be rendered inside SourceInspector context.");
  }

  return context;
}

import { createContext, useContext, type ReactNode } from "react";

import type {
  AnnotationActionResult,
  AnnotationAnchor,
  AnnotationPoint,
  AnnotationThread,
  AnnotationTriggerKey,
} from "./annotation-plugin";
import type { ResolvedAnnotationPosition } from "./anchor";

export interface AnnotationDraft {
  anchor: AnnotationAnchor;
  top: number;
  left: number;
  body: string;
}

export interface AnnotationContextValue {
  enabled: boolean;
  readOnly: boolean;
  triggerKey: AnnotationTriggerKey;
  pluginId: string;
  pageKey: string;
  currentCommitSha: string;
  selectedCommitSha: string;
  loading: boolean;
  submitting: boolean;
  result: AnnotationActionResult | null;
  threads: AnnotationThread[];
  currentThreads: AnnotationThread[];
  staleThreads: AnnotationThread[];
  showStale: boolean;
  draft: AnnotationDraft | null;
  threadPositions: Record<string, ResolvedAnnotationPosition>;
  refreshThreads: () => Promise<void>;
  setShowStale: (value: boolean) => void;
  setSelectedCommitSha: (value: string) => void;
  setDraftBody: (value: string) => void;
  submitDraft: () => Promise<void>;
  cancelDraft: () => void;
  replyToThread: (threadId: string, body: string) => Promise<void>;
  resolveThread: (threadId: string, commitSha: string) => Promise<void>;
  reopenThread: (threadId: string, commitSha: string) => Promise<void>;
  moveThreadAnchor: (
    threadId: string,
    input: {
      point: AnnotationPoint;
      anchor?: AnnotationAnchor;
    }
  ) => Promise<void>;
  deleteThread: (threadId: string, commitSha: string) => Promise<void>;
}

const AnnotationContext = createContext<AnnotationContextValue | null>(null);

export function AnnotationProvider({
  value,
  children,
}: {
  value: AnnotationContextValue;
  children: ReactNode;
}) {
  return <AnnotationContext.Provider value={value}>{children}</AnnotationContext.Provider>;
}

export function useAnnotationContext(): AnnotationContextValue {
  const context = useContext(AnnotationContext);
  if (!context) {
    throw new Error("Annotation components must be rendered inside AnnotationGate context.");
  }
  return context;
}

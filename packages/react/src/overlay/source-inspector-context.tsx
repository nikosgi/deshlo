import { createContext, useContext, type ReactNode } from "react";

import type {
  OverlaySelection,
  OverlaySubmitResult,
  TriggerKey,
} from "./overlay-plugin";

export interface SourceInspectorContextValue {
  inspectorEnabled: boolean;
  triggerKey: TriggerKey;
  pluginId: string;
  selection: OverlaySelection | null;
  selectionWarning: string;
  proposedText: string;
  submitting: boolean;
  result: OverlaySubmitResult | null;
  setProposedText: (value: string) => void;
  submit: () => Promise<void>;
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
    throw new Error("OverlayGatePanel must be rendered inside SourceInspector context.");
  }

  return context;
}

"use client";

export { default as OverlayGate } from "./overlay/OverlayGate";
export type { OverlayGateProps } from "./overlay/OverlayGate";
export {
  OverlayPluginProvider,
  useOverlayPlugin,
  type OverlayPluginProviderProps,
} from "./overlay/overlay-plugin-provider";
export type {
  OverlayPlugin,
  OverlayPluginContext,
  OverlayProposedChange,
  OverlayResultLink,
  OverlaySelection,
  OverlayListProposedChangesHandler,
  OverlaySubmitHandler,
  OverlaySubmitInput,
  OverlaySubmitResult,
  TriggerKey,
} from "./overlay/overlay-plugin";

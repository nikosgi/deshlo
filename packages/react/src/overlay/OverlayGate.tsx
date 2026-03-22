"use client";

import SourceInspector, { type SourceInspectorProps } from "./SourceInspector";
import OverlayGatePanel, { type OverlayGatePanelProps } from "./OverlayGatePanel";

export interface OverlayGateProps
  extends Omit<SourceInspectorProps, "children">,
    OverlayGatePanelProps {}

export default function OverlayGate({ width, ...sourceInspectorProps }: OverlayGateProps) {
  return (
    <SourceInspector {...sourceInspectorProps}>
      <OverlayGatePanel width={width} />
    </SourceInspector>
  );
}

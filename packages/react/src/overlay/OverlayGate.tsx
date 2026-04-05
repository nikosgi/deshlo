"use client";

import SourceInspector, { type SourceInspectorProps } from "./SourceInspector";
import OverlayGateBubbles from "./OverlayGateBubbles";
import OverlayGatePanel, { type OverlayGatePanelProps } from "./OverlayGatePanel";

export interface OverlayGateProps
  extends Omit<SourceInspectorProps, "children">,
    OverlayGatePanelProps {}

export default function OverlayGate({ width, ...sourceInspectorProps }: OverlayGateProps) {
  return (
    <SourceInspector {...sourceInspectorProps}>
      <OverlayGateBubbles />
      <OverlayGatePanel width={width} />
    </SourceInspector>
  );
}

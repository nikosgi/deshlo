"use client";

import { SourceInspectorOverlay } from "@fdb/nextjs/overlay";

export default function OverlayGate() {
  const enabled = process.env.NEXT_PUBLIC_SOURCE_INSPECTOR === "1";
  return enabled ? <SourceInspectorOverlay /> : null;
}

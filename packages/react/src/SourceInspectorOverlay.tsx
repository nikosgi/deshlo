'use client';

import { useEffect, useRef, useState } from "react";

export type TriggerKey = "alt" | "shift" | "meta" | "ctrl";

export interface SourceInspectorOverlayProps {
  attributeName?: string;
  triggerKey?: TriggerKey;
}

const DEFAULT_ATTRIBUTE_NAME = "data-src-loc";

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

export function SourceInspectorOverlay({
  attributeName = DEFAULT_ATTRIBUTE_NAME,
  triggerKey = "alt",
}: SourceInspectorOverlayProps) {
  const [location, setLocation] = useState("");
  const highlightedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      console.log("Trigger key pressed, checking for source location attribute...");

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

      const sourceLocation = element.getAttribute(attributeName);
      if (!sourceLocation) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (highlightedElement.current) {
        highlightedElement.current.style.outline = "";
      }

      element.style.outline = "2px solid #f59e0b";
      highlightedElement.current = element;

      setLocation(sourceLocation);
      console.info(`[source-inspector] ${sourceLocation}`, element);
    };

    window.addEventListener("click", onClick, true);

    return () => {
      window.removeEventListener("click", onClick, true);
      if (highlightedElement.current) {
        highlightedElement.current.style.outline = "";
      }
    };
  }, [attributeName, triggerKey]);

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 9999,
        maxWidth: 520,
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid #f59e0b",
        background: "rgba(17, 17, 17, 0.92)",
        color: "#f8fafc",
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <div style={{ fontWeight: 700 }}>Source Inspector</div>
      <div>{triggerKey.toUpperCase()}+Click any element to map it to source.</div>
      {location ? (
        <code style={{ display: "block", marginTop: 6, color: "#fde68a" }}>{location}</code>
      ) : null}
    </div>
  );
}

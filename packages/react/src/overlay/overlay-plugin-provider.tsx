"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { OverlayPlugin } from "./overlay-plugin";

export interface OverlayPluginProviderProps {
  plugin: OverlayPlugin;
  children: ReactNode;
}

const OverlayPluginContext = createContext<OverlayPlugin | null>(null);

export function OverlayPluginProvider({ plugin, children }: OverlayPluginProviderProps) {
  return <OverlayPluginContext.Provider value={plugin}>{children}</OverlayPluginContext.Provider>;
}

export function useOverlayPlugin(): OverlayPlugin | null {
  return useContext(OverlayPluginContext);
}

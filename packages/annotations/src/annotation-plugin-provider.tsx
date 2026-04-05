"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { AnnotationPlugin } from "./annotation-plugin";

export interface AnnotationPluginProviderProps {
  plugin: AnnotationPlugin;
  children: ReactNode;
}

const AnnotationPluginContext = createContext<AnnotationPlugin | null>(null);

export function AnnotationPluginProvider({ plugin, children }: AnnotationPluginProviderProps) {
  return (
    <AnnotationPluginContext.Provider value={plugin}>{children}</AnnotationPluginContext.Provider>
  );
}

export function useAnnotationPlugin(): AnnotationPlugin | null {
  return useContext(AnnotationPluginContext);
}

"use client";

import type { ReactNode } from "react";

import { createHttpAnnotationsPlugin, type HttpAnnotationsPluginConfig } from "./http";
import { AnnotationPluginProvider } from "./annotation-plugin-provider";

export interface HttpAnnotationsPluginProps {
  config: HttpAnnotationsPluginConfig;
  children: ReactNode;
}

export function HttpAnnotationsPlugin({ config, children }: HttpAnnotationsPluginProps) {
  const plugin = createHttpAnnotationsPlugin(config);
  return <AnnotationPluginProvider plugin={plugin}>{children}</AnnotationPluginProvider>;
}

export type { HttpAnnotationsPluginConfig };

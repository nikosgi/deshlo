import type {
  OverlayPlugin,
  OverlaySubmitHandler,
} from "./overlay-plugin";

export interface ResolvedSubmitHandler {
  pluginId: string;
  submit?: OverlaySubmitHandler;
}

export function resolveSubmitHandler(
  plugin: OverlayPlugin | null,
  onSubmit?: OverlaySubmitHandler
): ResolvedSubmitHandler {
  if (plugin) {
    return {
      pluginId: plugin.id,
      submit: plugin.submit,
    };
  }

  if (onSubmit) {
    return {
      pluginId: "custom-onsubmit",
      submit: onSubmit,
    };
  }

  return {
    pluginId: "unconfigured",
  };
}

import type {
  OverlayBatchSubmitHandler,
  OverlayPlugin,
  OverlaySubmitHandler,
} from "./overlay-plugin";

export interface ResolvedSubmitHandler {
  pluginId: string;
  submit?: OverlaySubmitHandler;
  submitBatch?: OverlayBatchSubmitHandler;
}

export function resolveSubmitHandler(
  plugin: OverlayPlugin | null,
  onSubmit?: OverlaySubmitHandler,
  onSubmitBatch?: OverlayBatchSubmitHandler
): ResolvedSubmitHandler {
  if (plugin) {
    return {
      pluginId: plugin.id,
      submit: plugin.submit,
      submitBatch: plugin.submitBatch,
    };
  }

  if (onSubmit || onSubmitBatch) {
    return {
      pluginId: "custom-onsubmit",
      submit: onSubmit,
      submitBatch: onSubmitBatch,
    };
  }

  return {
    pluginId: "unconfigured",
  };
}

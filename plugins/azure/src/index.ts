export interface AzurePluginPlaceholderConfig {
  endpoint?: string;
}

export function createAzurePluginPlaceholder(config: AzurePluginPlaceholderConfig = {}) {
  return {
    id: "azure-placeholder",
    config,
  };
}

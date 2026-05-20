import type { Provider, ProviderMetadata } from "./types";

const DAG_PROVIDERS = new Set(["claude", "claude-ollama"]);

class SessionProvider implements Provider {
  readonly capabilities;
  readonly metadata: ProviderMetadata;

  constructor(readonly id: string) {
    this.capabilities = {
      supportsDag: DAG_PROVIDERS.has(id),
      supportsCloning: false,
    };
    this.metadata = {
      description: id,
      limitations: [],
      website: "",
      cliName: id,
    };
  }

  get displayName(): string {
    return this.id;
  }
}

export function getProvider(id: string | undefined): Provider {
  return new SessionProvider(id ?? "unknown");
}

import type { PathReference, SettingsFieldReference } from "../types/ui";

export const modelFields: SettingsFieldReference[] = [
  { label: "Backend", value: "openai", envTag: "env" },
  { label: "Model", value: "gpt-4o", envTag: "env" },
  { label: "Base URL", value: "https://api.openai.com/v1", envTag: "env" },
  { label: "API Key", value: "sk-••••••••••••••••••1234" },
];

export const embeddingField: SettingsFieldReference = {
  label: "Embedding Model",
  value: "text-embedding-3-small",
};

export const pathItems: PathReference[] = [
  {
    label: "Data Directory",
    path: "~/ScholarAIO/vault/data",
    source: "config.yaml",
  },
  {
    label: "Papers Directory",
    path: "~/ScholarAIO/vault/papers",
    source: "config.yaml",
    verified: true,
  },
  {
    label: "Pending Directory",
    path: "~/ScholarAIO/ingest/queue",
    source: "env",
  },
];

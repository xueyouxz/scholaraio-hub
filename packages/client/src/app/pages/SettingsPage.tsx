import { useEffect, useState } from "react";
import { PERMISSION_MODES, api, getProviderChoices } from "../../core/api";
import type { PermissionMode, ProviderInfo, ServerSettings } from "../../core/types";

export function SettingsPage() {
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [globalInstructions, setGlobalInstructions] = useState("");
  const [provider, setProvider] = useState("claude");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<PermissionMode>("default");
  const [flash, setFlash] = useState("");

  useEffect(() => {
    void (async () => {
      const [settingsData, providerData] = await Promise.all([
        api.getSettings(),
        api.getProviders(),
      ]);
      setSettings(settingsData.settings);
      setProviders(getProviderChoices(providerData.providers));
      setGlobalInstructions(settingsData.settings?.globalInstructions ?? "");
      setProvider(settingsData.settings?.newSessionDefaults?.provider ?? "claude");
      setModel(settingsData.settings?.newSessionDefaults?.model ?? "");
      setMode(settingsData.settings?.newSessionDefaults?.permissionMode ?? "default");
    })();
  }, []);

  const save = async () => {
    const result = await api.updateSettings({
      globalInstructions: globalInstructions || undefined,
      newSessionDefaults: {
        provider: provider as "claude" | "codex",
        model: model || undefined,
        permissionMode: mode,
      },
    });
    setSettings(result.settings);
    setFlash("Settings saved.");
    window.setTimeout(() => setFlash(""), 1800);
  };

  const selectedProvider = providers.find((item) => item.name === provider);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="title">Settings</h2>
      </div>
      <div className="panel-body stack">
        <textarea
          value={globalInstructions}
          onChange={(event) => setGlobalInstructions(event.target.value)}
          placeholder="Global instructions for new sessions"
        />
        <div className="grid-two">
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            {providers.map((item) => (
              <option key={item.name} value={item.name}>
                {item.displayName}
              </option>
            ))}
          </select>
          <select value={mode} onChange={(event) => setMode(event.target.value as PermissionMode)}>
            {PERMISSION_MODES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <select value={model} onChange={(event) => setModel(event.target.value)}>
          <option value="">Default model</option>
          {(selectedProvider?.models ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        {settings ? (
          <div className="muted">
            Current provider default: {settings.newSessionDefaults?.provider ?? "claude"}
          </div>
        ) : null}
        {flash ? <div className="empty">{flash}</div> : null}
        <div className="toolbar">
          <button type="button" className="primary" onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </section>
  );
}

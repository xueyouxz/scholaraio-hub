const FALLBACK_TRANSLATIONS: Record<string, string> = {
  modalClose: "Close",
  schemaWarningTooltip: "Schema validation warning",
  schemaWarningTitle: "Schema validation warning",
  schemaWarningDescription: "The tool result did not match its expected schema.",
  schemaWarningPath: "Path",
  schemaWarningMessage: "Message",
  schemaWarningReport: "Report this issue",
};

export function useI18n() {
  return {
    t: (key: string, values?: Record<string, unknown>) => {
      let text = FALLBACK_TRANSLATIONS[key] ?? key;
      if (values) {
        for (const [name, value] of Object.entries(values)) {
          text = text.replaceAll(`{${name}}`, String(value));
        }
      }
      return text;
    },
  };
}

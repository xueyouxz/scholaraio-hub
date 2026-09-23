import { CAPABILITIES } from "../tasks";
import { CapabilityPrompt } from "./CapabilityPrompt";

/** Start, watch and stop the library work that costs model time. */
export function LibraryTasksPanel() {
  return (
    <section aria-label="文献库能力" className="shrink-0 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {CAPABILITIES.map((item) => (
        <CapabilityPrompt key={item.kind} kind={item.kind} />
      ))}
    </section>
  );
}

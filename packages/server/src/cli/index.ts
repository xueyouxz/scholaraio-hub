/**
 * The Hub's command line. `scripts/hub.mjs` runs it and chooses the profile:
 *
 *   pnpm dev [--server | --client]
 *   pnpm hub setup | doctor | migrate <plan|apply|rollback> ... | skills-sync
 *     [--production | --profile <name>]
 *
 * `pnpm start` runs the built server directly and does not come through here.
 */
type Command = (args: string[]) => Promise<number>;

// Loaded on demand: doctor pulls in the provider modules, dev needs none of them.
const commands: Record<string, () => Promise<Command>> = {
  dev: async () => (await import("./dev.js")).dev,
  setup: async () => (await import("./setup.js")).setup,
  doctor: async () => (await import("./doctor.js")).doctor,
  migrate: async () => (await import("./migrate.js")).migrate,
  "skills-sync": async () => (await import("./skills-sync.js")).skillsSync,
};

const [name, ...args] = process.argv.slice(2);
const load = name ? commands[name] : undefined;
if (!load) {
  console.error(
    `${name ? `未知命令：${name}\n` : ""}用法：pnpm hub <${Object.keys(commands).join(" | ")}> [--production | --profile <name>]`,
  );
  process.exitCode = 1;
} else {
  process.exitCode = await (await load())(args);
}

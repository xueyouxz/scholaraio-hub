/**
 * The Hub's command line. `scripts/hub.mjs` runs it and chooses the profile:
 *
 *   pnpm dev | pnpm start
 *   pnpm hub setup | doctor | migrate <plan|apply|rollback> ... | skills-sync
 *     [--production | --profile <name>]
 */
type Command = (args: string[]) => Promise<number>;

const commands: Record<string, () => Promise<Command>> = {
  dev: async () => (await import("./commands/dev.js")).dev,
  start: async () => (await import("./commands/start.js")).start,
  setup: async () => (await import("./commands/setup.js")).setup,
  doctor: async () => (await import("./commands/doctor.js")).doctor,
  migrate: async () => (await import("./commands/migrate.js")).migrate,
  "skills-sync": async () => (await import("./commands/skills-sync.js")).skillsSync,
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

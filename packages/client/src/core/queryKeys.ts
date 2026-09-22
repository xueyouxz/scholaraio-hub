export const queryKeys = {
  scholaraioSkills: () => ["scholaraio-skills"] as const,
  scholaraioSkill: (name: string) => ["scholaraio-skills", name] as const,
};

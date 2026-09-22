/** "default" means the CLI's own model; Claude already lists it first. */
export function modelOptions(models: { id: string; name: string }[] = []) {
  return models.some((item) => item.id === "default")
    ? models
    : [{ id: "default", name: "CLI 默认模型" }, ...models];
}

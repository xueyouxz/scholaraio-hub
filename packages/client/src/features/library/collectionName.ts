/**
 * Why a name is refused, said before the server has to refuse it.
 *
 * A workspace is a directory, and its name is the directory's name, so these
 * are the same rules the library applies when it creates one.
 */
export function collectionNameProblem(name: string): string | null {
  if (!name) return "请输入文献集合名称";
  if (name !== name.trim()) return "名称首尾不能有空格";
  if (name.length > 120) return "名称不能超过 120 个字符";
  if (name === "." || name === "..") return "名称不能是 . 或 ..";
  if (name.startsWith(".")) return "名称不能以 . 开头";
  if (/[/\\:]/.test(name)) return "名称不能包含 / \\ : ";
  if (name.includes("..")) return "名称不能包含 ..";
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32) return "名称不能包含控制字符";
  }
  return null;
}

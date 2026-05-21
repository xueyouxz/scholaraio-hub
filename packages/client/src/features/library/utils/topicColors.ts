const OUTLIER_COLOR = "#bfc9c0";

const PALETTE = [
  "#22c55e",
  "#16a34a",
  "#4ade80",
  "#86efac",
  "#34d399",
  "#10b981",
  "#6ee7b7",
  "#a7f3d0",
  "#059669",
  "#047857",
  "#065f46",
  "#84cc16",
  "#65a30d",
  "#a3e635",
  "#bef264",
  "#d9f99d",
  "#facc15",
  "#f59e0b",
  "#fbbf24",
  "#fcd34d",
];

export function buildTopicColors(topicIds: number[]): Map<number, string> {
  const map = new Map<number, string>();
  map.set(-1, OUTLIER_COLOR);

  const sorted = [...new Set(topicIds)].filter((id) => id !== -1).sort((a, b) => a - b);
  sorted.forEach((id, i) => {
    map.set(id, PALETTE[i % PALETTE.length] as string);
  });

  return map;
}

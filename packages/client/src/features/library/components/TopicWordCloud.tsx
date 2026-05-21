import type { TopicCloudWord } from "../utils/topicCloud";

interface Props {
  words: TopicCloudWord[];
}

export function TopicWordCloud({ words }: Props) {
  if (words.length === 0) {
    return (
      <span className="text-[9px] font-mono text-on-surface-variant/40">
        主题生成后显示关键词云
      </span>
    );
  }

  return (
    <div
      className="flex h-full w-full flex-wrap content-center items-center gap-x-2.5 gap-y-1.5 overflow-hidden"
      aria-label="主题关键词云"
    >
      {words.map((word) => (
        <span
          key={`${word.topicId ?? "global"}:${word.text}`}
          className="font-mono font-semibold leading-tight"
          style={{
            color: word.color,
            fontSize: `${word.size}px`,
          }}
        >
          {word.text}
        </span>
      ))}
    </div>
  );
}

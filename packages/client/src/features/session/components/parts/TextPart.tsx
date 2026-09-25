import { memo } from "react";
import { Markdown } from "../../../../shared/components/Markdown";

// Memoized on its string props: without this, every streamed delta re-parses
// the markdown of every finished block in the turn. The turn's footer copies
// the answer as a whole.
export const TextPart = memo(function TextPart({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  return (
    <div className="text-block timeline-item">
      <Markdown text={text} streaming={streaming} className="session-markdown" />
    </div>
  );
});

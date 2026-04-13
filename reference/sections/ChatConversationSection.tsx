import { Sparkles } from "lucide-react";
import type React from "react";
import ChatMessageBubble from "../components/ChatMessageBubble";
import { chatMessages } from "../mock/chat";

interface ChatConversationSectionProps {
  empty?: boolean;
}

const ChatConversationSection: React.FC<ChatConversationSectionProps> = ({ empty = false }) => (
  <div className="flex-1 overflow-y-auto no-scrollbar px-6 md:px-12 lg:px-20 py-6 space-y-8">
    {empty ? (
      <div className="flex min-h-full items-start justify-center pt-[8vh]">
        <div className="relative w-full max-w-3xl overflow-hidden rounded-[36px] border border-primary/12 bg-surface-container/88 px-8 py-12 text-center shadow-[0_20px_45px_rgba(17,24,39,0.10),0_48px_120px_rgba(17,24,39,0.14)] ring-1 ring-white/35 backdrop-blur-xl">
          <div className="relative flex flex-col items-center gap-5">
            <div className="flex h-16 w-16 items-center justify-center rounded-[22px] border border-primary/15 bg-primary/10 text-primary shadow-inner">
              <Sparkles className="h-7 w-7" />
            </div>
            <div className="space-y-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-primary/70">
                New conversation
              </p>
              <h2 className="font-serif text-4xl font-bold tracking-tight text-on-surface md:text-5xl">
                下午好，林策展
              </h2>
              <p className="mx-auto max-w-2xl text-sm leading-7 text-on-surface-variant md:text-base">
                新的研究线程已经就绪。你可以提出问题、比较论文，或开始整理新的界面重构方案。
              </p>
            </div>
          </div>
        </div>
      </div>
    ) : (
      <>
        {chatMessages.map((message) => (
          <ChatMessageBubble key={message.id} message={message} />
        ))}
        <div className="mr-auto flex items-center gap-2 text-on-surface-variant">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="w-2 h-2 rounded-full bg-primary/60" />
            ))}
          </div>
        </div>
      </>
    )}
  </div>
);

export default ChatConversationSection;

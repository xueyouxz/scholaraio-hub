import type React from "react";
import ChatComposerSection from "../sections/ChatComposerSection";
import ChatConversationSection from "../sections/ChatConversationSection";
import ChatExplorerSection from "../sections/ChatExplorerSection";

const ChatPageReference: React.FC = () => (
  <div className="flex-1 flex h-full bg-surface relative overflow-hidden">
    <div className="flex-1 flex flex-col h-full relative">
      <div style={{ paddingBottom: "176px" }} className="flex-1 overflow-y-auto no-scrollbar">
        <ChatConversationSection />
      </div>
      <ChatComposerSection />
    </div>
    <ChatExplorerSection />
  </div>
);

export default ChatPageReference;

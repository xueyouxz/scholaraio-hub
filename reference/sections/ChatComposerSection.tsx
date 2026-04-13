import { FileText, Image, Maximize2, Mic, Paperclip, Send, Wrench, X } from "lucide-react";
import type React from "react";

const attachments = [
  { id: "a1", name: "ui-audit.pdf", icon: FileText },
  { id: "a2", name: "reader-panel.png", icon: Image },
];

const ChatComposerSection: React.FC = () => (
  <div className="absolute bottom-0 left-0 w-full px-5 pb-3 pt-3 bg-surface border-t border-outline-variant/10">
    <div className="max-w-[42rem] mx-auto">
      <div className="flex flex-wrap gap-2 mb-2.5">
        {attachments.map((file) => {
          const Icon = file.icon;
          return (
            <div
              key={file.id}
              className="flex items-center gap-2 bg-surface-container-high border border-outline-variant/20 px-3 py-1 rounded-lg text-on-surface-variant"
            >
              <Icon className="w-3 h-3" />
              <span className="text-[11px] font-medium font-mono max-w-44 truncate">
                {file.name}
              </span>
              <X className="w-3 h-3" />
            </div>
          );
        })}
      </div>

      <div className="bg-surface-container px-2.5 py-2 rounded-[24px] shadow-sm border border-outline-variant/10 flex flex-col gap-1">
        <div className="relative">
          <button className="absolute top-1 right-1 z-10 p-1 rounded-lg text-on-surface-variant/50 hover:text-on-surface hover:bg-surface-container-high">
            <Maximize2 className="w-3 h-3" />
          </button>
          <div className="w-full bg-transparent font-sans text-sm md:text-[15px] px-2.5 py-2 min-h-[72px]">
            请帮我把阅读器、搜索、工作区三个页面的重复卡片归纳为可复用设计组件。
          </div>
        </div>
        <div className="flex justify-between items-center px-0.5 pb-0.5">
          <div className="flex gap-0">
            <button className="p-[5px] rounded-xl text-on-surface-variant hover:bg-surface-container-high">
              <Paperclip className="w-4 h-4" />
            </button>
            <button className="p-[5px] rounded-xl text-on-surface-variant hover:bg-surface-container-high">
              <Mic className="w-4 h-4" />
            </button>
            <button className="p-[5px] rounded-xl text-on-surface-variant hover:bg-surface-container-high">
              <Wrench className="w-4 h-4" />
            </button>
          </div>
          <button className="signature-gradient text-on-primary w-[34px] h-[34px] rounded-full flex items-center justify-center shadow-md">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
      <p className="text-[10px] text-center text-on-surface-variant/60 font-sans mt-2">
        ScholarAIO 可能会综合你的私有资料，请在最终输出前核对引用和结论。
      </p>
    </div>
  </div>
);

export default ChatComposerSection;

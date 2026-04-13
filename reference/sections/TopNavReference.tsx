import { SlidersHorizontal } from "lucide-react";
import type React from "react";

interface TopNavReferenceProps {
  title: string;
  drawerOpen?: boolean;
  sidebarWidth?: number;
}

const TopNavReference: React.FC<TopNavReferenceProps> = ({
  title,
  drawerOpen = true,
  sidebarWidth = 248,
}) => (
  <>
    <nav
      className="fixed top-0 right-0 z-50 flex justify-between items-center h-[3.25rem] px-6 bg-surface border-b border-outline-variant/10"
      style={{ left: `${sidebarWidth}px` }}
    >
      <div className="flex items-center gap-3">
        <h2 className="font-serif text-[1.65rem] font-bold text-primary">{title}</h2>
      </div>

      <button className="p-2 text-on-surface-variant hover:bg-surface-container rounded-full transition-colors">
        <SlidersHorizontal className="w-5 h-5" />
      </button>
    </nav>

    {drawerOpen ? (
      <div className="fixed top-[3.25rem] right-0 z-[70] w-80 h-[calc(100vh-3.25rem)] border-l border-outline-variant/20 bg-surface-container-low p-5 shadow-2xl">
        <h3 className="font-serif text-2xl font-bold text-on-surface mb-4">快捷设置</h3>
        <div className="space-y-3">
          <div className="rounded-xl bg-surface-container-high p-3">
            <p className="text-[10px] font-mono uppercase text-on-surface-variant mb-1">当前模型</p>
            <p className="text-sm font-semibold text-on-surface">gpt-4o</p>
          </div>
          <div className="rounded-xl bg-surface-container-high p-3">
            <p className="text-[10px] font-mono uppercase text-on-surface-variant mb-1">连接状态</p>
            <p className="text-sm font-semibold text-on-surface">Mock Connected</p>
          </div>
        </div>
        <button className="mt-6 w-full px-4 py-2 rounded-xl signature-gradient text-on-primary text-sm font-semibold">
          前往完整设置
        </button>
      </div>
    ) : null}
  </>
);

export default TopNavReference;

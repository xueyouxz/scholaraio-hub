import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type React from "react";

interface SidebarBrandProps {
  collapsed?: boolean;
}

const SidebarBrand: React.FC<SidebarBrandProps> = ({ collapsed = false }) => (
  <div
    className={`mb-4 rounded-[20px] transition-all duration-200 hover:bg-surface-container ${
      collapsed ? "flex items-center justify-center px-0 py-2.5" : "px-3 py-2.5"
    }`}
  >
    <div
      className={`flex w-full items-center ${
        collapsed ? "justify-center" : "justify-between gap-3"
      }`}
    >
      {!collapsed ? (
        <div className="min-w-0 -mt-1">
          <h1 className="font-serif text-[1.7rem] font-bold leading-none text-primary">
            ScholarAIO
          </h1>
          <p className="mt-0.5 text-[9px] uppercase tracking-[0.28em] text-on-surface-variant font-mono opacity-60">
            The Digital Atelier
          </p>
        </div>
      ) : null}
      <span className="flex shrink-0 items-center justify-center text-on-surface-variant">
        {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
      </span>
    </div>
  </div>
);

export default SidebarBrand;

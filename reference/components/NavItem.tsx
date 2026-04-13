import type React from "react";
import type { NavigationItem } from "../types/ui";

interface NavItemProps {
  item: NavigationItem;
  collapsed?: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ item, collapsed = false }) => {
  const Icon = item.icon;
  const active = item.state === "active";

  return (
    <div
      className={`w-full flex items-center rounded-xl transition-all duration-200 ${
        collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5"
      } ${
        active
          ? "bg-surface-container-high text-primary border-l-4 border-primary"
          : "text-on-surface-variant hover:bg-surface-container"
      }`}
    >
      <Icon className={`w-5 h-5 shrink-0 ${active ? "text-primary" : "text-on-surface-variant"}`} />
      {!collapsed ? (
        <span className="font-sans text-[13px] font-medium whitespace-nowrap">{item.label}</span>
      ) : null}
    </div>
  );
};

export default NavItem;

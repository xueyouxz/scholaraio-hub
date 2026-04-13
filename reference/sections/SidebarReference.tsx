import { Plus } from "lucide-react";
import type React from "react";
import ChatHistoryItem from "../components/ChatHistoryItem";
import NavItem from "../components/NavItem";
import SectionLabel from "../components/SectionLabel";
import SidebarBrand from "../components/SidebarBrand";
import UserProfileCard from "../components/UserProfileCard";
import { navigationItems, profileMenuItems, sidebarSessions } from "../mock/entities";

interface SidebarReferenceProps {
  collapsed?: boolean;
  menuOpen?: boolean;
}

const SidebarReference: React.FC<SidebarReferenceProps> = ({
  collapsed = false,
  menuOpen = true,
}) => (
  <aside
    className={`fixed left-0 top-0 h-full z-40 flex flex-col px-3 py-3 bg-surface-container-low border-r border-outline-variant/15 overflow-hidden ${
      collapsed ? "w-[5.25rem]" : "w-[15.5rem]"
    }`}
  >
    <SidebarBrand collapsed={collapsed} />

    {!collapsed ? (
      <div className="mb-3">
        <div className="w-full flex items-center gap-2.5 rounded-[18px] px-3 py-2.5 text-sm font-medium bg-surface-container text-on-surface">
          <Plus className="w-4 h-4 shrink-0" />
          <span>新建对话</span>
        </div>
      </div>
    ) : null}

    <nav className={`space-y-1.5 ${!collapsed ? "mb-5" : ""}`}>
      {navigationItems.map((item, index) => (
        <NavItem
          key={item.id}
          item={{ ...item, state: index === 0 ? "active" : "default" }}
          collapsed={collapsed}
        />
      ))}
    </nav>

    {!collapsed ? (
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pr-1 border-t border-outline-variant/10 pt-3">
        <SectionLabel label="recents" />
        <div className="space-y-3 mt-2">
          {["2026-04-09", "2026-04-08", "2026-04-07"].map((date) => (
            <div key={date} className="space-y-1.5">
              <p className="px-1 text-[11px] text-on-surface-variant/60">{date}</p>
              <div className="space-y-1">
                {sidebarSessions
                  .filter((item) => item.date === date)
                  .map((item, index) => (
                    <ChatHistoryItem
                      key={item.id}
                      item={item}
                      showActions={item.active && index === 0}
                    />
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    ) : (
      <div className="flex-1" />
    )}

    <div className="mt-3 pt-3 border-t border-outline-variant/10">
      <div className="relative">
        {menuOpen && !collapsed ? (
          <div className="absolute bottom-full left-0 right-0 mb-3 overflow-hidden rounded-[28px] border border-outline-variant/20 bg-surface-container-lowest shadow-[0_24px_50px_rgba(23,29,26,0.16)] backdrop-blur-xl">
            <div className="px-3 py-3">
              <div className="space-y-1">
                {profileMenuItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.id}
                      className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-surface-container"
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-container text-on-surface-variant">
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-on-surface">
                          {item.label}
                        </span>
                        <span className="block text-xs text-on-surface-variant">
                          {item.description}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        <UserProfileCard collapsed={collapsed} menuOpen={menuOpen} />
      </div>
    </div>
  </aside>
);

export default SidebarReference;

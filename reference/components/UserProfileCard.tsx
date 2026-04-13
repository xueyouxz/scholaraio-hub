import { ChevronUp, User } from "lucide-react";
import type React from "react";

interface UserProfileCardProps {
  collapsed?: boolean;
  menuOpen?: boolean;
}

const UserProfileCard: React.FC<UserProfileCardProps> = ({
  collapsed = false,
  menuOpen = false,
}) => (
  <div
    className={`w-full rounded-[20px] bg-surface-container transition-all duration-200 hover:bg-surface-container-high ${
      collapsed ? "flex justify-center p-2.5" : "flex items-center gap-3 px-3 py-3"
    }`}
  >
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary">
      <User className="w-4 h-4" />
    </div>
    {!collapsed ? (
      <>
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-xs font-bold">林策展</p>
          <p className="text-[10px] text-on-surface-variant font-mono">Senior Curator</p>
        </div>
        <span
          className={`shrink-0 text-on-surface-variant transition-transform duration-200 ${
            menuOpen ? "rotate-180" : ""
          }`}
        >
          <ChevronUp className="w-4 h-4" />
        </span>
      </>
    ) : null}
  </div>
);

export default UserProfileCard;

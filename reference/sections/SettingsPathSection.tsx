import { FolderOpen } from "lucide-react";
import type React from "react";
import SettingsPathRow from "../components/SettingsPathRow";
import { pathItems } from "../mock/settings";

const SettingsPathSection: React.FC = () => (
  <div className="bg-surface-container-low rounded-[2rem] p-8 border border-outline-variant/10">
    <div className="flex justify-between items-center mb-8">
      <div className="flex items-center gap-4">
        <div className="p-3 bg-secondary-container rounded-xl text-primary">
          <FolderOpen className="w-6 h-6" />
        </div>
        <h4 className="font-serif text-2xl font-bold">Path Configuration</h4>
      </div>
    </div>
    <div className="space-y-4">
      {pathItems.map((item) => (
        <SettingsPathRow key={item.label} item={item} />
      ))}
    </div>
  </div>
);

export default SettingsPathSection;

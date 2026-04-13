import type React from "react";
import SettingsFooterSection from "../sections/SettingsFooterSection";
import SettingsModelSection from "../sections/SettingsModelSection";
import SettingsPathSection from "../sections/SettingsPathSection";

const SettingsPageReference: React.FC = () => (
  <div className="flex-1 p-8 max-w-5xl mx-auto w-full space-y-8 overflow-y-auto no-scrollbar">
    <div className="mb-12">
      <h3 className="font-serif text-4xl font-bold text-on-surface mb-2">System Configuration</h3>
      <p className="text-on-surface-variant max-w-2xl leading-relaxed font-sans">
        面向后期重构的系统配置设计稿，保留卡片组织和信息层级，不保留编辑逻辑。
      </p>
    </div>
    <SettingsModelSection />
    <SettingsPathSection />
    <SettingsFooterSection />
  </div>
);

export default SettingsPageReference;

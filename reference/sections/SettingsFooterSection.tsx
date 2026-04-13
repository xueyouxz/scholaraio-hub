import { Download, HelpCircle } from "lucide-react";
import type React from "react";

const SettingsFooterSection: React.FC = () => (
  <>
    <div className="pt-12 pb-24 border-t border-outline-variant/15 flex flex-col md:flex-row justify-between items-start gap-8">
      <div className="max-w-sm">
        <h5 className="font-serif font-bold text-lg mb-2">Export Configuration</h5>
        <p className="text-sm text-on-surface-variant leading-relaxed mb-4 font-sans">
          导出当前系统配置，作为后期重构前的结构快照。
        </p>
        <button className="text-primary text-sm font-bold flex items-center gap-2 hover:translate-x-1 transition-transform font-sans">
          Download config.yaml <Download className="w-4 h-4" />
        </button>
      </div>

      <div className="bg-surface-container-high p-6 rounded-2xl w-full md:w-80">
        <h5 className="text-[10px] uppercase font-bold text-on-surface-variant mb-4 font-mono">
          Environment Status
        </h5>
        <div className="space-y-3">
          <div className="flex justify-between items-center text-xs font-sans">
            <span>Python v3.11.4</span>
            <span className="text-primary font-bold">READY</span>
          </div>
          <div className="flex justify-between items-center text-xs font-sans">
            <span>Connection</span>
            <span className="text-on-surface-variant">Mock</span>
          </div>
          <div className="flex justify-between items-center text-xs font-sans">
            <span>Vault Size</span>
            <span className="text-on-surface-variant">1.2 GB</span>
          </div>
          <div className="h-1 w-full bg-outline-variant/20 rounded-full mt-4">
            <div className="h-full w-3/4 bg-primary rounded-full" />
          </div>
        </div>
      </div>
    </div>

    <footer className="fixed bottom-0 right-0 left-64 h-10 bg-surface-container-low px-6 flex items-center justify-between border-t border-outline-variant/10">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-on-surface-variant">
          <span className="w-1.5 h-1.5 bg-primary rounded-full" />
          SYSTEM ONLINE
        </div>
        <div className="h-3 w-[1px] bg-outline-variant/30" />
        <div className="text-[10px] font-mono text-on-surface-variant uppercase">Latency: 42ms</div>
      </div>
      <div className="text-[10px] font-mono text-on-surface-variant uppercase">
        © 2024 SCHOLARAIO ATELIER
      </div>
    </footer>

    <div className="fixed bottom-14 right-8 z-50">
      <button className="w-14 h-14 bg-surface-container-highest rounded-full shadow-2xl flex items-center justify-center text-primary border border-primary/10 hover:scale-110 transition-transform">
        <HelpCircle className="w-7 h-7" />
      </button>
    </div>
  </>
);

export default SettingsFooterSection;

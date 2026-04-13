import { AlertCircle, CheckCircle2, Cpu, Database, FileText } from "lucide-react";
import type React from "react";
import SettingsFieldCard from "../components/SettingsFieldCard";
import { embeddingField, modelFields } from "../mock/settings";

const SettingsModelSection: React.FC = () => (
  <div className="grid grid-cols-1 gap-6">
    <div className="bg-surface-container-low rounded-[2rem] p-8 border border-outline-variant/10">
      <div className="flex justify-between items-start mb-8">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-secondary-container rounded-xl text-primary">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-serif text-2xl font-bold">Large Language Model</h4>
            <p className="text-xs text-on-surface-variant font-sans">核心推理与综合引擎</p>
          </div>
        </div>
        <CheckCircle2 className="w-6 h-6 text-primary fill-primary/10" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
        {modelFields.map((field) => (
          <SettingsFieldCard key={field.label} field={field} />
        ))}
      </div>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-surface-container-low rounded-[2rem] p-8 border border-outline-variant/10">
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-primary" />
            <h4 className="font-serif text-xl font-bold">Vector Embeddings</h4>
          </div>
          <CheckCircle2 className="w-5 h-5 text-primary fill-primary/10" />
        </div>
        <SettingsFieldCard field={embeddingField} />
      </div>

      <div className="bg-surface-container-low rounded-[2rem] p-8 border border-outline-variant/10">
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-primary" />
            <h4 className="font-serif text-xl font-bold">MinerU Configuration</h4>
          </div>
          <AlertCircle className="w-5 h-5 text-error" />
        </div>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-on-surface-variant font-mono">
              MinerU Path
            </label>
            <p className="font-mono text-sm">/usr/local/bin/mineru</p>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-on-surface-variant font-mono">
              MinerU Model
            </label>
            <p className="font-mono text-sm italic opacity-50">Not specified</p>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default SettingsModelSection;

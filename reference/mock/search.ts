import type { SearchFilterGroup } from "../types/ui";
import { papers } from "./entities";

export const searchModes = [
  { label: "关键词", active: false },
  { label: "语义", active: false },
  { label: "混合", active: true, highlight: true },
];

export const searchFilters: SearchFilterGroup[] = [
  {
    title: "发表类型",
    options: [
      { label: "期刊论文", checked: true },
      { label: "会议论文", checked: true },
      { label: "预印本", checked: false },
      { label: "学位论文", checked: false },
    ],
  },
  {
    title: "入库状态",
    options: [
      { label: "已在文库中", checked: true },
      { label: "尚未入库", checked: false },
    ],
  },
];

export const searchResults = papers;

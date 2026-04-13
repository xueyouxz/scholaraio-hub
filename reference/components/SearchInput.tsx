import { Search, X } from "lucide-react";
import type React from "react";

interface SearchInputProps {
  value: string;
}

const SearchInput: React.FC<SearchInputProps> = ({ value }) => (
  <div className="w-full h-14 bg-surface-container-low rounded-full flex items-center px-6 transition-all border border-outline-variant/10">
    <Search className="w-5 h-5 text-outline" />
    <div className="w-full bg-transparent text-on-surface px-4 font-sans">{value}</div>
    <X className="w-5 h-5 text-outline" />
  </div>
);

export default SearchInput;

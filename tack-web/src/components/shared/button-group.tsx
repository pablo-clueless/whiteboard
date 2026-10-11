"use client";

import { Option } from "@/types/app";
import { cn } from "cn";

interface Props {
  onValueChange: (value: string) => void;
  options: Option[];
  value: string;
}

export const ButtonGroup = ({ onValueChange, options, value }: Props) => {
  return (
    <div className="flex items-center rounded-md border">
      {options.map((option) => {
        const isSelected = option.value === value;
        return (
          <button
            className={cn(
              "border-l px-3 py-1 text-sm first:rounded-l-md last:rounded-r-md",
              isSelected ? "text-primary bg-white font-semibold" : "",
            )}
            key={option.value}
            onClick={() => onValueChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

"use client";

import { Option } from "@/types/app";
import { cn } from "cn";

interface Props {
  onValueChange: (value: string) => void;
  options: Option[];
  value: string;
  buttonClassName?: string;
  className?: string;
}

export const ButtonGroup = ({
  onValueChange,
  options,
  value,
  buttonClassName,
  className,
}: Props) => {
  return (
    <div className={cn("flex items-center rounded-md border", className)}>
      {options.map((option) => {
        const isSelected = option.value === value;
        return (
          <button
            className={cn(
              "border-l px-3 py-1 text-sm first:rounded-l-md last:rounded-r-md",
              isSelected ? "text-primary bg-white font-semibold" : "",
              buttonClassName,
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

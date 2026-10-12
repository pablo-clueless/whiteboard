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

import React from "react";

export const TabList = ({ onValueChange, options, value, buttonClassName, className }: Props) => {
  return (
    <div className={cn("flex items-center rounded-md border", className)}>
      {options.map((option) => {
        const Icon = option.icon;

        return (
          <button
            className={cn(
              "flex flex-1 items-center justify-center gap-x-2 py-1.5 text-sm font-medium first:rounded-l-md last:rounded-r-md",
              option.value === value ? "bg-primary text-white" : "",
              buttonClassName,
            )}
            key={option.value}
            onClick={() => onValueChange(option.value)}
          >
            {Icon && <Icon className="size-4" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

import { LucideIcon } from "lucide-react";

export type Maybe<T> = T | null;

export type Option = {
  label: string;
  value: string;
  description?: string;
  icon?: LucideIcon;
};

export interface TabProps {
  tab: string;
  className?: string;
}

"use client";

import { AnimatePresence, motion } from "motion/react";
import React from "react";
import { cn } from "cn";

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  tab: string | number;
  value: string | number;
  children?: React.ReactNode;
  className?: string;
  innerClassName?: string;
  animated?: boolean;
  preserveContent?: boolean;
}

const TabPanel = React.forwardRef<HTMLDivElement, Props>(
  (
    { tab, value, children, className, innerClassName, animated = true, preserveContent = false },
    ref,
  ) => {
    if (typeof tab !== typeof value) {
      throw new Error("TabPanel: tab and value must be of the same type");
    }

    const isSelected = tab === value;
    const content = <div className={cn("h-fit w-full", innerClassName)}>{children}</div>;

    return (
      <div
        ref={ref}
        role="tabpanel"
        hidden={!isSelected}
        id={`tabpanel-${value}`}
        aria-labelledby={`tab-${value}`}
        aria-hidden={!isSelected}
        tabIndex={isSelected ? 0 : -1}
        className={cn("h-fit w-full", className)}
      >
        {animated ? (
          <AnimatePresence mode="wait">
            {(isSelected || preserveContent) && (
              <motion.div
                key={`${value}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="h-full w-full"
              >
                {content}
              </motion.div>
            )}
          </AnimatePresence>
        ) : (
          isSelected && content
        )}
      </div>
    );
  },
);

TabPanel.displayName = "TabPanel";

export { TabPanel };
export type { Props as TabPanelProps };

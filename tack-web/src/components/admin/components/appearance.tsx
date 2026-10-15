"use client";

import { Check, MousePointer2 } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";

import {
  CURSOR_COLORS,
  MAX_DISPLAY_NAME_LENGTH,
  useProfileStore,
  useUserStore,
} from "@/stores/user";
import { TabPanel } from "@/components/shared";
import { Input } from "@/components/ui/input";
import type { TabProps } from "@/types/app";
import { useReportDirty } from "./use-settings";
import { SettingsSection } from "./section";
import { FormField } from "../fields";
import { toast } from "sonner";

/** How this browser shows up on boards: the name and colour on its cursor. */
export const Appearance = ({ tab }: TabProps) => {
  const saved = useProfileStore();
  return (
    <TabPanel tab={tab} value="appearance">
      {/* Keyed so the form starts again from what was saved. */}
      <OnBoards key={`${saved.displayName}\n${saved.color}`} />
    </TabPanel>
  );
};

const OnBoards = () => {
  const { displayName, color, setDisplayName, setColor } = useProfileStore();
  const accountName = useUserStore((s) => s.user?.name ?? "");
  const [name, setName] = useState(displayName ?? "");
  const [picked, setPicked] = useState<string | null>(color);
  const dirty = name.trim() !== (displayName ?? "") || picked !== color;
  useReportDirty("appearance", dirty);

  const shown = name.trim() || accountName || "Anonymous Otter";
  const preview = picked ?? CURSOR_COLORS[4];

  return (
    <SettingsSection
      description="The name and colour on your cursor when you're on a board. Kept in this browser."
      dirty={dirty}
      onReset={() => {
        setName(displayName ?? "");
        setPicked(color);
      }}
      onSave={() => {
        setDisplayName(name);
        setColor(picked);
        toast.success("Saved");
      }}
      title="On boards"
    >
      <div className="grid gap-6 py-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <FormField hint="Leave it empty to use your account name." label="Name">
            {(id) => (
              <Input
                className="sm:max-w-xs"
                id={id}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
                onChange={(e) => setName(e.target.value)}
                placeholder={accountName}
                value={name}
              />
            )}
          </FormField>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Colour</p>
            <div className="flex flex-wrap items-center gap-2" role="radiogroup">
              <button
                aria-checked={picked === null}
                className={cn(
                  "h-7 rounded-full border px-3 text-xs",
                  picked === null ? "border-foreground font-medium" : "text-muted-foreground",
                )}
                onClick={() => setPicked(null)}
                role="radio"
                type="button"
              >
                Any
              </button>
              {CURSOR_COLORS.map((c) => (
                <button
                  aria-checked={picked === c}
                  aria-label={c}
                  className={cn(
                    "grid size-7 place-items-center rounded-full text-white ring-offset-2",
                    picked === c && "ring-foreground ring-2",
                  )}
                  key={c}
                  onClick={() => setPicked(c)}
                  role="radio"
                  style={{ background: c }}
                  type="button"
                >
                  {picked === c && <Check className="size-4" />}
                </button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              With &quot;Any&quot;, each visit gets one of these, so people on a board look
              different.
            </p>
          </div>
        </div>
        <div
          aria-hidden
          className="relative h-28 w-48 rounded-md border bg-[radial-gradient(#d4d4d8_1px,transparent_1px)] bg-size-[14px_14px]"
        >
          <span className="absolute top-8 left-14">
            <MousePointer2 className="size-5" style={{ color: preview, fill: preview }} />
            <span
              className="absolute top-5 left-4 max-w-36 truncate rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap text-white"
              style={{ background: preview }}
            >
              {shown}
            </span>
          </span>
        </div>
      </div>
    </SettingsSection>
  );
};

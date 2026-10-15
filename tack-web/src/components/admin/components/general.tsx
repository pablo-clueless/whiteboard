"use client";

import { useState } from "react";

import { NumberRow, SettingsHistory, SettingsSection } from "./section";
import { useSectionDraft, useSettings } from "./use-settings";
import { Textarea } from "@/components/ui/textarea";
import type { PlatformProps } from "@/types/system";
import { TabPanel } from "@/components/shared";
import { TabProps } from "@/types/app";
import { ToggleRow } from "../fields";

export const General = ({ tab }: TabProps) => {
  const { data } = useSettings();
  return (
    <TabPanel tab={tab} value="general">
      {/* Keyed on the saved values, so the form resets to them after a save. */}
      <div className="space-y-6">
        {data && <PlatformForm key={JSON.stringify(data.platform)} saved={data.platform} />}
        <SettingsHistory section="platform" />
      </div>
    </TabPanel>
  );
};

const PlatformForm = ({ saved }: { saved: PlatformProps }) => {
  const { draft, errors, set, dirty, saving, save, reset } = useSectionDraft("platform", saved);
  // The text as typed: parsing it on every keystroke would eat the newline being typed.
  const [origins, setOrigins] = useState(saved.allowedOrigins.join("\n"));

  return (
    <SettingsSection
      title="Platform"
      description="How the server runs. Changes apply straight away, to boards already open too."
      dirty={dirty}
      onReset={() => {
        reset();
        setOrigins(saved.allowedOrigins.join("\n"));
      }}
      onSave={save}
      saving={saving}
    >
      <ToggleRow
        label="Maintenance mode"
        description="Only admins can open or create boards. Everyone else is told to try again later and reconnects on their own afterwards."
        checked={draft.maintenanceMode}
        onCheckedChange={(v) => set("maintenanceMode", v)}
      />
      <NumberRow
        label="Board size limit"
        description="Boards stop accepting edits past this size, and editors are told why."
        unit="MB"
        min={1}
        max={1024}
        value={draft.sizeLimit}
        error={errors.sizeLimit}
        onChange={(v) => set("sizeLimit", v)}
      />
      <NumberRow
        label="Idle timeout"
        description="How long a board stays loaded after the last person leaves."
        unit="seconds"
        min={5}
        max={86400}
        value={draft.idleTimeout}
        error={errors.idleTimeout}
        onChange={(v) => set("idleTimeout", v)}
      />
      <div className="space-y-1.5 py-3">
        <p className="text-sm font-medium">Allowed origins</p>
        <p className="text-muted-foreground text-xs">
          Sites allowed to call the API and open boards, one per line, like
          https://tack.example.com. Remove this site and the admin interface stops working.
        </p>
        {errors.allowedOrigins && (
          <p className="text-destructive text-xs" role="alert">
            {errors.allowedOrigins}
          </p>
        )}
        <Textarea
          aria-invalid={Boolean(errors.allowedOrigins)}
          className="font-mono text-xs"
          onChange={(e) => {
            setOrigins(e.target.value);
            set(
              "allowedOrigins",
              e.target.value
                .split("\n")
                .map((o) => o.trim())
                .filter(Boolean),
            );
          }}
          rows={4}
          value={origins}
        />
      </div>
    </SettingsSection>
  );
};

"use client";

import React, { type SubmitEvent, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { useApiMutation, useApiQuery } from "@/lib/query";
import { TabPanel } from "@/components/shared";
import type { FeatureFlag } from "@/types/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabProps } from "@/types/app";
import { SettingsHistory, SettingsSection } from "./section";
import { SETTINGS_KEY, useReportDirty } from "./use-settings";
import { ToggleRow } from "../fields";
import { EmptyNote } from "../panel";
import { useConfirm } from "../confirm";

const KEYS = [["admin", "feature-flags"], SETTINGS_KEY, ["admin", "settings-history"]];

export const FeatureFlags = ({ tab }: TabProps) => {
  const { dialog, confirm } = useConfirm();
  const { data: flags } = useApiQuery<FeatureFlag[]>({
    keys: ["admin", "feature-flags"],
    url: "/api/admin/feature-flags",
  });
  const toggle = useApiMutation<{ id: string; enabled: boolean }>({
    keys: KEYS,
    method: "patch",
    url: ({ id }) => `/api/admin/feature-flags/${id}`,
    successMessage: false,
  });
  const remove = useApiMutation<{ id: string }>({
    keys: KEYS,
    method: "delete",
    url: ({ id }) => `/api/admin/feature-flags/${id}`,
    successMessage: "Flag deleted",
  });

  return (
    <TabPanel tab={tab} value="feature-flags">
      <div className="space-y-6">
        <SettingsSection
          title="Feature flags"
          description="Switch features on and off without a deploy. The web client reads them from /api/config by id."
        >
          {flags?.length ? (
            flags.map((flag) => (
              <div className="flex items-center gap-2" key={flag.id}>
                <div className="flex-1">
                  <ToggleRow
                    checked={flag.enabled}
                    description={
                      <>
                        <code className="font-mono">{flag.id}</code>
                        {flag.description && ` · ${flag.description}`}
                      </>
                    }
                    disabled={toggle.isPending}
                    label={flag.name}
                    onCheckedChange={(enabled) => toggle.mutate({ id: flag.id, enabled })}
                  />
                </div>
                <Button
                  aria-label={`Delete ${flag.name}`}
                  onClick={() =>
                    confirm({
                      title: `Delete ${flag.name}?`,
                      description: `Anything checking "${flag.id}" will see it as off.`,
                      confirmLabel: "Delete",
                      destructive: true,
                      onConfirm: () => remove.mutate({ id: flag.id }),
                    })
                  }
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
              </div>
            ))
          ) : (
            <EmptyNote>No flags yet.</EmptyNote>
          )}
        </SettingsSection>
        <NewFlag />
        <SettingsHistory section="flags" />
      </div>
      {dialog}
    </TabPanel>
  );
};

const NewFlag = () => {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [description, setDescription] = useState("");
  useReportDirty("new-flag", Boolean(name.trim() || id.trim() || description.trim()));
  const create = useApiMutation<{ name: string; id?: string; description?: string }>({
    keys: KEYS,
    method: "post",
    url: "/api/admin/feature-flags",
    successMessage: "Flag created",
  });

  const onSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    create.mutate(
      { name, ...(id ? { id } : {}), ...(description ? { description } : {}) },
      {
        onSuccess: () => {
          setName("");
          setId("");
          setDescription("");
        },
      },
    );
  };

  return (
    <form className="space-y-3 rounded-md border bg-white p-4" onSubmit={onSubmit}>
      <p className="font-medium">New flag</p>
      <div className="grid grid-cols-3 gap-3">
        <Input onChange={(e) => setName(e.target.value)} placeholder="Name" required value={name} />
        <Input
          className="font-mono"
          onChange={(e) => setId(e.target.value)}
          placeholder="id (from the name if empty)"
          value={id}
        />
        <Input
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          value={description}
        />
      </div>
      <Button disabled={create.isPending || !name.trim()} type="submit">
        <Plus /> Add flag
      </Button>
    </form>
  );
};

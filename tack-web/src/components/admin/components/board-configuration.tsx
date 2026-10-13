"use client";

import { TabPanel } from "@/components/shared";
import type { BoardProps } from "@/types/system";
import { TabProps } from "@/types/app";
import { SettingsHistory, SettingsSection } from "./section";
import { useSectionDraft, useSettings } from "./use-settings";
import { ToggleRow } from "../fields";

export const BoardConfiguration = ({ tab }: TabProps) => {
  const { data } = useSettings();
  return (
    <TabPanel tab={tab} value="board-configuration">
      <div className="space-y-6">
        {data && <BoardForm key={JSON.stringify(data.board)} saved={data.board} />}
        <SettingsHistory section="board" />
      </div>
    </TabPanel>
  );
};

const BoardForm = ({ saved }: { saved: BoardProps }) => {
  const { draft, set, dirty, saving, save, reset } = useSectionDraft("board", saved);

  return (
    <SettingsSection
      title="Boards"
      description="What people can do on boards. Admins can always create boards."
      dirty={dirty}
      onReset={reset}
      onSave={save}
      saving={saving}
    >
      <ToggleRow
        label="New boards"
        description="Off: nobody but admins can create a board. Existing boards keep working."
        checked={draft.newBoardCreation}
        onCheckedChange={(v) => set("newBoardCreation", v)}
      />
      <ToggleRow
        label="Image uploads"
        description="Off: images can't be added. Ones already on boards still show."
        checked={draft.imageUploads}
        onCheckedChange={(v) => set("imageUploads", v)}
      />
      <ToggleRow
        label="Diagram import"
        description="Diagrams from DBML or Mermaid. Off: the editor hides From code and ignores pasted diagram code."
        checked={draft.diagramImport}
        onCheckedChange={(v) => set("diagramImport", v)}
      />
      <ToggleRow
        label="Read-only switch"
        description="Editors can lock a board with the Lock button so nobody can edit it until an editor unlocks it. Off: the button is hidden and locked boards can be edited again (their lock comes back if this is switched on)."
        checked={draft.readOnlySwitch}
        onCheckedChange={(v) => set("readOnlySwitch", v)}
      />
    </SettingsSection>
  );
};

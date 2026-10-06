import { Palette, ShieldLock, UserCircle, type LucideIcon } from "lucide-react";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { cn } from "cn";

const TABS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "account", label: "Account", icon: UserCircle },
  { id: "security", label: "Security", icon: ShieldLock },
  { id: "appearance", label: "Appearance", icon: Palette },
];

export const Settings = () => {
  const [tab, setTab] = useState(TABS[0].id);
  const [open, setOpen] = useState(false);

  return (
    <Dialog onOpenChange={(open) => setOpen(open)} open={open}>
      <DialogTrigger>Settings</DialogTrigger>
      <DialogContent className="sm:max-w-150">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription></DialogDescription>
        </DialogHeader>
        <div className="">
          <div className="flex items-center">
            {TABS.map(({ icon: Icon, id, label }) => (
              <button
                className={cn("flex items-center gap-x-2", tab === id ? "" : "")}
                key={id}
                onClick={() => setTab(id)}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

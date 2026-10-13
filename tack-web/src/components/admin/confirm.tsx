"use client";

import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmOptions {
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

/** A confirmation dialog: render `dialog` once, then `confirm({ … })` before risky actions. */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);

  const dialog = (
    <Dialog open={Boolean(options)} onOpenChange={(open) => !open && setOptions(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{options?.title}</DialogTitle>
          <DialogDescription>{options?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => setOptions(null)} variant="outline">
            Cancel
          </Button>
          <Button
            onClick={() => {
              options?.onConfirm();
              setOptions(null);
            }}
            variant={options?.destructive ? "destructive" : "default"}
          >
            {options?.confirmLabel ?? "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { dialog, confirm: setOptions };
}

"use client";

import React, { type SubmitEvent, useState } from "react";
import { UserPlus } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormField, NativeSelect, ROLE_OPTIONS } from "./fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApiMutation } from "@/lib/query";

type NewUser = { name: string; email: string; role: string; password?: string };

/** Creates an account. Without a password, the person is emailed a link to choose one. */
export const InviteUser = () => {
  const [open, setOpen] = useState(false);
  const create = useApiMutation<NewUser>({
    keys: ["admin", "users"],
    method: "post",
    url: "/api/admin/users",
    successMessage: "User created",
  });

  const onSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const password = String(data.get("password") ?? "");
    create.mutate(
      {
        name: String(data.get("name") ?? ""),
        email: String(data.get("email") ?? ""),
        role: String(data.get("role") ?? "viewer"),
        ...(password ? { password } : {}),
      },
      { onSuccess: () => setOpen(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <UserPlus /> Add user
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a user</DialogTitle>
          <DialogDescription>
            Leave the password empty to email them a link to choose their own.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" id="invite-user" onSubmit={onSubmit}>
          <FormField label="Name">{(id) => <Input id={id} name="name" required />}</FormField>
          <FormField label="Email">
            {(id) => <Input id={id} name="email" required type="email" />}
          </FormField>
          <FormField label="Role">
            {(id) => (
              <NativeSelect defaultValue="viewer" id={id} name="role" options={ROLE_OPTIONS} />
            )}
          </FormField>
          <FormField label="Password" hint="Optional.">
            {(id) => <Input autoComplete="new-password" id={id} name="password" type="password" />}
          </FormField>
        </form>
        <DialogFooter>
          <Button onClick={() => setOpen(false)} variant="outline">
            Cancel
          </Button>
          <Button disabled={create.isPending} form="invite-user" type="submit">
            {create.isPending ? "Adding…" : "Add user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

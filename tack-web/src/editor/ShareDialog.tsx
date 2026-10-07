"use client";

import { Check, Copy, Link2, RotateCcw, Share2 } from "lucide-react";
import type { WebsocketProvider } from "y-websocket";
import { useState } from "react";
import { cn } from "cn";

import { rememberLink, rememberedLink, shareUrl } from "@/lib/board-links";
import { setProviderToken } from "./sync/board-doc";
import { api, type Role } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Props = {
  boardId: string;
  token: string;
  role: Role;
  provider: WebsocketProvider;
  onTokenChange: (token: string) => void;
};

export function ShareDialog(props: Props) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className="bg-primary focus-visible:ring-primary/40 pointer-events-auto flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold text-white outline-none hover:bg-[#e0600a] focus-visible:ring-3"
          />
        }
      >
        <Share2 className="size-3.5" />
        Share
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <ShareBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ShareBody({ boardId, token, role, provider, onTokenChange }: Props) {
  const canEdit = role === "edit";
  // Links this browser knows. Viewers only ever know their own view link.
  const [links, setLinks] = useState<Partial<Record<Role, string>>>(() => ({
    edit: canEdit ? token : undefined,
    view: rememberedLink(boardId, "view") ?? (role === "view" ? token : undefined),
  }));
  const [creatingView, setCreatingView] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createViewLink = async () => {
    setCreatingView(true);
    setError(null);
    try {
      const link = await api.createLink(boardId, token, "view");
      rememberLink(boardId, "view", link.token);
      setLinks((l) => ({ ...l, view: link.token }));
    } catch {
      setError("Couldn't create a view link. Try again.");
    } finally {
      setCreatingView(false);
    }
  };

  const resetLinks = async () => {
    setResetting(true);
    setError(null);
    // Disconnect first: the server is about to drop everyone, and reconnecting with the old link
    // in the meantime would be refused for good.
    provider.disconnect();
    try {
      const fresh = await api.resetLinks(boardId, token);
      rememberLink(boardId, "edit", fresh.editToken);
      rememberLink(boardId, "view", fresh.viewToken);
      setProviderToken(provider, fresh.editToken);
      setLinks({ edit: fresh.editToken, view: fresh.viewToken });
      onTokenChange(fresh.editToken);
      setConfirmReset(false);
    } catch {
      setError("Couldn't reset the links. The old ones still work.");
    } finally {
      provider.connect();
      setResetting(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Share this board</DialogTitle>
        <DialogDescription>
          {canEdit
            ? "Anyone with a link can open the board. People with the edit link can change it; people with the view link can only look."
            : "You have a view link. Anyone you send it to can look at the board, but not change it."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {canEdit && links.edit && <LinkRow label="Can edit" url={shareUrl(boardId, links.edit)} />}
        {links.view ? (
          <LinkRow label="Can view" url={shareUrl(boardId, links.view)} />
        ) : (
          canEdit && (
            <div className="space-y-1.5">
              <p className="text-ink text-sm font-semibold">Can view</p>
              <button
                type="button"
                onClick={createViewLink}
                disabled={creatingView}
                className="text-ink focus-visible:ring-primary/30 flex h-10 w-full items-center justify-center gap-2 rounded-xl border bg-white text-sm font-semibold outline-none hover:bg-[#f8f8f9] focus-visible:ring-3 disabled:opacity-60"
              >
                <Link2 className="size-4" />
                {creatingView ? "Creating view link…" : "Create view link"}
              </button>
            </div>
          )
        )}

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        {canEdit && (
          <div className="border-t pt-4">
            {confirmReset ? (
              <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-3.5">
                <p className="text-ink text-sm leading-relaxed">
                  <span className="font-semibold">Reset links?</span> Everyone using the current
                  links, including people you&apos;ve shared them with, is disconnected and will
                  need a new link.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    disabled={resetting}
                    className="text-ink focus-visible:ring-primary/30 h-9 rounded-lg px-3 text-sm font-semibold outline-none hover:bg-white focus-visible:ring-3"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={resetLinks}
                    disabled={resetting}
                    className="bg-destructive h-9 rounded-lg px-3 text-sm font-semibold text-white outline-none hover:bg-red-700 focus-visible:ring-3 focus-visible:ring-red-300 disabled:opacity-60"
                  >
                    {resetting ? "Resetting links…" : "Reset links"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="text-ink/60 hover:text-destructive focus-visible:ring-primary/30 flex items-center gap-1.5 rounded text-sm font-medium outline-none focus-visible:ring-3"
              >
                <RotateCcw className="size-3.5" />
                Reset links
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function LinkRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the field is selectable, so the link can still be copied by hand.
    }
  };
  return (
    <div className="space-y-1.5">
      <p className="text-ink text-sm font-semibold">{label}</p>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          aria-label={`${label} link`}
          onFocus={(e) => e.currentTarget.select()}
          className="text-ink/70 focus-visible:ring-primary/20 h-10 min-w-0 flex-1 rounded-xl border bg-[#f8f8f9] px-3 font-mono text-xs outline-none select-all focus-visible:ring-3"
        />
        <button
          type="button"
          onClick={copy}
          className={cn(
            "focus-visible:ring-primary/30 flex h-10 w-24 shrink-0 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold outline-none focus-visible:ring-3",
            copied ? "bg-emerald-50 text-emerald-700" : "bg-ink text-white hover:bg-black",
          )}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
    </div>
  );
}

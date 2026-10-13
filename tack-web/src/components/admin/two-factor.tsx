"use client";

import { Check, Copy, Download, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import React, { type SubmitEvent, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TwoFactorSetup as SetupData, User } from "@/types/user";
import { fieldOf, http, HttpError } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUserStore } from "@/stores/user";

const copy = (text: string) =>
  navigator.clipboard.writeText(text).then(
    () => toast.success("Copied"),
    () => toast.error("Couldn't copy"),
  );

/** A code input with its error underneath. */
const CodeField = ({
  error,
  recoveryAllowed,
  disabled,
}: {
  error?: string;
  recoveryAllowed?: boolean;
  disabled?: boolean;
}) => (
  <div className="space-y-1">
    <Input
      aria-invalid={Boolean(error)}
      aria-label={recoveryAllowed ? "Code or recovery code" : "Code"}
      autoComplete="one-time-code"
      autoFocus
      className="font-mono tracking-widest"
      disabled={disabled}
      inputMode={recoveryAllowed ? "text" : "numeric"}
      name="code"
      placeholder={recoveryAllowed ? "123456 or a recovery code" : "123456"}
      required
    />
    {error && <p className="text-destructive text-xs">{error}</p>}
  </div>
);

/** Runs a request that takes a code, splitting a wrong code (beside the field) from the rest. */
function useCodeSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const submit =
    (fn: (code: string) => Promise<void>) => async (e: SubmitEvent<HTMLFormElement>) => {
      e.preventDefault();
      const code = String(new FormData(e.currentTarget).get("code") ?? "");
      setPending(true);
      setError(undefined);
      try {
        await fn(code);
      } catch (err) {
        if (err instanceof HttpError && fieldOf(err) === "code") setError(err.message);
        else toast.error(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setPending(false);
      }
    };
  return { pending, error, submit };
}

/** Recovery codes, shown once, with copy and download. */
const RecoveryCodes = ({ codes, onDone }: { codes: string[]; onDone: () => void }) => {
  const [saved, setSaved] = useState(false);
  const text = codes.join("\n");
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Tack recovery codes\n\n${text}\n`], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "tack-recovery-codes.txt" });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        If you lose your phone, each of these signs you in once instead of a code. Keep them
        somewhere safe: they won&apos;t be shown again.
      </p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border bg-gray-50 p-4 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button onClick={() => copy(text)} size="sm" variant="outline">
          <Copy /> Copy
        </Button>
        <Button onClick={download} size="sm" variant="outline">
          <Download /> Download
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input checked={saved} onChange={(e) => setSaved(e.target.checked)} type="checkbox" />
        I&apos;ve saved these codes
      </label>
      <Button className="w-full" disabled={!saved} onClick={onDone}>
        Done
      </Button>
    </div>
  );
};

/**
 * Setting up an authenticator app: scan the QR code (or type the key), confirm with a code, save
 * the recovery codes. Calls onDone with the updated user once they're saved.
 */
export const TwoFactorSetup = ({ onDone }: { onDone: (user: User) => void }) => {
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [starting, setStarting] = useState(false);
  const [enabled, setEnabled] = useState<{ codes: string[]; user: User } | null>(null);
  const { pending, error, submit } = useCodeSubmit();

  const start = async () => {
    setStarting(true);
    try {
      setSetup(await http.post<SetupData>("/api/auth/two-factor/setup"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start setup");
    } finally {
      setStarting(false);
    }
  };

  if (enabled) return <RecoveryCodes codes={enabled.codes} onDone={() => onDone(enabled.user)} />;

  if (!setup) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">
          You&apos;ll need an authenticator app such as Google Authenticator, 1Password, Authy or
          Microsoft Authenticator. After this, signing in asks for a code from it as well as your
          password.
        </p>
        <Button className="w-full" disabled={starting} onClick={start}>
          {starting ? <Loader2 className="animate-spin" /> : <KeyRound />} Set up an authenticator app
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={submit(async (code) => {
        const result = await http.post<{ recoveryCodes: string[]; user: User }>(
          "/api/auth/two-factor/enable",
          { code },
        );
        setEnabled({ codes: result.recoveryCodes, user: result.user });
      })}
    >
      <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
        <li>Scan this QR code with your authenticator app.</li>
        <li>Enter the 6-digit code it shows.</li>
      </ol>
      <div className="flex justify-center">
        {/* The server's SVG, shown as an image so none of it runs as markup on this page. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt="QR code for your authenticator app"
          className="size-48 rounded-md border bg-white p-2"
          src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`}
        />
      </div>
      <details className="text-sm">
        <summary className="text-muted-foreground cursor-pointer text-xs">Can&apos;t scan it?</summary>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 rounded bg-gray-100 px-2 py-1 font-mono text-xs break-all">
            {setup.secret.match(/.{1,4}/g)?.join(" ")}
          </code>
          <Button
            aria-label="Copy key"
            onClick={() => copy(setup.secret)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Copy />
          </Button>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          Enter this key in the app as a time-based key.
        </p>
      </details>
      <CodeField disabled={pending} error={error} />
      <Button className="w-full" disabled={pending} type="submit">
        {pending ? <Loader2 className="animate-spin" /> : <Check />} Turn on two-factor sign-in
      </Button>
    </form>
  );
};

/**
 * Two-factor sign-in for the signed-in user, from the header menu: set it up, or with it on, get
 * new recovery codes or turn it off (unless it's required).
 */
export const TwoFactorDialog = ({
  open,
  onOpenChange,
  required,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Admins can't turn it off while the security settings require it. */
  required: boolean;
}) => {
  const { user, setUser } = useUserStore();
  const [action, setAction] = useState<"codes" | "disable" | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const { pending, error, submit } = useCodeSubmit();

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setAction(null);
      setCodes(null);
    }
  };

  let body: React.ReactNode;
  if (!user) body = null;
  else if (!user.twoFactorEnabled) {
    body = (
      <TwoFactorSetup
        onDone={(u) => {
          setUser(u);
          close(false);
          toast.success("Two-factor sign-in is on");
        }}
      />
    );
  } else if (codes) {
    body = <RecoveryCodes codes={codes} onDone={() => close(false)} />;
  } else if (action) {
    body = (
      <form
        className="space-y-3"
        onSubmit={submit(async (code) => {
          if (action === "codes") {
            const r = await http.post<{ recoveryCodes: string[] }>("/api/auth/two-factor/recovery-codes", {
              code,
            });
            setCodes(r.recoveryCodes);
          } else {
            setUser(await http.post<User>("/api/auth/two-factor/disable", { code }));
            close(false);
            toast.success("Two-factor sign-in is off");
          }
        })}
      >
        <p className="text-muted-foreground text-sm">
          {action === "codes"
            ? "Enter a code from your authenticator app. Your old recovery codes stop working."
            : "Enter a code from your authenticator app, or a recovery code."}
        </p>
        <CodeField disabled={pending} error={error} recoveryAllowed={action === "disable"} />
        <div className="flex justify-end gap-2">
          <Button onClick={() => setAction(null)} type="button" variant="outline">
            Back
          </Button>
          <Button disabled={pending} type="submit" variant={action === "disable" ? "destructive" : "default"}>
            {action === "codes" ? "Make new codes" : "Turn off"}
          </Button>
        </div>
      </form>
    );
  } else {
    body = (
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-sm">
          <ShieldCheck className="size-4 text-green-600" /> On. Signing in asks for a code from your
          authenticator app.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setAction("codes")} variant="outline">
            New recovery codes
          </Button>
          <Button
            disabled={required}
            onClick={() => setAction("disable")}
            title={required ? "Required for admins by the security settings" : undefined}
            variant="outline"
          >
            Turn off
          </Button>
        </div>
        {required && (
          <p className="text-muted-foreground text-xs">
            The security settings require it for admins, so it can&apos;t be turned off.
          </p>
        )}
      </div>
    );
  }

  return (
    <Dialog onOpenChange={close} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Two-factor sign-in</DialogTitle>
          <DialogDescription>A code from your phone as well as your password.</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

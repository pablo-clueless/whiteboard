"use client";

import { type ComponentProps, type ReactNode, useId, useState } from "react";
import { Eye, EyeOff, Info } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";

import { Input } from "@/components/ui/input";

export function AuthHeader({ title, subtitle }: { title: string; subtitle: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-ink text-[2rem] leading-tight font-black tracking-[-0.04em]">{title}</h1>
      <p className="text-ink/60 mt-2 text-[15px] leading-relaxed">{subtitle}</p>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (id: string, describedBy?: string) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-ink text-sm font-semibold">
          {label}
        </label>
        {hint}
      </div>
      {children(id, error ? errorId : undefined)}
      {error && (
        <p id={errorId} className="text-destructive text-[13px]">
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  "placeholder:text-ink/35 h-11 rounded-xl border-[#e2e2e7] bg-white px-3.5 text-[15px] md:text-[15px] focus-visible:border-primary focus-visible:ring-primary/20";

export function TextInput({ className, ...props }: ComponentProps<"input">) {
  return <Input className={cn(inputClass, className)} {...props} />;
}

export function PasswordInput({ className, ...props }: ComponentProps<"input">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        className={cn(inputClass, "pr-11", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="text-ink/45 hover:text-ink focus-visible:ring-primary/30 absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-lg outline-none focus-visible:ring-3"
      >
        {visible ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
      </button>
    </div>
  );
}

export function SubmitButton({ children, pending }: { children: ReactNode; pending?: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-primary focus-visible:ring-primary/40 h-11 w-full rounded-xl text-[15px] font-semibold text-white transition-colors outline-none hover:bg-[#e0600a] focus-visible:ring-4 disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="text-ink/45 my-6 flex items-center gap-3 text-[13px]">
      <span className="h-px flex-1 bg-[#e6e6ea]" />
      {children}
      <span className="h-px flex-1 bg-[#e6e6ea]" />
    </div>
  );
}

export function GoogleButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-ink focus-visible:ring-primary/30 flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-[#e2e2e7] bg-white text-[15px] font-semibold transition-colors outline-none hover:bg-[#f8f8f9] focus-visible:ring-4"
    >
      <svg viewBox="0 0 24 24" className="size-4.5" aria-hidden>
        <path
          fill="#4285F4"
          d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8.1z"
        />
        <path
          fill="#34A853"
          d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"
        />
        <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9z" />
        <path
          fill="#EA4335"
          d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"
        />
      </svg>
      {children}
    </button>
  );
}

/** Shown after submit while accounts aren't switched on. TODO: remove once the auth API exists. */
export function NotAvailable({ children }: { children?: ReactNode }) {
  return (
    <p
      role="status"
      className="text-ink/75 mt-4 flex gap-2 rounded-xl border border-[#ffd9bd] bg-[#fff1e6] px-3.5 py-3 text-[13px] leading-relaxed"
    >
      <Info className="text-primary mt-px size-4 shrink-0" />
      <span>
        {children ?? "Accounts aren't switched on yet."} You can still{" "}
        <Link href="/" className="text-ink font-semibold underline underline-offset-2">
          start a board
        </Link>{" "}
        without one.
      </span>
    </p>
  );
}

export function FooterLink({ text, href, label }: { text: string; href: string; label: string }) {
  return (
    <p className="text-ink/60 mt-8 text-center text-sm">
      {text}{" "}
      <Link
        href={href}
        className="text-primary focus-visible:ring-primary/30 rounded font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-3"
      >
        {label}
      </Link>
    </p>
  );
}

export const linkClass =
  "text-primary focus-visible:ring-primary/30 rounded text-[13px] font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-3";

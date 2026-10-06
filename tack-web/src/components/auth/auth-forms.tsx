"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";

import {
  AuthHeader,
  Divider,
  Field,
  FooterLink,
  GoogleButton,
  linkClass,
  NotAvailable,
  PasswordInput,
  SubmitButton,
  TextInput,
} from "./form";

const MIN_PASSWORD = 8;

// TODO(auth): every submit below should call the auth API once it exists. Until then they only
// confirm that accounts aren't available, rather than pretending to succeed.
function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setNotice("Accounts aren't switched on yet.");
  };
  return { notice, setNotice, onSubmit };
}

export function SignInForm() {
  const { notice, setNotice, onSubmit } = useNotice();
  return (
    <>
      <AuthHeader title="Welcome back" subtitle="Log in to get back to your boards." />
      <form onSubmit={onSubmit} className="space-y-5">
        <Field label="Email">
          {(id) => (
            <TextInput
              id={id}
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
            />
          )}
        </Field>
        <Field
          label="Password"
          hint={
            <Link href="/forgot-password" className={linkClass}>
              Forgot password?
            </Link>
          }
        >
          {(id) => (
            <PasswordInput
              id={id}
              name="password"
              autoComplete="current-password"
              placeholder="Your password"
              required
            />
          )}
        </Field>
        <label className="text-ink/75 flex w-fit cursor-pointer items-center gap-2.5 text-sm">
          <Checkbox name="remember" defaultChecked className="size-[18px] rounded-[5px]" />
          Keep me logged in
        </label>
        <SubmitButton>Log in</SubmitButton>
      </form>
      <Divider>or</Divider>
      <GoogleButton onClick={() => setNotice("Google sign-in isn't switched on yet.")}>
        Continue with Google
      </GoogleButton>
      {notice && <NotAvailable>{notice}</NotAvailable>}
      <FooterLink text="New to Tack?" href="/signup" label="Create an account" />
    </>
  );
}

export function SignUpForm() {
  const { notice, setNotice, onSubmit } = useNotice();
  return (
    <>
      <AuthHeader
        title="Create your account"
        subtitle="Keep your boards in one place and pick up where you left off."
      />
      <form onSubmit={onSubmit} className="space-y-5">
        <Field label="Name">
          {(id) => (
            <TextInput
              id={id}
              name="name"
              autoComplete="name"
              placeholder="Ada Lovelace"
              required
            />
          )}
        </Field>
        <Field label="Email">
          {(id) => (
            <TextInput
              id={id}
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
            />
          )}
        </Field>
        <Field
          label="Password"
          hint={<span className="text-ink/45 text-[13px]">At least {MIN_PASSWORD} characters</span>}
        >
          {(id) => (
            <PasswordInput
              id={id}
              name="password"
              autoComplete="new-password"
              placeholder="Choose a password"
              minLength={MIN_PASSWORD}
              required
            />
          )}
        </Field>
        <SubmitButton>Create account</SubmitButton>
      </form>
      <Divider>or</Divider>
      <GoogleButton onClick={() => setNotice("Google sign-in isn't switched on yet.")}>
        Sign up with Google
      </GoogleButton>
      {notice && <NotAvailable>{notice}</NotAvailable>}
      <FooterLink text="Already have an account?" href="/signin" label="Log in" />
    </>
  );
}

export function ForgotPasswordForm() {
  const { notice, onSubmit } = useNotice();
  return (
    <>
      <AuthHeader
        title="Reset your password"
        subtitle="Enter the email you signed up with and we'll send you a link to choose a new one."
      />
      <form onSubmit={onSubmit} className="space-y-5">
        <Field label="Email">
          {(id) => (
            <TextInput
              id={id}
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
            />
          )}
        </Field>
        <SubmitButton>Send reset link</SubmitButton>
      </form>
      {notice && <NotAvailable>{notice}</NotAvailable>}
      <FooterLink text="Remembered it?" href="/signin" label="Back to log in" />
    </>
  );
}

export function ResetPasswordForm() {
  const { notice, setNotice } = useNotice();
  const [mismatch, setMismatch] = useState(false);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const differs = data.get("password") !== data.get("confirm");
    setMismatch(differs);
    if (!differs) setNotice("Accounts aren't switched on yet.");
  };

  return (
    <>
      <AuthHeader
        title="Choose a new password"
        subtitle="You'll use it the next time you log in."
      />
      <form onSubmit={onSubmit} className="space-y-5">
        <Field
          label="New password"
          hint={<span className="text-ink/45 text-[13px]">At least {MIN_PASSWORD} characters</span>}
        >
          {(id) => (
            <PasswordInput
              id={id}
              name="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              required
            />
          )}
        </Field>
        <Field
          label="Confirm new password"
          error={mismatch ? "The passwords don't match." : undefined}
        >
          {(id, describedBy) => (
            <PasswordInput
              id={id}
              name="confirm"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              required
              aria-invalid={mismatch || undefined}
              aria-describedby={describedBy}
              onChange={() => setMismatch(false)}
            />
          )}
        </Field>
        <SubmitButton>Save password</SubmitButton>
      </form>
      {notice && <NotAvailable>{notice}</NotAvailable>}
    </>
  );
}

export function VerifyEmail() {
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <span className="bg-primary/10 text-primary mb-6 grid size-14 place-items-center rounded-2xl">
        <MailCheck className="size-7" />
      </span>
      <AuthHeader
        title="Check your inbox"
        subtitle="We sent you a link to confirm your email. Open it on this device to finish setting up your account."
      />
      <button
        type="button"
        onClick={() => setNotice("Accounts aren't switched on yet.")}
        className="text-ink focus-visible:ring-primary/30 h-11 w-full rounded-xl border border-[#e2e2e7] bg-white text-[15px] font-semibold transition-colors outline-none hover:bg-[#f8f8f9] focus-visible:ring-4"
      >
        Resend email
      </button>
      {notice && <NotAvailable>{notice}</NotAvailable>}
      <FooterLink text="Wrong address?" href="/signup" label="Sign up again" />
    </>
  );
}

"use client";

import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MailCheck } from "lucide-react";
import Link from "next/link";

import type { PasswordPolicy, PublicConfig } from "@/types/system";
import type { Session, SigninResult, User } from "@/types/user";
import { fieldOf, http, HttpError } from "@/lib/client";
import { useUserStore } from "@/stores/user";
import { isAdmin } from "@/lib/permissions";

import {
  AuthHeader,
  Divider,
  Field,
  FooterLink,
  FormMessage,
  GoogleButton,
  linkClass,
  NotAvailable,
  PasswordInput,
  SubmitButton,
  TextInput,
} from "./form";

const POLICY: Record<PasswordPolicy, { min: number; hint: string }> = {
  basic: { min: 8, hint: "At least 8 characters" },
  strong: { min: 12, hint: "12+ characters, mixed case, a digit and a symbol" },
};

/** The server's password policy, so hints match what it will accept. */
function usePasswordPolicy() {
  const [policy, setPolicy] = useState<PasswordPolicy>("basic");
  useEffect(() => {
    http
      .get<PublicConfig>("/api/config")
      .then((config) => setPolicy(config.passwordPolicy))
      .catch(() => {});
  }, []);
  return POLICY[policy];
}

/** Runs a submit, tracking pending state and turning a failure into a message. */
function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  };
  return { pending, error, setError, run };
}

const text = (data: FormData, key: string) => String(data.get(key) ?? "");

/** Only same-site paths, so `?next=` can't send anyone elsewhere. */
const safeNext = (next?: string) =>
  next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;

export function SignInForm({ next }: { next?: string }) {
  const router = useRouter();
  const signin = useUserStore((s) => s.signin);
  const { pending, error, run } = useSubmit();
  const [notice, setNotice] = useState<string | null>(null);
  // Set once the password was right on an account with two-factor sign-in.
  const [challenge, setChallenge] = useState<string | null>(null);

  const finish = (session: Session) => {
    signin(session);
    router.replace(safeNext(next) ?? (isAdmin(session.user) ? "/admin/overview" : "/"));
  };

  const onSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    run(async () => {
      const result = await http.post<SigninResult>("/api/auth/signin", {
        email: text(data, "email"),
        password: text(data, "password"),
      });
      if ("twoFactorRequired" in result) setChallenge(result.challenge);
      else finish(result);
    });
  };

  if (challenge) {
    return <TwoFactorStep challenge={challenge} onBack={() => setChallenge(null)} onSignedIn={finish} />;
  }

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
        <SubmitButton pending={pending}>{pending ? "Logging in…" : "Log in"}</SubmitButton>
      </form>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <Divider>or</Divider>
      <GoogleButton onClick={() => setNotice("Google sign-in isn't switched on yet.")}>
        Continue with Google
      </GoogleButton>
      {notice && <NotAvailable>{notice}</NotAvailable>}
      <FooterLink text="New to Tack?" href="/signup" label="Create an account" />
    </>
  );
}

/** The second step of signing in: a code from the authenticator app, or a recovery code. */
function TwoFactorStep({
  challenge,
  onBack,
  onSignedIn,
}: {
  challenge: string;
  onBack: () => void;
  onSignedIn: (session: Session) => void;
}) {
  const { pending, error, setError, run } = useSubmit();
  const [recovery, setRecovery] = useState(false);
  const [codeError, setCodeError] = useState<string | undefined>();

  const onSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = text(new FormData(e.currentTarget), "code");
    setCodeError(undefined);
    run(async () => {
      try {
        onSignedIn(await http.post<Session>("/api/auth/signin/two-factor", { challenge, code }));
      } catch (err) {
        // A wrong code goes beside the field; anything else (expired, locked) below the form.
        if (err instanceof HttpError && fieldOf(err) === "code") setCodeError(err.message);
        else throw err;
      }
    });
  };

  return (
    <>
      <AuthHeader
        title="Two-factor sign-in"
        subtitle={
          recovery
            ? "Enter one of the recovery codes you saved when you set up two-factor sign-in. Each works once."
            : "Enter the 6-digit code from your authenticator app."
        }
      />
      <form onSubmit={onSubmit} className="space-y-5" key={recovery ? "recovery" : "code"}>
        <Field label={recovery ? "Recovery code" : "Code"} error={codeError}>
          {(id, describedBy) => (
            <TextInput
              id={id}
              name="code"
              aria-describedby={describedBy}
              aria-invalid={Boolean(codeError)}
              autoComplete="one-time-code"
              autoFocus
              className={recovery ? undefined : "font-mono tracking-[0.3em]"}
              inputMode={recovery ? "text" : "numeric"}
              maxLength={recovery ? 20 : 7}
              pattern={recovery ? undefined : "[0-9 ]{6,7}"}
              placeholder={recovery ? "xxxxx-xxxxx" : "123456"}
              required
            />
          )}
        </Field>
        <SubmitButton pending={pending}>{pending ? "Checking…" : "Continue"}</SubmitButton>
      </form>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <div className="mt-6 flex justify-between">
        <button type="button" className={linkClass} onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className={linkClass}
          onClick={() => {
            setRecovery((r) => !r);
            setCodeError(undefined);
            setError(null);
          }}
        >
          {recovery ? "Use the authenticator app" : "Use a recovery code"}
        </button>
      </div>
    </>
  );
}

export function SignUpForm() {
  const router = useRouter();
  const policy = usePasswordPolicy();
  const { pending, error, run } = useSubmit();
  const [notice, setNotice] = useState<string | null>(null);

  const onSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    run(async () => {
      const user = await http.post<User>("/api/auth/signup", {
        name: text(data, "name"),
        email: text(data, "email"),
        password: text(data, "password"),
      });
      router.push(`/verify-email?email=${encodeURIComponent(user.email)}`);
    });
  };

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
        <Field label="Password" hint={<span className="text-ink/45 text-[13px]">{policy.hint}</span>}>
          {(id) => (
            <PasswordInput
              id={id}
              name="password"
              autoComplete="new-password"
              placeholder="Choose a password"
              minLength={policy.min}
              required
            />
          )}
        </Field>
        <SubmitButton pending={pending}>
          {pending ? "Creating account…" : "Create account"}
        </SubmitButton>
      </form>
      {error && <FormMessage tone="error">{error}</FormMessage>}
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
  const { pending, error, run } = useSubmit();
  const [sentTo, setSentTo] = useState<string | null>(null);

  const onSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = text(new FormData(e.currentTarget), "email");
    run(async () => {
      await http.post("/api/auth/forgot-password", { email });
      setSentTo(email);
    });
  };

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
        <SubmitButton pending={pending}>{pending ? "Sending…" : "Send reset link"}</SubmitButton>
      </form>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {sentTo && (
        <FormMessage tone="success">
          If {sentTo} has an account, a reset link is on its way. It works for an hour.
        </FormMessage>
      )}
      <FooterLink text="Remembered it?" href="/signin" label="Back to log in" />
    </>
  );
}

export function ResetPasswordForm({ token }: { token?: string }) {
  const policy = usePasswordPolicy();
  const { pending, error, run } = useSubmit();
  const [mismatch, setMismatch] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const differs = data.get("password") !== data.get("confirm");
    setMismatch(differs);
    if (differs) return;
    run(async () => {
      await http.post("/api/auth/reset-password", { token, password: text(data, "password") });
      setDone(true);
    });
  };

  if (!token) {
    return (
      <>
        <AuthHeader
          title="This link isn't complete"
          subtitle="Open the link from your email again, or ask for a new one."
        />
        <FooterLink text="Need a new link?" href="/forgot-password" label="Reset your password" />
      </>
    );
  }

  if (done) {
    return (
      <>
        <AuthHeader
          title="Password saved"
          subtitle="You've been signed out everywhere else. Log in with your new password."
        />
        <Link
          href="/signin"
          className="bg-primary grid h-11 w-full place-items-center rounded-xl text-[15px] font-semibold text-white"
        >
          Log in
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthHeader
        title="Choose a new password"
        subtitle="You'll use it the next time you log in."
      />
      <form onSubmit={onSubmit} className="space-y-5">
        <Field
          label="New password"
          hint={<span className="text-ink/45 text-[13px]">{policy.hint}</span>}
        >
          {(id) => (
            <PasswordInput
              id={id}
              name="password"
              autoComplete="new-password"
              minLength={policy.min}
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
              minLength={policy.min}
              required
              aria-invalid={mismatch || undefined}
              aria-describedby={describedBy}
              onChange={() => setMismatch(false)}
            />
          )}
        </Field>
        <SubmitButton pending={pending}>{pending ? "Saving…" : "Save password"}</SubmitButton>
      </form>
      {error && <FormMessage tone="error">{error}</FormMessage>}
    </>
  );
}

/** "Check your inbox" after sign-up; with `?token=` from the email, confirms the address. */
export function VerifyEmail({ token, email }: { token?: string; email?: string }) {
  const { pending, error, run } = useSubmit();
  const [resent, setResent] = useState(false);
  const [verified, setVerified] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // Once: the token is single-use, so a second request (Strict Mode) would fail.
    if (!token || started.current) return;
    started.current = true;
    run(async () => {
      await http.post("/api/auth/verify-email", { token });
      setVerified(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (token) {
    return (
      <>
        <span className="bg-primary/10 text-primary mb-6 grid size-14 place-items-center rounded-2xl">
          <MailCheck className="size-7" />
        </span>
        <AuthHeader
          title={verified ? "Email confirmed" : error ? "We couldn't confirm it" : "Confirming…"}
          subtitle={
            verified
              ? "Your account is ready. Log in to get started."
              : error
                ? "The link may have expired. Log in or sign up again to get a new one."
                : "One moment."
          }
        />
        {error && <FormMessage tone="error">{error}</FormMessage>}
        {(verified || error) && (
          <Link
            href="/signin"
            className="bg-primary mt-6 grid h-11 w-full place-items-center rounded-xl text-[15px] font-semibold text-white"
          >
            Log in
          </Link>
        )}
      </>
    );
  }

  const resend = () =>
    run(async () => {
      await http.post("/api/auth/resend-verification", { email });
      setResent(true);
    });

  return (
    <>
      <span className="bg-primary/10 text-primary mb-6 grid size-14 place-items-center rounded-2xl">
        <MailCheck className="size-7" />
      </span>
      <AuthHeader
        title="Check your inbox"
        subtitle={
          <>
            We sent a link to confirm {email ? <strong>{email}</strong> : "your email"}. Open it on
            this device to finish setting up your account.
          </>
        }
      />
      {email && (
        <button
          type="button"
          onClick={resend}
          disabled={pending}
          className="text-ink focus-visible:ring-primary/30 h-11 w-full rounded-xl border border-[#e2e2e7] bg-white text-[15px] font-semibold transition-colors outline-none hover:bg-[#f8f8f9] focus-visible:ring-4 disabled:opacity-60"
        >
          {pending ? "Sending…" : "Resend email"}
        </button>
      )}
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {resent && <FormMessage tone="success">Sent. It can take a minute to arrive.</FormMessage>}
      <FooterLink text="Wrong address?" href="/signup" label="Sign up again" />
    </>
  );
}

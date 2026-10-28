"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  signInWithEmail,
  signInWithGoogle,
  signInWithPassword,
  signUpWithPassword,
  type LoginState,
} from "./actions";

type Mode = "signin" | "signup" | "link";

export function LoginForm() {
  const params = useSearchParams();
  const oauthError = params.get("error");
  const next = params.get("next") ?? "/projects";
  const [mode, setMode] = useState<Mode>("signin");

  const [pwdState, pwdAction, pwdPending] = useActionState<LoginState, FormData>(
    signInWithPassword,
    {}
  );
  const [signState, signAction, signPending] = useActionState<LoginState, FormData>(
    signUpWithPassword,
    {}
  );
  const [linkState, linkAction, linkPending] = useActionState<LoginState, FormData>(
    signInWithEmail,
    {}
  );

  const sentState = linkState.sent ? linkState : signState.sent ? signState : null;
  if (sentState) {
    return (
      <div className="space-y-3 text-sm">
        <p className="font-medium">Check your inbox</p>
        <p className="text-muted-foreground">
          {sentState.signup
            ? "We sent a confirmation link to "
            : "We sent a sign-in link to "}
          <span className="font-medium">{sentState.email}</span>. Click it to
          continue — you can close this tab.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {mode !== "link" ? (
        <form
          action={mode === "signin" ? pwdAction : signAction}
          className="space-y-3"
        >
          <input type="hidden" name="next" value={next} />
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              placeholder={mode === "signup" ? "8+ characters" : "••••••••"}
              minLength={mode === "signup" ? 8 : undefined}
              required
            />
          </div>
          {(pwdState.error || signState.error) && (
            <p className="text-sm text-destructive">
              {(mode === "signin" ? pwdState : signState).error}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={mode === "signin" ? pwdPending : signPending}
          >
            {mode === "signin"
              ? pwdPending
                ? "Signing in…"
                : "Sign in"
              : signPending
                ? "Creating account…"
                : "Create account"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {mode === "signin" ? (
              <>
                New here?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className="underline underline-offset-2"
                >
                  Create an account
                </button>
                {" · "}
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className="underline underline-offset-2"
                >
                  Sign in
                </button>
                {" · "}
              </>
            )}
            <button
              type="button"
              onClick={() => setMode("link")}
              className="underline underline-offset-2"
            >
              Use a sign-in link instead
            </button>
          </p>
        </form>
      ) : (
        <form action={linkAction} className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </div>
          {linkState.error && (
            <p className="text-sm text-destructive">{linkState.error}</p>
          )}
          <Button type="submit" className="w-full" disabled={linkPending}>
            {linkPending ? "Sending link…" : "Email me a sign-in link"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className="underline underline-offset-2"
            >
              Use a password instead
            </button>
          </p>
        </form>
      )}

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">OR</span>
        <Separator className="flex-1" />
      </div>

      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="outline" className="w-full">
          Continue with Google
        </Button>
      </form>

      {oauthError && (
        <p className="text-sm text-destructive">Sign-in failed. Please try again.</p>
      )}
    </div>
  );
}

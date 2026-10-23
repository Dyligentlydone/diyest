"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { signInWithEmail, signInWithGoogle, type LoginState } from "./actions";

export function LoginForm() {
  const oauthError = useSearchParams().get("error");
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    signInWithEmail,
    {}
  );

  if (state.sent) {
    return (
      <div className="space-y-3 text-sm">
        <p className="font-medium">Check your inbox</p>
        <p className="text-muted-foreground">
          We sent a sign-in link to <span className="font-medium">{state.email}</span>.
          Click it to continue — you can close this tab.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3">
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
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Sending link…" : "Email me a sign-in link"}
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">OR</span>
        <Separator className="flex-1" />
      </div>

      <form action={signInWithGoogle}>
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

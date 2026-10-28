"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updatePassword, type PasswordState } from "./actions";

/** Set/change password — lets magic-link accounts switch to password login. */
export function PasswordForm() {
  const [state, formAction, pending] = useActionState<PasswordState, FormData>(
    updatePassword,
    {}
  );

  if (state.saved)
    return (
      <p className="text-sm text-green-700">
        Password saved — you can now sign in with email + password.
      </p>
    );

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password_confirm">Confirm password</Label>
        <Input
          id="password_confirm"
          name="password_confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Set password"}
      </Button>
    </form>
  );
}

import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — diyest" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Sign in to diyest</CardTitle>
          <CardDescription>
            Save your plans, track builds, and pick up where you left off.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isSupabaseConfigured() ? (
            <p className="text-sm text-muted-foreground">
              Supabase is not configured yet. Add{" "}
              <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
              <code className="font-mono text-xs">.env.local</code> to enable sign-in.
            </p>
          ) : (
            <Suspense>
              <LoginForm />
            </Suspense>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

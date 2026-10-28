import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { buttonVariants } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { UserMenu } from "./user-menu";

async function HeaderAuth() {
  if (!isSupabaseConfigured()) {
    return (
      <Link href="/login" className={buttonVariants({ size: "sm" })}>
        Sign in
      </Link>
    );
  }
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.email ? (
    <UserMenu email={user.email} />
  ) : (
    <Link href="/login" className={buttonVariants({ size: "sm" })}>
      Sign in
    </Link>
  );
}

/** Display-only badge — connection() marks it request-time so the auth call
 *  (which reads Date.now internally) is legal under Cache Components. */
async function HeaderName() {
  if (!isSupabaseConfigured()) return null;
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();
  const name = profile?.display_name?.trim() || user.email?.split("@")[0];
  if (!name) return null;
  return (
    <span className="hidden text-xs text-muted-foreground sm:inline">
      · {name}
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center font-semibold" aria-label="diyest home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="diyest" className="h-9 w-auto" />
          <Suspense fallback={null}>
            <HeaderName />
          </Suspense>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/gallery"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Gallery
          </Link>
          <Link href="/new" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            New project
          </Link>
          <Link
            href="/projects"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            My projects
          </Link>
          <Suspense fallback={<div className="h-7 w-16" aria-hidden />}>
            <HeaderAuth />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}

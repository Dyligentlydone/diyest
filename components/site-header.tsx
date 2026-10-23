import { Suspense } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/env";
import { isInviteOnly } from "@/lib/site-mode";
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

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center font-semibold" aria-label="diyest home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="diyest" className="h-9 w-auto" />
        </Link>
        {isInviteOnly() && (
          <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
            Beta
          </span>
        )}
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

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { isInviteOnly, isPublicPath } from "@/lib/site-mode";

const PROTECTED_PATHS = ["/settings", "/projects"];

export async function updateSession(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    // Let the app run before Supabase is wired up; pages show a setup notice.
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session token if needed. Do not add logic between
  // createServerClient and getUser() — it can cause random logouts.
  // A corrupt/stale session cookie can make getUser() throw — treat as
  // signed-out rather than killing every request through middleware.
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // clear the corrupt session cookie so the next request starts clean
    for (const c of request.cookies.getAll())
      if (c.name.includes("-auth-token")) {
        request.cookies.delete(c.name);
        response.cookies.delete(c.name);
      }
  }

  const { pathname } = request.nextUrl;

  // In invite_only mode every app page requires sign-in (invite validity is
  // checked inside the routes/pages themselves — see lib/site-mode).
  const needsAuth = isInviteOnly()
    ? !isPublicPath(pathname) && !pathname.startsWith("/api/")
    : PROTECTED_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (!user && needsAuth) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const next = request.nextUrl.searchParams.get("next");
    const url = request.nextUrl.clone();
    // honor safe internal return targets (e.g. anon draft → save flow)
    url.pathname = next?.startsWith("/") && !next.startsWith("//") ? next : "/projects";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

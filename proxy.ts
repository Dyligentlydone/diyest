import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

const REF_COOKIE_OPTS = {
  maxAge: 60 * 60 * 24 * 30, // 30 days
  path: "/",
  sameSite: "lax" as const,
};

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);

  // remember referral params across navigation — ?invite= is a creator promo
  // code, ?ref= is a personal waitlist referral code
  const invite = request.nextUrl.searchParams.get("invite")?.trim().toUpperCase();
  const ref = request.nextUrl.searchParams.get("ref")?.trim().toUpperCase();
  if (invite)
    response.cookies.set("diyest_invite", invite.slice(0, 60), REF_COOKIE_OPTS);
  if (ref)
    response.cookies.set("diyest_ref", ref.slice(0, 40), REF_COOKIE_OPTS);

  return response;
}

export const config = {
  matcher: [
    // Run on everything except static assets and image optimization.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

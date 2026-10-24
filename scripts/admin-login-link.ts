/**
 * Mints a magic-login link for a given email without sending an email —
 * paste the printed URL into a browser and you're signed in on the target
 * deployment. Creates the user first if they don't exist yet.
 *
 *   npx tsx --env-file=.env.production.local scripts/admin-login-link.ts you@gmail.com
 *
 * Optional second arg overrides the redirect (defaults to the prod
 * /auth/callback). Needs NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in the env file or exported.
 */
import { createClient } from "@supabase/supabase-js";

const email = process.argv[2];
const redirectTo =
  process.argv[3] ?? "https://diyest-production.up.railway.app/auth/callback";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!email || !url || !key) {
  console.error(
    "Usage: scripts/admin-login-link.ts <email> [redirectTo]\nNeeds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment."
  );
  process.exit(1);
}

async function main() {
  const sb = createClient(url!, key!, { auth: { persistSession: false } });

  const { error: createErr } = await sb.auth.admin.createUser({
    email: email!,
    email_confirm: true,
  });
  if (createErr && !/already|exists|registered/i.test(createErr.message)) {
    console.error("createUser failed:", createErr.message);
    process.exit(1);
  }

  const { data, error } = await sb.auth.admin.generateLink({
    type: "magiclink",
    email: email!,
    options: { redirectTo },
  });
  if (error) {
    console.error("generateLink failed:", error.message);
    process.exit(1);
  }

  // action_link is implicit-flow (#access_token) which our /auth/callback
  // (PKCE ?code) can't consume — build a token_hash link for /auth/confirm.
  const app = redirectTo.replace(/\/auth\/callback.*$/, "");
  const link =
    `${app}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}` +
    `&type=magiclink&next=${encodeURIComponent("/admin")}`;

  console.log("\nOpen this in your browser to sign in:\n");
  console.log(link);
}

main();

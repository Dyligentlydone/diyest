import type { Metadata } from "next";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = {
  title: "Enter invite code — diyest",
  robots: { index: false },
};

export default function InviteEntryPage() {
  return (
    <main className="mx-auto flex max-w-sm flex-1 flex-col items-center px-4 py-20 text-center">
      <h1 className="text-2xl font-bold">Have an invite code?</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Enter it to unlock the beta — codes look like <code className="font-mono">MAKERJANE</code>.
      </p>
      <InviteForm />
    </main>
  );
}

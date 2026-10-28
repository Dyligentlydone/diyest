import Link from "next/link";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/invites", label: "Invites" },
  { href: "/admin/promo", label: "Promo" },
  { href: "/admin/waitlist", label: "Waitlist" },
  { href: "/admin/feedback", label: "Feedback" },
];

export const metadata = { title: "Admin — diyest", robots: { index: false } };

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="text-xl font-bold">Admin</h1>
      <nav className="mt-3 flex gap-1 border-b pb-3">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="mt-6">{children}</div>
    </main>
  );
}

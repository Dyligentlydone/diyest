import { Suspense } from "react";
import { ThumbsDown, ThumbsUp, Flag } from "lucide-react";
import { requireAdmin } from "@/lib/site-mode";
import { createServiceClient } from "@/lib/supabase/server";

async function FeedbackList() {
  await requireAdmin();
  const supabase = createServiceClient();
  const { data: feedback } = await supabase
    .from("plan_feedback")
    .select("id, project_id, user_id, step_n, rating, comment, category, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const projectIds = [...new Set((feedback ?? []).map((f) => f.project_id).filter(Boolean))];
  const { data: projects } = projectIds.length
    ? await supabase.from("projects").select("id, title, slug").in("id", projectIds)
    : { data: [] };
  const title = new Map((projects ?? []).map((p) => [p.id, p.title]));

  if (!feedback?.length)
    return <p className="py-12 text-center text-sm text-muted-foreground">No feedback yet.</p>;

  return (
    <ul className="space-y-2">
      {feedback.map((f) => (
        <li key={f.id} className="rounded-lg border p-3 text-sm">
          <div className="flex items-center gap-2">
            {f.step_n ? (
              <Flag className="h-4 w-4 text-amber-600" aria-hidden />
            ) : f.rating === "up" ? (
              <ThumbsUp className="h-4 w-4 text-green-600" aria-hidden />
            ) : (
              <ThumbsDown className="h-4 w-4 text-destructive" aria-hidden />
            )}
            <span className="font-medium">
              {f.project_id ? (title.get(f.project_id) ?? "Deleted project") : "Anonymous draft"}
              {f.step_n ? ` — step ${f.step_n}` : ""}
            </span>
            {f.category && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{f.category}</span>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {new Date(f.created_at).toLocaleString("en-US", {
                month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
              })}
            </span>
          </div>
          {f.comment && <p className="mt-1.5 text-muted-foreground">{f.comment}</p>}
        </li>
      ))}
    </ul>
  );
}

export default function AdminFeedbackPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg border bg-muted/40" />}>
      <FeedbackList />
    </Suspense>
  );
}

"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, NotebookPen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { compressImage } from "@/lib/images";

export interface JournalEntry {
  id: string;
  note: string;
  /** signed URL, null when no photo */
  imageUrl: string | null;
  created_at: string;
}

export function JournalSection({
  projectId,
  entries: initial,
}: {
  projectId: string;
  entries: JournalEntry[];
}) {
  const [entries, setEntries] = useState(initial);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickPhoto(files: FileList | null) {
    if (!files?.length) return;
    try {
      setPhoto(await compressImage(files[0]));
    } catch (e) {
      toast.error((e as Error).message);
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function add() {
    if (!note.trim() && !photo) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/journal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note, image: photo ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Couldn't save entry");
      setEntries((e) => [
        {
          id: data.entry.id,
          note: data.entry.note,
          imageUrl: photo, // already a data URL — shows immediately
          created_at: data.entry.created_at,
        },
        ...e,
      ]);
      setNote("");
      setPhoto(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const prev = entries;
    setEntries((e) => e.filter((x) => x.id !== id));
    const res = await fetch(
      `/api/projects/${projectId}/journal?entry=${id}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      setEntries(prev);
      toast.error("Couldn't delete entry");
    }
  }

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <NotebookPen className="h-5 w-5" /> Build journal
      </h2>

      <div className="mb-4 space-y-2 rounded-md border p-3">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="How did it go? What did you learn?"
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          maxLength={2000}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            <Camera className="h-3.5 w-3.5" /> Photo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            hidden
            onChange={(e) => pickPhoto(e.target.files)}
          />
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="Journal photo" className="h-10 w-10 rounded object-cover" />
          )}
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            disabled={busy || (!note.trim() && !photo)}
            onClick={add}
          >
            {busy ? "Saving…" : "Add entry"}
          </Button>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No entries yet — photo-log your progress as you build.
        </p>
      ) : (
        <ol className="relative space-y-4 border-l pl-5">
          {entries.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                  {e.note && (
                    <p className="mt-0.5 whitespace-pre-wrap text-sm">{e.note}</p>
                  )}
                  {e.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={e.imageUrl}
                      alt="Journal entry"
                      className="mt-2 max-h-48 rounded-md border object-cover"
                    />
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Delete entry"
                  onClick={() => void remove(e.id)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

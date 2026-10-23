import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Camera, Ruler, ListChecks } from "lucide-react";

export default function Home() {
  return (
    <main className="flex-1">
      <section className="mx-auto flex max-w-3xl flex-col items-center px-4 py-24 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="diyest" className="h-28 w-auto sm:h-36" />
        <h1 className="mt-8 text-4xl font-bold tracking-tight sm:text-5xl">
          Snap a photo. Get a plan you can actually build.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          diyest turns a picture or a description into a complete woodworking plan:
          measured drawings, a materials and cut list, and step-by-step instructions
          matched to your skill level and tools.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/new" className={buttonVariants({ size: "lg" })}>
            Start a project
          </Link>
          <Link
            href="/login"
            className={buttonVariants({ size: "lg", variant: "outline" })}
          >
            Sign in
          </Link>
        </div>
      </section>

      <section className="border-t">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-16 sm:grid-cols-3">
          <div>
            <Camera className="h-6 w-6" aria-hidden />
            <h2 className="mt-3 font-semibold">Show it what you want</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload a photo or describe the piece — a bookcase, a table, a repair.
            </p>
          </div>
          <div>
            <Ruler className="h-6 w-6" aria-hidden />
            <h2 className="mt-3 font-semibold">Get real drawings</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Every plan includes a dimensioned blueprint generated from the actual
              geometry — not a guess.
            </p>
          </div>
          <div>
            <ListChecks className="h-6 w-6" aria-hidden />
            <h2 className="mt-3 font-semibold">Build with confidence</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Shopping list, cut layout and numbered steps with safety notes at every
              stage.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "New project — BuildIt" };

export default function NewProjectPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold">New project</h1>
      <Card>
        <CardHeader>
          <CardTitle>Build this</CardTitle>
          <CardDescription>
            Photo-to-plan generation arrives in the next milestone. This page will
            hold the four entry modes: Build this, Fix it, My space, and Leftovers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Foundation milestone is in place: auth, database schema, and settings are
            wired up.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

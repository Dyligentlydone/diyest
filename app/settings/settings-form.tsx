"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Profile } from "@/lib/types";
import { updateSettings, type SettingsState } from "./actions";

export function SettingsForm({ profile, email }: { profile: Profile; email: string }) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    updateSettings,
    {}
  );

  useEffect(() => {
    if (state.saved) toast.success("Settings saved");
  }, [state]);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={email} disabled />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="display_name">Display name</Label>
        <Input
          id="display_name"
          name="display_name"
          defaultValue={profile.display_name ?? ""}
          placeholder="How you'll appear on shared plans"
          maxLength={80}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="units">Units</Label>
          <Select name="units" defaultValue={profile.units}>
            <SelectTrigger id="units">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="metric">Metric (mm)</SelectItem>
              <SelectItem value="imperial">Imperial (ft/in)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="skill_level">Skill level</Label>
          <Select name="skill_level" defaultValue={profile.skill_level}>
            <SelectTrigger id="skill_level">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="beginner">Beginner</SelectItem>
              <SelectItem value="intermediate">Intermediate</SelectItem>
              <SelectItem value="advanced">Advanced</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="kerf_mm">Default blade kerf (mm)</Label>
        <Input
          id="kerf_mm"
          name="kerf_mm"
          type="number"
          step="0.1"
          min={0}
          max={10}
          defaultValue={profile.kerf_mm}
          className="w-32"
        />
        <p className="text-xs text-muted-foreground">
          Used by the cut-list optimizer to account for material lost to the saw
          blade.
        </p>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}

-- Storage bucket for project photos (inputs, journal, progress checks).
-- Public read (needed later for /p/[slug] share pages); writes only inside the
-- uploader's own top-level folder: {user_id}/{project_id}/file.jpg

insert into storage.buckets (id, name, public)
values ('project-images', 'project-images', true)
on conflict (id) do nothing;

create policy "project_images_public_read" on storage.objects
  for select using (bucket_id = 'project-images');

create policy "project_images_insert_own_folder" on storage.objects
  for insert with check (
    bucket_id = 'project-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "project_images_update_own_folder" on storage.objects
  for update using (
    bucket_id = 'project-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "project_images_delete_own_folder" on storage.objects
  for delete using (
    bucket_id = 'project-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

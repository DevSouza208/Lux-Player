-- Private chunks allow a 200 MiB playlist without increasing global upload limits.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-playlists', 'user-playlists', false, 8388608, array['application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = 8388608,
  allowed_mime_types = array['application/octet-stream'];
-- No anonymous policies: uploads/downloads require server-issued signed URLs.

-- Fix Storage RLS for product image uploads
-- Run this in Supabase SQL Editor when you see:
-- StorageApiError: new row violates row-level security policy

-- 1) Ensure bucket exists and is public-readable
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = excluded.public;

-- 2) Replace old permissive/conflicting policies
drop policy if exists "Public can view product images" on storage.objects;
drop policy if exists "Authenticated users can upload product images" on storage.objects;
drop policy if exists "Authenticated users can upload own product images" on storage.objects;
drop policy if exists "Authenticated users can update own product images" on storage.objects;
drop policy if exists "Authenticated users can delete own product images" on storage.objects;

-- Public read for product-images bucket
create policy "Public can view product images"
on storage.objects
for select
using (bucket_id = 'product-images');

-- Authenticated users can only upload into their own folder:
-- path format: {auth.uid()}/products/{timestamp}.jpg
create policy "Authenticated users can upload own product images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Authenticated users can update own product images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Authenticated users can delete own product images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ============================================================
-- knowledge-base bucket (PRIVATE — role-gated reads via RLS)
-- Added in v6.2 for internal document management.
-- Do NOT make this bucket public; that would bypass role-gated
-- access control intended for finance / inventory_manager reads.
-- ============================================================

-- Ensure bucket exists and is PRIVATE (public = false)
insert into storage.buckets (id, name, public)
values ('knowledge-base', 'knowledge-base', false)
on conflict (id) do update set public = excluded.public;

-- Drop any stale knowledge-base policies before recreating
drop policy if exists "Admins can read knowledge-base files" on storage.objects;
drop policy if exists "Finance can read knowledge-base files" on storage.objects;
drop policy if exists "Inventory managers can read knowledge-base files" on storage.objects;
drop policy if exists "Admins can upload knowledge-base files" on storage.objects;
drop policy if exists "Admins can update knowledge-base files" on storage.objects;
drop policy if exists "Admins can delete knowledge-base files" on storage.objects;

-- Read: admin / super_admin (via is_admin())
create policy "Admins can read knowledge-base files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'knowledge-base'
  and public.is_admin()
);

-- Read: finance
create policy "Finance can read knowledge-base files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'knowledge-base'
  and public.is_finance()
);

-- Read: inventory_manager
create policy "Inventory managers can read knowledge-base files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'knowledge-base'
  and public.is_inventory_manager()
);

-- Write (insert): admin / super_admin only
-- Path format: {auth.uid()}/knowledge-base/{filename}
create policy "Admins can upload knowledge-base files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'knowledge-base'
  and public.is_admin()
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Write (update): admin / super_admin only
create policy "Admins can update knowledge-base files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'knowledge-base'
  and public.is_admin()
)
with check (
  bucket_id = 'knowledge-base'
  and public.is_admin()
);

-- Write (delete): admin / super_admin only
create policy "Admins can delete knowledge-base files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'knowledge-base'
  and public.is_admin()
);

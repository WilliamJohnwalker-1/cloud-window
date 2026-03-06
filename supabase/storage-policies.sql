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

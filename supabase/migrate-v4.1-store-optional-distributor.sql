-- Migration v4.1: allow stores without distributor binding
-- Execute after migrate-v4.0-store-management.sql

ALTER TABLE public.stores
  ALTER COLUMN distributor_id DROP NOT NULL;

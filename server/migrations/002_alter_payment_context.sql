-- ============================================================
-- Migration 002: Alter payment_context in contacts to text
-- Run this once against your Supabase SQL editor or psql
-- ============================================================

-- 1. contacts: change payment_context column type to text
ALTER TABLE public.contacts
  ALTER COLUMN payment_context TYPE text;

ALTER TABLE public.contacts
  ALTER COLUMN payment_context SET DEFAULT 'other';

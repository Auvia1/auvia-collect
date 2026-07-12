-- ============================================================
-- Migration 001: Add Vobiz + AI columns to clinics & calls
-- Run this once against your Supabase SQL editor or psql
-- ============================================================

-- 1. clinics: AI system prompt (per-clinic override)
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS system_prompt text;

-- 2. calls: Vobiz recording SID + call amount
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS vobiz_call_sid text,       -- links to Vobiz recording SID
  ADD COLUMN IF NOT EXISTS amount         numeric(12,2); -- amount billed per call attempt

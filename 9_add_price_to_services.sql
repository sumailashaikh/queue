-- Migration: Add price field to services
ALTER TABLE public.services 
ADD COLUMN price numeric DEFAULT 0;

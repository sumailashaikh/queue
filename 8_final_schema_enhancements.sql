-- Add price to Services
alter table public.services 
add column price numeric(10,2) default 0.00;

-- Add description to Businesses
alter table public.businesses
add column description text;

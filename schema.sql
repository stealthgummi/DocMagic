-- Run this once in the Neon SQL Editor opened from the Vercel Storage tab.
create table if not exists public.contract_requests (
  id text primary key,
  workspace text not null default '7layer',
  title text not null,
  provider_name text not null,
  provider_email text not null,
  client_company text,
  client_name text not null,
  client_email text not null,
  effective_date date,
  terms text not null,
  token_hash text not null unique,
  token text,
  status text not null default 'pending' check (status in ('pending', 'signed')),
  created_at timestamptz not null default now(),
  signed_at timestamptz,
  signer_name text,
  signer_ip text,
  signer_user_agent text,
  signer_consent boolean not null default false,
  provider_signer_name text,
  provider_signed_at timestamptz
);

create index if not exists idx_contract_requests_workspace on public.contract_requests (workspace, created_at desc);

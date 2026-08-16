// The schema, as an ordered list of statements.
//
// It lives here rather than in a .sql file because Neon's HTTP driver runs one
// statement per call, and because a file on disk is not reliably bundled into a
// serverless function. This module is the single source of truth.
//
// Every statement is "if not exists", so running the migration twice is safe.
export const STATEMENTS = [
  `create extension if not exists "pgcrypto"`,

  `create table if not exists users (
     id            uuid primary key default gen_random_uuid(),
     username      text not null,
     email         text,
     -- Null for accounts created purely through Google or Facebook: those users
     -- have no password, and a placeholder hash would be a lie.
     password_hash text,
     created_at    timestamptz not null default now()
   )`,

  // Case-insensitive uniqueness without the citext extension: "Sugan" and
  // "sugan" must not be two accounts, or one could impersonate the other.
  `create unique index if not exists users_username_lower_idx on users (lower(username))`,
  `create unique index if not exists users_email_lower_idx on users (lower(email)) where email is not null`,

  // One provider identity per row, so an account can link both Google and
  // Facebook later without duplicating the user.
  `create table if not exists user_identities (
     user_id     uuid not null references users(id) on delete cascade,
     provider    text not null check (provider in ('google', 'facebook')),
     provider_id text not null,
     created_at  timestamptz not null default now(),
     primary key (provider, provider_id)
   )`,
  `create index if not exists user_identities_user_idx on user_identities (user_id)`,

  // Watchlist, favourites and ratings are three columns on one row rather than
  // three tables: they are all "this user's relationship to this title", they
  // are always read together when rendering a card, and one row means one
  // lookup instead of three joins.
  `create table if not exists user_titles (
     user_id      uuid not null references users(id) on delete cascade,
     tmdb_id      integer not null,
     media_type   text not null check (media_type in ('movie', 'tv')),
     in_watchlist boolean not null default false,
     is_favourite boolean not null default false,
     rating       smallint check (rating between 1 and 10),
     updated_at   timestamptz not null default now(),
     primary key (user_id, tmdb_id, media_type)
   )`,

  // Rails read as "everything this user saved, newest first", so the partial
  // indexes match that shape exactly.
  `create index if not exists user_titles_watchlist_idx on user_titles (user_id, updated_at desc) where in_watchlist`,
  `create index if not exists user_titles_favourite_idx on user_titles (user_id, updated_at desc) where is_favourite`,
  `create index if not exists user_titles_rated_idx on user_titles (user_id, updated_at desc) where rating is not null`,

  // Failed sign-ins, so hand-rolled login is not a free credential-stuffing
  // target. Checked before any password comparison, cleared on success.
  `create table if not exists login_attempts (
     username  text not null,
     attempted timestamptz not null default now()
   )`,
  `create index if not exists login_attempts_idx on login_attempts (lower(username), attempted desc)`,
]

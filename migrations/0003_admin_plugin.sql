-- Better Auth admin plugin columns (as emitted by better-auth 1.7 getMigrations
-- for SQLite). Access now lives in the database: an admin pre-creates users,
-- a ban revokes access, and `role` replaces the ADMIN_EMAILS secret.
alter table "user" add column "role" text;
alter table "user" add column "banned" integer default 0;
alter table "user" add column "banReason" text;
alter table "user" add column "banExpires" date;
alter table "session" add column "impersonatedBy" text;

-- Everyone who has signed in so far keeps access as a regular user. The first
-- admin is set with `npm run make-admin`, since this public repo can't name them.
UPDATE "user" SET role = 'user', banned = 0;

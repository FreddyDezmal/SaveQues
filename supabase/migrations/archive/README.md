# Archived Migrations

These migrations have all been applied to production and are kept here
for audit history only.

**Do not replay these against any database.**

New environments should use `../014_consolidated_schema.sql` instead,
which produces the identical final schema in a single idempotent pass.

All conflicts, duplicates, and orphaned columns found in these files
are documented in `../MIGRATION_CONFLICTS.md`.
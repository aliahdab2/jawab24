#!/bin/bash
#
# Stage a THROWAWAY database as one Salla merchant, for the listing screenshots.
#
#   ./stage.sh reset      empty every app table, so the next demo login seeds fresh
#   ./stage.sh merchant   keep only the Salla-linked page + store, give the account
#                         a merchant identity
#
# The database is named by SHOT_DATABASE_URL (see "How to re-shoot" in ../README.md,
# and the top of capture.js). It must be a scratch database — never the dev database
# and never production: `reset` truncates every application table.
set -euo pipefail

DB="${SHOT_DATABASE_URL:-postgresql://$USER@127.0.0.1:5432/jawab24_salla_shots}"

# ⛔ Guard the DATABASE NAME, not the URL.
#
# This used to be `case "$DB" in *_shots*)`, which matches `_shots` ANYWHERE in the
# connection string — the user, the host, a query parameter — while the error message
# claimed the URL had to *name* a `*_shots` database. `reset` truncates every
# application table on a server that also hosts the shared dev database, so the guard
# has to mean what it says. Strip the query string, then take the last path segment.
DB_NAME="${DB%%\?*}"
DB_NAME="${DB_NAME##*/}"
case "$DB_NAME" in
  *_shots) ;;
  *)
    echo "refusing: SHOT_DATABASE_URL must name a database ending in _shots (got '${DB_NAME:-<empty>}')" >&2
    exit 2
    ;;
esac

# ⛔ ON_ERROR_STOP is not optional. Without it psql runs the REST of a script after a
# failed statement and still exits 0 — so `set -e` reports success and capture.js goes
# on to shoot a half-staged account. That is exactly the «مستخدم تجريبي» trap below,
# arriving silently. (Rule: exit 0 is not success.)
PSQL=(psql "$DB" -v ON_ERROR_STOP=1)

case "${1:-}" in
  reset)
    # ⛔ `plans` is REFERENCE data seeded by backend/src/scripts/seed-plans.ts, not by a
    # migration — truncating it leaves the account on no plan at all, and the reply
    # tester then answers «تم الوصول للحد الشهري للردود الذكية» instead of quoting a
    # product. (Cost one wasted capture round on 2026-09-04.)
    TABLES=$("${PSQL[@]}" -t -A -c "select string_agg(format('%I.%I', schemaname, tablename), ', ') from pg_tables where schemaname='public' and tablename not in ('__drizzle_migrations', 'plans');")
    if [ -z "$TABLES" ]; then
      echo "refusing: '$DB_NAME' has no public tables — is it migrated?" >&2
      exit 2
    fi
    "${PSQL[@]}" -q -c "truncate $TABLES restart identity cascade;"
    echo "reset"
    ;;
  merchant)
    # One Salla store, one page linked to it — a Salla merchant's actual view. The
    # Shopify store the demo seeder also creates must go: it has no business in a
    # Salla App Store screenshot.
    #
    # The identity fields are not cosmetics. The sidebar substitutes «مستخدم تجريبي»
    # for any facebook_id starting with `demo_` (Sidebar.tsx → useIsDemoUser), and the
    # demo banner keys off the same check — so a demo-shaped account cannot produce a
    # merchant-shaped screenshot however the data is named.
    #
    # ⚠️ `is_admin = true` is required ONLY because /integrations and its «المتاجر» nav
    # item are still admin-gated (Sidebar.tsx getNavigationGroups, integrations.tsx
    # redirect). That gate is the reason gallery-1 shows a screen a merchant cannot
    # open — see ../README.md, "What a merchant can and cannot see". Drop this flag as
    # soon as the gate goes, and re-shoot.
    #
    # One transaction: a partial stage is worse than a failed one, because the failure
    # is visible and the partial is not.
    "${PSQL[@]}" -q -1 <<'SQL'
delete from pages where name <> 'أزياء الخليج';
delete from ecommerce_stores where platform <> 'salla';
update users set name = 'نورة الحربي', facebook_id = 'fb_10021547', email = 'noura@gulf-fashion.sa', is_admin = true;
update workspaces set name = 'أزياء الخليج';
SQL

    # Fail LOUDLY on the traps rather than letting capture.js shoot them. Each of these
    # cost a capture round on 2026-09-04 and each is invisible until you read the PNG.
    "${PSQL[@]}" -t -A <<'SQL'
do $$
declare demo_users int; plan_rows int; stores int; pages int;
begin
  select count(*) into demo_users from users where facebook_id like 'demo\_%';
  select count(*) into plan_rows  from plans;
  select count(*) into stores     from ecommerce_stores;
  select count(*) into pages      from pages;
  if demo_users > 0 then
    raise exception 'staging failed: % user(s) still have a demo_ facebook_id — the sidebar will print «مستخدم تجريبي»', demo_users;
  end if;
  if plan_rows = 0 then
    raise exception 'staging failed: plans table is empty — run seed-plans.ts, or the reply tester answers «تم الوصول للحد الشهري»';
  end if;
  if stores <> 1 then
    raise exception 'staging failed: expected exactly 1 store, found %', stores;
  end if;
  if pages <> 1 then
    raise exception 'staging failed: expected exactly 1 page, found %', pages;
  end if;
end $$;
SQL

    "${PSQL[@]}" -A -F' | ' -c "select 'user', name from users union all select 'store', store_name from ecommerce_stores union all select 'page', name from pages;"
    ;;
  *)
    echo "usage: stage.sh reset|merchant" >&2; exit 2;;
esac

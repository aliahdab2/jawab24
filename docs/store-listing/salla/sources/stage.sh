#!/bin/bash
#
# Stage a THROWAWAY database as one Salla merchant, for the listing screenshots.
#
#   ./stage.sh reset      empty every app table, so the next demo login seeds fresh
#   ./stage.sh merchant   keep only the Salla-linked page + store, give the account
#                         a merchant identity
#
# The database is named by SHOT_DATABASE_URL (see sources/README-capture below, and
# the top of capture.js). It must be a scratch database — never the dev database and
# never production: `reset` truncates every application table.
set -euo pipefail

DB="${SHOT_DATABASE_URL:-postgresql://aliahdab@127.0.0.1:5432/jawab24_salla_shots}"

case "$DB" in
  # Refuse anything that is not obviously a scratch database. `reset` is destructive
  # and a typo in an env var is not a good enough reason to lose a dev database.
  *jawab24_salla_shots*|*_shots*) ;;
  *) echo "refusing: SHOT_DATABASE_URL must name a *_shots scratch database" >&2; exit 2;;
esac

case "${1:-}" in
  reset)
    # ⛔ `plans` is REFERENCE data seeded by backend/src/scripts/seed-plans.ts, not by a
    # migration — truncating it leaves the account on no plan at all, and the reply
    # tester then answers «تم الوصول للحد الشهري للردود الذكية» instead of quoting a
    # product. (Cost one wasted capture round on 2026-09-04.)
    TABLES=$(psql "$DB" -t -A -c "select string_agg(format('%I.%I', schemaname, tablename), ', ') from pg_tables where schemaname='public' and tablename not in ('__drizzle_migrations', 'plans');")
    psql "$DB" -q -c "truncate $TABLES restart identity cascade;"
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
    psql "$DB" -q <<'SQL'
delete from pages where name <> 'أزياء الخليج';
delete from ecommerce_stores where platform <> 'salla';
update users set name = 'نورة الحربي', facebook_id = 'fb_10021547', email = 'noura@gulf-fashion.sa', is_admin = true;
update workspaces set name = 'أزياء الخليج';
SQL
    psql "$DB" -A -F' | ' -c "select 'user', name from users union all select 'store', store_name from ecommerce_stores union all select 'page', name from pages;"
    ;;
  *)
    echo "usage: stage.sh reset|merchant" >&2; exit 2;;
esac

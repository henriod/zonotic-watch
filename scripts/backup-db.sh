#!/bin/sh
# Nightly Postgres dump for the production stack. Install on the server with:
#   (crontab -l 2>/dev/null; echo "30 2 * * * /root/zonoticwatch/scripts/backup-db.sh >> /var/log/zw-backup.log 2>&1") | crontab -
# Restore:
#   docker compose -f docker-compose.prod.yml exec -T zw-postgres \
#     pg_restore -U zonotic -d zonotic --clean --if-exists < /root/backups/zonoticwatch/<file>.dump
# ponytail: on-box only, so it does not survive losing the server; copy the
# dumps off the box (rclone/S3) once a destination is chosen.
set -eu
DIR=/root/backups/zonoticwatch
KEEP_DAYS=14
mkdir -p "$DIR"
cd /root/zonoticwatch
OUT="$DIR/zonotic-$(date +%F).dump"
docker compose -f docker-compose.prod.yml exec -T zw-postgres \
  pg_dump -U zonotic -Fc zonotic > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
find "$DIR" -name 'zonotic-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) backup ok: $OUT ($(du -h "$OUT" | cut -f1))"

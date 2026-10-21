# Deployment

Scriptorium runs as one application container plus a PostgreSQL 17 container. Everything the application writes lives in the database and in the `/data` volume (uploads, backups, logs). No internet access is needed after the images are pulled.

## Requirements

- Docker (Unraid, or any host with Docker Engine 24+).
- PostgreSQL 17 (16 works with a startup warning). On Unraid install a PostgreSQL 17 container from Community Applications, or add the official `postgres:17` image manually.
- A random `APP_SECRET` of at least 32 characters. Keep it constant across updates: it signs session cookies.

## Environment

| Variable           | Required | Default                 | Meaning                                                                           |
| ------------------ | -------- | ----------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`     | yes      | —                       | `postgres://user:password@host:5432/database`                                     |
| `APP_SECRET`       | yes      | —                       | at least 32 random characters                                                     |
| `PUBLIC_URL`       | yes      | `http://localhost:3000` | the address users open; `https://…` when behind a proxy (turns on Secure cookies) |
| `PORT`             | no       | `3000`                  | listening port inside the container                                               |
| `DATA_DIR`         | no       | `/data`                 | uploads, backups, maintenance marker                                              |
| `TRUST_PROXY`      | no       | `false`                 | `true` behind a reverse proxy, so client addresses and rate limits are correct    |
| `TRUSTED_ORIGINS`  | no       | —                       | extra allowed browser origins, comma separated                                    |
| `COOKIE_SECURE`    | no       | `auto`                  | `auto` derives from `PUBLIC_URL`; override with `true`/`false`                    |
| `LOG_LEVEL`        | no       | `info`                  | `fatal` … `trace`                                                                 |
| `SEED_CONTENT`     | no       | `true`                  | import bundled SRD content at start (idempotent)                                  |
| `CONTENT_DIR`      | no       | `/app/content`          | bundled content directory                                                         |
| `BACKUP_CRON`      | no       | —                       | cron expression for automatic backups, e.g. `0 4 * * *`                           |
| `BACKUP_RETENTION` | no       | `14`                    | backups to keep                                                                   |
| `PG_BIN_DIR`       | no       | —                       | directory with `pg_dump`/`pg_restore` if not on PATH                              |

## Unraid (no Compose needed)

1. Install a PostgreSQL 17 container from Community Applications. Create a database `scriptorium` and a user with a password, for example from the container console:
   ```bash
   psql -U postgres -c "CREATE USER scriptorium WITH PASSWORD 'choose-a-password';" -c "CREATE DATABASE scriptorium OWNER scriptorium;"
   ```
2. In Docker → Add Container, switch to advanced view and either load `deploy/unraid/scriptorium.xml` as a template or fill the fields by hand: repository `scriptorium:latest` (or the registry image once published), port `3000`, path `/mnt/user/appdata/scriptorium/data` → `/data`, and the variables `DATABASE_URL`, `APP_SECRET`, `PUBLIC_URL`, optionally `TRUST_PROXY`, `BACKUP_CRON`, `BACKUP_RETENTION`.
3. Start the container. On first start it applies migrations, imports the bundled SRD content (about 1,800 entries, a few seconds) and begins serving.
4. Open `http://<unraid-ip>:3000`, complete the setup wizard (instance name and the first administrator), then create invites for your players under Administration → Invites.

Behind SWAG or Nginx Proxy Manager: proxy to the container port, set `PUBLIC_URL` to the `https://` address and `TRUST_PROXY=true`. Server-Sent Events need proxy buffering off for `/api/trpc` (`proxy_buffering off;`) when live updates arrive in later milestones.

## Docker Compose (other hosts)

```bash
cp deploy/docker/.env.example deploy/docker/.env   # set APP_SECRET and POSTGRES_PASSWORD
docker compose -f deploy/docker/compose.yml up -d --build
```

The Compose file builds the image from the repository, starts PostgreSQL 17 with a named volume and waits for it to be healthy.

## Health

- `GET /healthz` — the process is up.
- `GET /readyz` — database reachable and no maintenance in progress (`503` with `status: maintenance` during a restore).

## Updates

Pull or build the new image and restart the container. Migrations are forward-only and run at start under an advisory lock; bundled content is re-imported idempotently (unchanged entries are skipped). Take a backup first.

## Backups

A backup is a directory `<DATA_DIR>/backups/<timestamp>/` containing:

- `manifest.json` — application and PostgreSQL versions, last migration, row counts per table, checksums;
- `db/<table>.csv` — every application table exported with PostgreSQL `COPY` (CSV with header) from one consistent snapshot;
- `uploads/` — a copy of every uploaded file (files are immutable and content-addressed, so a copy taken after the dump is consistent with it).

Create one:

- Administration → Backups → **Back up now**, or
- `docker exec scriptorium scriptorium backup`, or
- automatically with `BACKUP_CRON` (old backups beyond `BACKUP_RETENTION` are pruned after each run).

Verify one: `docker exec scriptorium scriptorium verify-backup /data/backups/<timestamp>` (checks the manifest and every table and file checksum).

Copy `/mnt/user/appdata/scriptorium/data/backups` somewhere safe with your usual Unraid backup routine. The Appdata Backup plugin also works as a cold backup if the container and the database container are stopped first.

## Restore

Restore replaces the database contents and the uploads directory with the backup. Run it from the application container against the database `DATABASE_URL` points to:

```bash
docker exec scriptorium scriptorium restore /data/backups/<timestamp>
```

While it runs, a maintenance marker makes the running server answer `503` to everything except health endpoints; the marker is removed when the restore finishes or fails. The command verifies the backup first, brings the schema to the running version with migrations, truncates the application tables and loads the CSV files in dependency order inside one transaction, swaps the uploads directory atomically, and re-verifies the restored files. A backup can be restored into the same or a newer application version, never an older one. To restore into a brand-new database on another host, point `DATABASE_URL` at the empty database and run the same command; then start the server.

## Local image build and the first production run

The Dockerfile is validated by the CI workflow (`docker build`) and on the Unraid host; the development workstation for this project has no Docker, so builds are not run there. The restore procedure is covered by an automated acceptance test that backs up one instance and restores into a fresh one (`apps/server/test/backup.test.ts`).

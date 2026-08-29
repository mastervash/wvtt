# Deploying without Docker

Most people should use the container: `docker compose up -d`, described in the
[main README](../README.md#run-your-own). This directory is for running the server
directly on a host with systemd and nginx.

If you are moving an existing systemd install to the container, the room snapshots come
across as plain files — stop the service, copy `server/data/rooms` into the volume, and
make sure they end up owned by uid 1000, which is what the container runs as:

```bash
sudo systemctl stop wvtt && sudo systemctl disable wvtt
docker volume create wvtt_wvtt-data
docker run --rm -v wvtt_wvtt-data:/data -v "$PWD/server/data:/src:ro" alpine \
  sh -c 'mkdir -p /data/rooms && cp /src/rooms/*.json /data/rooms/ \
         && chown -R 1000:1000 /data && chmod 700 /data /data/rooms \
         && chmod 600 /data/rooms/*.json'
docker compose up -d
```

Room codes keep working across the move. Leave the unit file in place until you are
happy with the container — `systemctl enable --now wvtt` is the way back, and stopping
the container first frees the port.

The whole app is one Node process: it serves the built client, the JSON API and the
game websocket on a single port. nginx only needs to proxy that one upstream.

## First deploy

```bash
cd /home/mastervash/wvtt
npm ci
npm run build

sudo cp deploy/wvtt.service /etc/systemd/system/wvtt.service
sudo systemctl daemon-reload
sudo systemctl enable --now wvtt

sudo cp deploy/nginx.conf /etc/nginx/sites-available/wvtt
sudo ln -s /etc/nginx/sites-available/wvtt /etc/nginx/sites-enabled/wvtt
sudo nginx -t && sudo systemctl reload nginx
```

Set `server_name` in the nginx config to your hostname, then get a certificate:

```bash
sudo certbot --nginx -d your.hostname
```

## Updating

```bash
cd /home/mastervash/wvtt
git pull
npm ci
npm run build
sudo systemctl restart wvtt
```

## Checking on it

```bash
systemctl status wvtt
journalctl -u wvtt -f
curl localhost:2567/api/health
```

## Notes

- Rooms live in memory. Restarting the service ends every table in progress; there is
  no persistence layer yet, by design for v1.
- The service is capped at 1 GB. Each room holds its own state plus, if the pack has a
  rules script, a QuickJS isolate limited to 16 MB.
- `PORT` is set in the unit file. Change it in both the unit and the nginx config.

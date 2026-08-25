# Deploying

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

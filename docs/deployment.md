# LinkBox Deployment Runbook

Last verified: 2026-06-24

This runbook records the current home-server deployment flow. Do not commit
passwords, private keys, FRP tokens, or production `.env` files.

## Current Production Target

| Item | Value |
| --- | --- |
| Server | `150.158.146.192` |
| SSH | `ssh -p 6004 wq@150.158.146.192` |
| App path | `/home/wq/LinkBox` |
| Runtime | Docker Compose service `linkbox` |
| Container port | `3100` |
| Public URL | `http://150.158.146.192:6057/` |
| Mobile URL | `http://150.158.146.192:6057/mobile/` |
| Rollback symlink | `/home/wq/LinkBox-prev` |

The existing FRP tunnel is preserved during normal application updates. The
application deployment does not edit FRP configuration.

## Local Verification Before Deploy

Run from the repository root:

```bash
git diff --check

cd mobile
npm run build

cd ../client
npm run build

cd ..
node --test \
  mobile/src/utils/imageBatchGallery.test.mjs \
  mobile/src/utils/groupChatDisplay.test.mjs \
  mobile/src/utils/socialConversations.test.mjs

node --test \
  server/test/socialGroup.test.mjs \
  server/test/assistantTurn.test.mjs
```

For broad backend changes, also run:

```bash
cd server
npm test
```

Some HTTP tests bind `127.0.0.1`. In restricted sandboxes they may need explicit
permission:

```bash
node --test server/test/socialDirectMessages.test.mjs
```

## Package

Run from `/Users/wq` on the Mac workstation:

```bash
tar \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='client/node_modules' \
  --exclude='mobile/node_modules' \
  --exclude='server/node_modules' \
  --exclude='data' \
  --exclude='uploads' \
  --exclude='certs' \
  --exclude='server/uploads' \
  -czf /tmp/linkbox-update.tar.gz \
  -C /Users/wq LinkBox
```

The archive intentionally excludes databases, uploads, certificates, and
dependency folders.

## Upload

```bash
scp -P 6004 /tmp/linkbox-update.tar.gz \
  wq@150.158.146.192:/tmp/linkbox-update.tar.gz
```

## Deploy

Build the new release before stopping the running service. The switch creates a
timestamped rollback directory and updates `/home/wq/LinkBox-prev`.

```bash
ssh -p 6004 wq@150.158.146.192 '
set -e
stamp=$(date +%Y%m%d-%H%M%S)
rm -rf /home/wq/LinkBox-new
mkdir -p /home/wq/LinkBox-new
tar -xzf /tmp/linkbox-update.tar.gz -C /home/wq/LinkBox-new --strip-components=1
cd /home/wq/LinkBox-new
docker compose build linkbox
cd /home/wq
docker compose -f /home/wq/LinkBox/docker-compose.yml stop linkbox
mv /home/wq/LinkBox /home/wq/LinkBox-prev-$stamp
mv /home/wq/LinkBox-new /home/wq/LinkBox
ln -sfn /home/wq/LinkBox-prev-$stamp /home/wq/LinkBox-prev
cd /home/wq/LinkBox
docker compose up -d linkbox
echo rollback=/home/wq/LinkBox-prev-$stamp
'
```

## Verify

Local server check:

```bash
ssh -p 6004 wq@150.158.146.192 '
cd /home/wq/LinkBox
docker compose ps
curl -s -o /tmp/linkbox-root.html -w "%{http_code}\n" http://127.0.0.1:3100/
curl -s -o /tmp/linkbox-mobile.html -w "%{http_code}\n" http://127.0.0.1:3100/mobile/
docker compose logs --tail=30 linkbox
'
```

Public check from the workstation:

```bash
curl -s -o /tmp/linkbox-public-root.html -w '%{http_code}\n' \
  http://150.158.146.192:6057/

curl -s -o /tmp/linkbox-public-mobile.html -w '%{http_code}\n' \
  http://150.158.146.192:6057/mobile/
```

Both should return `200`.

## Rollback

Use the timestamped rollback directory printed by deploy, or the
`/home/wq/LinkBox-prev` symlink.

```bash
ssh -p 6004 wq@150.158.146.192 '
set -e
cd /home/wq
docker compose -f /home/wq/LinkBox/docker-compose.yml stop linkbox
bad=LinkBox-bad-$(date +%Y%m%d-%H%M%S)
mv /home/wq/LinkBox /home/wq/$bad
cp -a "$(readlink -f /home/wq/LinkBox-prev)" /home/wq/LinkBox
cd /home/wq/LinkBox
docker compose up -d linkbox
curl -fsS http://127.0.0.1:3100/ >/dev/null
echo rollback_ok
'
```

## Useful Operations

Show container status and logs:

```bash
ssh -p 6004 wq@150.158.146.192 '
cd /home/wq/LinkBox
docker compose ps
docker compose logs --tail=100 linkbox
'
```

Restart only LinkBox:

```bash
ssh -p 6004 wq@150.158.146.192 '
cd /home/wq/LinkBox
docker compose restart linkbox
'
```

## Historical Targets

Older notes referenced a cpolar endpoint and an RK3576/TaishanPi native
systemd deployment. Those are not the current production path. If they are
reactivated, verify host, SSH port, app path, data path, and service manager
before using any old commands.

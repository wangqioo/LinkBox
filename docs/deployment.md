# LinkBox Deployment Runbook

Last verified: 2026-06-11

This runbook records the two active LinkBox deployments and the exact update
flow used from the Windows development machine. Do not commit passwords or
private keys to this repository.

## Targets

| Target | Host | SSH user | Runtime | App path | Data path |
|--------|------|----------|---------|----------|-----------|
| Home server | `5.tcp.cpolar.cn:10281` | `wq` | Docker Compose | `/home/wq/LinkBox` | `/home/wq/linkbox-data` |
| RK3576 / TaishanPi | `150.158.146.192:6277` | `lckfb` | native systemd | `/opt/linkbox` | `/var/lib/linkbox` |

Known SSH host key fingerprints:

```text
home server: ssh-ed25519 255 SHA256:usrCN0O7t/Gd56zxNDQMBG7g+rch7VOw2XYJrSr7TPg
RK3576:      ssh-ed25519 255 SHA256:/PLBOTxtyNmCJsf3mK7by9dvG4Lg6RNbdxSQRVb/Vzc
```

Credentials are managed outside git. As of the last verification, both targets
were reachable with password-based SSH from this workstation.

## Local Build And Package

Run from PowerShell on the Windows development machine:

```powershell
cd C:\Users\100448405\LinkBox\client
npm.cmd run build

cd C:\Users\100448405\LinkBox\mobile
npm.cmd run build

cmd /c tar.exe --exclude=.git --exclude=node_modules --exclude=client/node_modules --exclude=server/node_modules --exclude=mobile/node_modules --exclude=server/linkbox.db --exclude=server/linkbox.db-* --exclude=server/uploads --exclude=server/certs -czf C:\tmp\linkbox-update.tar.gz -C C:\Users\100448405\LinkBox .
```

The archive intentionally excludes local databases, uploads, certificates, and
dependency folders. Remote data directories must never be overwritten by a
deploy archive.

## Deploy To Home Server

Upload:

```powershell
& 'C:\Program Files\PuTTY\pscp.exe' -P 10281 -batch -hostkey 'ssh-ed25519 255 SHA256:usrCN0O7t/Gd56zxNDQMBG7g+rch7VOw2XYJrSr7TPg' C:\tmp\linkbox-update.tar.gz wq@5.tcp.cpolar.cn:/home/wq/linkbox-update.tar.gz
```

Prepare and build before stopping the running container:

```powershell
& 'C:\Program Files\PuTTY\plink.exe' -ssh -P 10281 -batch -hostkey 'ssh-ed25519 255 SHA256:usrCN0O7t/Gd56zxNDQMBG7g+rch7VOw2XYJrSr7TPg' wq@5.tcp.cpolar.cn "set -e; rm -rf /home/wq/LinkBox-new; mkdir -p /home/wq/LinkBox-new; tar -xzf /home/wq/linkbox-update.tar.gz -C /home/wq/LinkBox-new; if [ -f /home/wq/LinkBox/.env ]; then cp /home/wq/LinkBox/.env /home/wq/LinkBox-new/.env; fi; cd /home/wq/LinkBox-new; docker compose build linkbox"
```

Switch and verify:

```powershell
& 'C:\Program Files\PuTTY\plink.exe' -ssh -P 10281 -batch -hostkey 'ssh-ed25519 255 SHA256:usrCN0O7t/Gd56zxNDQMBG7g+rch7VOw2XYJrSr7TPg' wq@5.tcp.cpolar.cn "set -e; cd /home/wq/LinkBox; docker compose down; cd /home/wq; rm -rf /home/wq/LinkBox-prev; mv /home/wq/LinkBox /home/wq/LinkBox-prev; mv /home/wq/LinkBox-new /home/wq/LinkBox; cd /home/wq/LinkBox; docker compose up -d; sleep 5; docker compose ps; curl -fsS http://127.0.0.1:3100/ >/dev/null; echo HOME_LINKBOX_OK"
```

Rollback if needed:

```sh
cd /home/wq/LinkBox
docker compose down
cd /home/wq
mv LinkBox LinkBox-bad
mv LinkBox-prev LinkBox
cd /home/wq/LinkBox
docker compose up -d
```

## Deploy To RK3576 / TaishanPi

Upload:

```powershell
& 'C:\Program Files\PuTTY\pscp.exe' -P 6277 -batch -hostkey 'ssh-ed25519 255 SHA256:/PLBOTxtyNmCJsf3mK7by9dvG4Lg6RNbdxSQRVb/Vzc' C:\tmp\linkbox-update.tar.gz lckfb@150.158.146.192:/home/lckfb/linkbox-update.tar.gz
```

Prepare the new release. This reuses the existing native `server/node_modules`
because `better-sqlite3` is architecture-specific and already built on the
board:

```powershell
& 'C:\Program Files\PuTTY\plink.exe' -ssh -P 6277 -batch -hostkey 'ssh-ed25519 255 SHA256:/PLBOTxtyNmCJsf3mK7by9dvG4Lg6RNbdxSQRVb/Vzc' lckfb@150.158.146.192 "set -e; rm -rf /home/lckfb/linkbox-new; mkdir -p /home/lckfb/linkbox-new; tar -xzf /home/lckfb/linkbox-update.tar.gz -C /home/lckfb/linkbox-new; if [ -d /opt/linkbox/server/node_modules ]; then cp -a /opt/linkbox/server/node_modules /home/lckfb/linkbox-new/server/node_modules; fi; if [ -d /opt/linkbox/server/certs ]; then cp -a /opt/linkbox/server/certs /home/lckfb/linkbox-new/server/certs; fi; test -d /home/lckfb/linkbox-new/client/dist; test -d /home/lckfb/linkbox-new/mobile/dist; test -d /home/lckfb/linkbox-new/server/node_modules; echo RK_PREP_OK"
```

Switch and verify. Enter the sudo password when prompted if the command is run
interactively:

```powershell
& 'C:\Program Files\PuTTY\plink.exe' -ssh -P 6277 -batch -hostkey 'ssh-ed25519 255 SHA256:/PLBOTxtyNmCJsf3mK7by9dvG4Lg6RNbdxSQRVb/Vzc' lckfb@150.158.146.192 "set -e; ts=`$(date +%Y%m%d-%H%M%S); sudo systemctl stop linkbox; sudo mv /opt/linkbox /opt/linkbox-prev-`$ts; sudo mv /home/lckfb/linkbox-new /opt/linkbox; sudo chown -R root:root /opt/linkbox; sudo systemctl start linkbox; sleep 5; systemctl is-active linkbox; curl -fsS http://127.0.0.1:3100/ >/dev/null; echo RK_LINKBOX_OK; systemctl status linkbox --no-pager | head -12"
```

If quoting gets in the way, use a fixed backup suffix instead:

```powershell
& 'C:\Program Files\PuTTY\plink.exe' -ssh -P 6277 -batch -hostkey 'ssh-ed25519 255 SHA256:/PLBOTxtyNmCJsf3mK7by9dvG4Lg6RNbdxSQRVb/Vzc' lckfb@150.158.146.192 "set -e; sudo systemctl stop linkbox; sudo mv /opt/linkbox /opt/linkbox-prev-YYYYMMDD-HHMMSS; sudo mv /home/lckfb/linkbox-new /opt/linkbox; sudo chown -R root:root /opt/linkbox; sudo systemctl start linkbox"
```

Rollback if needed:

```sh
sudo systemctl stop linkbox
sudo mv /opt/linkbox /opt/linkbox-bad
sudo mv /opt/linkbox-prev-YYYYMMDD-HHMMSS /opt/linkbox
sudo systemctl start linkbox
curl -fsS http://127.0.0.1:3100/ >/dev/null
```

## Post-Deploy Checks

Home server:

```powershell
& 'C:\Program Files\PuTTY\plink.exe' -ssh -P 10281 -batch -hostkey 'ssh-ed25519 255 SHA256:usrCN0O7t/Gd56zxNDQMBG7g+rch7VOw2XYJrSr7TPg' wq@5.tcp.cpolar.cn "docker ps --filter name=linkbox --format '{{.Names}} {{.Status}}'; curl -fsS http://127.0.0.1:3100/ >/dev/null && echo HOME_HTTP_OK"
```

RK3576:

```powershell
& 'C:\Program Files\PuTTY\plink.exe' -ssh -P 6277 -batch -hostkey 'ssh-ed25519 255 SHA256:/PLBOTxtyNmCJsf3mK7by9dvG4Lg6RNbdxSQRVb/Vzc' lckfb@150.158.146.192 "uname -m; systemctl is-active linkbox; curl -fsS http://127.0.0.1:3100/ >/dev/null && echo RK_HTTP_OK; journalctl -u linkbox -n 20 --no-pager"
```

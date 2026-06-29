# Aufschaltung Mail Bridge

Eigenes Repo fuer die Aufschaltung-Automation.

Dieses Repo benutzt bewusst dieselben Secret-Namen wie das funktionierende Ausschreibungs-Repo:

- `EWS_URL`
- `EWS_EMAIL`
- `EWS_USERNAME`
- `EWS_PASSWORD`
- `EWS_AUTH_TYPE`
- `EWS_VERIFY_TLS`
- `APPS_SCRIPT_WEBAPP_URL`
- `BRIDGE_TOKEN`

Dadurch bleibt die Logik exakt gleich. Die Werte in diesem Repo gehoeren aber zur Mailbox `aufschaltungen.berlin@sicherheit-nord.de`.

Fallback ohne EWS-Zugriff auf das Aufschaltungs-Postfach:

- Im Aufschaltungs-Postfach werden nur relevante Ajax-Aufschaltungs-Mails an `matteo.merkle@sicherheit-nord.de` weitergeleitet.
- Dieses Repo kann dann mit den funktionierenden Matteo-EWS-Zugangsdaten lesen:
  - `EWS_EMAIL=matteo.merkle@sicherheit-nord.de`
  - `EWS_USERNAME=matteo.merkle@sicherheit-nord.de`
- Damit nicht alle Matteo-Mails verarbeitet werden, filtert der Workflow zusaetzlich ueber:
  - `MAIL_INCLUDE_REGEX`
  - optional `MAIL_EXCLUDE_REGEX`

Workflow:

- `.github/workflows/exchange-mail-bridge.yml`
- GitHub schedule bleibt als Cloud-Backup aktiv.
- Das Apps Script startet denselben Workflow zusaetzlich per GitHub API ueber
  `triggerAufschaltungExchangeMailBridgeWorkflow()`. Damit haengt der
  produktive Ablauf nicht nur am unzuverlaessig minutengenauen GitHub-Cron.
- Jeder Lauf schaut standardmaessig 24 Stunden zurueck. Doppelte Sendungen
  werden ueber `MessageId` und die AutoReply-Statusspalten im Google Sheet
  verhindert.

Apps Script:

- `exchange_mail_bridge/apps_script/AufschaltungAutoReply_Code.gs`

## Betrieb

Apps-Script-Trigger einrichten:

```text
setupAufschaltungAutomationTriggers()
```

Manueller GitHub-Import ueber Apps Script:

```text
triggerAufschaltungExchangeMailBridgeWorkflow()
```

Manueller GitHub-Import ueber GitHub Actions:

```powershell
gh workflow run exchange-mail-bridge.yml --repo matteohaudenschild/Aufschaltung-Mail-Bridge --ref master -f lookback_minutes=1440 -f mail_top=50 -f mail_scan_top=500 -f include_attachments=true -f include_body_html=true -f dry_run_summary=false
```

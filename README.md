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

Workflow:

- `.github/workflows/exchange-mail-bridge.yml`

Apps Script:

- `exchange_mail_bridge/apps_script/AufschaltungAutoReply_Code.gs`

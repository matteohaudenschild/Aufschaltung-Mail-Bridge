import os
from datetime import datetime, timezone

from exchangelib import Mailbox, Message

from exchange_to_apps_script import connect_account, env


def main() -> None:
    account = connect_account()
    to_address = env("TEST_MAIL_TO", env("EWS_EMAIL"))
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    subject = env(
        "TEST_MAIL_SUBJECT",
        f"NSL-Aufschaltungsanfrage - Ajax Aufschaltung E2E Test {stamp}",
    )
    body = env(
        "TEST_MAIL_BODY",
        "\n".join(
            [
                "NSL-Aufschaltungsanfrage",
                "",
                "Ajax Aufschaltung Testlauf fuer den kompletten Automations-Cycle.",
                "",
                "Kundendaten:",
                "Name: Max Mustermann Testkunde",
                "E-Mail: kunde.autoreply.test@example.com",
                "Telefon: 030 123456",
                "",
                "Objekt:",
                "Objektname: Cody E2E Testobjekt",
                "Strasse: Teststrasse 1",
                "PLZ / Ort: 12459 Berlin",
                "",
                "Anlage:",
                "Anlagetyp: Ajax",
                "Aufschaltung: NSL / Leitstelle",
                "Hinweis: Diese Mail ist ein technischer Test. Bitte nicht produktiv bearbeiten.",
                "",
                "Viele Gruesse",
                "Cody Test",
            ]
        ),
    )

    message = Message(
        account=account,
        folder=account.sent,
        subject=subject,
        body=body,
        to_recipients=[Mailbox(email_address=to_address)],
    )
    message.send_and_save()
    print(
        {
            "ok": True,
            "to": to_address,
            "subject": subject,
            "note": "Test mail sent via EWS. No Apps Script post and no auto reply triggered by this workflow.",
        }
    )


if __name__ == "__main__":
    main()

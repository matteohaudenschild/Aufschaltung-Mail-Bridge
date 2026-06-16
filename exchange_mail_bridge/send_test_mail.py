from datetime import datetime, timezone

from exchangelib import Mailbox, Message

from exchange_to_apps_script import connect_account, env


def main() -> None:
    account = connect_account()
    to_address = env("TEST_MAIL_TO", env("EWS_EMAIL"))
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    customer_email = env("TEST_CUSTOMER_EMAIL", "kunde.autoreply.test@example.com")
    subject = env(
        "TEST_MAIL_SUBJECT",
        f"WG: NSL-Aufschaltungsanfrage - Cody E2E Test {stamp}",
    )
    body = env(
        "TEST_MAIL_BODY",
        "\n".join(
            [
                "________________________________",
                "Von: Ajax Team",
                "Gesendet: Dienstag, 16. Juni 2026 08:02:09 (UTC+01:00) Amsterdam, Berlin, Bern, Rom, Stockholm, Wien",
                "An: Dennis Gessert",
                "Betreff: NSL-Aufschaltungsanfrage",
                "",
                "AKTUELLE WARNUNG: Vorsicht vor Phishing-E-Mails! - Alle empfangenden E-Mails auf Echtheit pruefen, da u.U. Fake-Adressen verwendet werden ODER bekannte Absender Opfer eines Hackings/Cyberangriffs geworden sind!! Im Zweifelsfall nicht antworten, keinen Link anklicken, keine Anhaenge oeffnen UND den Datenschutzbeauftragten informieren (datenschutz@wachdienst.de) !",
                "",
                "Hallo!",
                "Der Benutzer Cody Testkunde moechte sein Sicherheitssystem (Viktoria-Luise-Platz 4 10777 hub ID 002AA197) mit Ihrer Ueberwachungszentrale verbinden und hat folgende Kontaktdaten bereitgestellt, um die Details mit Ihnen zu besprechen.",
                "",
                f"E-Mail-Adresse: {customer_email}",
                "Telefonnummer: +491744943000",
                "Name: Cody Testkunde",
                "",
                "Hinweis: Diese Mail ist ein technischer Test. Bitte nicht produktiv bearbeiten.",
            ]
        ),
    )

    message = Message(
        account=account,
        folder=account.inbox if is_create_inbox_item() else account.sent,
        subject=subject,
        body=body,
        to_recipients=[Mailbox(email_address=to_address)],
    )
    if is_create_inbox_item():
        message.save()
        action = "created in inbox"
    else:
        message.send_and_save()
        action = "sent via EWS"

    print(
        {
            "ok": True,
            "to": to_address,
            "subject": subject,
            "action": action,
            "note": "No Apps Script post and no auto reply triggered by this workflow.",
        }
    )


def is_create_inbox_item() -> bool:
    return env("TEST_MAIL_CREATE_INBOX_ITEM").lower() in {"1", "true", "yes", "y", "on"}


if __name__ == "__main__":
    main()

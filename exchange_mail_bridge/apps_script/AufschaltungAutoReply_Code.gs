const AUFSCHALTUNG_AUTO_REPLY_CONFIG = {
  ENABLED: true,
  SHEET_ID_PROPERTY: "AUFSCHALTUNG_SHEET_ID",
  SHEET_ID: "",
  SHEET_NAME: "Exchange Mail",
  START_AFTER_ISO: "2026-06-11T00:00:00.000Z",
  MAX_ROWS_PER_RUN: 25,
  TRIGGER_INTERVAL_MINUTES: 5,
  DELIVERY_MODE_PROPERTY: "AUFSCHALTUNG_DELIVERY_MODE",
  TEST_MODE_ENABLED: false,
  TEST_RECIPIENT_EMAIL: "matteo.haudenschild@gmail.com",
  GENERATED_TEST_CUSTOMER_EMAIL: "matteo.merkle@sicherheit-nord.de",
  SENDER_NAME: "Sicherheit Nord",
  FROM_ALIAS: "aufschaltungen.berlin@sicherheit-nord.de",
  REPLY_TO_EMAIL: "aufschaltungen.berlin@sicherheit-nord.de",
  SUBJECT: "Bitte vervollständigen Sie Ihre Anfrage bei Sicherheit Nord",
  FORM_LINK: "https://matteohaudenschild.github.io/Aufschaltformular/",
  LOGO_URL: "https://www.sicherheit-nord.de/assets/Logos/Logos-Farbe/SN_Logo.png",
  USE_HTML_EMAIL: true,
  ALLOW_BODY_EMAIL_FALLBACK: false,
  REQUIRED_KEYWORDS: [
    "NSL-Aufschaltungsanfrage"
  ],
  INTERNAL_DOMAINS: [
    "sicherheit-nord.de",
    "wackerhagengruppe.de",
    "tng.de"
  ],
  BLOCKED_LOCAL_PARTS: [
    "noreply",
    "no-reply",
    "do-not-reply",
    "donotreply",
    "mailer-daemon",
    "postmaster"
  ],
  STATUS_HEADERS: [
    "AufschaltungAutoReplyStatus",
    "AufschaltungAutoReplyProcessedAt",
    "AufschaltungAutoReplyTo",
    "AufschaltungAutoReplyDetectedCustomerEmail",
    "AufschaltungAutoReplyReason",
    "AufschaltungAutoReplySource"
  ],
  STATUS_SENT: "sent",
  STATUS_TEST_SENT: "test_sent",
  STATUS_SKIPPED: "skipped",
  STATUS_REVIEW: "review",
  STATUS_ERROR: "error"
};

function autoReplyAufschaltung() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log("Aufschaltungs-AutoReply uebersprungen: Script-Lock nicht erhalten.");
    return;
  }

  try {
    processAufschaltungExchangeSheetAutoReplies_();
  } finally {
    lock.releaseLock();
  }
}

function runAutoReplyAufschaltungNow() {
  Logger.log("Aufschaltungs-AutoReply wird manuell gestartet.");
  processAufschaltungExchangeSheetAutoReplies_();
}

function sendAufschaltungPreviewToPrivateTestNow() {
  const testRecipient = aufschaltungNormalizeEmail_(AUFSCHALTUNG_AUTO_REPLY_CONFIG.TEST_RECIPIENT_EMAIL);
  if (!testRecipient) {
    throw new Error("TEST_RECIPIENT_EMAIL ist leer.");
  }

  const mail = aufschaltungBuildAutoReplyMail_();
  aufschaltungSendAutoReply_(testRecipient, mail);
  Logger.log("Aufschaltungs-Testmail gesendet an " + testRecipient);
}

function enableAufschaltungTestMode() {
  PropertiesService.getScriptProperties().setProperty(
    AUFSCHALTUNG_AUTO_REPLY_CONFIG.DELIVERY_MODE_PROPERTY,
    "test"
  );
  Logger.log(
    "Aufschaltungs-Testmodus aktiv: AutoReplies gehen an "
    + AUFSCHALTUNG_AUTO_REPLY_CONFIG.TEST_RECIPIENT_EMAIL
    + ", erkannte Kundenadressen werden nur protokolliert."
  );
}

function enableAufschaltungLiveMode() {
  PropertiesService.getScriptProperties().setProperty(
    AUFSCHALTUNG_AUTO_REPLY_CONFIG.DELIVERY_MODE_PROPERTY,
    "live"
  );
  Logger.log("Aufschaltungs-Livemodus aktiv: AutoReplies gehen an die erkannte E-Mail-Adresse aus dem Ajax-Text.");
}

function checkAufschaltungDeliveryMode() {
  const mode = aufschaltungGetDeliveryMode_();
  Logger.log("Aktueller Aufschaltungs-Modus: " + mode);
  Logger.log("Testempfaenger: " + AUFSCHALTUNG_AUTO_REPLY_CONFIG.TEST_RECIPIENT_EMAIL);
  Logger.log("Generierte Test-Kundenadresse im Ajax-Text: " + AUFSCHALTUNG_AUTO_REPLY_CONFIG.GENERATED_TEST_CUSTOMER_EMAIL);
  return mode;
}

function runGeneratedAjaxAufschaltungRoutingTestNow() {
  const customerEmail = aufschaltungNormalizeEmail_(AUFSCHALTUNG_AUTO_REPLY_CONFIG.GENERATED_TEST_CUSTOMER_EMAIL);
  if (!customerEmail) {
    throw new Error("GENERATED_TEST_CUSTOMER_EMAIL ist leer.");
  }

  const sheet = aufschaltungGetSheet_();
  aufschaltungBridgeEnsureHeader_(sheet);
  const headers = aufschaltungEnsureHeaders_(sheet);
  const columns = aufschaltungHeaderIndex_(headers);
  aufschaltungAssertRequiredColumns_(columns);
  aufschaltungResetGeneratedRoutingTestRows_(sheet, columns);

  const now = new Date();
  const message = {
    id: "cody-generated-aufschaltung-routing-test:" + now.getTime(),
    receivedTime: now.toISOString(),
    fromName: "Dennis Gessert",
    fromEmail: "aufschaltungen.berlin@sicherheit-nord.de",
    subject: "WG: NSL-Aufschaltungsanfrage - Cody Routing Test",
    bodyPreview: "NSL-Aufschaltungsanfrage mit Test-Kundenadresse " + customerEmail,
    bodyTextFull: aufschaltungBuildGeneratedAjaxTestBody_(customerEmail, now),
    conversationId: "cody-generated-aufschaltung-routing-test",
    webLink: ""
  };

  const row = aufschaltungBridgeBuildRow_(message, "", "", now.toISOString());
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  Logger.log("Generierte Ajax-Testzeile angelegt. Kundenadresse im Text: " + customerEmail);

  const result = processAufschaltungExchangeSheetAutoReplies_();
  Logger.log("Generierter Ajax-Routing-Test beendet: " + JSON.stringify(result));
  return result;
}

function setupAutoReplyAufschaltungTrigger() {
  aufschaltungRemoveTriggersForFunction_("autoReplyAufschaltung");

  ScriptApp.newTrigger("autoReplyAufschaltung")
    .timeBased()
    .everyMinutes(Math.max(1, Number(AUFSCHALTUNG_AUTO_REPLY_CONFIG.TRIGGER_INTERVAL_MINUTES) || 1))
    .create();

  Logger.log(
    "Minutentrigger erstellt fuer autoReplyAufschaltung: alle "
    + String(AUFSCHALTUNG_AUTO_REPLY_CONFIG.TRIGGER_INTERVAL_MINUTES || 1)
    + " Minute(n)."
  );
}

function checkAutoReplyAufschaltungSetup() {
  const aliases = GmailApp.getAliases();
  const sheet = aufschaltungGetSheet_();
  const headers = aufschaltungEnsureHeaders_(sheet);
  Logger.log("Ausfuehrendes Konto: " + (Session.getEffectiveUser().getEmail() || "(unbekannt)"));
  Logger.log("Sheet: " + sheet.getParent().getName() + " / " + sheet.getName());
  Logger.log("Sheet-ID: " + aufschaltungGetSheetId_());
  Logger.log("Zeilen: " + sheet.getLastRow());
  Logger.log("Header: " + headers.join(", "));
  Logger.log("Absendername: " + AUFSCHALTUNG_AUTO_REPLY_CONFIG.SENDER_NAME);
  Logger.log("Absenderadresse: " + AUFSCHALTUNG_AUTO_REPLY_CONFIG.FROM_ALIAS);
  Logger.log("Delivery-Modus: " + aufschaltungGetDeliveryMode_());
  Logger.log("Verfuegbare Gmail-Aliase: " + (aliases.length ? aliases.join(", ") : "(keine)"));
  if (
    AUFSCHALTUNG_AUTO_REPLY_CONFIG.FROM_ALIAS
    && aliases.indexOf(AUFSCHALTUNG_AUTO_REPLY_CONFIG.FROM_ALIAS) === -1
  ) {
    Logger.log("WARNUNG: Absenderadresse ist nicht in GmailApp.getAliases() enthalten. Gmail muss den Alias erst bestaetigt haben.");
  }
}

function setupAufschaltungConfigOnce() {
  PropertiesService.getScriptProperties().setProperties({
    AUFSCHALTUNG_SHEET_ID: "PASTE_GOOGLE_SHEET_ID_HERE",
    AUFSCHALTUNG_BRIDGE_TOKEN: "PASTE_LONG_RANDOM_TOKEN_HERE",
    AUFSCHALTUNG_SHEET_NAME: AUFSCHALTUNG_AUTO_REPLY_CONFIG.SHEET_NAME,
    AUFSCHALTUNG_ATTACHMENT_FOLDER_NAME: "Aufschaltung Exchange Mail Attachments",
    AUFSCHALTUNG_BODY_FOLDER_NAME: "Aufschaltung Exchange Mail Bodies"
  }, false);
  Logger.log("Aufschaltungs-Properties angelegt. Bitte Platzhalter durch echte Werte ersetzen.");
}

function createAufschaltungSheetAndSetPropertyNow() {
  const spreadsheet = SpreadsheetApp.create("Aufschaltung Exchange Mail");
  const sheet = spreadsheet.getSheets()[0];
  sheet.setName(AUFSCHALTUNG_AUTO_REPLY_CONFIG.SHEET_NAME);
  aufschaltungBridgeEnsureHeader_(sheet);
  aufschaltungEnsureHeaders_(sheet);
  PropertiesService.getScriptProperties().setProperty("AUFSCHALTUNG_SHEET_ID", spreadsheet.getId());
  Logger.log("Aufschaltungs-Sheet erstellt: " + spreadsheet.getUrl());
  Logger.log("AUFSCHALTUNG_SHEET_ID gesetzt: " + spreadsheet.getId());
}

function processAufschaltungExchangeSheetAutoReplies_() {
  if (!AUFSCHALTUNG_AUTO_REPLY_CONFIG.ENABLED) {
    Logger.log("Aufschaltungs-AutoReply ist deaktiviert.");
    return {
      checked: 0,
      sent: 0,
      skipped: 0,
      review: 0,
      disabled: true
    };
  }

  const sheet = aufschaltungGetSheet_();
  const headers = aufschaltungEnsureHeaders_(sheet);
  const columns = aufschaltungHeaderIndex_(headers);
  aufschaltungAssertRequiredColumns_(columns);

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log("Keine Exchange-Zeilen im Aufschaltungs-Sheet vorhanden.");
    return {
      checked: 0,
      sent: 0,
      skipped: 0,
      review: 0
    };
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const alreadyRepliedKeys = aufschaltungBuildAlreadyRepliedKeySet_(values, columns);
  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let review = 0;
  let details = [];

  for (let index = 0; index < values.length; index += 1) {
    if (processed >= AUFSCHALTUNG_AUTO_REPLY_CONFIG.MAX_ROWS_PER_RUN) {
      break;
    }

    const rowNumber = index + 2;
    const row = aufschaltungBuildRowObject_(values[index], columns);
    const currentStatus = String(row.AufschaltungAutoReplyStatus || "").trim().toLowerCase();
    if (currentStatus) {
      continue;
    }

    if (!aufschaltungIsAfterStart_(row)) {
      continue;
    }

    if (!aufschaltungMatchesRequiredKeywords_(row)) {
      continue;
    }

    processed += 1;

    try {
      const recipient = aufschaltungExtractCustomerEmailFromRow_(row);
      if (!recipient.email) {
        const reason = recipient.reason || "Keine sichere Kunden-E-Mail-Adresse erkannt.";
        const source = recipient.source || "";
        aufschaltungSetStatus_(
          sheet,
          columns,
          rowNumber,
          AUFSCHALTUNG_AUTO_REPLY_CONFIG.STATUS_REVIEW,
          "",
          reason,
          source,
          ""
        );
        aufschaltungPushAutoReplyDetail_(details, rowNumber, row, AUFSCHALTUNG_AUTO_REPLY_CONFIG.STATUS_REVIEW, "", reason, source, "");
        review += 1;
        continue;
      }

      if (!aufschaltungIsAllowedRecipient_(recipient.email)) {
        const reason = "Empfaenger ist intern, Systemadresse oder blockiert.";
        aufschaltungSetStatus_(
          sheet,
          columns,
          rowNumber,
          AUFSCHALTUNG_AUTO_REPLY_CONFIG.STATUS_SKIPPED,
          recipient.email,
          reason,
          recipient.source,
          recipient.email
        );
        aufschaltungPushAutoReplyDetail_(details, rowNumber, row, AUFSCHALTUNG_AUTO_REPLY_CONFIG.STATUS_SKIPPED, recipient.email, reason, recipient.source, recipient.email);
        skipped += 1;
        continue;
      }

      const duplicateKey = aufschaltungBuildDuplicateReplyKey_(row, recipient.email);
      if (alreadyRepliedKeys.has(duplicateKey)) {
        const reason = "Duplikat: Fuer diese Kundenadresse und Anlage/Hub wurde bereits eine Aufschaltungs-AutoReply gesendet.";
        aufschaltungSetStatus_(
          sheet,
          columns,
          rowNumber,
          AUFSCHALTUNG_AUTO_REPLY_CONFIG.STATUS_SKIPPED,
          recipient.email,
          reason,
          "duplicate-customer-hub",
          recipient.email
        );
        aufschaltungPushAutoReplyDetail_(details, rowNumber, row, AUFSCHALTUNG_AUTO_REPLY_CONFIG.STATUS_SKIPPED, recipient.email, reason, "duplicate-customer-hub", recipient.email);
        skipped += 1;
        continue;
      }

      const delivery = aufschaltungResolveDeliveryRecipient_(recipient.email);
      const mail = aufschaltungBuildAutoReplyMail_();
      aufschaltungSendAutoReply_(delivery.email, mail);
      const sentStatus = delivery.testMode ? AUFSCHALTUNG_AUTO_REPLY_CONFIG.STATUS_TEST_SENT : AUFSCHALTUNG_AUTO_REPLY_CONFIG.STATUS_SENT;
      const sentReason = delivery.testMode
        ? "TESTMODUS: AutoReply an Testadresse gesendet. Erkannte Kundenadresse waere: " + recipient.email
        : "Aufschaltungs-AutoReply gesendet.";
      aufschaltungSetStatus_(
        sheet,
        columns,
        rowNumber,
        sentStatus,
        delivery.email,
        sentReason,
        recipient.source,
        recipient.email
      );
      aufschaltungPushAutoReplyDetail_(details, rowNumber, row, sentStatus, delivery.email, sentReason, recipient.source, recipient.email);
      alreadyRepliedKeys.add(duplicateKey);
      sent += 1;
      Logger.log(
        "Aufschaltungs-AutoReply gesendet fuer Zeile "
        + rowNumber
        + " an "
        + delivery.email
        + (delivery.testMode ? " (Testmodus, erkannt: " + recipient.email + ")" : "")
      );
    } catch (error) {
      const reason = String(error && error.message ? error.message : error);
      aufschaltungSetStatus_(
        sheet,
        columns,
        rowNumber,
        AUFSCHALTUNG_AUTO_REPLY_CONFIG.STATUS_ERROR,
        "",
        reason,
        "exception",
        ""
      );
      aufschaltungPushAutoReplyDetail_(details, rowNumber, row, AUFSCHALTUNG_AUTO_REPLY_CONFIG.STATUS_ERROR, "", reason, "exception", "");
      Logger.log("Aufschaltungs-AutoReply Fehler in Zeile " + rowNumber + ": " + error);
    }
  }

  Logger.log(
    "Aufschaltungs-AutoReply Lauf beendet: geprueft="
    + processed
    + ", sent="
    + sent
    + ", skipped="
    + skipped
    + ", review="
    + review
  );
  if (details.length) {
    Logger.log("Aufschaltungs-AutoReply Details: " + JSON.stringify(details));
  }

  return {
    checked: processed,
    sent: sent,
    skipped: skipped,
    review: review,
    details: details
  };
}

function aufschaltungBuildAlreadyRepliedKeySet_(values, columns) {
  const keys = new Set();

  values.forEach(function(rowValues) {
    const row = aufschaltungBuildRowObject_(rowValues, columns);
    if (aufschaltungIsCodyTestRow_(row)) {
      return;
    }

    const status = String(rowValues[columns.AufschaltungAutoReplyStatus] || "").trim().toLowerCase();
    if (!aufschaltungStatusCountsAsAlreadyReplied_(status)) {
      return;
    }

    const email = aufschaltungExtractAlreadyRepliedEmailFromValues_(rowValues, columns);
    if (email) {
      keys.add(aufschaltungBuildDuplicateReplyKey_(row, email));
    }
  });

  return keys;
}

function aufschaltungIsCodyTestRow_(row) {
  const messageId = String(row.MessageId || "");
  if (messageId.indexOf("cody-generated-aufschaltung-routing-test:") === 0) {
    return true;
  }

  const haystack = aufschaltungNormalizeComparable_([
    row.Subject,
    row.BodyPreview,
    row.BodyTextFull
  ].join(" "));

  return haystack.indexOf("cody e2e trigger test") !== -1
    || haystack.indexOf("cody routing test") !== -1
    || (
      haystack.indexOf("technischer test") !== -1
      && haystack.indexOf("cody testkunde") !== -1
    );
}

function aufschaltungStatusCountsAsAlreadyReplied_(status) {
  if (status === AUFSCHALTUNG_AUTO_REPLY_CONFIG.STATUS_SENT) {
    return true;
  }

  return aufschaltungGetDeliveryMode_() === "test"
    && status === AUFSCHALTUNG_AUTO_REPLY_CONFIG.STATUS_TEST_SENT;
}

function aufschaltungExtractAlreadyRepliedEmailFromValues_(rowValues, columns) {
  if ("AufschaltungAutoReplyDetectedCustomerEmail" in columns) {
    const detected = aufschaltungNormalizeEmail_(rowValues[columns.AufschaltungAutoReplyDetectedCustomerEmail]);
    if (detected) {
      return detected;
    }
  }

  if ("AufschaltungAutoReplyReason" in columns) {
    const reasonEmail = aufschaltungExtractEmailFromStatusReason_(rowValues[columns.AufschaltungAutoReplyReason]);
    if (reasonEmail) {
      return reasonEmail;
    }
  }

  if ("AufschaltungAutoReplyTo" in columns) {
    const toEmail = aufschaltungNormalizeEmail_(rowValues[columns.AufschaltungAutoReplyTo]);
    const testEmail = aufschaltungNormalizeEmail_(AUFSCHALTUNG_AUTO_REPLY_CONFIG.TEST_RECIPIENT_EMAIL);
    if (toEmail && toEmail !== testEmail) {
      return toEmail;
    }
  }

  return "";
}

function aufschaltungBuildDuplicateReplyKey_(row, email) {
  const normalizedEmail = aufschaltungNormalizeEmail_(email);
  const hubId = aufschaltungExtractHubId_(aufschaltungGetBestBodyText_(row));
  if (hubId) {
    return normalizedEmail + "|hub:" + hubId;
  }

  const messageId = String(row && row.MessageId ? row.MessageId : "").trim().toLowerCase();
  if (messageId) {
    return normalizedEmail + "|message:" + messageId;
  }

  return normalizedEmail + "|subject:" + String(row && row.Subject ? row.Subject : "").trim().toLowerCase();
}

function aufschaltungExtractHubId_(body) {
  const match = String(body || "").match(/\bhub\s*id\s*[:#-]?\s*([A-Z0-9_-]{4,})/i);
  return match && match[1] ? match[1].toUpperCase() : "";
}

function aufschaltungExtractEmailFromStatusReason_(reason) {
  const matches = String(reason || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  for (let i = 0; i < matches.length; i += 1) {
    const email = aufschaltungNormalizeEmail_(matches[i]);
    if (email && aufschaltungIsAllowedRecipient_(email)) {
      return email;
    }
  }
  return "";
}

function aufschaltungGetSheet_() {
  const spreadsheet = SpreadsheetApp.openById(aufschaltungGetSheetId_());
  const sheet = spreadsheet.getSheetByName(AUFSCHALTUNG_AUTO_REPLY_CONFIG.SHEET_NAME);
  if (!sheet) {
    throw new Error("Exchange-Sheet nicht gefunden: " + AUFSCHALTUNG_AUTO_REPLY_CONFIG.SHEET_NAME);
  }
  return sheet;
}

function aufschaltungGetSheetId_() {
  const props = PropertiesService.getScriptProperties();
  const fromProps = props.getProperty(AUFSCHALTUNG_AUTO_REPLY_CONFIG.SHEET_ID_PROPERTY);
  const sheetId = String(fromProps || AUFSCHALTUNG_AUTO_REPLY_CONFIG.SHEET_ID || "").trim();
  if (!sheetId || sheetId === "PASTE_GOOGLE_SHEET_ID_HERE") {
    throw new Error("Bitte Script Property AUFSCHALTUNG_SHEET_ID mit der Google-Sheet-ID setzen.");
  }
  return sheetId;
}

function aufschaltungEnsureHeaders_(sheet) {
  const lastColumn = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function(header) {
    return String(header || "").trim();
  });

  AUFSCHALTUNG_AUTO_REPLY_CONFIG.STATUS_HEADERS.forEach(function(header) {
    if (headers.indexOf(header) === -1) {
      headers.push(header);
      sheet.getRange(1, headers.length).setValue(header);
    }
  });

  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(header) {
    return String(header || "").trim();
  });
}

function aufschaltungHeaderIndex_(headers) {
  return headers.reduce(function(map, header, index) {
    if (header) {
      map[header] = index;
    }
    return map;
  }, {});
}

function aufschaltungAssertRequiredColumns_(columns) {
  ["MessageId", "ReceivedTime", "FromEmail", "Subject"].forEach(function(header) {
    if (!(header in columns)) {
      throw new Error("Pflichtspalte fehlt im Exchange-Sheet: " + header);
    }
  });
}

function aufschaltungBuildRowObject_(values, columns) {
  return Object.keys(columns).reduce(function(row, key) {
    row[key] = values[columns[key]];
    return row;
  }, {});
}

function aufschaltungIsAfterStart_(row) {
  const startAfter = new Date(AUFSCHALTUNG_AUTO_REPLY_CONFIG.START_AFTER_ISO);
  const received = new Date(String(row.ReceivedTime || row.ImportedAt || ""));
  if (isNaN(received.getTime()) || isNaN(startAfter.getTime())) {
    return true;
  }
  return received >= startAfter;
}

function aufschaltungMatchesRequiredKeywords_(row) {
  const required = AUFSCHALTUNG_AUTO_REPLY_CONFIG.REQUIRED_KEYWORDS || [];
  if (!required.length) {
    return true;
  }

  const haystack = aufschaltungNormalizeComparable_([
    row.FromName,
    row.FromEmail,
    row.Subject,
    row.BodyPreview,
    row.BodyTextFull,
    row.BodyLinks
  ].join(" "));

  return required.some(function(keyword) {
    return haystack.indexOf(aufschaltungNormalizeComparable_(keyword)) !== -1;
  });
}

function aufschaltungExtractCustomerEmailFromRow_(row) {
  const bodyText = aufschaltungGetBestBodyText_(row);
  const explicit = aufschaltungExtractExplicitCustomerEmail_(bodyText);
  if (explicit) {
    return {
      email: explicit,
      source: "body-field"
    };
  }

  return {
    email: "",
    source: "",
    reason: "Keine sichere Kundenadresse im Feld E-Mail-Adresse der Ajax-Aufschaltung erkannt."
  };
}

function aufschaltungGetBestBodyText_(row) {
  const html = aufschaltungGetBodyHtml_(row);
  const htmlText = html ? aufschaltungStripHtml_(html) : "";
  const sheetText = String(row.BodyTextFull || row.BodyPreview || "");
  return htmlText && htmlText.length > sheetText.length ? htmlText : sheetText;
}

function aufschaltungGetBodyHtml_(row) {
  const inlineHtml = String(row.BodyHtml || "");
  if (inlineHtml) {
    return inlineHtml;
  }

  return aufschaltungReadDriveTextFromLinks_(row.BodyHtmlLink);
}

function aufschaltungReadDriveTextFromLinks_(linksText) {
  const links = String(linksText || "").split(/\s+/).filter(Boolean);

  for (let i = 0; i < links.length; i += 1) {
    const fileId = aufschaltungExtractDriveFileIdFromUrl_(links[i]);
    if (!fileId) {
      continue;
    }

    try {
      return DriveApp.getFileById(fileId).getBlob().getDataAsString("UTF-8");
    } catch (error) {
      Logger.log("Konnte Aufschaltungs-HTML aus Drive nicht lesen: " + error);
    }
  }

  return "";
}

function aufschaltungExtractDriveFileIdFromUrl_(url) {
  const value = String(url || "");
  const fileMatch = value.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch && fileMatch[1]) {
    return fileMatch[1];
  }

  const idMatch = value.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return idMatch && idMatch[1] ? idMatch[1] : "";
}

function aufschaltungExtractExplicitCustomerEmail_(body) {
  const plainBody = String(body || "");
  const emailAddressLabel = "(?:e[\\s-]*mail|email|mail)(?:[\\s-]*(?:adresse|address))?";
  const fieldPatterns = [
    new RegExp("^[ \\t]*" + emailAddressLabel + "\\s*:\\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,})", "im"),
    new RegExp("^[ \\t]*(?:kunden|kunde|customer|kontakt|ansprechpartner)[^\\n:]{0,70}" + emailAddressLabel + "\\s*:\\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,})", "im"),
    new RegExp("^[ \\t]*" + emailAddressLabel + "[^\\n:]{0,70}(?:kunden|kunde|customer|kontakt|ansprechpartner)\\s*:\\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,})", "im")
  ];

  for (let i = 0; i < fieldPatterns.length; i += 1) {
    const match = plainBody.match(fieldPatterns[i]);
    if (match && match[1]) {
      const email = aufschaltungNormalizeEmail_(match[1]);
      if (aufschaltungIsAllowedRecipient_(email)) {
        return email;
      }
    }
  }

  return "";
}

function aufschaltungExtractFallbackEmail_(body) {
  const matches = String(body || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  for (let i = 0; i < matches.length; i += 1) {
    const email = aufschaltungNormalizeEmail_(matches[i]);
    if (aufschaltungIsAllowedRecipient_(email)) {
      return email;
    }
  }
  return "";
}

function aufschaltungIsAllowedRecipient_(email) {
  const normalized = aufschaltungNormalizeEmail_(email);
  if (!normalized || normalized.indexOf("@") === -1) {
    return false;
  }

  if (normalized === aufschaltungNormalizeEmail_(AUFSCHALTUNG_AUTO_REPLY_CONFIG.GENERATED_TEST_CUSTOMER_EMAIL)) {
    return true;
  }

  const parts = normalized.split("@");
  const local = parts[0];
  const domain = parts[1];

  if (AUFSCHALTUNG_AUTO_REPLY_CONFIG.INTERNAL_DOMAINS.indexOf(domain) !== -1) {
    return false;
  }

  return !AUFSCHALTUNG_AUTO_REPLY_CONFIG.BLOCKED_LOCAL_PARTS.some(function(part) {
    return local === part || local.indexOf(part + ".") === 0 || local.indexOf(part + "-") === 0;
  });
}

function aufschaltungBuildAutoReplyMail_() {
  const textBody = [
    "Guten Tag,",
    "",
    "vielen Dank fuer Ihre Anfrage bei Sicherheit Nord.",
    "Bitte fuellen Sie das Aufschaltformular vollstaendig aus, damit wir Ihre Anfrage weiterbearbeiten koennen.",
    "",
    "Oeffnen Sie das Formular dafuer einfach ueber den folgenden Link:",
    "",
    "<" + AUFSCHALTUNG_AUTO_REPLY_CONFIG.FORM_LINK + ">",
    "",
    "Falls Sie diese Anfrage nicht gestellt haben, koennen Sie diese E-Mail ignorieren.",
    "",
    "Mit freundlichen Gruessen",
    "Sicherheit Nord"
  ].join("\n");

  const htmlBody = [
    "<!doctype html>",
    '<html lang="de">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "</head>",
    '<body style="margin:0;padding:0;background:#2b5f70;color:#1f2937;font-family:Arial,sans-serif;">',
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Bitte füllen Sie das Aufschaltformular aus, damit wir Ihre Anfrage weiterbearbeiten können.</div>',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background:#2b5f70;">',
    "<tr>",
    '<td align="center" style="padding:24px 12px 28px;background:linear-gradient(180deg,#346f82,#234f60);">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:592px;">',
    "<tr>",
    '<td style="background:#ffffff;border:1px solid #d7e0ea;border-radius:22px;box-shadow:0 12px 34px rgba(17,35,56,0.12);overflow:hidden;">',
    '<div style="padding:14px 24px 10px;text-align:center;background:#fbfdff;border-bottom:1px solid #e3ebf3;">',
    '<img src="' + AUFSCHALTUNG_AUTO_REPLY_CONFIG.LOGO_URL + '" alt="Sicherheit Nord Logo" width="164" style="display:block;width:164px;max-width:66%;height:auto;margin:0 auto 6px;border:0;">',
    "</div>",
    '<div style="padding:22px 24px 22px;">',
    '<div style="width:84px;height:3px;margin:0 auto 12px;border-radius:999px;background:#0a84ff;"></div>',
    '<h1 style="margin:0 0 10px;color:#11283f;font-size:28px;line-height:1.08;font-weight:700;text-align:center;">Aufschaltformular</h1>',
    '<p style="margin:0 0 18px;color:#233f5f;font-size:15px;line-height:1.55;text-align:center;">Ihre Anfrage ist bei Sicherheit Nord eingegangen.</p>',
    '<p style="margin:0 0 12px;color:#22384f;font-size:15px;line-height:1.65;">Guten Tag,</p>',
    '<p style="margin:0 0 12px;color:#22384f;font-size:15px;line-height:1.65;">vielen Dank für Ihre Anfrage bei Sicherheit Nord.</p>',
    '<p style="margin:0 0 18px;color:#22384f;font-size:15px;line-height:1.65;">Für die weitere Bearbeitung öffnen Sie bitte das Aufschaltformular über den folgenden Button.</p>',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 18px;">',
    "<tr>",
    '<td align="center" bgcolor="#0a84ff" style="border-radius:999px;box-shadow:0 10px 20px rgba(10,132,255,0.24);">',
    '<a href="' + AUFSCHALTUNG_AUTO_REPLY_CONFIG.FORM_LINK + '" style="display:inline-block;padding:13px 22px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">Zum Aufschaltformular</a>',
    "</td>",
    "</tr>",
    "</table>",
    '<p style="margin:0 0 4px;color:#6a7d93;font-size:12px;line-height:1.55;text-align:center;">Falls der Button nicht funktioniert:</p>',
    '<p style="margin:0 0 18px;text-align:center;"><a href="' + AUFSCHALTUNG_AUTO_REPLY_CONFIG.FORM_LINK + '" style="color:#4a6f95;text-decoration:none;font-size:12px;line-height:1.65;">Direkter Link zum Formular</a></p>',
    '<p style="margin:0;color:#22384f;font-size:15px;line-height:1.65;">Mit freundlichen Grüßen<br><strong>Sicherheit Nord</strong></p>',
    "</div>",
    "</td>",
    "</tr>",
    "</table>",
    "</td>",
    "</tr>",
    "</table>",
    "</body>",
    "</html>"
  ].join("");

  return {
    textBody: textBody,
    htmlBody: htmlBody
  };
}

function aufschaltungSendAutoReply_(customerEmail, mail) {
  const options = {
    name: AUFSCHALTUNG_AUTO_REPLY_CONFIG.SENDER_NAME
  };

  if (AUFSCHALTUNG_AUTO_REPLY_CONFIG.FROM_ALIAS) {
    const aliases = GmailApp.getAliases();
    if (aliases.indexOf(AUFSCHALTUNG_AUTO_REPLY_CONFIG.FROM_ALIAS) !== -1) {
      options.from = AUFSCHALTUNG_AUTO_REPLY_CONFIG.FROM_ALIAS;
    } else {
      Logger.log("FROM_ALIAS nicht als Gmail-Alias verfuegbar, sende vom Standardkonto: " + AUFSCHALTUNG_AUTO_REPLY_CONFIG.FROM_ALIAS);
    }
  }

  if (AUFSCHALTUNG_AUTO_REPLY_CONFIG.REPLY_TO_EMAIL) {
    options.replyTo = AUFSCHALTUNG_AUTO_REPLY_CONFIG.REPLY_TO_EMAIL;
  }

  if (AUFSCHALTUNG_AUTO_REPLY_CONFIG.USE_HTML_EMAIL) {
    options.htmlBody = mail.htmlBody;
  }

  GmailApp.sendEmail(customerEmail, AUFSCHALTUNG_AUTO_REPLY_CONFIG.SUBJECT, mail.textBody, options);
}

function aufschaltungResolveDeliveryRecipient_(detectedRecipient) {
  if (aufschaltungGetDeliveryMode_() === "test") {
    const testRecipient = aufschaltungNormalizeEmail_(AUFSCHALTUNG_AUTO_REPLY_CONFIG.TEST_RECIPIENT_EMAIL);
    if (!testRecipient) {
      throw new Error("TEST_MODE_ENABLED ist aktiv, aber TEST_RECIPIENT_EMAIL ist leer.");
    }

    return {
      email: testRecipient,
      testMode: true,
      detectedRecipient: detectedRecipient
    };
  }

  return {
    email: detectedRecipient,
    testMode: false,
    detectedRecipient: detectedRecipient
  };
}

function aufschaltungGetDeliveryMode_() {
  const propMode = String(
    PropertiesService.getScriptProperties().getProperty(AUFSCHALTUNG_AUTO_REPLY_CONFIG.DELIVERY_MODE_PROPERTY) || ""
  ).trim().toLowerCase();

  if (propMode === "test" || propMode === "live") {
    return propMode;
  }

  return AUFSCHALTUNG_AUTO_REPLY_CONFIG.TEST_MODE_ENABLED ? "test" : "live";
}

function aufschaltungBuildGeneratedAjaxTestBody_(customerEmail, dateValue) {
  const timestamp = Utilities.formatDate(
    dateValue,
    Session.getScriptTimeZone() || "Europe/Berlin",
    "EEEE, dd. MMMM yyyy HH:mm:ss"
  );

  return [
    "Von: Ajax Team",
    "Gesendet: " + timestamp + " (UTC+01:00) Amsterdam, Berlin, Bern, Rom, Stockholm, Wien",
    "An: Dennis Gessert",
    "Betreff: NSL-Aufschaltungsanfrage",
    "",
    "AKTUELLE WARNUNG: Vorsicht vor Phishing-E-Mails! - Alle empfangenden E-Mails auf Echtheit pruefen, da u.U. Fake-Adressen (Identitaetsdiebstahl!) verwendet werden ODER bekannte Absender Opfer eines Hackings/Cyberangriffs geworden sind! Im Zweifelsfall nicht antworten, keinen Link anklicken, keine Anhaenge oeffnen UND den Datenschutzbeauftragten informieren (datenschutz@wachdienst.de) !",
    "",
    "",
    "Hallo!",
    "Der Benutzer Cody Routing Test moechte sein Sicherheitssystem (Cody Testobjekt hub ID 00C0DY01) mit Ihrer Ueberwachungszentrale verbinden und hat folgende Kontaktdaten bereitgestellt, um die Details mit Ihnen zu besprechen.",
    "",
    "E-Mail-Adresse: " + customerEmail,
    "Telefonnummer: +491744943000",
    "Name: Cody Routing Test"
  ].join("\n");
}

function aufschaltungResetGeneratedRoutingTestRows_(sheet, columns) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1 || !("MessageId" in columns) || !("AufschaltungAutoReplyStatus" in columns)) {
    return;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  values.forEach(function(rowValues, index) {
    const messageId = String(rowValues[columns.MessageId] || "");
    if (messageId.indexOf("cody-generated-aufschaltung-routing-test:") !== 0) {
      return;
    }

    const rowNumber = index + 2;
    sheet.getRange(rowNumber, columns.AufschaltungAutoReplyStatus + 1).setValue(AUFSCHALTUNG_AUTO_REPLY_CONFIG.STATUS_SKIPPED);
    if ("AufschaltungAutoReplyReason" in columns) {
      sheet.getRange(rowNumber, columns.AufschaltungAutoReplyReason + 1).setValue("Alter generierter Cody-Routing-Test deaktiviert, damit ein neuer Routing-Test moeglich ist.");
    }
  });
}

function aufschaltungSetStatus_(sheet, columns, rowNumber, status, recipient, reason, source, detectedCustomerEmail) {
  const now = new Date().toISOString();
  sheet.getRange(rowNumber, columns.AufschaltungAutoReplyStatus + 1).setValue(status);
  sheet.getRange(rowNumber, columns.AufschaltungAutoReplyProcessedAt + 1).setValue(now);
  sheet.getRange(rowNumber, columns.AufschaltungAutoReplyTo + 1).setValue(recipient || "");
  if ("AufschaltungAutoReplyDetectedCustomerEmail" in columns) {
    sheet.getRange(rowNumber, columns.AufschaltungAutoReplyDetectedCustomerEmail + 1).setValue(detectedCustomerEmail || "");
  }
  sheet.getRange(rowNumber, columns.AufschaltungAutoReplyReason + 1).setValue(aufschaltungTruncate_(reason || "", 1000));
  sheet.getRange(rowNumber, columns.AufschaltungAutoReplySource + 1).setValue(source || "");
}

function aufschaltungPushAutoReplyDetail_(details, rowNumber, row, status, recipient, reason, source, detectedCustomerEmail) {
  if (!Array.isArray(details) || details.length >= 25) {
    return;
  }

  details.push({
    row: rowNumber,
    status: String(status || ""),
    recipient: aufschaltungNormalizeEmail_(recipient || ""),
    detectedCustomerEmail: aufschaltungNormalizeEmail_(detectedCustomerEmail || ""),
    reason: aufschaltungTruncate_(reason || "", 500),
    source: String(source || ""),
    subject: aufschaltungTruncate_(row && row.Subject ? row.Subject : "", 180),
    fromEmail: aufschaltungNormalizeEmail_(row && row.FromEmail ? row.FromEmail : ""),
    receivedTime: String(row && row.ReceivedTime ? row.ReceivedTime : "")
  });
}

function aufschaltungStripHtml_(value) {
  return String(value || "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:p|div|tr|table|tbody|thead|tfoot|ul|ol|li|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<\/?(?:td|th)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function aufschaltungNormalizeEmail_(value) {
  return String(value || "")
    .trim()
    .replace(/^<|>$/g, "")
    .toLowerCase();
}

function aufschaltungNormalizeComparable_(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\u00e4/g, "ae")
    .replace(/\u00f6/g, "oe")
    .replace(/\u00fc/g, "ue")
    .replace(/\u00df/g, "ss")
    .replace(/[^a-z0-9@.\-\/\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aufschaltungTruncate_(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars) + " [... gekuerzt, insgesamt " + text.length + " Zeichen]";
}

function aufschaltungRemoveTriggersForFunction_(functionName) {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction && trigger.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function aufschaltungBridgeIsRequest_(e) {
  try {
    const payload = aufschaltungBridgeParsePayload_(e);
    return Boolean(payload && payload.token && Array.isArray(payload.messages));
  } catch (error) {
    return false;
  }
}

function aufschaltungBridgeDoPost_(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const props = PropertiesService.getScriptProperties();
    const expectedToken = props.getProperty("AUFSCHALTUNG_BRIDGE_TOKEN");
    const sheetId = props.getProperty("AUFSCHALTUNG_SHEET_ID");
    const sheetName = props.getProperty("AUFSCHALTUNG_SHEET_NAME") || AUFSCHALTUNG_AUTO_REPLY_CONFIG.SHEET_NAME;

    if (!expectedToken || !sheetId || expectedToken === "PASTE_LONG_RANDOM_TOKEN_HERE") {
      return aufschaltungBridgeJsonResponse_({
        ok: false,
        error: "Missing AUFSCHALTUNG_SHEET_ID or AUFSCHALTUNG_BRIDGE_TOKEN in Script Properties."
      }, 500);
    }

    const payload = aufschaltungBridgeParsePayload_(e);
    if (payload.token !== expectedToken) {
      return aufschaltungBridgeJsonResponse_({
        ok: false,
        error: "Unauthorized."
      }, 401);
    }

    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const sheet = aufschaltungBridgeGetOrCreateSheet_(sheetId, sheetName);
    const headers = aufschaltungBridgeEnsureHeader_(sheet);
    const columns = aufschaltungBridgeColumnMap_(headers);
    const existingRows = aufschaltungBridgeExistingIdRows_(sheet);
    const now = new Date().toISOString();
    const rows = [];
    const updates = [];
    let skipped = 0;
    let updated = 0;

    messages.forEach(function(message) {
      const messageId = aufschaltungBridgeClean_(message.id);
      if (!messageId) {
        skipped += 1;
        return;
      }

      const rowNumber = existingRows.get(messageId);
      const existingAttachmentLinks = rowNumber && columns.AttachmentLinks
        ? aufschaltungBridgeClean_(sheet.getRange(rowNumber, columns.AttachmentLinks).getValue())
        : "";
      const hasStaleAttachmentLinks = Boolean(existingAttachmentLinks) && !aufschaltungBridgeValidLinks_(existingAttachmentLinks);
      const savedAttachmentLinks = hasStaleAttachmentLinks ? "" : existingAttachmentLinks;
      const attachmentLinks = savedAttachmentLinks || aufschaltungBridgeSaveAttachments_(message, props);
      const existingBodyHtmlLink = rowNumber && columns.BodyHtmlLink
        ? aufschaltungBridgeClean_(sheet.getRange(rowNumber, columns.BodyHtmlLink).getValue())
        : "";
      const hasStaleBodyHtmlLink = Boolean(existingBodyHtmlLink) && !aufschaltungBridgeValidLinks_(existingBodyHtmlLink);
      const savedBodyHtmlLink = hasStaleBodyHtmlLink ? "" : existingBodyHtmlLink;
      const bodyHtmlLink = savedBodyHtmlLink || aufschaltungBridgeSaveBodyHtml_(message, props);
      const row = aufschaltungBridgeBuildRow_(message, attachmentLinks, bodyHtmlLink, now);

      if (rowNumber) {
        if (
          aufschaltungBridgeHasEnrichment_(message)
          || attachmentLinks
          || bodyHtmlLink
          || hasStaleAttachmentLinks
          || hasStaleBodyHtmlLink
        ) {
          updates.push({
            rowNumber: rowNumber,
            row: row
          });
          updated += 1;
        } else {
          skipped += 1;
        }
        return;
      }

      existingRows.set(messageId, sheet.getLastRow() + rows.length + 1);
      rows.push(row);
    });

    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }

    updates.forEach(function(update) {
      sheet.getRange(update.rowNumber, 1, 1, update.row.length).setValues([update.row]);
    });

    let autoReply = {
      triggered: false
    };

    if (rows.length > 0 || updated > 0) {
      try {
        autoReply = Object.assign(
          {
            triggered: true
          },
          processAufschaltungExchangeSheetAutoReplies_()
        );
      } catch (autoReplyError) {
        autoReply = {
          triggered: true,
          ok: false,
          error: String(autoReplyError && autoReplyError.message ? autoReplyError.message : autoReplyError)
        };
      }
    }

    return aufschaltungBridgeJsonResponse_({
      ok: true,
      appended: rows.length,
      updated: updated,
      skipped: skipped,
      autoReply: autoReply
    });
  } catch (error) {
    return aufschaltungBridgeJsonResponse_({
      ok: false,
      error: String(error && error.message ? error.message : error)
    }, 500);
  } finally {
    lock.releaseLock();
  }
}

function aufschaltungBridgeParsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error("Missing JSON body.");
  }
  return JSON.parse(e.postData.contents);
}

function aufschaltungBridgeGetOrCreateSheet_(sheetId, sheetName) {
  const spreadsheet = SpreadsheetApp.openById(sheetId);
  return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
}

function aufschaltungBridgeEnsureHeader_(sheet) {
  const headers = [
    "MessageId",
    "ReceivedTime",
    "FromName",
    "FromEmail",
    "Subject",
    "BodyPreview",
    "HasAttachments",
    "AttachmentCount",
    "AttachmentNames",
    "AttachmentLinks",
    "BodyImageUrls",
    "BodyHtmlLink",
    "BodyLinks",
    "BodyTextFull",
    "ConversationId",
    "WebLink",
    "ImportedAt"
  ];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    return headers;
  }

  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (current[0] === "MessageId") {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return headers;
  }

  const isHeaderPresent = headers.every(function(header, index) {
    return current[index] === header;
  });

  if (!isHeaderPresent) {
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  return headers;
}

function aufschaltungBridgeColumnMap_(headers) {
  return headers.reduce(function(columns, header, index) {
    columns[header] = index + 1;
    return columns;
  }, {});
}

function aufschaltungBridgeExistingIdRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return new Map();
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const rows = new Map();
  values.forEach(function(row, index) {
    const messageId = String(row[0] || "");
    if (messageId) {
      rows.set(messageId, index + 2);
    }
  });
  return rows;
}

function aufschaltungBridgeBuildRow_(message, attachmentLinks, bodyHtmlLink, importedAt) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  return [
    aufschaltungBridgeClean_(message.id),
    aufschaltungBridgeClean_(message.receivedTime),
    aufschaltungBridgeClean_(message.fromName),
    aufschaltungBridgeClean_(message.fromEmail),
    aufschaltungBridgeClean_(message.subject),
    aufschaltungBridgeClean_(message.bodyPreview),
    Boolean(message.hasAttachments || attachments.length > 0),
    Number(message.attachmentCount || attachments.length || 0),
    aufschaltungBridgeClean_(aufschaltungBridgeAttachmentNames_(attachments)),
    aufschaltungBridgeClean_(attachmentLinks),
    aufschaltungBridgeClean_(aufschaltungBridgeBodyImageUrls_(message)),
    aufschaltungBridgeClean_(bodyHtmlLink),
    aufschaltungBridgeClean_(aufschaltungBridgeBodyLinks_(message)),
    aufschaltungBridgeClean_(message.bodyTextFull),
    aufschaltungBridgeClean_(message.conversationId),
    aufschaltungBridgeClean_(message.webLink),
    importedAt
  ];
}

function aufschaltungBridgeHasEnrichment_(message) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const bodyImageUrls = Array.isArray(message.bodyImageUrls) ? message.bodyImageUrls : [];
  const bodyLinks = Array.isArray(message.bodyLinks) ? message.bodyLinks : [];
  return attachments.length > 0
    || bodyImageUrls.length > 0
    || bodyLinks.length > 0
    || Boolean(message.bodyHtml)
    || Boolean(message.bodyTextFull)
    || Number(message.attachmentCount || 0) > 0;
}

function aufschaltungBridgeSaveAttachments_(message, props) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (!attachments.length) {
    return "";
  }

  const folderName = props.getProperty("AUFSCHALTUNG_ATTACHMENT_FOLDER_NAME") || "Aufschaltung Exchange Mail Attachments";
  const folder = aufschaltungBridgeGetOrCreateDriveFolder_(folderName);
  const links = [];

  attachments.forEach(function(attachment, index) {
    if (!attachment.base64) {
      return;
    }

    const safeMessageId = aufschaltungBridgeClean_(message.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "message";
    const safeName = aufschaltungBridgeClean_(attachment.name || ("attachment-" + (index + 1))).replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
    const fileName = safeMessageId + "_" + (index + 1) + "_" + safeName;
    const bytes = Utilities.base64Decode(attachment.base64);
    const blob = Utilities.newBlob(bytes, aufschaltungBridgeClean_(attachment.contentType) || MimeType.BINARY, fileName);
    const file = folder.createFile(blob);
    links.push(file.getUrl());
  });

  return links.join("\n");
}

function aufschaltungBridgeSaveBodyHtml_(message, props) {
  const html = aufschaltungBridgeCleanLarge_(message.bodyHtml, 200000);
  if (!html) {
    return "";
  }

  const folderName = props.getProperty("AUFSCHALTUNG_BODY_FOLDER_NAME") || "Aufschaltung Exchange Mail Bodies";
  const folder = aufschaltungBridgeGetOrCreateDriveFolder_(folderName);
  const safeMessageId = aufschaltungBridgeClean_(message.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "message";
  const safeSubject = aufschaltungBridgeClean_(message.subject || "mail-body").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "mail-body";
  const fileName = safeMessageId + "_" + safeSubject + ".html";
  const file = folder.createFile(fileName, html, MimeType.HTML);
  return file.getUrl();
}

function aufschaltungBridgeValidLinks_(value) {
  const text = aufschaltungBridgeClean_(value);
  if (!text) {
    return false;
  }
  return text.split(/\s+/).some(function(part) {
    return /^https?:\/\//i.test(part);
  });
}

function aufschaltungBridgeGetOrCreateDriveFolder_(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(folderName);
}

function aufschaltungBridgeAttachmentNames_(attachments) {
  return attachments.map(function(attachment, index) {
    return [
      "attachment " + (index + 1),
      attachment.name ? "name=" + attachment.name : "",
      attachment.contentType ? "contentType=" + attachment.contentType : "",
      attachment.isInline ? "inline=true" : "",
      attachment.contentId ? "contentId=" + attachment.contentId : "",
      attachment.skippedReason ? "skipped=" + attachment.skippedReason : ""
    ].filter(Boolean).join(" | ");
  }).join("\n");
}

function aufschaltungBridgeBodyImageUrls_(message) {
  const urls = Array.isArray(message.bodyImageUrls) ? message.bodyImageUrls : [];
  return urls.join("\n");
}

function aufschaltungBridgeBodyLinks_(message) {
  const links = Array.isArray(message.bodyLinks) ? message.bodyLinks : [];
  return links.join("\n");
}

function aufschaltungBridgeClean_(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).replace(/\u0000/g, "").slice(0, 50000);
}

function aufschaltungBridgeCleanLarge_(value, limit) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).replace(/\u0000/g, "").slice(0, limit);
}

function aufschaltungBridgeJsonResponse_(payload, statusCode) {
  if (statusCode) {
    payload.statusCode = statusCode;
  }

  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

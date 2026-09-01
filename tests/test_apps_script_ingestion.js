const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPOSITORY_ROOT = path.resolve(__dirname, "..");
const HEADERS = [
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

const VARIANTS = [
  {
    name: "standalone",
    file: "exchange_mail_bridge/apps_script/Code.gs",
    handler: "doPost",
    tokenProperty: "BRIDGE_TOKEN",
    sheetProperty: "SHEET_ID"
  },
  {
    name: "aufschaltung",
    file: "exchange_mail_bridge/apps_script/AufschaltungAutoReply_Code.gs",
    handler: "aufschaltungBridgeDoPost_",
    tokenProperty: "AUFSCHALTUNG_BRIDGE_TOKEN",
    sheetProperty: "AUFSCHALTUNG_SHEET_ID"
  }
];

function message(messageId = "message-1") {
  return {
    id: messageId,
    receivedTime: "2026-09-01T12:00:00.000Z",
    fromName: "Test Sender",
    fromEmail: "sender@example.com",
    subject: "Test message",
    bodyPreview: "Preview",
    hasAttachments: true,
    attachmentCount: 1,
    attachments: [
      {
        name: "attachment.pdf",
        contentType: "application/pdf",
        base64: "YXR0YWNobWVudA=="
      }
    ],
    bodyHtml: "<p>Test body</p>",
    bodyTextFull: "Test body"
  };
}

function existingRow(messageId, attachmentLinks, bodyHtmlLink) {
  return [
    messageId,
    "2026-09-01T12:00:00.000Z",
    "Test Sender",
    "sender@example.com",
    "Test message",
    "Preview",
    true,
    1,
    "attachment 1 | name=attachment.pdf",
    attachmentLinks,
    "",
    bodyHtmlLink,
    "",
    "Test body",
    "",
    "",
    "2026-09-01T12:01:00.000Z"
  ];
}

function createHarness(variant, options = {}) {
  const matrix = (options.rows || [HEADERS]).map((row) => row.slice());
  let dataRowWrites = 0;
  let filesCreated = 0;
  let lockReleased = 0;
  const lockTimeouts = [];

  const sheet = {
    getLastRow() {
      return matrix.length;
    },
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValues() {
          return Array.from({ length: rowCount }, (_, rowOffset) =>
            Array.from({ length: columnCount }, (_, columnOffset) =>
              (matrix[row - 1 + rowOffset] || [])[column - 1 + columnOffset] ?? ""
            )
          );
        },
        getValue() {
          return (matrix[row - 1] || [])[column - 1] ?? "";
        },
        setValues(values) {
          if (row > 1) {
            dataRowWrites += 1;
          }
          values.forEach((valuesRow, rowOffset) => {
            const targetRow = row - 1 + rowOffset;
            matrix[targetRow] = matrix[targetRow] || [];
            valuesRow.forEach((value, columnOffset) => {
              matrix[targetRow][column - 1 + columnOffset] = value;
            });
          });
        }
      };
    },
    appendRow(row) {
      matrix.push(row.slice());
    },
    insertRowBefore(row) {
      matrix.splice(row - 1, 0, []);
    },
    setFrozenRows() {}
  };

  const folder = {
    createFile() {
      filesCreated += 1;
      const fileUrl = filesCreated % 2 === 1
        ? "https://drive.google.com/repaired-attachment"
        : "https://drive.google.com/repaired-body";
      return {
        getUrl() {
          return fileUrl;
        }
      };
    }
  };

  const context = {
    Array,
    Boolean,
    Date,
    Error,
    JSON,
    Map,
    Number,
    Object,
    RegExp,
    Set,
    String,
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput(text) {
        return {
          text,
          setMimeType() {
            return this;
          }
        };
      }
    },
    DriveApp: {
      createFolder() {
        return folder;
      },
      getFoldersByName() {
        return {
          hasNext() {
            return true;
          },
          next() {
            return folder;
          }
        };
      }
    },
    GmailApp: {},
    LockService: {
      getScriptLock() {
        return {
          tryLock(timeoutMilliseconds) {
            lockTimeouts.push(timeoutMilliseconds);
            return options.lockAvailable !== false;
          },
          releaseLock() {
            lockReleased += 1;
          }
        };
      }
    },
    Logger: { log() {} },
    MimeType: {
      BINARY: "application/octet-stream",
      HTML: "text/html"
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(propertyName) {
            if (propertyName === variant.tokenProperty) {
              return "test-secret";
            }
            if (propertyName === variant.sheetProperty) {
              return "test-sheet-id";
            }
            return null;
          }
        };
      }
    },
    ScriptApp: {},
    SpreadsheetApp: {
      openById() {
        return {
          getSheetByName() {
            return sheet;
          },
          insertSheet() {
            return sheet;
          }
        };
      }
    },
    Utilities: {
      base64Decode(value) {
        return value;
      },
      newBlob() {
        return {};
      }
    }
  };

  vm.createContext(context);
  const scriptPath = path.join(REPOSITORY_ROOT, variant.file);
  vm.runInContext(fs.readFileSync(scriptPath, "utf8"), context, {
    filename: scriptPath
  });

  return {
    invoke(messages) {
      const event = {
        postData: {
          contents: JSON.stringify({
            token: "test-secret",
            messages
          })
        }
      };
      const output = context[variant.handler](event);
      return JSON.parse(output.text);
    },
    state() {
      return {
        dataRowWrites,
        filesCreated,
        lockReleased,
        lockTimeouts: lockTimeouts.slice(),
        matrix
      };
    }
  };
}

function testBusyLock(variant) {
  const harness = createHarness(variant, {
    lockAvailable: false,
    rows: [HEADERS]
  });
  const result = harness.invoke([message()]);
  const state = harness.state();

  assert.deepStrictEqual(result, {
    ok: false,
    transient: true,
    error: "script_busy",
    retryAfterSeconds: 5,
    statusCode: 503
  });
  assert.deepStrictEqual(state.lockTimeouts, [1000]);
  assert.strictEqual(state.lockReleased, 0);
  assert.strictEqual(state.dataRowWrites, 0);
  assert.strictEqual(state.filesCreated, 0);
}

function testKnownRowIsSkipped(variant) {
  const harness = createHarness(variant, {
    rows: [
      HEADERS,
      existingRow(
        "message-1",
        "https://drive.google.com/existing-attachment",
        "https://drive.google.com/existing-body"
      )
    ]
  });
  const result = harness.invoke([message()]);
  const state = harness.state();

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.appended, 0);
  assert.strictEqual(result.updated, 0);
  assert.strictEqual(result.skipped, 1);
  assert.strictEqual(state.dataRowWrites, 0);
  assert.strictEqual(state.filesCreated, 0);
  assert.strictEqual(state.lockReleased, 1);
}

function testMissingLinksAreRepaired(variant) {
  const harness = createHarness(variant, {
    rows: [HEADERS, existingRow("message-1", "", "")]
  });
  const result = harness.invoke([message()]);
  const state = harness.state();

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.appended, 0);
  assert.strictEqual(result.updated, 1);
  assert.strictEqual(result.skipped, 0);
  assert.strictEqual(state.dataRowWrites, 1);
  assert.strictEqual(state.filesCreated, 2);
  assert.match(state.matrix[1][9], /^https:\/\//);
  assert.match(state.matrix[1][11], /^https:\/\//);
  assert.strictEqual(state.lockReleased, 1);
}

function testDuplicateExistingRepairRunsOnce(variant) {
  const harness = createHarness(variant, {
    rows: [HEADERS, existingRow("message-1", "", "")]
  });
  const first = message();
  const result = harness.invoke([first, { ...first }]);
  const state = harness.state();

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.appended, 0);
  assert.strictEqual(result.updated, 1);
  assert.strictEqual(result.skipped, 1);
  assert.strictEqual(state.dataRowWrites, 1);
  assert.strictEqual(state.filesCreated, 2);
  assert.strictEqual(state.matrix.length, 2);
  assert.strictEqual(state.lockReleased, 1);
}

function testDuplicateNewRowIsAppendedOnce(variant) {
  const harness = createHarness(variant, { rows: [HEADERS] });
  const first = message("message-new");
  const result = harness.invoke([first, { ...first }]);
  const state = harness.state();

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.appended, 1);
  assert.strictEqual(result.updated, 0);
  assert.strictEqual(result.skipped, 1);
  assert.strictEqual(state.dataRowWrites, 1);
  assert.strictEqual(state.filesCreated, 2);
  assert.strictEqual(state.matrix.length, 2);
  assert.strictEqual(state.matrix[1][0], "message-new");
  assert.strictEqual(state.lockReleased, 1);
}

const tests = [
  testBusyLock,
  testKnownRowIsSkipped,
  testMissingLinksAreRepaired,
  testDuplicateExistingRepairRunsOnce,
  testDuplicateNewRowIsAppendedOnce
];

for (const variant of VARIANTS) {
  for (const test of tests) {
    test(variant);
  }
  process.stdout.write(`Apps Script ingestion tests passed: ${variant.name}\n`);
}

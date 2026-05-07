// =====================================================================
// Gmail 請求書PDF整理スクリプト
// 複数担当者アカウント対応版
//
// 運用想定:
//   各担当者が自分のGoogleアカウントでこのGASをコピーして実行する
//   全員が同じ DRIVE_FOLDER_ID / SPREADSHEET_ID を向く
//   重複チェック: 送信者メールアドレス + ファイル名 + 受信日 が同じものはスキップ
// =====================================================================

var CONFIG = {
  // 保存先DriveフォルダID（全担当者共通。DriveフォルダURLの末尾のID）
  DRIVE_FOLDER_ID: "YOUR_DRIVE_FOLDER_ID_HERE",

  // 一覧記録用スプレッドシートID（全担当者共通）
  SPREADSHEET_ID: "YOUR_SPREADSHEET_ID_HERE",

  // 一覧シート名
  SHEET_NAME: "請求書一覧",

  // Gmail検索クエリ
  GMAIL_QUERY: 'has:attachment filename:pdf (subject:請求書 OR subject:invoice OR subject:Invoice OR subject:INVOICE)',

  // 処理済みラベル名
  PROCESSED_LABEL: "請求書処理済み",

  // 最大処理件数（1回の実行あたり）
  MAX_THREADS: 50,
};

// =====================================================================
// メイン処理
// =====================================================================
function organizeInvoices() {
  var folder = getDriveFolder();
  var sheet = getOrCreateSheet();
  var processedLabel = getOrCreateLabel(CONFIG.PROCESSED_LABEL);
  var currentAccount = Session.getActiveUser().getEmail();

  // スプレッドシートから既存の重複キーを先読みする（API呼び出し最小化）
  var existingKeys = loadExistingKeys(sheet);

  var query = CONFIG.GMAIL_QUERY + ' -label:' + CONFIG.PROCESSED_LABEL;
  var threads = GmailApp.search(query, 0, CONFIG.MAX_THREADS);

  if (threads.length === 0) {
    Logger.log("未処理の請求書メールは見つかりませんでした。");
    return;
  }

  Logger.log("対象スレッド数: " + threads.length + " (実行アカウント: " + currentAccount + ")");

  var newRows = [];

  threads.forEach(function(thread) {
    var messages = thread.getMessages();
    messages.forEach(function(message) {
      var attachments = message.getAttachments();
      attachments.forEach(function(attachment) {
        if (!isPdfAttachment(attachment)) return;

        var dupKey = buildDuplicateKey(
          extractEmail(message.getFrom()),
          attachment.getName(),
          message.getDate()
        );

        if (existingKeys[dupKey]) {
          Logger.log("重複スキップ: " + attachment.getName() + " (" + message.getFrom() + ")");
          return;
        }

        var result = saveAttachmentToDrive(attachment, message, folder, currentAccount);
        if (result) {
          newRows.push(result);
          existingKeys[dupKey] = true; // 同一実行内での重複も防ぐ
          Logger.log("保存完了: " + result.fileName);
        }
      });
    });

    thread.addLabel(processedLabel);
  });

  if (newRows.length > 0) {
    appendToSheet(sheet, newRows);
    Logger.log("一覧に追加した件数: " + newRows.length);
  }
}

// =====================================================================
// PDFをDriveに保存してメタデータを返す
// =====================================================================
function saveAttachmentToDrive(attachment, message, folder, account) {
  try {
    var rawName = attachment.getName();
    var safeName = sanitizeFileName(rawName, message.getDate());

    // Driveの同名ファイルチェック（別アカウントが先に保存済みの場合）
    var existing = folder.getFilesByName(safeName);
    if (existing.hasNext()) {
      Logger.log("Drive既存ファイルをスキップ: " + safeName);
      return null;
    }

    var blob = attachment.copyBlob();
    var file = folder.createFile(blob.setName(safeName));

    return {
      date: Utilities.formatDate(message.getDate(), Session.getScriptTimeZone(), "yyyy/MM/dd"),
      sender: message.getFrom(),
      subject: message.getSubject(),
      fileName: safeName,
      fileUrl: file.getUrl(),
      savedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss"),
      account: account,
    };
  } catch (e) {
    Logger.log("保存エラー (" + attachment.getName() + "): " + e.message);
    return null;
  }
}

// =====================================================================
// 重複チェック用ヘルパー
// =====================================================================

// スプレッドシートの既存行から重複キーのセットを作る
function loadExistingKeys(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  // 列: 受信日(1) 送信者(2) 件名(3) ファイル名(4)
  var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  var keys = {};
  data.forEach(function(row) {
    var date = String(row[0]);
    var senderEmail = extractEmail(String(row[1]));
    var savedName = String(row[3]);
    var originalName = savedName.replace(/^\d{8}_/, ""); // 日付プレフィックスを除去
    keys[buildDuplicateKeyFromParts(date, senderEmail, originalName)] = true;
  });
  return keys;
}

// 重複キーを生成（メール処理時）
function buildDuplicateKey(senderEmail, originalFileName, date) {
  var dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy/MM/dd");
  return buildDuplicateKeyFromParts(dateStr, senderEmail, originalFileName);
}

// 重複キーを生成（既存データ参照時）
function buildDuplicateKeyFromParts(dateStr, senderEmail, fileName) {
  return [dateStr, senderEmail.toLowerCase(), fileName.toLowerCase()].join("|");
}

// "Display Name <email@example.com>" からメールアドレスのみ抽出
function extractEmail(from) {
  var match = from.match(/<(.+?)>/);
  return match ? match[1].toLowerCase() : from.toLowerCase().trim();
}

// =====================================================================
// その他ヘルパー
// =====================================================================

function isPdfAttachment(attachment) {
  var mimeType = attachment.getContentType() || "";
  var name = attachment.getName() || "";
  return mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}

function sanitizeFileName(name, date) {
  var prefix = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyyMMdd") + "_";
  var safe = name.replace(/[\\/:*?"<>|]/g, "_");
  if (!safe.startsWith(prefix)) {
    safe = prefix + safe;
  }
  return safe;
}

function getDriveFolder() {
  try {
    return DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  } catch (e) {
    throw new Error("Driveフォルダが見つかりません。CONFIG.DRIVE_FOLDER_IDを確認してください。\n" + e.message);
  }
}

function getOrCreateLabel(labelName) {
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }
  return label;
}

function getOrCreateSheet() {
  var ss;
  try {
    ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  } catch (e) {
    throw new Error("スプレッドシートが見つかりません。CONFIG.SPREADSHEET_IDを確認してください。\n" + e.message);
  }

  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    var headers = ["受信日", "送信者", "件名", "ファイル名", "DriveリンクURL", "保存日時", "処理アカウント", "仕訳ステータス"];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendToSheet(sheet, rows) {
  rows.forEach(function(row) {
    sheet.appendRow([
      row.date,
      row.sender,
      row.subject,
      row.fileName,
      row.fileUrl,
      row.savedAt,
      row.account,
      "未処理",
    ]);
  });
}

// =====================================================================
// セットアップ補助：初回のみ実行
// DriveフォルダとSpreadsheetを自動生成してIDをログ出力する
// =====================================================================
function setupResources() {
  var folder = DriveApp.createFolder("請求書PDFs");
  Logger.log("Driveフォルダを作成しました。ID: " + folder.getId());
  Logger.log("フォルダURL: " + folder.getUrl());

  var ss = SpreadsheetApp.create("請求書一覧");
  Logger.log("スプレッドシートを作成しました。ID: " + ss.getId());
  Logger.log("スプレッドシートURL: " + ss.getUrl());

  Logger.log("\n【重要】以下のIDを全担当者のCode.gsのCONFIG欄に設定してください:");
  Logger.log("DRIVE_FOLDER_ID: " + folder.getId());
  Logger.log("SPREADSHEET_ID:  " + ss.getId());
  Logger.log("\nDriveフォルダとスプレッドシートを全担当者と共有することを忘れずに。");
}

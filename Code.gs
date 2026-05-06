// =====================================================================
// Gmail 請求書PDF整理スクリプト
// 機能:
//   1. Gmailから請求書PDFを検索
//   2. 指定のDriveフォルダに保存
//   3. スプレッドシートに一覧を記録
// =====================================================================

// ---- 設定 ----
var CONFIG = {
  // 保存先DriveフォルダID（DriveフォルダURLの末尾のID部分を貼り付ける）
  DRIVE_FOLDER_ID: "YOUR_DRIVE_FOLDER_ID_HERE",

  // 一覧記録用スプレッドシートID（スプレッドシートURLのIDを貼り付ける）
  SPREADSHEET_ID: "YOUR_SPREADSHEET_ID_HERE",

  // 一覧シート名
  SHEET_NAME: "請求書一覧",

  // Gmail検索クエリ（請求書に関するメールを絞り込む）
  GMAIL_QUERY: 'has:attachment filename:pdf (subject:請求書 OR subject:invoice OR subject:Invoice OR subject:INVOICE)',

  // 処理済みラベル名（処理済みメールに付けるラベル）
  PROCESSED_LABEL: "請求書処理済み",

  // 最大処理件数（一度の実行で処理するメール数の上限）
  MAX_THREADS: 50,
};

// =====================================================================
// メイン処理：Gmailを検索して請求書PDFをDriveへ保存し一覧を更新
// =====================================================================
function organizeInvoices() {
  var folder = getDriveFolder();
  var sheet = getOrCreateSheet();
  var processedLabel = getOrCreateLabel(CONFIG.PROCESSED_LABEL);

  var query = CONFIG.GMAIL_QUERY + ' -label:' + CONFIG.PROCESSED_LABEL;
  var threads = GmailApp.search(query, 0, CONFIG.MAX_THREADS);

  if (threads.length === 0) {
    Logger.log("未処理の請求書メールは見つかりませんでした。");
    return;
  }

  Logger.log("対象スレッド数: " + threads.length);

  var newRows = [];

  threads.forEach(function(thread) {
    var messages = thread.getMessages();
    messages.forEach(function(message) {
      var attachments = message.getAttachments();
      attachments.forEach(function(attachment) {
        if (!isPdfAttachment(attachment)) return;

        var result = saveAttachmentToDrive(attachment, message, folder);
        if (result) {
          newRows.push(result);
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
// PDFの添付ファイルをDriveに保存し、メタデータを返す
// =====================================================================
function saveAttachmentToDrive(attachment, message, folder) {
  try {
    var rawName = attachment.getName();
    var safeName = sanitizeFileName(rawName, message.getDate());

    // 同名ファイルが既に存在する場合はスキップ
    var existing = folder.getFilesByName(safeName);
    if (existing.hasNext()) {
      Logger.log("既存ファイルをスキップ: " + safeName);
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
    };
  } catch (e) {
    Logger.log("保存エラー (" + attachment.getName() + "): " + e.message);
    return null;
  }
}

// =====================================================================
// ヘルパー関数群
// =====================================================================

function isPdfAttachment(attachment) {
  var mimeType = attachment.getContentType() || "";
  var name = attachment.getName() || "";
  return mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}

function sanitizeFileName(name, date) {
  var prefix = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyyMMdd") + "_";
  // ファイル名に使えない文字を置換
  var safe = name.replace(/[\\/:*?"<>|]/g, "_");
  // 既にプレフィックスが付いている場合は重複を避ける
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
    var headers = ["受信日", "送信者", "件名", "ファイル名", "DriveリンクURL", "保存日時"];
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
    ]);
  });
}

// =====================================================================
// セットアップ補助：スプレッドシートとDriveフォルダを自動生成する
// 初回のみ手動で実行してください
// =====================================================================
function setupResources() {
  // Driveフォルダを作成
  var folder = DriveApp.createFolder("請求書PDFs");
  Logger.log("Driveフォルダを作成しました。ID: " + folder.getId());
  Logger.log("フォルダURL: " + folder.getUrl());

  // スプレッドシートを作成
  var ss = SpreadsheetApp.create("請求書一覧");
  Logger.log("スプレッドシートを作成しました。ID: " + ss.getId());
  Logger.log("スプレッドシートURL: " + ss.getUrl());

  Logger.log("\n以下のIDをCode.gsのCONFIG欄に貼り付けてください:");
  Logger.log("DRIVE_FOLDER_ID: " + folder.getId());
  Logger.log("SPREADSHEET_ID: " + ss.getId());
}

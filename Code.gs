// =====================================================================
// Gmail 請求書PDF整理スクリプト
// 複数担当者アカウント対応版
//
// 運用想定:
//   各担当者が自分のGoogleアカウントでこのGASをコピーして実行する
//   全員が同じ DRIVE_FOLDER_ID / SPREADSHEET_ID を向く
//   重複チェック: PDFのMD5ハッシュ（コンテンツ一致）
//                ファイル名変更・転送経路が違っても同一PDFを検出できる
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

  // 既存のPDFハッシュ一覧をスプレッドシートから先読み
  var existingHashes = loadExistingHashes(sheet);

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

        // ブロブを一度だけ読む（ハッシュ計算とDrive保存で共用）
        var blob = attachment.copyBlob();
        var hash = computePdfHash(blob);

        if (existingHashes[hash]) {
          Logger.log("重複スキップ (ハッシュ一致): " + attachment.getName());
          return;
        }

        var result = saveBlobToDrive(blob, attachment.getName(), message, folder, currentAccount, hash);
        if (result) {
          newRows.push(result);
          existingHashes[hash] = true; // 同一実行内の重複も防ぐ
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
function saveBlobToDrive(blob, originalName, message, folder, account, hash) {
  try {
    var safeName = sanitizeFileName(originalName, message.getDate());
    var file = folder.createFile(blob.setName(safeName));

    return {
      date: Utilities.formatDate(message.getDate(), Session.getScriptTimeZone(), "yyyy/MM/dd"),
      sender: message.getFrom(),
      subject: message.getSubject(),
      fileName: safeName,
      fileUrl: file.getUrl(),
      savedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss"),
      account: account,
      hash: hash,
    };
  } catch (e) {
    Logger.log("保存エラー (" + originalName + "): " + e.message);
    return null;
  }
}

// =====================================================================
// PDFハッシュ（MD5）の計算・管理
// =====================================================================

function computePdfHash(blob) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, blob.getBytes());
  return digest.map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

// スプレッドシートの「PDFハッシュ」列から既存ハッシュを読み込む
function loadExistingHashes(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  // PDFハッシュ列（8列目）だけ取得
  var data = sheet.getRange(2, 8, lastRow - 1, 1).getValues();
  var hashes = {};
  data.forEach(function(row) {
    var h = String(row[0]).trim();
    if (h) hashes[h] = true;
  });
  return hashes;
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
    var headers = ["受信日", "送信者", "件名", "ファイル名", "DriveリンクURL", "保存日時", "処理アカウント", "PDFハッシュ", "仕訳ステータス"];
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
      row.hash,
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

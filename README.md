# Gmail 請求書PDF整理 GAS

GmailからPDF添付の請求書を検索し、指定のGoogle Driveフォルダに保存してスプレッドシートで一覧管理するGoogle Apps Scriptです。

## 機能

- Gmailの添付PDFを自動検出（件名キーワード: 請求書 / invoice）
- 指定のDriveフォルダへ保存（日付プレフィックス付きリネーム）
- スプレッドシートに受信日・送信者・件名・ファイル名・DriveリンクURLを記録
- 処理済みメールに自動でGmailラベルを付与（二重処理防止）
- 同名ファイルが存在する場合はスキップ

## セットアップ手順

### 1. GASプロジェクトを作成する

1. [Google Apps Script](https://script.google.com/) を開く
2. 「新しいプロジェクト」を作成
3. `Code.gs` の内容を貼り付ける
4. 「プロジェクトの設定」→「appsscript.json をエディタで表示する」をONにして `appsscript.json` の内容を貼り付ける

### 2. DriveフォルダとスプレッドシートのIDを取得する

**自動作成する場合（推奨）:**

1. GASエディタで `setupResources` 関数を選択して「実行」
2. ログに表示された `DRIVE_FOLDER_ID` と `SPREADSHEET_ID` をコピー

**手動で既存のものを使う場合:**

- DriveフォルダURL例: `https://drive.google.com/drive/folders/XXXXX` → `XXXXX` がID
- スプレッドシートURL例: `https://docs.google.com/spreadsheets/d/XXXXX/edit` → `XXXXX` がID

### 3. Code.gsのCONFIGを更新する

```js
var CONFIG = {
  DRIVE_FOLDER_ID: "取得したフォルダID",
  SPREADSHEET_ID: "取得したスプレッドシートID",
  // 必要に応じてGMAIL_QUERYも調整
};
```

### 4. 権限を承認して実行する

1. `organizeInvoices` 関数を選択して「実行」
2. Googleアカウントの権限を承認する

### 5. 定期実行を設定する（任意）

1. GASエディタの「トリガー（時計アイコン）」を開く
2. 「トリガーを追加」→ 関数: `organizeInvoices`、イベント: 時間主導型（例: 1日ごと）

## スプレッドシート出力例

| 受信日 | 送信者 | 件名 | ファイル名 | DriveリンクURL | 保存日時 |
|--------|--------|------|------------|----------------|----------|
| 2026/05/01 | vendor@example.com | 請求書_2026年4月分 | 20260501_請求書.pdf | https://drive... | 2026/05/06 10:00:00 |

## Gmail検索クエリのカスタマイズ

`CONFIG.GMAIL_QUERY` を変更することで対象メールを絞り込めます。

```js
// 例: 特定の送信者に限定
'has:attachment filename:pdf from:billing@example.com'

// 例: 特定期間のみ
'has:attachment filename:pdf subject:請求書 after:2026/01/01'
```

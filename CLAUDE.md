# Exp5 - Gmail請求書PDF抽出 (Unit 1)

## このプロジェクトの役割

Gmailに届いた請求書のPDF添付ファイルを自動で取り出し、Google Driveの指定フォルダに保存する。

## システム全体の中での位置づけ

```
Gmail（担当者A・B・C 各アカウント）
  ↓
【このプロジェクト: Exp5】
  PDFを抽出 → Driveフォルダに保存 → スプレッドシートに一覧記録
                ↓
          Google Drive（共有ポイント）
                ↓
【Exp4: 仕訳GAS】
  PDFを読み込み → 仕訳データ生成
```

## 複数アカウント対応

担当者ごとに自分のGoogleアカウントでGASをコピーして実行する。
全員が同じ `DRIVE_FOLDER_ID` と `SPREADSHEET_ID` を指定する。

**重複チェックキー:** `送信者メールアドレス + ファイル名 + 受信日`
同じ請求書が複数担当者に届いても1件だけ登録される。

## Exp4（仕訳GAS）との接合点

| 項目 | 内容 |
|---|---|
| 共有Driveフォルダ | `CONFIG.DRIVE_FOLDER_ID`（Code.gsに設定） |
| ファイル命名規則 | `yyyyMMdd_元のファイル名.pdf` |
| 一覧スプレッドシート | `CONFIG.SPREADSHEET_ID`（Code.gsに設定） |
| 仕訳ステータス列 | スプレッドシートの「仕訳ステータス」列（未処理/済） |

Exp4はこのDriveフォルダIDとスプレッドシートIDを参照して動作する。

## スプレッドシートの列構成

| 列 | 内容 |
|---|---|
| 受信日 | yyyy/MM/dd |
| 送信者 | メール送信者（フルヘッダー） |
| 件名 | メール件名 |
| ファイル名 | yyyyMMdd_元のファイル名.pdf |
| DriveリンクURL | 保存先ファイルのURL |
| 保存日時 | yyyy/MM/dd HH:mm:ss |
| 処理アカウント | 実行した担当者のGmailアドレス |
| PDFハッシュ | MD5ハッシュ（重複検出キー） |
| 仕訳ステータス | 未処理 / 済（Exp4が更新） |

## ファイル構成

```
Code.gs          - メインスクリプト
appsscript.json  - OAuthスコープ設定
```

## 主な関数

| 関数 | 説明 |
|---|---|
| `organizeInvoices()` | メイン処理。定期トリガーに登録する |
| `setupResources()` | 初回のみ実行。DriveフォルダとSpreadsheetを自動生成 |

## セットアップ

1. `setupResources()` を実行してDriveフォルダIDとスプレッドシートIDを取得
2. `Code.gs` の `CONFIG` にIDを設定
3. DriveフォルダとスプレッドシートをExpメンバー全員と共有（編集権限）
4. **取得したIDをExp4（仕訳GAS）のCLAUDE.mdにも記載する**
5. 各担当者がコードをコピーして同じIDを設定
6. `organizeInvoices()` を時間トリガーに登録（推奨: 1日1回）

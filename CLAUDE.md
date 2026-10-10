# CLAUDE.md

このファイルは、このリポジトリで作業する Claude Code (claude.ai/code) への指針を提供する。

## プロジェクト概要

電気設備設計において、ユーザーの入力情報から「施工図面のレイアウト構成（指示書）」および「概算の資材・施工見積（日本国内の現行単価ベース）」を自動生成します。

- 種類: PWA（ビルド無しの素の HTML/CSS/JS）
- デプロイ先: Vercel

## コマンド

- **ローカル起動**: `python3 -m http.server 8000` → http://localhost:8000/
  - `file://` で直接開くとインストール・オフライン動作ができないため、確認は必ずローカルサーバー経由で行う。
- **ビルド／lint／テスト**: 該当コマンド無し。

## ディレクトリ構造

```
index.html / style.css / app.js   画面
manifest.webmanifest  PWA の設定
sw.js                 Service Worker（オフライン用キャッシュ）
intent-interview.md   intent.md（作業の意図）を作るインタビューの指示
docs/                 仕様・メモ・参考資料（中身は git 管理外）
assets/               画像などの素材（中身は git 管理外）
.env.example          秘密情報の項目の見本
```

## このプロジェクトで使うスキル

- `scaffold-express-server` — Scaffold a minimal Express.js web server with a routes/ folder structure and a curl-based automated test script (test.sh).
- `graphify` — Use for any question about a codebase, its architecture, file relationships, or project content — especially when graphify-out/ exists, wher…
- `generate-illustration` — Generate new images from a text prompt, or edit/transform existing images with a text instruction, using Nano Banana 2 (Gemini 3.1 Flash Ima…
  - 画像・アイコン・イラストはこのスキルで作る。手描き・SVG での代替はしない。

## 資料の保存場所

- `docs/` — 仕様・メモ・参考資料（中身は .gitignore 済み。リポジトリには上がらない）
- `assets/` — 画像などの素材（中身は .gitignore 済み。リポジトリには上がらない）

## 秘密情報

- 値は `.env`（`.gitignore` 済み）に置く。コードへのハードコードやコミットはしない。

| 名前 | 用途 | GitHub Actions |
|---|---|---|
| `API_KEY` | GeminiのAPI呼び出し | Secrets に登録して使う |

## 作業の意図（intent.md）

- `intent.md` があれば、作業の前に読み、出来上がったらその5つの項目と見比べて合っているかを確かめてから報告する。
- `intent.md` が無いときに作りたいものの話を始められたら、`intent-interview.md` の手順でインタビューして `intent.md` を作る。

## 注意事項

- 新しい依存関係の追加や、依頼範囲外のリファクタリングは避ける。
- テストが実行できなかった場合は、その理由を明記する。

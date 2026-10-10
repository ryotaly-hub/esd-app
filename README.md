# esd-app

電気設備設計において、ユーザーの入力情報から「施工図面のレイアウト構成（指示書）」および「概算の資材・施工見積（日本国内の現行単価ベース）」を自動生成します。

## 構成

- 種類: PWA（ビルド無しの素の HTML/CSS/JS）
- デプロイ先: Vercel

## 使い方

- **ローカル起動**: `python3 -m http.server 8000` → http://localhost:8000/
  - `file://` で直接開くとインストール・オフライン動作ができないため、確認は必ずローカルサーバー経由で行う。
- **ビルド／lint／テスト**: 該当コマンド無し。

## 資料の保存場所

- `docs/` — 仕様・メモ・参考資料（中身は .gitignore 済み。リポジトリには上がらない）
- `assets/` — 画像などの素材（中身は .gitignore 済み。リポジトリには上がらない）

## 秘密情報

- 値は `.env`（`.gitignore` 済み）に置く。コードへのハードコードやコミットはしない。

| 名前 | 用途 | GitHub Actions |
|---|---|---|
| `API_KEY` | GeminiのAPI呼び出し | Secrets に登録して使う |

## 作り始める前に

- Claude Code に「`intent-interview.md` を読んで、そのとおりに進めて」と頼み、インタビューに答えて `intent.md`（何に困っているか・どうなったら嬉しいか・誰に関係するか・守る条件・未決事項）を作る。

## 初期設定のチェックリスト

- [ ] `cp .env.example .env` を実行し、`.env` に秘密情報の値を設定する
- [ ] `gh secret set API_KEY` で GitHub Secrets に API_KEY を登録する
- [ ] generate-illustration スキルでアイコン（192px・512px）を作り、`icons/` に置いて manifest.webmanifest の icons に追加する
- [ ] Vercel でこのリポジトリをインポートしてデプロイを設定する

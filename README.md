# esd-app

電気設備設計において、ユーザーの入力情報から「施工図面のレイアウト構成（指示書）」および「概算の資材・施工見積（日本国内の現行単価ベース）」を自動生成します。

## できること

- 建物図面（平面図の画像・PDF）を入れると、図面に機器の記号と配線ルートを重ねた「配線図面例」と、その範囲の概算価格（機器数量・配線延長 × 材工単価）を出す。階ごとの図面を複数枚でも、複数の階を1枚にまとめた図面でも登録でき、基準階は「同じ図面の階数」で何フロア分かを指定できる。系統ごとの表示切替・画像保存ができる
- 建物概要（用途・構造・階数・延床面積）と電気設備の4カテゴリ（受変電・幹線／一般電源・照明／弱電・通信／防災・安全）をドロップダウンで選ぶと、プロンプトに埋め込んで Gemini に送る（送る内容は画面で確認・コピーできる。「未定」の項目は標準仕様で補完させる）
- 「価格を Web 検索で確かめる」をオンにすると、Google 検索で最新の公開価格を参照して見積もり、参照した情報源を一覧で出す
- 回答の Markdown（施工図面作成ガイド〈CAD/BIM作図指示書〉・概算見積）を表示する
- 回答末尾の見積データ（JSON）から、カテゴリ別内訳（資材費・労務費・小計）・小計グラフ・見積総括（直接工事費・諸経費・総合計・㎡単価）を表示し、PDF で保存できる

## 構成

- 種類: Node.js（Express）サーバー ＋ PWA の画面（`public/` のビルド無しの素の HTML/CSS/JS）
- デプロイ先: Vercel
- 公開 URL: https://esd-app-fawn.vercel.app/ （合言葉 `ACCESS_PASSWORD` が必要。ユーザー名は何でもよい）

## 使い方

- **ローカル起動**: `npm install`（初回のみ）→ `npm start` → http://localhost:3000/
  - `.env` に `API_KEY` を入れておくと「生成する」で Gemini を呼べる。
- **テスト**: `npm test`（偽の Gemini サーバーで API を検証する。本物には接続しない）

## 資料の保存場所

- `docs/` — 仕様・メモ・参考資料（中身は .gitignore 済み。リポジトリには上がらない）
- `assets/` — 画像などの素材（中身は .gitignore 済み。リポジトリには上がらない）

## 秘密情報

- 値は `.env`（`.gitignore` 済み）に置く。コードへのハードコードやコミットはしない。

| 名前 | 用途 | GitHub Actions |
|---|---|---|
| `API_KEY` | GeminiのAPI呼び出し | Secrets に登録して使う |
| `GEMINI_MODEL` | 使う Gemini のモデル（省略可。既定は `gemini-3.8-flash`） | 不要 |
| `GEMINI_API_BASE` | Gemini API の接続先（省略可。テスト用） | 不要 |

## 作り始める前に

- Claude Code に「`intent-interview.md` を読んで、そのとおりに進めて」と頼み、インタビューに答えて `intent.md`（何に困っているか・どうなったら嬉しいか・誰に関係するか・守る条件・未決事項）を作る。

## 初期設定のチェックリスト

- [ ] `cp .env.example .env` を実行し、`.env` に秘密情報の値を設定する
- [ ] `gh secret set API_KEY` で GitHub Secrets に API_KEY を登録する
- [ ] generate-illustration スキルでアイコン（192px・512px）を作り、`public/icons/` に置いて public/manifest.webmanifest の icons に追加する
- [x] Vercel でこのリポジトリをインポートしてデプロイを設定する
- [ ] Vercel の Environment Variables に `API_KEY` と `ACCESS_PASSWORD`（公開 URL の合言葉。必要なら `GEMINI_MODEL`）を登録する

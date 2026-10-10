# CLAUDE.md

このファイルは、このリポジトリで作業する Claude Code (claude.ai/code) への指針を提供する。

## プロジェクト概要

電気設備設計において、ユーザーの入力情報から「施工図面のレイアウト構成（指示書）」および「概算の資材・施工見積（日本国内の現行単価ベース）」を自動生成します。

- 種類: Node.js（Express）サーバー ＋ PWA の画面（`public/` のビルド無しの素の HTML/CSS/JS）
- デプロイ先: Vercel（公開 URL: https://esd-app-fawn.vercel.app/ 、`main` に push すると自動でデプロイ）

## コマンド

- **ローカル起動**: `npm install`（初回のみ）→ `npm start` → http://localhost:3000/
  - `.env` の `API_KEY` を読んで Gemini を呼ぶ。`.env` が無いと生成ボタンはエラーになる（画面の確認は「API を使わない場合はこちら」→ 回答の貼り付けでもできる）。
  - ポートは環境変数 `PORT` で変えられる。
- **テスト**: `npm test`（= `bash test.sh`）。偽の Gemini サーバー（3999番）とアプリ（3100番）を起動し、curl で API を検証する。本物の Gemini には接続しない。
  - 新しいエンドポイントを足したら、`test.sh` に `assert_eq` を追記する。
- **ビルド／lint**: 該当コマンド無し。

## ディレクトリ構造

```
index.js              Express サーバー（public/ の配信と /api の登録。Vercel ではこれをそのまま使う）
routes/api.js         API（GET /api/options、POST /api/prompt、POST /api/generate）
lib/fields.js         入力項目とドロップダウンの選択肢（画面のフォームはここから作る）
lib/prompt.js         プロンプトテンプレートと {building_type} などの埋め込み
lib/gemini.js         Gemini の呼び出し（平面図の画像を添付、Google 検索グラウンディングで価格を Web 参照）
lib/drawing.js        配線図面例の系統・機器の種類の定義と、届いた平面図（複数）の確認
lib/rooms.js          平面図の室の検出（1段目）のプロンプトと結果の確認・室の番号付け
public/               画面（index.html / style.css / app.js / drawing.js / sw.js / manifest.webmanifest）
                      drawing.js は平面図の登録（PDF は pdf.js で画像化）と配線図面例の描画・概算
                      layout.js は室の範囲と機器の数から機器・配線を並べる（画面と test.sh の両方で使う）
public/img/           アイコン（icon-*.png・app-*.png）と背景の建築図面（bg-architecture.webp）。generate-illustration スキルで作成
test.sh               API の自動テスト（npm test）
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
| `ACCESS_PASSWORD` | 公開 URL の合言葉（設定するとページと API 全体に Basic 認証がかかる。ユーザー名は何でもよい。空ならかけない） | 不要（Vercel の Environment Variables に登録） |
| `GEMINI_MODEL` | 使う Gemini のモデル（省略可。既定は `gemini-3.8-flash`） | 不要 |
| `GEMINI_API_BASE` | Gemini API の接続先（省略可。テストで偽サーバーに向けるときだけ使う） | 不要 |

## 作業の意図（intent.md）

- `intent.md` があれば、作業の前に読み、出来上がったらその5つの項目と見比べて合っているかを確かめてから報告する。
- `intent.md` が無いときに作りたいものの話を始められたら、`intent-interview.md` の手順でインタビューして `intent.md` を作る。

## プロンプトと出力の形

- 入力項目と選択肢は `lib/fields.js` だけで定義する。画面は `GET /api/options` で受け取ってフォームを作るので、選択肢を増やすときは `lib/fields.js` を直すだけでよい（選択肢の `label` が画面の表示、`text` がプロンプトに入る文）。
- 電気設備の4カテゴリは、選んだ項目の `text` を「、」でつないでテンプレートの `{power_system_input}` などに入れる。一部だけ選んだときは「（その他は標準的な仕様で補完）」を付け、何も選ばなければ「未入力（標準的な仕様で補完してください）」にする。
- プロンプトは画面から送らず、サーバーが入力値から組み立てる（任意のプロンプトを中継させないため）。選択肢に無い値は捨てる。
- 既定のモデルは `gemini-3.8-flash`（2026-10 時点で `gemini-2.5-flash` は新規利用者に提供終了）。
- 「価格を Web 検索で確かめる」がオンのときは、Gemini の Google 検索グラウンディング（`tools: [{ google_search: {} }]`）を使い、Instructions に価格を検索で確かめる指示を足す。参照した情報源は画面と見積書の「参照した外部データ」に出す。建設物価・積算資料などの有料の物価資料には接続していない。
- プロンプト本文はユーザーから受け取った指示書（Role / Task / Input Data / Output Format / Instructions）がベース。Input Data の部分だけを `{key}` に置き換えている。
- Instructions の最後で「Markdown に加えて見積データを JSON で末尾に出す」よう指示し、JSON の形（`categories` に資材費・労務費・小計、`overhead_rate`、`notes`）を指定している。画面は最後の ```json ブロックを読み、小計は資材費＋労務費、直接工事費・諸経費・総合計・㎡単価は画面側で計算し直して表示する。
- 建物図面（平面図）は何枚でも（最大8枚・合計3MB。base64 にしても Vercel の受け取り上限 4.5MB に収まるように）登録でき、1枚ごとに「1つの階」（階の名前・同じ図面の階数）か「複数の階をまとめた図」かを選ぶ。PDF は全ページを1枚ずつ登録する（cdnjs の pdf.js 3.11.174 で画像化）。画像は画面で長辺 2000px（3枚以上は 1600px）以下の JPEG にしてから送る。
- 配線図面例は2段階で作る。
  1. `lib/rooms.js` / `detectRooms`: 図面1枚ごとに Gemini に階の建物外形と室の範囲だけを物体検出の形式（`box_2d` = [ymin, xmin, ymax, xmax]、0〜1000）で返させる（並列）。室には `画像-階-室` の番号を付ける。
  2. 本体の生成: 検出した室の一覧（番号・室名・おおよその寸法）をプロンプトに入れ、JSON の `drawing` では室の番号ごとの機器の数・分電盤を置く室（`panel_room`）・実寸だけを返させる。1枚でも検出できなければ、本体の依頼で室の範囲も返させる方式に切り替える。
- 機器の位置と配線ルートは AI ではなく `public/layout.js` が決める（AI に点の座標を直接返させると背景の図面とずれるため）。天井の機器は室の内側に格子状、コンセントは壁沿い、スイッチ・誘導灯は分電盤側の壁、カメラは隅。配線は分電盤から廊下の中心線を通って各室の入口へ行き、室内を折り返してつなぐ（縦横の直線だけ）。機器は必ず室の内側に入る。`test.sh` でこれを確かめている。
- 「複数の階をまとめた図」は、検出した階の外形に余白を付けた範囲（`layout.js` の `cropRect`）を SVG の viewBox で切り出し、階ごとに別の図として表示する。
- 配線図面例の「機器を編集する」で、機器の追加（種類を選んで図面をクリック）・ドラッグでの移動・削除（Delete キー）・元に戻す・自動配置に戻すができる。編集エリアの下の「編集を反映する」で編集モードを閉じる（編集は操作のたびに反映済み）。分電盤は移動だけ。編集のたびに `layout.js` の `routeFloor` で配線を引き直し（機器の室は位置から `assignRoom` で決める）、凡例・内訳・概算を計算し直す。編集した配置は `localStorage` の `esd-app:wiring-edits` に階ごとに保存し、新しく生成すると消える。
- AI には `unit_prices` を配置に使わなかった種類も含めて全種類返させる（画面で機器を追加したときの単価に使う）。単価が無い種類は 0 円で計算し、注記に出す。
- 「1つの階」の図面は1フロア分だけ配置し、「同じ図面の階数」で数量・金額を掛ける。縮尺は建物外形の横幅（px）と実寸（入力値 → AI の値 → 寸法線から検出した値）から求める。
- 配線図面の概算は画面で計算する: 機器の数 ×（材料単価＋労務単価）と、配線長 ×（1mあたりの単価）。配線長は図面上の長さ×1.2（立上り・余長）。諸経費率は建物全体の見積と同じ値を使う。記号は JIS C 0303 を簡略化したもので、系統ごとに色と線種を変えている。記号の大きさは、PC では表示している図の幅から倍率を求め、画面上で凡例の1.5倍になるようにしている（`public/drawing.js` の `updateSymbolSizes`、幅を変えると描き直す）。スマホ（幅 560px 以下）は画像の大きさに合わせた元の大きさのまま。
- AI の回答（Markdown）は、大見出し（「1. 施工図面作成ガイド」など）ごとに、閉じた状態の開閉ボタン（`details`）にまとめて表示する（`public/app.js` の `renderSections`）。AI は見出しの書き方が揃わない（`# 1.` と `## 2.` の混在、太字の行など）ので、番号の付いた見出しを 1→2→3 の順にたどって区切る。番号の見出しが無ければ、2回以上出てくる一番上の階層の見出しで区切る。
- 建物名（`building_name`）は画面だけの入力欄で、`lib/fields.js` には無い。ファイル名と見積書の印刷にだけ使い、AI には送らない（自由な文をプロンプトに入れないため）。
- ページ冒頭と最下部（結果の欄の一番下）の「結果を保存」で、入力・登録した図面・AI の回答・配線図面例の編集をまとめた JSON（`電気設備設計_建物名_生成日.json`、`format: "esd-app-result"`）を保存し、「ファイルを開く」で元に戻す。開いたファイルの中身は信用せず、入力は `lib/fields.js` の項目だけ、図面は画像の data URL だけを受け付ける（`public/drawing.js` の `cleanList`）。「リセット」は入力・図面・結果・`localStorage` をすべて消す。
- PDF 出力はブラウザの印刷（「PDFに保存」）を使い、`public/style.css` の `@media print` で見積書の体裁にしている。
- Service Worker は通信優先（つながらないときだけキャッシュ）。生成などの POST はキャッシュしない。

## 注意事項

- 新しい依存関係の追加や、依頼範囲外のリファクタリングは避ける。
- テストが実行できなかった場合は、その理由を明記する。

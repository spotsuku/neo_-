# 自律開発プロトコル

あなたは自律的に開発サイクルを回すエンジニアです。以下のループを厳守してください。

## 基本サイクル（PDCA）

### 1. PLAN（計画）
- タスクを受けたら、まず実装前に計画を立てる
- 影響範囲、変更ファイル、想定リスクを箇条書きで提示
- 不明点が3つ以上ある場合のみ質問。それ未満は自分で判断して進める
- 計画は最大10行以内に収める

### 2. DO（実装）
- 計画に従って一気に実装する
- 単一HTMLファイル構成（Supabase + Vercel）の規約を守る
- 変更後は必ず以下を実行：
  - `node --check <file>` で構文確認
  - 既存機能の回帰がないかgrepで確認
- 実装中に計画外の変更が必要になったら、その場で計画を更新して継続

### 3. CHECK（検証）
- 実装後、自分で以下をセルフレビュー：
  - [ ] 構文エラーなし
  - [ ] 既存のデータフロー（KPIカード等）を壊していない
  - [ ] Supabase RLS / 認証フローに影響なし
  - [ ] コンソールエラーが出ない想定か
  - [ ] 破壊的代入（Object.assign 等）の前に旧値を退避したか
- 問題があれば自動で修正してから報告

### 4. ACT（学習）
- ミスをしたら、即座にこのファイル（CLAUDE.md）の「失敗ログ」セクションに追記
- 形式：`- [日付] <何をやろうとして> <何を間違えた> → <次回の対策>`
- ユーザーから指摘された規約・好みも同様に追記

## 停止条件（ここでだけユーザーに確認する）

以下の場合のみループを止めて確認：
1. データベーススキーマの破壊的変更
2. 本番デプロイ（vercel --prod）
3. 既存ユーザーデータに影響する処理
4. 3回試して同じエラーが解決しない
5. APIキー等のシークレット操作

## 報告フォーマット

各サイクル終了時に以下を出力：
- ✅ 完了したこと（1-3行）
- 📝 CLAUDE.md に追記した学習（あれば）
- ⚠️ 残課題 / 次にやるべきこと
- 🔄 続行可否（「次のタスクに進めます」or「確認待ちです」）

## 禁止事項

- 「実装しました」だけで検証をスキップしない
- 計画なしでいきなりコードを書かない
- 同じエラーを2回以上繰り返さない（必ず学習を残す）
- ユーザーに過度に確認を求めない（停止条件以外は自走）

---

# 失敗ログ（自動追記される）

- [2026-04-29] MF債務支払いの取込ロジックで `Object.assign(row, next)` の**後**に `row.actual` を読んで前値を取得しようとし、差分が常に 0 になるバグを混入。セルフレビュー段階で発覚し修正。→ **対策**: 既存オブジェクトを更新する場合、変更前スナップショット（旧 `actual` / 旧 `payMonth` 等）は必ず破壊的代入の**前**にローカル変数へ退避する。CHECKチェックリストに項目追加済み。
- [2026-04-30] MF連携の `/api/mf/auth` が本番で 500 を返し「Unexpected end of JSON input」になる不具合。`sbRest()` が `Prefer: return=minimal` 付きの POST に対して PostgREST が返す **201 + 空ボディ**を `r.json()` で直接パースして失敗していた。→ **対策**: REST ヘルパは「2xx でも空ボディ」を必ず想定し、`r.text()` で取得 → 空なら null、非空なら JSON.parse、失敗時は文字列のまま返すフォールバックを置く。Vercel API は `vercel logs` を見ない限りスタックが見えないので、サーバ側 catch では `console.error` も残すこと。
- [2026-04-30] OAuth2 token endpoint で `token_exchange_401` が発生。MF アプリ登録のクライアント認証方式が **CLIENT_SECRET_BASIC** だったが、実装側は client_id/secret を **body のフォーム値**として送っていた。→ **対策**: token / refresh の両方で `Authorization: Basic base64(id:secret)` ヘッダを付け、body には grant_type / code / redirect_uri / code_verifier のみを残す。OAuth プロバイダは Developer Portal で必ず認証方式を確認（`CLIENT_SECRET_BASIC` / `CLIENT_SECRET_POST` / `none(PKCE)` など）。
- [2026-05-09] データロス防止 3層強化 (P0)。DB をきれいに整理、リアルタイム自動保存をオフラインでも継続、履歴をクラウド永続化。
  - migration 010_dashboard_safety.sql: dashboard_data 正式定義 + dashboard_snapshots / login_history 新設 + RLS + RPC (create_snapshot / prune_snapshots)
  - IndexedDB オフラインキュー: save 失敗時に saveData を退避 → online/focus/30秒タイマで自動 flush
  - save() ミューテックス: _saveChain Promise チェーンで直列化 (並行 write 競合を物理的に防止)
  - スナップショット Supabase 永続化: 端末横断で履歴閲覧・復元可能、200件ローテーション、☁/📵 バッジで同期状態を可視化
  教訓: 「データを失わない」は単一の対策では不十分。書き込みパス全体に多層防御 (mutex + retry + offline queue + cloud snapshot) を入れる必要がある。
- [2026-05-09] 同時編集でデータが消える/古い状態に戻る重大バグを5箇所同時修正。
  根本原因: (1) `loadFromDB` で「localStorage の estimates 件数が多ければ優先」していたため別端末の編集が古いタブで上書き／(2) `save` のマージが `{...DB, ...saveData}` の浅いマージで events/sessions/estimates 等のネスト構造ごと上書き／(3) save の 5秒判定で短時間連続編集は完全上書き／(4) `saveMemberData` がマージなし完全上書き／(5) `applySyncData` (Realtime) が `S = _pendingSyncData` で全置換、30秒で未保存変更も自動上書き。
  → **対策**: `mergeS()` / `mergeArrayById()` 深いマージ関数を導入し、全保存・受信パスで「データを失わない union 方向」に統一。配列は id（categories は name、defaults は name）ベースで union、ネストの events.items / sessions.items / estimates も再帰マージ。saveData 側を優先するが他人の追加項目は絶対に消さない。
  教訓: マルチ端末・マルチタブ前提のアプリでは「最後の保存が勝つ」設計は致命的。必ず id ベースの 3-way merge（base / mine / theirs）を考える。spread の浅いマージはネスト構造を破壊する。
- [2026-04-30] MFクラウド債務支払いの公式スコープは仕様上 3つのみ:
  `mfc/accounts-payable/received_invoice.read`,
  `mfc/accounts-payable/received_invoice.write`,
  `mfc/accounts-payable/office_setting.read`
  推測した `mfc/saimu/...` や `mfc/payable/...` は無効。→ **対策**: スコープは MF Developer Portal の正式な選択肢／公式 API ドキュメント（GitHub `moneyforward/expense-api-doc` など）を最初に確認すること。`required_products[]=invoice` のエラーは「アプリが invoice 製品で登録され続けている」ではなく、scope パラメータが invoice 系を含むだけでも発生する可能性あり。

# プロジェクト固有ルール

- pptxgenjs使用時は絵文字を使わず番号ラベル
- 日本語フォント：MS明朝（serif）/ Meiryo（sans-serif）
- PPTX→PDF変換は soffice.py、QAは pdftoppm -jpeg -r 150
- 単一HTMLファイル構成、変更後は node --check 必須

# 機能別メモ

## マネーフォワード債務支払い 連携（API: A案）

- エンドポイント: `/api/mf/{auth,callback,payables,status}`（Vercel ESM）
- 認証: Supabase JWT を Authorization ヘッダで API に渡す → API 側で `/auth/v1/user` で検証
- OAuth2: PKCE フロー。state は `mf_oauth_states` テーブルに 10分 TTL で保管（service_role のみ）
- トークン: `mf_oauth_tokens`（user_id PK）に保管。RLS deny-all、`mf_is_linked` / `mf_unlink` RPC のみ公開
- データ保存: 専用テーブルは作らず `S.ledger`（実績）に直接反映。raw データは `S.mfPayables` に保持
- 冪等性: ledger 行に `_mfId` を持たせ、再取込時はキー一致で UPDATE
- 必須 ENV: `MF_CLIENT_ID`, `MF_CLIENT_SECRET`, `MF_REDIRECT_URI`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_BASE_URL`
- 任意 ENV: `MF_AUTHORIZE_URL`, `MF_TOKEN_URL`, `MF_API_BASE`, `MF_PAYABLES_PATH`, `MF_SCOPE`

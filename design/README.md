# NEO Design System

NEO ACADEMIA の制作物（パンフレット等）を半自動生成するための基盤一式。

## 構成

| ファイル | 役割 |
|----------|------|
| `NEO_Design_Bible.md` | デザイン基準（色・フォント・グリッド・コンポーネント） |
| `NEO_Pamphlet_Spec.md` | パンフレット発注仕様・生成パイプライン |
| `templates/neo_a4_master.html` | A4縦の印刷対応マスターテンプレート |
| `../.claude/agents/0{1..4}_*.md` | サブエージェント（copy / visual / layout / qa） |
| `output/` | 生成物（copy.md, prompts.md, pamphlet_*.html, qa_report.md） |

## 使い方（最短）
1. `NEO_Pamphlet_Spec.md` の「一括指示テンプレート」を埋めて Claude Code に渡す。
2. copy → visual → layout → qa の順でエージェントが処理。
3. `templates/neo_a4_master.html` を複製して各ページを組版。
4. ブラウザの「印刷 → PDF保存（A4 / 余白なし / 背景オン）」で確認用PDFを出力。
5. 仕上げをデザインツール（Canva / Figma）で微調整。

## デザインツール接続状況

### Canva MCP — ✅ 接続済（このプロジェクトで利用可）
`create-design-from-brand-template` / `generate-design` / `export-design` 等が使える。
HTML→PDF とは別ルートとして、ブランドテンプレートからの生成・PDF書き出しに利用可能。

### Figma MCP — ⏸ 設定済 / 認証待ち
`.mcp.json` に Figma リモート MCP サーバ（`https://mcp.figma.com/mcp`）を登録済み。
**接続を完了させる手順（ローカルの対話セッションが必要）:**

1. ローカルで `claude` を起動 → プロジェクトの `.mcp.json` の信頼を承認。
2. `/mcp` を実行 → `figma` を選択 → ブラウザで OAuth ログイン（Figma アカウント）。
3. 認証後 `figma` ツール（`mcp__figma__*`）が利用可能になる。

補足:
- **クラウド/Web セッションでは OAuth ログインを完了できない**ため、Figma 連携はローカル環境で認証する必要がある。
- Figma 公式プラグイン経由の場合: `claude plugin install figma@claude-plugins-official` → Claude Code 再起動。
- Figma **Dev Mode**（`127.0.0.1:3845`）はローカルで Figma デスクトップアプリ起動が前提（クラウドコンテナでは不可）。

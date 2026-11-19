# 0009: UI を shadcn/ui（Tailwind CSS v4 + Radix）で刷新する

- 状態: 承認
- 日付: 2026-11-19

## 背景

MVP のフロントエンドは、素の CSS（`App.css`）、自作のダイアログ、`window.confirm`、自前の SVG 棒グラフでできている。見た目が簡素なうえ、ダークモード、確認ダイアログ、操作結果の通知といった現代的な UI の要素がない。画面を追加するたびに CSS を手で書き足す必要もある。

なお、MVP の仕様（`docs/features.md` と `plan/01-mvp-checklist.md` の Phase 2）では、ダッシュボードのグラフは CSS か SVG で描き、ライブラリーを追加しないとしていた。この ADR はその方針を見直し、グラフに Recharts を使う。

選択肢:

1. 自前の CSS を磨き続ける。依存は増えないが、部品とアクセシビリティを自分で作り続ける必要がある。
2. MUI や Chakra などのコンポーネントライブラリを入れる。ランタイムが大きく、見た目のカスタマイズに独自の流儀がある。
3. shadcn/ui を使う。部品のソースをリポジトリにコピーする方式で、中身は Tailwind CSS と Radix（アクセシブルな部品の土台）。ランタイムの依存は小さく、コードを直接編集できる。

## 決定

shadcn/ui を採用する（選択肢 3）。部品は `src/frontend/src/components/ui/` に CLI で生成し、リポジトリで管理する。テーマはライト・ダーク・システムの 3 つから選べるようにし、ダッシュボードのグラフは shadcn Chart（Recharts）に置き換える。

### 追加する依存（2026-11-19, npm registry で確認）

| 区分 | パッケージ                                       | 版                    | 用途・peer の確認                                                |
| ---- | ------------------------------------------------ | --------------------- | ---------------------------------------------------------------- |
| dev  | tailwindcss / @tailwindcss/vite                  | 4.3.5                 | スタイル。Vite プラグインの peer は vite `^5.2〜^8`              |
| dep  | radix-ui                                         | 1.8.1                 | Dialog・AlertDialog・Checkbox・DropdownMenu・Slot。React 19 対応 |
| dep  | class-variance-authority / clsx / tailwind-merge | 0.7.1 / 2.1.1 / 3.7.0 | 部品のバリアントとクラス結合（`cn()`）                           |
| dep  | tw-animate-css                                   | 1.4.0                 | 部品の開閉アニメーション（CSS のみ）                             |
| dep  | lucide-react                                     | 1.75.0                | アイコン。React 19 対応                                          |
| dep  | sonner                                           | 2.0.8                 | トースト通知。React 19 対応                                      |
| dep  | recharts（peer の react-is）                     | 3.11.0                | shadcn Chart の描画。React 19 対応                               |

shadcn の CLI（4.23.0）は部品を生成するときだけ `npx` で使い、依存には加えない。

### 採用しないもの

- **next-themes**: shadcn の `sonner.tsx` が import するが、Next.js 向けで、このアプリには過剰。テーマは自前の小さな Context（`src/context/ThemeContext.tsx`）で管理する。
- **shadcn の Sidebar ブロック**: 多くの部品とフックを持ち込む。メニューは 4 項目しかないので、サイドバーは自前で作る。
- **Radix Select**: jsdom では動かすのに polyfill が必要で、`combobox` の操作テストも書き直しになる。選択リストは native の `<select>` を shadcn の見た目に揃えて使う。

## 結果・影響

- エントリーの CSS は `src/frontend/src/index.css`（Tailwind とテーマトークン）になり、`App.css` は削除する。
- `@/` → `src/frontend/src/` の alias を `tsconfig.json` と `vite.config.ts` に追加する。設定は `src/frontend/components.json` に置く。
- `components/ui/` の生成コードも oxlint と oxfmt の対象にする。生成し直したら lint と format を通す。
- Recharts の分だけバンドルが大きくなる。ダッシュボードは `React.lazy` で別のチャンクに分け、他の画面の読み込みに Recharts を含めない（ビルド時点で各チャンクは約 440 kB、gzip 後は約 130 kB）。
- `index.html` のインラインスクリプトで、描画前にテーマを当てる。`staticwebapp.config.json` に CSP を追加するときは、このスクリプトを許可する（ハッシュか外部ファイル化）。
- jsdom では Recharts のツールチップを描画できない。グラフの数値はアクセシブルな表でテストする。

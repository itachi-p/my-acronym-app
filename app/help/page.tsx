import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import Markdown, { type Components } from "react-markdown";
import { BackToTopButton } from "./BackToTopButton";

// content/help.mdが唯一の情報源。文言・画像の差し替えはこのファイルと
// public/help/配下の画像を編集するだけで完結させ、コード変更を
// 要求しない(この方針のためコード内にヘルプ文言をハードコードしない)。
const HELP_MARKDOWN_PATH = path.join(process.cwd(), "content", "help.md");

// react-markdownはデフォルトで生HTMLを解釈しない(rehype-raw等を
// 追加しない限り、マークダウン内のHTMLタグはただの文字列として
// エスケープ表示される)。信頼できる管理下のファイルではあるが、
// 生HTMLを有効化する経路自体を作らない方針を維持するため、
// rehype-raw/remark-rehypeのallowDangerousHtmlは一切使わない。
// lg:max-w-[40em]は1024px以上でのみ効く(モバイルのbaseスタイルは
// 変更しない)。article をグリッド化した際、フル幅(grid-column:1/-1)
// の本文がグリッド全幅まで間延びしないよう、日本語35〜45文字程度を
// 目安に1行の長さを抑える(globals.cssの.help-articleグリッド定義と
// 対応)。
const TEXT_MAX_WIDTH_CLASS = "lg:max-w-[40em]";

const components: Components = {
  h1: (props) => (
    <h1
      {...props}
      className={`text-2xl font-bold text-slate-900 dark:text-white ${TEXT_MAX_WIDTH_CLASS}`}
    />
  ),
  h2: (props) => (
    <h2
      {...props}
      className={`mt-8 text-xl font-bold text-indigo-600 first:mt-6 dark:text-indigo-400 ${TEXT_MAX_WIDTH_CLASS}`}
    />
  ),
  h3: (props) => (
    <h3
      {...props}
      className={`mt-5 text-base font-semibold text-slate-800 dark:text-slate-100 ${TEXT_MAX_WIDTH_CLASS}`}
    />
  ),
  p: (props) => (
    <p
      {...props}
      className={`mt-2 break-words leading-relaxed text-slate-700 dark:text-slate-300 ${TEXT_MAX_WIDTH_CLASS}`}
    />
  ),
  ol: (props) => (
    <ol
      {...props}
      className={`mt-2 list-decimal space-y-1 pl-5 text-slate-700 dark:text-slate-300 ${TEXT_MAX_WIDTH_CLASS}`}
    />
  ),
  ul: (props) => (
    <ul
      {...props}
      className={`mt-2 list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300 ${TEXT_MAX_WIDTH_CLASS}`}
    />
  ),
  li: (props) => <li {...props} className="break-words leading-relaxed" />,
  code: (props) => (
    <code
      {...props}
      className="whitespace-normal break-words rounded bg-slate-100 px-1.5 py-0.5 text-sm text-indigo-700 dark:bg-slate-800 dark:text-indigo-300"
    />
  ),
  a: (props) => (
    <a
      {...props}
      className="break-words text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400"
      target={props.href?.startsWith("http") ? "_blank" : undefined}
      rel={
        props.href?.startsWith("http") ? "noopener noreferrer" : undefined
      }
    />
  ),
  // スマートフォンのスクリーンショット(縦長)を想定。横幅はコンテナに
  // 収まらせ(max-w-full)、縦長画像が画面を占有しすぎないよう
  // 最大高さを制限する(max-h-*)。ファイルを差し替えるだけで表示が
  // 変わり、この設定自体はコード変更が不要な範囲(見た目の制約)に
  // とどめてある。
  //
  // w-full は付けない。widthを明示するとbox幅がコンテナ幅
  // (max-w-lgラッパー由来の480px)に固定され、max-h-[70vh]による
  // 高さ制約と組み合わさった結果、object-containが絵を実寸より
  // 小さく縮小して箱の中央に描画し、左右に大きな空白(レターボックス)
  // が生じていた(枠480×491pxに対し絵は226×491px、空白254px=
  // 枠面積の53%)。widthを指定しなければ、preflightのheight:autoと
  // max-heightの制約から幅が画像の縦横比(346:750)に基づいて
  // 逆算され、枠が絵の実寸に密着する。object-containは箱と絵の
  // 寸法差がなくなり不要になったため削除した(このimg以外での
  // 使用箇所なし。削除して問題ない)。中央寄せはmx-autoで維持する。
  img: (props) => (
    // eslint-disable-next-line @next/next/no-img-element -- public/help/配下の画像をファイル差し替えのみで反映させたいため、next/imageの最適化パイプライン(ビルド時の許可リスト等)を経由させない
    <img
      {...props}
      alt={props.alt ?? ""}
      loading="lazy"
      className="mx-auto mt-3 max-h-[70vh] max-w-full rounded-xl border border-slate-300 dark:border-slate-600"
    />
  ),
};

export default function HelpPage() {
  const source = fs.readFileSync(HELP_MARKDOWN_PATH, "utf-8");

  return (
    <main className="min-h-dvh bg-gradient-to-b from-indigo-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/*
        PC向け(lg: = 1024px以上)ではコンテナ幅を広げ、画像だけの段落を
        3カラムへ横並びさせる(globals.cssの.help-articleグリッド定義)。
        モバイルのbaseスタイル(max-w-lg)は変更しない、min-width方向の
        上乗せのみ(モバイルファースト原則、docs/decisions.md参照)。
      */}
      <div className="mx-auto max-w-lg px-4 py-6 lg:max-w-4xl">
        <div className="mb-1 flex items-center justify-end gap-2">
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition-all hover:border-indigo-400 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
          >
            <span aria-hidden="true">🔍</span>
            検索画面へ
          </Link>
        </div>

        <article className="help-article mt-4">
          <Markdown components={components}>{source}</Markdown>
        </article>
      </div>

      <BackToTopButton />
    </main>
  );
}

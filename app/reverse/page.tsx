import { Suspense } from "react";
import Link from "next/link";
import {
  getAcronymIndexCounts,
  getAcronymsByIndexKey,
  type IndexKeyCount,
} from "@/lib/db-server";
import {
  normalizeIndexKeyParam,
  resolveIndexSelection,
  sortIndexKeyCounts,
} from "@/lib/reverse-index";
import { ResultBrowser } from "./ResultBrowser";

// searchParamsを読むページはNext.jsが自動的に動的レンダリングにするが、
// 意図を明示し将来の変更で静的化されることを防ぐため明示しておく
// (app/api/search/route.ts と同じ方針。decisions.md 7章参照)。
export const dynamic = "force-dynamic";

function IndexBar({
  counts,
  selectedKey,
}: {
  counts: IndexKeyCount[];
  selectedKey: string | null;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {counts.map((c) => (
        <Link
          key={c.key}
          href={`/reverse?key=${encodeURIComponent(c.key)}`}
          prefetch={false}
          scroll={false}
          className={
            c.key === selectedKey
              ? "rounded-full bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-all"
              : "rounded-full border-2 border-slate-400 bg-white px-3 py-2 text-sm text-slate-700 transition-all hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          }
        >
          {c.key}
          <span className="ml-1 text-xs opacity-70">[{c.count}]</span>
        </Link>
      ))}
    </div>
  );
}

async function ResultList({
  promise,
}: {
  promise: ReturnType<typeof getAcronymsByIndexKey>;
}) {
  const { data, error } = await promise;

  if (error || !data) {
    return <p className="text-red-600">⚠ 読み込みに失敗しました</p>;
  }

  if (data.length === 0) {
    // 集計クエリに現れるキーは必ず件数>=1のため通常到達しないが、
    // 集計と一覧を別クエリで独立に取得している以上、理論上の
    // 空振り(集計後の削除等)にも対応しておく。
    return <p className="text-sm text-slate-500">該当なし</p>;
  }

  return <ResultBrowser items={data} />;
}

export default async function ReverseIndexPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const normalizedKey = normalizeIndexKeyParam(searchParams.key);

  // 集計クエリと一覧クエリを並列に投げる。この時点ではキーの妥当性は
  // まだ確定していないが、一覧クエリは等値比較のため無効なキーでも
  // 単に0件が返るだけで副作用はない(3-3参照)。妥当性が確定してから
  // 描画に使うかどうかを判断する(下のresolveIndexSelection)。
  const countsPromise = getAcronymIndexCounts();
  const listPromise = normalizedKey
    ? getAcronymsByIndexKey(normalizedKey)
    : null;

  const { data: countsData, error: countsError } = await countsPromise;

  if (countsError || !countsData) {
    return (
      <main className="min-h-dvh bg-gradient-to-b from-indigo-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <div className="mx-auto max-w-lg px-4 py-6">
          <p className="text-red-600">⚠ 読み込みに失敗しました</p>
        </div>
      </main>
    );
  }

  const counts = sortIndexKeyCounts(countsData);
  const availableKeys = counts.map((c) => c.key);
  const selectedKey = resolveIndexSelection(normalizedKey, availableKeys);

  return (
    <main className="min-h-dvh bg-gradient-to-b from-indigo-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">逆引き辞書</h1>
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 transition-all hover:border-indigo-400 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
          >
            <span aria-hidden="true">🔍</span>
            検索画面へ
          </Link>
        </div>
        <p className="mb-5 text-sm text-slate-500">
          アクロニムの先頭文字を選ぶと一覧が表示されます（[ ]内は登録件数）
        </p>

        <IndexBar counts={counts} selectedKey={selectedKey} />

        <div className="mt-5">
          {selectedKey && listPromise ? (
            <Suspense
              key={selectedKey}
              fallback={
                <p className="text-sm text-slate-500">読み込み中...</p>
              }
            >
              <ResultList promise={listPromise} />
            </Suspense>
          ) : (
            <p className="text-sm text-slate-500">上のキーを選んでください</p>
          )}
        </div>
      </div>
    </main>
  );
}

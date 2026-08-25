"use client";

import { useEffect, useState } from "react";
import type { AcronymRelated, AcronymTag } from "@/lib/types";

// 主タグ・副タグをまとめてピル表示する。主タグは塗りつぶし、
// 副タグは枠線のみで視覚的に区別する。flex-wrapで折り返し、
// 375px幅でも横スクロールを起こさないようbreak-words/max-w-fullを
// 各ピルに付与する。
export function TagPills({ tags }: { tags: AcronymTag[] }) {
  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className={
            tag.is_primary
              ? "max-w-full whitespace-normal break-words rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white"
              : "max-w-full whitespace-normal break-words rounded-full bg-indigo-50 px-3 py-1 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
          }
        >
          {tag.name}
        </span>
      ))}
    </div>
  );
}

const linkClassName =
  "max-w-full whitespace-normal break-words rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-600 dark:text-slate-300 dark:hover:border-indigo-500 dark:hover:text-indigo-400";

// 詳細表示を開いた時点でホモニム(同義語衝突)と概念的関連の両方を
// 単一エンドポイントから取得する。両方0件ならセクション自体を
// 非表示にする。idが変わるたびに取り直す。
//
// リンクをNext.jsのページ遷移(<Link href="/?id=...">)にしないこと。
// 外部から?id=で直接開くディープリンク経路とは別に保つため、
// クリック時は呼び出し側が渡すonNavigateコールバックを呼ぶだけに
// とどめる。呼び出し側(検索画面/逆引き画面それぞれ)が「現在の画面は
// そのまま、詳細の中身だけをその場で差し替える」処理を持つことで、
// /reverseから辿った場合に背後の逆引き一覧が検索画面へ置き換わって
// しまう問題を避ける(2026-08-26修正)。
export function RelatedTerms({
  id,
  onNavigate,
}: {
  id: string;
  onNavigate: (id: string) => void;
}) {
  const [data, setData] = useState<AcronymRelated | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);

    fetch(`/api/acronym/${id}/related`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json) {
          setData(json as AcronymRelated);
        }
      })
      .catch(() => {
        // 関連用語の取得失敗は詳細表示自体をブロックしない
        // (セクション非表示のまま静かに諦める)。
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!data || (data.homonyms.length === 0 && data.relations.length === 0)) {
    return null;
  }

  return (
    <div className="mt-5 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
      <p className="text-xs font-semibold text-slate-400">関連用語</p>

      {data.homonyms.length > 0 && (
        <div>
          <p className="text-xs text-slate-500">同じ略語の別の意味</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {data.homonyms.map((homonym) => (
              <button
                type="button"
                key={homonym.id}
                onClick={() => onNavigate(homonym.id)}
                className={linkClassName}
              >
                {homonym.acronym} = {homonym.full_spelling}
              </button>
            ))}
          </div>
        </div>
      )}

      {data.relations.length > 0 && (
        <div>
          <p className="text-xs text-slate-500">関連する用語</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {data.relations.map((relation) => (
              <button
                type="button"
                key={relation.id}
                onClick={() => onNavigate(relation.related.id)}
                className={linkClassName}
              >
                {relation.related.acronym}
                {relation.relation_note ? `（${relation.relation_note}）` : ""}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

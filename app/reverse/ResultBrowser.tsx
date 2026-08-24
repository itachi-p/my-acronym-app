"use client";

import { useState } from "react";
import Link from "next/link";
import type { Acronym } from "@/lib/types";

function DetailPanel({ item }: { item: Acronym }) {
  return (
    <div className="mt-2 rounded-xl border-2 border-indigo-200 bg-white p-4 dark:border-indigo-800/40 dark:bg-slate-900">
      <div className="text-sm text-slate-500">{item.full_spelling}</div>

      <dl className="mt-2 space-y-2">
        <div>
          <dt className="text-xs font-semibold text-slate-400">日本語訳</dt>
          <dd className="font-medium text-slate-800 dark:text-slate-200">
            {item.japanese_translation}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-semibold text-slate-400">概要</dt>
          <dd className="leading-relaxed text-slate-700 dark:text-slate-300">
            {item.description}
          </dd>
        </div>
      </dl>

      <Link
        href={`/?q=${encodeURIComponent(item.acronym)}`}
        className="mt-3 inline-block text-sm text-indigo-600 hover:underline dark:text-indigo-400"
      >
        検索画面で開く →
      </Link>
    </div>
  );
}

export function ResultBrowser({ items }: { items: Acronym[] }) {
  // 件数が増えるほど全件を縦に展開表示すると読みたい1件を探すのに
  // スクロールが長くなるため、一覧はコンパクトな行だけを並べ、
  // タップした1件だけをその場に展開する(アコーディオン)。
  // 複数展開すると結局縦長になり目的を損なうため、開くのは常に1件のみ。
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const isOpen = item.id === openId;

        return (
          <div key={item.id}>
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : item.id)}
              aria-expanded={isOpen}
              className={
                isOpen
                  ? "w-full rounded-xl border-2 border-indigo-400 bg-indigo-50 p-4 text-left transition-all dark:border-indigo-500 dark:bg-slate-800"
                  : "w-full rounded-xl border-2 border-slate-300 bg-slate-50 p-4 text-left transition-all hover:border-indigo-400 hover:bg-indigo-50 hover:shadow-md dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
              }
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold text-indigo-700 dark:text-indigo-300">
                  {item.acronym}
                </div>
                <span aria-hidden="true" className="shrink-0 text-slate-400">
                  {isOpen ? "▾" : "▸"}
                </span>
              </div>
              <div className="text-sm text-slate-700 dark:text-slate-300">
                {item.japanese_translation}
              </div>
            </button>

            {isOpen && <DetailPanel item={item} />}
          </div>
        );
      })}
    </div>
  );
}

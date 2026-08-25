"use client";

import { useState } from "react";
import Link from "next/link";
import type { Acronym } from "@/lib/types";
import { RelatedTerms, TagPills } from "@/components/AcronymDetail";

// タグ・本文・関連用語など、アコーディオン展開(DetailPanel)と
// オーバーレイ(DetailOverlay)の両方で共有する中身。
// onNavigateは関連用語クリック時に呼ばれ、ページ遷移はしない
// (呼び出し元のopenDetailByIdがオーバーレイの中身をその場で
// 差し替える。詳細はResultBrowserのコメント参照)。
function DetailBody({
  item,
  onNavigate,
}: {
  item: Acronym;
  onNavigate: (id: string) => void;
}) {
  return (
    <>
      <div className="mt-2">
        <TagPills tags={item.tags} />
      </div>

      <dl className="mt-2 space-y-2">
        <div>
          <dt className="text-xs font-semibold text-slate-400">日本語訳</dt>
          <dd className="break-words font-medium text-slate-800 dark:text-slate-200">
            {item.japanese_translation}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-semibold text-slate-400">概要</dt>
          <dd className="break-words leading-relaxed text-slate-700 dark:text-slate-300">
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

      <RelatedTerms id={item.id} onNavigate={onNavigate} />
    </>
  );
}

// アコーディオンでタップした行の直下に展開する詳細(現行一覧に
// 含まれるitemのみが対象)。
function DetailPanel({
  item,
  onNavigate,
}: {
  item: Acronym;
  onNavigate: (id: string) => void;
}) {
  return (
    <div className="mt-2 rounded-xl border-2 border-indigo-200 bg-white p-4 dark:border-indigo-800/40 dark:bg-slate-900">
      <div className="break-words text-sm text-slate-500">{item.full_spelling}</div>
      <DetailBody item={item} onNavigate={onNavigate} />
    </div>
  );
}

// 関連用語から辿った先(現行一覧には含まれない可能性がある)を表示する
// オーバーレイ。逆引き一覧を含む背後の画面には一切手を触れない。
function DetailOverlay({
  item,
  onClose,
  onNavigate,
}: {
  item: Acronym;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-16 backdrop-blur-sm sm:items-center sm:pt-4"
      onClick={onClose}
    >
      <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="animate-fade-in rounded-2xl border border-indigo-200/60 bg-white p-5 shadow-xl shadow-indigo-200/60 dark:border-indigo-800/40 dark:bg-slate-900">
          <div className="mb-1 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words text-3xl font-bold text-indigo-600 dark:text-indigo-400">
                {item.acronym}
              </h2>
              <p className="mt-1 break-words text-sm text-slate-500">{item.full_spelling}</p>
            </div>
            <button
              onClick={onClose}
              aria-label="閉じる"
              className="shrink-0 rounded-full p-2 text-lg leading-none text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              ✕
            </button>
          </div>

          <DetailBody item={item} onNavigate={onNavigate} />
        </div>
      </div>
    </div>
  );
}

export function ResultBrowser({ items }: { items: Acronym[] }) {
  // 件数が増えるほど全件を縦に展開表示すると読みたい1件を探すのに
  // スクロールが長くなるため、一覧はコンパクトな行だけを並べ、
  // タップした1件だけをその場に展開する(アコーディオン)。
  // 複数展開すると結局縦長になり目的を損なうため、開くのは常に1件のみ。
  const [openId, setOpenId] = useState<string | null>(null);

  // 関連用語(ホモニム/概念的関連)から辿った先はitemsに含まれるとは
  // 限らないため、openIdのアコーディオンとは別にオーバーレイで表示する。
  // これにより、逆引き一覧(items・選択中の頭文字キー)には一切触れずに
  // 関連用語を連続して辿れる。オーバーレイを閉じれば元の逆引き一覧に
  // 戻る(2026-08-26: 以前はRelatedTermsが/?id=への実ページ遷移だった
  // ため、背後の逆引き一覧ごと検索画面に置き換わってしまっていた)。
  const [overlayItem, setOverlayItem] = useState<Acronym | null>(null);

  const openDetailById = (id: string) => {
    fetch(`/api/acronym/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((item) => {
        if (item && !item.error) {
          setOverlayItem(item as Acronym);
        }
      })
      .catch(() => {});
  };

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
                {/*
                  このdivのclassは e2e/reverse-lookup.spec.ts が
                  `div[class="font-bold text-indigo-700 dark:text-indigo-300"]`
                  で完全一致セレクタとして依存している。break-words等を
                  追加すると一致しなくなりテストが壊れるため変更しない
                  (acronym自体は短い文字列のため、折り返し防御の優先度は低い)。
                */}
                <div className="font-bold text-indigo-700 dark:text-indigo-300">
                  {item.acronym}
                </div>
                <span aria-hidden="true" className="shrink-0 text-slate-400">
                  {isOpen ? "▾" : "▸"}
                </span>
              </div>
              <div className="break-words text-sm text-slate-700 dark:text-slate-300">
                {item.japanese_translation}
              </div>
            </button>

            {isOpen && (
              <DetailPanel item={item} onNavigate={openDetailById} />
            )}
          </div>
        );
      })}

      {overlayItem && (
        <DetailOverlay
          item={overlayItem}
          onClose={() => setOverlayItem(null)}
          onNavigate={openDetailById}
        />
      )}
    </div>
  );
}

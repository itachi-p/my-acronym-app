"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAllAcronyms } from "@/lib/supabase";
import { CATEGORIES, type Acronym, type Category } from "@/lib/types";

function matchesQuery(acronym: Acronym, query: string): boolean {
  const q = query.toUpperCase();
  return (
    acronym.acronym.toUpperCase().includes(q) ||
    acronym.full_spelling.toUpperCase().includes(q) ||
    acronym.japanese_translation.includes(query) ||
    acronym.reading.includes(query)
  );
}

function DetailCard({ item }: { item: Acronym }) {
  const wikiUrl = `https://ja.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(item.acronym)}`;
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(item.acronym + " 略語 意味")}`;

  return (
    <div className="animate-fade-in rounded-2xl border border-indigo-200/60 bg-white p-5 shadow-lg shadow-indigo-100/50 dark:border-indigo-800/40 dark:bg-slate-900 dark:shadow-indigo-950/30">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-indigo-600 dark:text-indigo-400">
            {item.acronym}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {item.full_spelling}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          {item.category}
        </span>
      </div>

      <dl className="space-y-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            カタカナ読み
          </dt>
          <dd className="mt-0.5 text-base text-slate-800 dark:text-slate-200">
            {item.reading}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            日本語訳
          </dt>
          <dd className="mt-0.5 text-base font-medium text-slate-800 dark:text-slate-200">
            {item.japanese_translation}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            概要
          </dt>
          <dd className="mt-0.5 leading-relaxed text-slate-700 dark:text-slate-300">
            {item.description}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex gap-2">
        <a
          href={wikiUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-center text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          Wikipedia で検索
        </a>
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-center text-sm font-medium text-white transition hover:bg-indigo-700"
        >
          Google で検索
        </a>
      </div>
    </div>
  );
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("すべて");
  const [acronyms, setAcronyms] = useState<Acronym[]>([]);
  const [selected, setSelected] = useState<Acronym | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    fetchAllAcronyms().then((data) => {
      setAcronyms(data);
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => {
    let results = acronyms;

    if (category !== "すべて") {
      results = results.filter((a) => a.category === category);
    }

    if (query.trim()) {
      results = results.filter((a) => matchesQuery(a, query.trim()));
    }

    return results;
  }, [acronyms, query, category]);

  const exactMatch = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.trim().toUpperCase();
    return acronyms.find((a) => a.acronym.toUpperCase() === q) ?? null;
  }, [acronyms, query]);

  const showAiButton = query.trim().length > 0 && !exactMatch && !aiLoading;

  const handleSelect = useCallback((item: Acronym) => {
    setSelected(item);
    setAiError(null);
  }, []);

  const handleAiGenerate = useCallback(async () => {
    const term = query.trim().toUpperCase();
    if (!term) return;

    setAiLoading(true);
    setAiError(null);

    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acronym: term }),
      });

      const data = await res.json();

      if (!res.ok) {
        setAiError(data.error ?? "AI生成に失敗しました");
        return;
      }

      const newAcronym = data as Acronym;
      setAcronyms((prev) =>
        [...prev.filter((a) => a.id !== newAcronym.id), newAcronym].sort(
          (a, b) => a.acronym.localeCompare(b.acronym)
        )
      );
      setSelected(newAcronym);
    } catch {
      setAiError("通信エラーが発生しました");
    } finally {
      setAiLoading(false);
    }
  }, [query]);

  return (
    <div className="min-h-dvh bg-gradient-to-b from-indigo-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 pb-8 pt-safe">
        {/* Header */}
        <header className="pb-4 pt-6">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Acronym Finder
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            英略語をリアルタイム検索
          </p>
        </header>

        {/* Search Input */}
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
              setAiError(null);
            }}
            placeholder="略語を入力 (例: API, CEO)"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="w-full rounded-2xl border border-slate-200 bg-white py-4 pl-12 pr-4 text-lg shadow-sm outline-none ring-indigo-500 transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                setSelected(null);
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
              aria-label="クリア"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Category Tabs */}
        <div className="scrollbar-hide -mx-4 mt-4 overflow-x-auto px-4">
          <div className="flex gap-2 pb-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => {
                  setCategory(cat);
                  setSelected(null);
                }}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                  category === cat
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-200 dark:shadow-indigo-900/50"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Content Area */}
        <div className="mt-5 flex-1 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
            </div>
          ) : selected ? (
            <div>
              <button
                onClick={() => setSelected(null)}
                className="mb-3 flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 dark:text-indigo-400"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                一覧に戻る
              </button>
              <DetailCard item={selected} />
            </div>
          ) : (
            <>
              {query.trim() && (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {filtered.length} 件の候補
                </p>
              )}

              <ul className="space-y-2">
                {filtered.map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => handleSelect(item)}
                      className="w-full rounded-xl border border-slate-100 bg-white px-4 py-3.5 text-left shadow-sm transition hover:border-indigo-200 hover:shadow-md active:scale-[0.99] dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-800"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                          {item.acronym}
                        </span>
                        <span className="truncate text-xs text-slate-400">
                          {item.category}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-slate-600 dark:text-slate-300">
                        {item.japanese_translation}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>

              {!query.trim() && filtered.length === 0 && (
                <p className="py-16 text-center text-slate-400">
                  略語を入力して検索してください
                </p>
              )}

              {query.trim() && filtered.length === 0 && !aiLoading && (
                <p className="py-8 text-center text-slate-400">
                  「{query.trim().toUpperCase()}」は見つかりませんでした
                </p>
              )}
            </>
          )}

          {/* AI Generate Button */}
          {showAiButton && !selected && (
            <div className="sticky bottom-4 pt-2">
              <button
                onClick={handleAiGenerate}
                disabled={aiLoading}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-indigo-300/40 transition hover:from-violet-700 hover:to-indigo-700 active:scale-[0.98] disabled:opacity-60 dark:shadow-indigo-900/50"
              >
                🤖 AIで「{query.trim().toUpperCase()}」を新規検索して保存する
              </button>
            </div>
          )}

          {aiLoading && (
            <div className="flex items-center justify-center gap-3 py-6">
              <div className="h-6 w-6 animate-spin rounded-full border-3 border-indigo-200 border-t-indigo-600" />
              <span className="text-sm text-slate-500">AIが解析中...</span>
            </div>
          )}

          {aiError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {aiError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

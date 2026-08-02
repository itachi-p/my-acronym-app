"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CATEGORIES, CATEGORY_DISPLAY_NAMES, type Acronym, type Category } from "@/lib/types";

function DetailCard({ item }: { item: Acronym }) {
  const wikiUrl = `https://ja.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(
    item.acronym
  )}`;
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(
    `${item.acronym} 略語 意味`
  )}`;

  return (
    <div className="animate-fade-in rounded-2xl border border-indigo-200/60 bg-white p-5 shadow-lg shadow-indigo-100/50 dark:border-indigo-800/40 dark:bg-slate-900">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">
            {item.acronym}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{item.full_spelling}</p>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          {item.category}
        </span>
      </div>

      <dl className="space-y-3">
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

      <div className="mt-5 flex gap-2">
        <a
          href={wikiUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-xl border-2 border-slate-300 bg-white px-4 py-2 text-center text-sm font-medium text-slate-800 transition-all hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          Wikipedia
        </a>

        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white transition-all hover:bg-indigo-700"
        >
          Google検索
        </a>
      </div>
    </div>
  );
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Acronym[]>([]);
  const [selected, setSelected] = useState<Acronym | null>(null);
  const [category, setCategory] = useState<Category>("すべて");
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (value: string) => {
    if (value.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
      const data = await res.json();

      setResults(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (value: string) => {
    const q = value.toUpperCase();

    setQuery(q);
    setSelected(null);
    setAiError(null);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      search(q);
    }, 300);
  };

  const handleAiGenerate = async () => {
    setAiLoading(true);
    setAiError(null);

    try {
      const res = await fetch("/api/acronym", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          acronym: query,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "AI生成失敗");
      }

      setSelected(data);
      setResults([data]);
    } catch (error: unknown) {
      setAiError(error instanceof Error ? error.message : "通信エラー");
    } finally {
      setAiLoading(false);
    }
  };

  const filtered =
    category === "すべて"
      ? results
      : results.filter((item) => item.category === category);

  return (
    <main className="min-h-dvh bg-gradient-to-b from-indigo-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="mx-auto max-w-lg px-4 py-6">
        <h1 className="mb-1 text-2xl font-bold">Acronym Finder</h1>

        <p className="mb-5 text-sm text-slate-500">
          英略語の正式名称と意味を検索
        </p>

        <input
          ref={inputRef}
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="略語を入力 (例: CEO, API)"
          autoCapitalize="characters"
          className="w-full rounded-xl border-2 border-indigo-300 bg-white px-4 py-3 text-lg text-slate-900 placeholder-slate-500 focus:border-indigo-600 focus:outline-none dark:border-indigo-700 dark:bg-slate-800 dark:text-white"
        />

        <div className="mt-4 flex gap-2 overflow-x-auto">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={
                category === cat
                  ? "whitespace-nowrap rounded-full bg-indigo-600 px-3 py-1 text-sm font-medium text-white transition-all"
                  : "whitespace-nowrap rounded-full border-2 border-slate-400 bg-white px-3 py-1 text-sm text-slate-700 transition-all hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }
            >
              {CATEGORY_DISPLAY_NAMES[cat]}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          {loading && <p>検索中...</p>}

          {selected ? (
            <>
              <button onClick={() => setSelected(null)} className="text-indigo-600">
                ← 戻る
              </button>

              <DetailCard item={selected} />
            </>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelected(item)}
                className="w-full rounded-xl border-2 border-slate-300 bg-slate-50 p-4 text-left transition-all hover:border-indigo-400 hover:bg-indigo-50 hover:shadow-md dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
              >
                <div className="font-bold text-indigo-700 dark:text-indigo-300">{item.acronym}</div>
                <div className="text-sm text-slate-700 dark:text-slate-300">{item.japanese_translation}</div>
              </button>
            ))
          )}

          {query.length >= 2 && !loading && results.length === 0 && !aiLoading && (
            <button
              onClick={handleAiGenerate}
              className="w-full rounded-2xl bg-indigo-600 px-5 py-4 text-white"
            >
              🤖 AIで「{query}」を調査して登録
            </button>
          )}

          {aiLoading && <p>Geminiで調査中...</p>}

          {aiError && <p className="text-red-600">{aiError}</p>}
        </div>
      </div>
    </main>
  );
}

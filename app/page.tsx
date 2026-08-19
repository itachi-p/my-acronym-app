"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ACRONYM_CATEGORIES,
  CATEGORIES,
  CATEGORY_DISPLAY_NAMES,
  type Acronym,
  type AcronymCategory,
  type Category,
} from "@/lib/types";

function DetailCard({ item }: { item: Acronym }) {
  const wikiUrl = `https://ja.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(
    item.full_spelling
  )}`;
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(
    `${item.acronym} ${item.full_spelling}`
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
  const [searchError, setSearchError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [manualFormOpen, setManualFormOpen] = useState(false);
  const [manualFullSpelling, setManualFullSpelling] = useState("");
  const [manualJapanese, setManualJapanese] = useState("");
  const [manualCategory, setManualCategory] = useState<AcronymCategory>(
    ACRONYM_CATEGORIES[0]
  );
  const [manualDescription, setManualDescription] = useState("");
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (value: string) => {
    if (value.length < 2) {
      setResults([]);
      setSearchError(null);
      return;
    }

    setLoading(true);
    setSearchError(null);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
      const data = await res.json();

      if (!res.ok || !Array.isArray(data)) {
        setResults([]);
        setSearchError(
          typeof data?.error === "string" ? data.error : "検索に失敗しました"
        );
        return;
      }

      setResults(data);
    } catch (error) {
      console.error(error);
      setResults([]);
      setSearchError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (value: string) => {
    // 入力の強制大文字化はしない。TOCfE (Theory of Constraints for
    // Education) のように大小文字混在の略語が存在し、変換すると
    // 元の表記を復元できないため、入力されたままの表記を保持する。
    setQuery(value);
    setSelected(null);
    setSearchError(null);
    setAiError(null);
    setManualFormOpen(false);
    setManualError(null);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      search(value);
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
        const message =
          data && typeof data === "object" && "error" in data
            ? String((data as { error?: unknown }).error)
            : "AI生成失敗";

        throw new Error(message);
      }

      // 登録直後はGET /api/searchを叩き直さず、POSTの戻り値を
      // そのまま反映する。1件のみ登録された場合は詳細を直接開き、
      // 複数の解釈が登録された場合は一覧から選ばせる。
      const items = Array.isArray(data) ? (data as Acronym[]) : [];

      setResults(items);
      setSelected(items.length === 1 ? items[0] : null);
    } catch (error: unknown) {
      setAiError(error instanceof Error ? error.message : "通信エラー");
    } finally {
      setAiLoading(false);
    }
  };

  const handleManualSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setManualLoading(true);
    setManualError(null);

    try {
      const res = await fetch("/api/acronym/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          acronym: query,
          full_spelling: manualFullSpelling,
          japanese_translation: manualJapanese,
          category: manualCategory,
          description: manualDescription,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const message =
          data && typeof data === "object" && "error" in data
            ? String((data as { error?: unknown }).error)
            : "登録に失敗しました";

        throw new Error(message);
      }

      const newItem = data as Acronym;

      // 既存の一覧に追記して選択状態にする。ここでも
      // GET /api/searchへの再検索は行わない。
      setResults((prev) => [...prev, newItem]);
      setSelected(newItem);
      setManualFormOpen(false);
      setManualFullSpelling("");
      setManualJapanese("");
      setManualCategory(ACRONYM_CATEGORIES[0]);
      setManualDescription("");
    } catch (error: unknown) {
      setManualError(error instanceof Error ? error.message : "通信エラー");
    } finally {
      setManualLoading(false);
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
          placeholder="略語を入力 (例: CEO, API, TOCfE)"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
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
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold text-indigo-700 dark:text-indigo-300">{item.acronym}</div>
                  <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                    {CATEGORY_DISPLAY_NAMES[item.category]}
                  </span>
                </div>
                <div className="text-sm text-slate-700 dark:text-slate-300">{item.japanese_translation}</div>
              </button>
            ))
          )}

          {searchError && <p className="text-red-600">⚠ {searchError}</p>}

          {query.length >= 2 &&
            !loading &&
            !searchError &&
            results.length === 0 &&
            !aiLoading && (
              <button
                onClick={handleAiGenerate}
                className="w-full rounded-2xl bg-indigo-600 px-5 py-4 text-white"
              >
                🤖 AIで「{query}」を調査して登録
              </button>
            )}

          {aiLoading && <p>AIで調査中...</p>}

          {aiError && <p className="text-red-600">{aiError}</p>}

          {query.length >= 2 && !loading && !searchError && (
            <div>
              {manualFormOpen ? (
                <form
                  onSubmit={handleManualSubmit}
                  className="space-y-3 rounded-2xl border-2 border-slate-300 bg-white p-4 dark:border-slate-600 dark:bg-slate-800"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      「{query}」を手動で登録
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setManualFormOpen(false);
                        setManualError(null);
                      }}
                      className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                    >
                      閉じる
                    </button>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400">正式名称</label>
                    <input
                      value={manualFullSpelling}
                      onChange={(e) => setManualFullSpelling(e.target.value)}
                      required
                      className="mt-1 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400">日本語訳</label>
                    <input
                      value={manualJapanese}
                      onChange={(e) => setManualJapanese(e.target.value)}
                      required
                      className="mt-1 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400">カテゴリ</label>
                    <select
                      value={manualCategory}
                      onChange={(e) => setManualCategory(e.target.value as AcronymCategory)}
                      className="mt-1 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                    >
                      {ACRONYM_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400">説明</label>
                    <textarea
                      value={manualDescription}
                      onChange={(e) => setManualDescription(e.target.value)}
                      required
                      rows={3}
                      className="mt-1 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                    />
                  </div>

                  {manualError && <p className="text-sm text-red-600">{manualError}</p>}

                  <button
                    type="submit"
                    disabled={manualLoading}
                    className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {manualLoading ? "登録中..." : "登録する"}
                  </button>
                </form>
              ) : (
                !aiLoading && (
                  <button
                    onClick={() => {
                      setManualFormOpen(true);
                      setManualError(null);
                    }}
                    className="w-full rounded-xl border-2 border-dashed border-slate-400 px-4 py-2 text-sm text-slate-600 transition-all hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-600 dark:text-slate-300 dark:hover:border-indigo-500 dark:hover:text-indigo-400"
                  >
                    {results.length === 0
                      ? "✍️ 手動で登録"
                      : `✍️ 「${query}」に別の意味を手動で追加`}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

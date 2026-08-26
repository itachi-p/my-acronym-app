"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ALL_DISPLAY_GROUP,
  getPrimaryTag,
  type Acronym,
  type DisplayGroup,
  type Tag,
} from "@/lib/types";
import { RelatedTerms, TagPills } from "@/components/AcronymDetail";

const MAX_SECONDARY_TAGS = 2;

function DetailCard({
  item,
  onClose,
  onNavigate,
}: {
  item: Acronym;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const wikiUrl = `https://ja.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(
    item.full_spelling
  )}`;
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(
    `${item.acronym} ${item.full_spelling}`
  )}`;

  return (
    <div className="animate-fade-in rounded-2xl border border-indigo-200/60 bg-white p-5 shadow-xl shadow-indigo-200/60 dark:border-indigo-800/40 dark:bg-slate-900">
      <div className="mb-4 flex items-start justify-between gap-3">
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

      <TagPills tags={item.tags} />

      <dl className="mt-4 space-y-3">
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

      <RelatedTerms id={item.id} onNavigate={onNavigate} />
    </div>
  );
}

function HomeContent() {
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isComposingRef = useRef(false);
  const searchParams = useSearchParams();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Acronym[]>([]);
  const [selected, setSelected] = useState<Acronym | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>(ALL_DISPLAY_GROUP);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRejectedInfo, setAiRejectedInfo] = useState<{
    count: number;
    reasonCodes: string[];
  } | null>(null);

  const [tags, setTags] = useState<Tag[]>([]);
  const [displayGroups, setDisplayGroups] = useState<DisplayGroup[]>([]);

  const [manualFormOpen, setManualFormOpen] = useState(false);
  const [manualFullSpelling, setManualFullSpelling] = useState("");
  const [manualJapanese, setManualJapanese] = useState("");
  const [manualPrimaryTag, setManualPrimaryTag] = useState("");
  const [manualSecondaryTags, setManualSecondaryTags] = useState<string[]>([]);
  const [manualDescription, setManualDescription] = useState("");
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // UIのボタン(表示グループ)とタグ選択肢は tags.display_group /
  // sort_order から動的に生成する。ハードコードされたカテゴリ配列は
  // 廃止した(タグを増減してもこのファイルの変更が不要になる)。
  useEffect(() => {
    fetch("/api/tags")
      .then((res) => res.json())
      .then((json) => {
        if (json && !json.error) {
          setTags(json.tags ?? []);
          setDisplayGroups(json.displayGroups ?? []);
        }
      })
      .catch(() => {
        // タグ一覧の取得失敗時はボタンが「すべて」のみになるだけで、
        // 検索自体は継続できるため致命的エラー扱いにしない。
      });
  }, []);

  useEffect(() => {
    if (tags.length > 0 && !manualPrimaryTag) {
      setManualPrimaryTag(tags[0].name);
    }
  }, [tags, manualPrimaryTag]);

  const search = useCallback(async (value: string) => {
    if (value.length < 2) {
      setResults([]);
      setSearchError(null);
      return [];
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
        return [];
      }

      setResults(data);
      return data as Acronym[];
    } catch (error) {
      console.error(error);
      setResults([]);
      setSearchError("通信エラーが発生しました");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // 指定idのレコードを取得し、詳細ポップアップの中身だけを差し替える。
  // 検索欄・結果一覧(results)には一切触れない。
  // - 外部からの ?id= ディープリンク起動(下のuseEffect)
  // - 詳細内の関連用語(ホモニム/概念的関連)クリックによる画面内遷移
  // の両方がこの関数を経由するが、後者はURLを一切変更しない
  // (ページ遷移ではなくコールバック呼び出しのみ)。/reverseの
  // 逆引き一覧が背後で検索画面に置き換わってしまう問題を避けるため、
  // 画面内遷移は常にこの「その場で中身だけ差し替える」方式に統一する
  // (2026-08-26修正。以前はRelatedTermsが<Link href="/?id=...">で
  // 実ページ遷移していたため、/reverseから辿ると背後の逆引き一覧
  // ごと検索画面に置き換わっていた)。
  const openDetailById = useCallback((id: string) => {
    fetch(`/api/acronym/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((item) => {
        if (item && !item.error) {
          setSelected(item as Acronym);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // ?id= はページ読み込み時点の外部ディープリンク専用の受け口。
    // 画面内での関連用語遷移はopenDetailByIdを直接呼ぶだけでURLを
    // 変更しないため、このeffectを再発火させない。
    const id = searchParams.get("id");

    if (id) {
      openDetailById(id);
      return;
    }

    // iOSショートカット等、URLに ?q=XX を付けて外部起動された場合は
    // その場で検索まで自動で行う(手早く調べるのが目的の起動経路なので、
    // 起動後にもう一度入力させない)。1件だけヒットした場合はそのまま
    // 詳細を開く。通常のブラウザ起動時(qなし)は従来通り入力欄へ
    // フォーカスするだけにする。
    const q = searchParams.get("q")?.trim();

    if (!q) {
      inputRef.current?.focus();
      return;
    }

    setQuery(q);

    search(q).then((items) => {
      if (items.length === 1) {
        setSelected(items[0]);
      }
    });
  }, [searchParams, search, openDetailById]);

  const handleChange = (value: string) => {
    // 入力の強制大文字化はしない。TOCfE (Theory of Constraints for
    // Education) のように大小文字混在の略語が存在し、変換すると
    // 元の表記を復元できないため、入力されたままの表記を保持する。
    setQuery(value);
    setSelected(null);
    setSearchError(null);
    setAiError(null);
    setAiRejectedInfo(null);
    setManualFormOpen(false);
    setManualError(null);
    // タブは前回の検索語に対する絞り込みなので、新しい検索語を
    // 打ち始めたら「すべて」に戻す。残したままだと、例えばITタブを
    // 選んだ状態で別の略語を検索した際、バックエンドは正しく返して
    // いるのに該当タブでないというだけで結果が表示されず
    // 「検索してもヒットしない」ように見えてしまう。
    setSelectedGroup(ALL_DISPLAY_GROUP);

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
    setAiRejectedInfo(null);

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

      // 候補が基準に合わず0件になったケースも200 + results:[] +
      // rejectedCountで返る(3-4参照)。res.ok===falseはGroq呼び出し
      // 自体の失敗等、真のエラーのみを意味する。
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
      const items = Array.isArray(data?.results) ? (data.results as Acronym[]) : [];
      const rejectedCount =
        typeof data?.rejectedCount === "number" ? data.rejectedCount : 0;
      const rejectedReasonCodes = Array.isArray(data?.rejectedReasonCodes)
        ? (data.rejectedReasonCodes as string[])
        : [];

      setResults(items);
      setSelected(items.length === 1 ? items[0] : null);
      setAiRejectedInfo(
        rejectedCount > 0
          ? { count: rejectedCount, reasonCodes: rejectedReasonCodes }
          : null
      );
    } catch (error: unknown) {
      setAiError(error instanceof Error ? error.message : "通信エラー");
    } finally {
      setAiLoading(false);
    }
  };

  const toggleSecondaryTag = (name: string) => {
    setManualSecondaryTags((prev) => {
      if (prev.includes(name)) {
        return prev.filter((n) => n !== name);
      }

      if (prev.length >= MAX_SECONDARY_TAGS) {
        return prev;
      }

      return [...prev, name];
    });
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
          tags: [manualPrimaryTag, ...manualSecondaryTags],
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
      setManualPrimaryTag(tags[0]?.name ?? "");
      setManualSecondaryTags([]);
      setManualDescription("");
    } catch (error: unknown) {
      setManualError(error instanceof Error ? error.message : "通信エラー");
    } finally {
      setManualLoading(false);
    }
  };

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    // IME変換確定のEnterでAI調査が誤発火しないようにする。
    // compositionイベントとnativeEvent.isComposingの両方を見るのは、
    // Safari等一部ブラウザでcompositionendの発火タイミングが
    // keydownより後ろにずれ、片方だけでは確定Enterを拾ってしまう
    // ケースがあるため。
    if (isComposingRef.current || e.nativeEvent.isComposing) return;

    // AIボタンの表示条件と揃える。結果が既にある状態でのEnterは
    // 何もしない(誤操作による不要なAI調査を防ぐ)。
    if (
      query.length < 2 ||
      loading ||
      searchError ||
      aiLoading ||
      results.length > 0
    ) {
      return;
    }

    handleAiGenerate();
  };

  const filtered =
    selectedGroup === ALL_DISPLAY_GROUP
      ? results
      : results.filter((item) =>
          item.tags.some((tag) => tag.display_group === selectedGroup)
        );

  const secondaryTagCandidates = tags.filter(
    (tag) => tag.name !== manualPrimaryTag
  );

  return (
    <main className="min-h-dvh bg-gradient-to-b from-indigo-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/*
        結果はポップアップ(オーバーレイ)で表示する。ショートカット等
        から起動して即座に1件へ自動遷移するケースを想定し、背後の
        検索画面をリセットせずに一目で読んで閉じられるようにするため。
        背景タップまたは✕ボタンで閉じる。
      */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-16 backdrop-blur-sm sm:items-center sm:pt-4"
          onClick={() => setSelected(null)}
        >
          <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <DetailCard
              item={selected}
              onClose={() => setSelected(null)}
              onNavigate={openDetailById}
            />
          </div>
        </div>
      )}

      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">Acronym Finder</h1>
          <Link
            href="/reverse"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 transition-all hover:border-indigo-400 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
          >
            <span aria-hidden="true">📖</span>
            逆引き辞書
          </Link>
        </div>

        <p className="mb-5 text-sm text-slate-500">
          英略語の正式名称と意味を検索
        </p>

        <input
          ref={inputRef}
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          placeholder="略語を入力 (例: CEO, API, TOCfE)"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full rounded-xl border-2 border-indigo-300 bg-white px-4 py-3 text-lg text-slate-900 placeholder-slate-500 focus:border-indigo-600 focus:outline-none dark:border-indigo-700 dark:bg-slate-800 dark:text-white"
        />

        {/*
          表示グループは7個固定ではなく tags.display_group から動的に
          決まる(将来増減しうる)。overflow-x-auto(横スクロール)だった
          ものをflex-wrapへ変更し、1行に収まらない分は折り返す。
          固定のグリッド列数(grid-cols-N)は使わない
          (グループ数が変わっても崩れない実装にするため)。
        */}
        <div className="mt-4 flex flex-wrap gap-2">
          {[ALL_DISPLAY_GROUP, ...displayGroups.map((g) => g.name)].map(
            (groupName) => (
              <button
                key={groupName}
                onClick={() => setSelectedGroup(groupName)}
                className={
                  selectedGroup === groupName
                    ? "whitespace-nowrap rounded-full bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-all"
                    : "whitespace-nowrap rounded-full border-2 border-slate-400 bg-white px-3 py-2 text-sm text-slate-700 transition-all hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                }
              >
                {groupName}
              </button>
            )
          )}
        </div>

        <div className="mt-5 space-y-3">
          {loading && <p>検索中...</p>}

          {filtered.map((item) => {
            const primaryTag = getPrimaryTag(item.tags);

            return (
              <button
                key={item.id}
                onClick={() => setSelected(item)}
                className="w-full rounded-xl border-2 border-slate-300 bg-slate-50 p-4 text-left transition-all hover:border-indigo-400 hover:bg-indigo-50 hover:shadow-md dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 break-words font-bold text-indigo-700 dark:text-indigo-300">{item.acronym}</div>
                  {primaryTag && (
                    <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                      {primaryTag.name}
                    </span>
                  )}
                </div>
                <div className="break-words text-sm text-slate-700 dark:text-slate-300">{item.japanese_translation}</div>
              </button>
            );
          })}

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

          {aiRejectedInfo &&
            (aiRejectedInfo.reasonCodes.includes("A1") ? (
              <div className="rounded-xl border-2 border-slate-300 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <p>
                  2文字の略語は誤登録が多いため、自動登録を制限しています。
                  必要な場合は手動登録から追加してください。
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setManualFormOpen(true);
                    setManualError(null);
                  }}
                  className="mt-2 font-medium text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400"
                >
                  手動で登録する
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                ℹ️ {aiRejectedInfo.count}件が基準に合わず登録されませんでした
              </p>
            ))}

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
                    <label className="text-xs font-semibold text-slate-400">主タグ</label>
                    <select
                      value={manualPrimaryTag}
                      onChange={(e) => {
                        const name = e.target.value;
                        setManualPrimaryTag(name);
                        setManualSecondaryTags((prev) =>
                          prev.filter((n) => n !== name)
                        );
                      }}
                      className="mt-1 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                    >
                      {tags.map((tag) => (
                        <option key={tag.id} value={tag.name}>
                          {tag.name}（{tag.display_group}）
                        </option>
                      ))}
                    </select>
                  </div>

                  {secondaryTagCandidates.length > 0 && (
                    <div>
                      <label className="text-xs font-semibold text-slate-400">
                        副タグ（任意・最大{MAX_SECONDARY_TAGS}件）
                      </label>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {secondaryTagCandidates.map((tag) => {
                          const active = manualSecondaryTags.includes(tag.name);

                          return (
                            <button
                              type="button"
                              key={tag.id}
                              aria-pressed={active}
                              onClick={() => toggleSecondaryTag(tag.name)}
                              disabled={
                                !active &&
                                manualSecondaryTags.length >= MAX_SECONDARY_TAGS
                              }
                              className={
                                active
                                  ? "rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-all"
                                  : "rounded-full border-2 border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition-all hover:border-indigo-400 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
                              }
                            >
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

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
                    disabled={manualLoading || !manualPrimaryTag}
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

        <div className="mt-8 text-center">
          <Link
            href="/help"
            className="text-xs text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
          >
            ヘルプ
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-gradient-to-b from-indigo-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950" />}>
      <HomeContent />
    </Suspense>
  );
}

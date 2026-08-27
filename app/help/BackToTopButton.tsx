"use client";

import { useEffect, useState } from "react";

// 一定量スクロールした後にのみ表示する(常時表示するとページ最上部でも
// 無意味なボタンが視界に入り続けるため)。300pxはモバイルで見出し+
// 本文1〜2ブロック分がスクロールアウトする程度の実測値。
const SHOW_AFTER_SCROLL_Y = 300;

export function BackToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > SHOW_AFTER_SCROLL_Y);
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
  };

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="トップに戻る"
      // bottomはenv(safe-area-inset-bottom)込みで計算し、PWAとして
      // 起動した際にホームインジケータ等と重ならないようにする。
      // 非表示時もDOMからは外さずopacity+pointer-eventsで切り替える
      // (アンマウント/再マウントより軽く、フェードも自然になるため)。
      className={`fixed right-4 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-50 flex h-12 w-12 items-center justify-center rounded-full border-2 border-indigo-300 bg-indigo-50/90 text-xl text-indigo-700 shadow-lg backdrop-blur transition-all duration-200 hover:border-indigo-400 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/90 dark:text-indigo-300 dark:hover:bg-indigo-900 ${
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0"
      }`}
    >
      <span aria-hidden="true">↑</span>
    </button>
  );
}

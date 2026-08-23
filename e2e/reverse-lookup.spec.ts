import { test, expect, type Page, type Locator } from "@playwright/test";

type Badge = { key: string; count: number };

async function getBadges(page: Page): Promise<Badge[]> {
  const links = page.locator('a[href^="/reverse?key="]');
  const total = await links.count();
  const badges: Badge[] = [];
  for (let i = 0; i < total; i++) {
    const link = links.nth(i);
    const href = await link.getAttribute("href");
    const key = decodeURIComponent(
      new URL(href!, "http://localhost").searchParams.get("key")!
    );
    // キー文字列とカウントをリンクの結合テキストから正規表現で分離すると、
    // キーが数字で終わる("0-9")場合にカウントの数字と連結されて誤抽出する。
    // カウント用spanから直接読む。
    const countText = await link
      .locator('span[class="ml-1 text-xs opacity-70"]')
      .innerText();
    badges.push({ key, count: Number(countText.trim()) });
  }
  return badges;
}

// 実DOMのみを対象にする(<script>内のRSCペイロードはPlaywrightのDOM APIでは
// そもそも見えないため、curlでの検証時のような二重カウント問題は起きない)。
function resultItemLocator(page: Page): Locator {
  return page.locator(
    'div[class="font-bold text-indigo-700 dark:text-indigo-300"]'
  );
}

test.describe("逆引き画面: バッジ件数と実表示件数の一致", () => {
  test("集計結果に現れる全キーで、バッジ件数と一覧の実表示件数が一致する", async ({
    page,
  }) => {
    await page.goto("/reverse");
    const badges = await getBadges(page);
    expect(badges.length).toBeGreaterThan(0);

    for (const { key, count } of badges) {
      await page.goto(`/reverse?key=${encodeURIComponent(key)}`);
      const actual = await resultItemLocator(page).count();
      expect(actual, `キー"${key}": バッジ${count}件 / 実表示${actual}件`).toBe(
        count
      );
    }
  });
});

test.describe("逆引き画面: キー正規化と選択の挙動", () => {
  test("小文字指定(?key=a)は大文字指定(?key=A)と同一の一覧を返す", async ({
    page,
  }) => {
    await page.goto("/reverse");
    const badges = await getBadges(page);
    const alpha = badges.find((b) => /^[A-Z]$/.test(b.key));
    test.skip(!alpha, "英字1文字キーが集計結果に存在しないためスキップ");

    await page.goto(`/reverse?key=${alpha!.key}`);
    const upperTexts = await resultItemLocator(page).allTextContents();

    await page.goto(`/reverse?key=${alpha!.key.toLowerCase()}`);
    const lowerTexts = await resultItemLocator(page).allTextContents();

    expect(lowerTexts).toEqual(upperTexts);
  });

  test("パラメータ重複指定(?key=A&key=B)は先頭のみ採用され、単独指定と同一になる", async ({
    page,
  }) => {
    await page.goto("/reverse");
    const badges = await getBadges(page);
    test.skip(badges.length < 2, "比較に2キー以上必要なためスキップ");
    const [first, second] = badges;

    await page.goto(`/reverse?key=${encodeURIComponent(first.key)}`);
    const singleTexts = await resultItemLocator(page).allTextContents();

    await page.goto(
      `/reverse?key=${encodeURIComponent(first.key)}&key=${encodeURIComponent(
        second.key
      )}`
    );
    const dupTexts = await resultItemLocator(page).allTextContents();

    expect(dupTexts).toEqual(singleTexts);
  });

  test("?key=%23 は200を返し、'#'キーの有無に応じて状態を区別する", async ({
    page,
  }) => {
    const response = await page.goto("/reverse?key=%23");
    expect(response?.status()).toBe(200);

    await page.goto("/reverse");
    const badges = await getBadges(page);
    const hashBadge = badges.find((b) => b.key === "#");

    await page.goto("/reverse?key=%23");
    if (hashBadge) {
      // '#'キーが集計に存在する場合、選択は有効になり結果は必ず1件以上
      const actual = await resultItemLocator(page).count();
      expect(actual).toBe(hashBadge.count);
      expect(actual).toBeGreaterThan(0);
    } else {
      // '#'キーが集計に存在しない場合、無効キーとして「未選択」扱いになり
      // 「該当なし」ではなく案内メッセージが出る(resolveIndexSelectionの仕様)
      await expect(page.getByText("上のキーを選んでください")).toBeVisible();
      await expect(resultItemLocator(page)).toHaveCount(0);
    }
  });
});

export const AUTO_CRAWL_MAP_LIMIT = 200;

export type AutomaticCrawlSettings = {
  pageLimit: number;
  maxDepth: number;
  discoveredCount: number;
};

function pathDepth(value: string) {
  try {
    return new URL(value).pathname.split("/").filter(Boolean).length;
  } catch {
    return null;
  }
}

/**
 * Подбирает технические параметры по карте сайта. Небольшой запас в лимите
 * позволяет дочитать страницы, которые sitemap/map не вернул с первого раза,
 * а 90-й перцентиль глубины не даёт одному аномальному URL раздуть обход.
 */
export function automaticCrawlSettings(
  rootUrl: string,
  discoveredUrls: string[]
): AutomaticCrawlSettings {
  const urls = [...new Set(discoveredUrls)];
  if (!urls.length) return { pageLimit: 50, maxDepth: 3, discoveredCount: 0 };

  const pageLimit = Math.min(
    AUTO_CRAWL_MAP_LIMIT,
    Math.max(20, Math.ceil(urls.length * 1.1))
  );
  const rootDepth = pathDepth(rootUrl) ?? 0;
  const relativeDepths = urls
    .map(pathDepth)
    .filter((depth): depth is number => depth !== null)
    .map((depth) => Math.max(1, depth - rootDepth))
    .sort((a, b) => a - b);
  const percentileIndex = Math.min(
    relativeDepths.length - 1,
    Math.floor(relativeDepths.length * 0.9)
  );
  const typicalDepth = relativeDepths[percentileIndex] ?? 3;

  return {
    pageLimit,
    maxDepth: Math.min(5, Math.max(2, typicalDepth)),
    discoveredCount: urls.length,
  };
}

type RevenueReport = { rubles: number; year: number };

/** DataNewton's BFO line 2110 is reported in thousands of rubles. */
export function dataNewtonRevenue(source: unknown): RevenueReport | null {
  if (!isRecord(source)) return null;
  const block = source.finance_plain_block ?? source["datanewton.finance_plain_block"];
  if (!isRecord(block) || !Array.isArray(block.fin_data)) return null;
  const row = block.fin_data.find((item) => isRecord(item) && String(item.code) === "2110");
  if (!isRecord(row) || !isRecord(row.sum_by_year_map)) return null;
  const latest = Object.entries(row.sum_by_year_map)
    .filter(([year, amount]) => /^\d{4}$/.test(year) && typeof amount === "number" && Number.isFinite(amount))
    .sort(([left], [right]) => Number(right) - Number(left))[0];
  if (!latest) return null;
  return { year: Number(latest[0]), rubles: (latest[1] as number) * 1_000 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

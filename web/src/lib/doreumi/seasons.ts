export type DoreumiSeason = 'everyday' | 'seollal' | 'chuseok' | 'christmas';
/** Everything Doreumi can wear: a full seasonal outfit or a single accessory. */
export type DoreumiLook = DoreumiSeason | 'flower-pin' | 'santa-hat';
// Published calendar dates; unknown years deliberately do not guess lunar holidays.
// 2026: https://www.seoul.co.kr/news/society/science-news/2025/06/30/20250630500055
// 2027: https://www.kasa.go.kr/prog/plcyBrf/brief/kor/sub01_01_04/view.do?plcyBrfNo=431
export const DOREUMI_HOLIDAYS: Record<number, { seollal: string; chuseok: string }> = {
  2026: { seollal: '2026-02-17', chuseok: '2026-09-25' },
  2027: { seollal: '2027-02-07', chuseok: '2027-09-15' },
};
export function doreumiSeason(date = new Date()): DoreumiSeason {
  const day = new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  if (day.slice(5) >= '12-18' && day.slice(5) <= '12-26') return 'christmas';
  const year = DOREUMI_HOLIDAYS[Number(day.slice(0, 4))];
  if (year) for (const season of ['seollal', 'chuseok'] as const) {
    if (Math.abs(Date.parse(day) - Date.parse(year[season])) <= 3 * 86400_000) return season;
  }
  return 'everyday';
}

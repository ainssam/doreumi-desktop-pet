/**
 * 도름이 아이템의 자리·색 규칙. 화면과 서버가 같은 표를 본다(DB 0405 의 CHECK 와 같은 값).
 * 사용자 결정(2026-09-26): 입는 자리 = 카테고리, 자리마다 하나만 입고 같은 자리를 입으면 자동 교체,
 * 한 벌 옷은 상의·하의 두 자리를 함께 차지한다. 색은 몸통·배 문양·머리 문양 세 곳, 새 색 하나 5도름.
 */
export const DOREUMI_SLOTS = [
  { id: "head", label: "머리" },
  { id: "face", label: "얼굴" },
  { id: "neck", label: "목" },
  { id: "top", label: "상의" },
  { id: "bottom", label: "하의" },
  { id: "shoes", label: "신발" },
  { id: "back", label: "등" },
  { id: "hand", label: "손" },
] as const;
export type DoreumiSlot = (typeof DOREUMI_SLOTS)[number]["id"];
const SLOT_IDS = new Set<string>(DOREUMI_SLOTS.map((slot) => slot.id));
export const isDoreumiSlot = (value: unknown): value is DoreumiSlot => typeof value === "string" && SLOT_IDS.has(value);

/** 상점·내 아이템 탭의 묶음. 한 벌 옷은 상의+하의를 함께 차지하는 아이템이다. */
export const DOREUMI_CATEGORIES = [
  ...DOREUMI_SLOTS.map((slot) => ({ id: slot.id as string, label: slot.label, slots: [slot.id] as DoreumiSlot[] })),
  { id: "outfit", label: "한 벌 옷", slots: ["top", "bottom"] as DoreumiSlot[] },
];
export function categoryOf(slots: readonly string[]): string {
  if (slots.length === 2 && slots.includes("top") && slots.includes("bottom")) return "outfit";
  return slots[0] ?? "head";
}
export const categoryLabel = (slots: readonly string[]) => DOREUMI_CATEGORIES.find((c) => c.id === categoryOf(slots))?.label ?? "기타";

/** 승인 때 고르는 자리 값: 카테고리 하나 → 실제 차지하는 자리들. */
export function slotsOfCategory(category: string): DoreumiSlot[] | null {
  return DOREUMI_CATEGORIES.find((c) => c.id === category)?.slots ?? null;
}
export function normalizeSlots(value: unknown): DoreumiSlot[] | null {
  if (!Array.isArray(value)) return null;
  const slots = [...new Set(value)].filter(isDoreumiSlot);
  if (slots.length !== value.length || slots.length < 1 || slots.length > 2) return null;
  if (slots.length === 2 && categoryOf(slots) !== "outfit") return null;
  return slots;
}

export const DOREUMI_COLOR_PARTS = [
  { id: "body", label: "몸통", base: "#f2f4fa" },
  { id: "belly", label: "배 문양", base: "#041642" },
  { id: "head", label: "머리 문양", base: "#041642" },
] as const;
export type DoreumiColorPart = (typeof DOREUMI_COLOR_PARTS)[number]["id"];
export const isColorPart = (value: unknown): value is DoreumiColorPart => typeof value === "string" && DOREUMI_COLOR_PARTS.some((part) => part.id === value);
export const isHexColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/.test(value);
/** DB 함수 buy_doreumi_color 의 가격과 같다. 바꾸려면 두 곳을 함께. */
export const DOREUMI_COLOR_PRICE = 5;
/** 판매 수수료(가격의 10%). DB 는 0.1도름 단위 정수(tenths = 가격)로 쌓는다. */
export const DOREUMI_COMMISSION_PERCENT = 10;
/** 아이템 만들기 자격: 교사 인증 + 받은 도름 이 이상(DB doreumi_item_maker_eligible 과 같다). */
export const DOREUMI_MAKER_MIN_DORMS = 10;

/** Catalog items still use 'hand'; only equipped instances choose a particular hand. */
export const DOREUMI_HANDS = [{ id: "leftHand", label: "왼손" }, { id: "rightHand", label: "오른손" }] as const;
export type DoreumiHand = (typeof DOREUMI_HANDS)[number]["id"];
export type DoreumiWearSlot = Exclude<DoreumiSlot, "hand"> | DoreumiHand | "hand";
export const isDoreumiHand = (slot: unknown): slot is DoreumiHand => slot === "leftHand" || slot === "rightHand";
export const isDoreumiWearSlot = (slot: unknown): slot is DoreumiWearSlot => isDoreumiSlot(slot) || isDoreumiHand(slot);
export const naturalHand = (bone?: string | null): DoreumiHand => bone?.endsWith("L") ? "leftHand" : "rightHand";
export const slotFitsItem = (slot: DoreumiWearSlot, slots: readonly DoreumiSlot[]) => isDoreumiHand(slot) ? slots.includes("hand") : slots.includes(slot);
export type DoreumiWorn = Partial<Record<DoreumiWearSlot, string>>;
export type DoreumiColors = Partial<Record<DoreumiColorPart, string>>;

/** Old wardrobes preserve their authored hand when read and use the new keys on their next save. */
export function canonicalWorn(worn: DoreumiWorn, handOf: (id: string) => DoreumiHand = () => "rightHand"): DoreumiWorn {
  const { hand, ...next } = worn;
  if (hand) { const target = handOf(hand); if (!next[target]) next[target] = hand; }
  return next;
}

/** 새 아이템을 입으면 그 아이템이 차지할 자리에 있던 것은 모두 벗긴다(한 벌 옷이 상의·하의를 같이 벗김, 그 반대도). */
export function wearItem(worn: DoreumiWorn, itemId: string, slots: readonly DoreumiSlot[], slotsOf: (id: string) => readonly DoreumiSlot[] | undefined, hand: DoreumiHand = "rightHand"): DoreumiWorn {
  if (slots.includes("hand")) return { ...canonicalWorn(worn), [hand]: itemId };
  const next: DoreumiWorn = {};
  const taken = new Set<string>(slots);
  const displaced = new Set<string>();
  for (const [slot, id] of Object.entries(worn) as [DoreumiWearSlot, string][]) {
    if (isDoreumiHand(slot) || slot === "hand") { next[slot] = id; continue; }
    if (taken.has(slot) || displaced.has(id)) { displaced.add(id); continue; }
    if ((slotsOf(id) ?? [slot]).some((s) => taken.has(s))) { displaced.add(id); continue; }
    next[slot] = id;
  }
  for (const [slot, id] of Object.entries(next) as [DoreumiWearSlot, string][]) if (displaced.has(id)) delete next[slot];
  for (const slot of slots) next[slot] = itemId;
  return next;
}
export function takeOffItem(worn: DoreumiWorn, itemId: string, hand?: DoreumiHand): DoreumiWorn {
  if (hand) { const next = { ...worn }; if (next[hand] === itemId) delete next[hand]; return next; }
  return Object.fromEntries(Object.entries(worn).filter(([, id]) => id !== itemId)) as DoreumiWorn;
}
/** Fitting-room drafts stay separate from purchased, saved wardrobe entries. */
export type DoreumiTryOn = { id: string; hand?: DoreumiHand };
const tryOnSlots = (trial: DoreumiTryOn, slots: readonly DoreumiSlot[]): readonly DoreumiWearSlot[] => slots.includes("hand") ? [trial.hand ?? "rightHand"] : slots;
export function tryOnItem(trials: readonly DoreumiTryOn[], trial: DoreumiTryOn, slotsOf: (id: string) => readonly DoreumiSlot[] | undefined): DoreumiTryOn[] {
  const slots = slotsOf(trial.id);
  if (!slots?.length) return [...trials];
  const taken = new Set(tryOnSlots(trial, slots));
  return [...trials.filter(previous => !tryOnSlots(previous, slotsOf(previous.id) ?? []).some(slot => taken.has(slot))), trial];
}
export const removeTryOn = (trials: readonly DoreumiTryOn[], id: string, hand?: DoreumiHand) => trials.filter(trial => trial.id !== id || trial.hand !== hand);
export function tryOnWorn(worn: DoreumiWorn, trials: readonly DoreumiTryOn[], slotsOf: (id: string) => readonly DoreumiSlot[] | undefined): DoreumiWorn {
  return trials.reduce((next, trial) => { const slots = slotsOf(trial.id); return slots?.length ? wearItem(next, trial.id, slots, slotsOf, trial.hand) : next; }, worn);
}
/** Successful writes use the fresh wardrobe as the base; drafts still being tried remain. */
export function remainingTryOns(trials: readonly DoreumiTryOn[], worn: DoreumiWorn, slotsOf: (id: string) => readonly DoreumiSlot[] | undefined): DoreumiTryOn[] {
  return trials.filter(trial => { const slots = slotsOf(trial.id); return !!slots?.length && !tryOnSlots(trial, slots).every(slot => worn[slot] === trial.id); });
}
/** 입은 목록의 서로 다른 아이템 id(한 벌 옷은 두 자리에 같은 id). */
export const wornItemIds = (worn: DoreumiWorn) => [...new Set(Object.values(worn).filter((id): id is string => !!id))];

/** 렌더러에 넘기는 모습. 공식 아이템(꽃 머리핀)은 코드로, 회원 아이템은 .glb 로 그린다. */
export type DoreumiDressItem = { id: string; slots: DoreumiSlot[]; asset?: string; bone?: string | null; rigged?: boolean; hand?: DoreumiHand };
export type DoreumiDress = { items: DoreumiDressItem[]; colors: DoreumiColors };
export const EMPTY_DRESS: DoreumiDress = { items: [], colors: {} };
export const dressKey = (dress: DoreumiDress) => JSON.stringify([dress.items.map((item) => [item.id, item.hand ?? "", item.asset ?? "", item.bone ?? "", !!item.rigged]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), dress.colors]);

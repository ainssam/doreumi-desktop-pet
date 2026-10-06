import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * `@/...` 별칭을 src/ 로 풀어 주는 해석기 — 테스트에서 앱 모듈을 그대로 불러오기 위한 것.
 * Next 는 tsconfig 의 paths 로 이 별칭을 알지만 node 는 모른다. 확장자도 tsconfig 처럼 붙여 준다.
 */
const SRC = new URL("../src/", import.meta.url);
const CANDIDATES = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.mjs"];

export function resolve(specifier, context, next) {
  // src 안의 확장자 없는 상대 import("./steps")도 Next 처럼 .ts·.tsx 로 풀어 준다.
  if (specifier.startsWith(".") && context.parentURL?.startsWith(SRC.href) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    for (const ext of [".ts", ".tsx"]) {
      const candidate = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
    }
  }
  if (!specifier.startsWith("@/")) return next(specifier, context);
  const base = new URL(specifier.slice(2), SRC);
  for (const ext of CANDIDATES) {
    const candidate = new URL(base.href + ext);
    if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
  }
  return next(specifier, context);
}

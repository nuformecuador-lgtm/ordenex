import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Worktrees de agentes: copias completas del repo dentro de `.claude/`.
    // Sin esto el lint recorre cada copia (minutos de corrida) y un error de
    // OTRA rama pone `./init.sh` en rojo en `dev`.
    ".claude/**",
  ]),
]);

export default eslintConfig;

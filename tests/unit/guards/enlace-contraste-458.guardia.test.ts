import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contraste, cssSinComentarios, token } from "../../fixtures/contraste";

/**
 * FICHA 458 — F3 del recorrido final (`progress/recorrido_458-final.md`).
 *
 * axe midió 2,99:1 en los enlaces `text-primary` (#f26419) sobre la página (#f7f8fc) de las
 * pantallas nuevas de la wallet: «Volver a los saldos…» de los tres estados de cuenta y el «Ver»
 * del origen en el extracto. El arreglo es `text-primary-strong`, un alias de `--chart-11-strong`
 * (el tono más oscuro del naranja que ya existía, con su par por tema).
 *
 * Se declara como GUARDIA porque lee archivos (el CSS y el fuente), no módulos importados.
 * Cubre dos cosas: que el token llegue a 4,5 en los DOS temas, y que los cuatro enlaces lo usen.
 */

const RAIZ = path.resolve(__dirname, "../../..");
const AA_TEXTO = 4.5;

describe("458/F3 — el enlace en color de marca cumple AA sobre la página", () => {
  it("la herramienta reproduce el 2,99 que midió axe con el token viejo (control del método)", () => {
    // Si esto no diera ~2,99, la aritmética no es la de axe y lo de abajo no vale nada.
    expect(contraste("#f26419", token("claro", "background"))).toBeCloseTo(2.99, 1);
  });

  it("`--color-primary-strong` es el alias de `--chart-11-strong`", () => {
    expect(cssSinComentarios).toMatch(/--color-primary-strong:\s*var\(--chart-11-strong\)\s*;/);
  });

  it.each(["claro", "oscuro"] as const)(
    "tema %s: --chart-11-strong sobre --background y sobre --card ≥ 4,5",
    (tema) => {
      const tinta = token(tema, "chart-11-strong");
      expect(contraste(tinta, token(tema, "background"))).toBeGreaterThanOrEqual(AA_TEXTO);
      expect(contraste(tinta, token(tema, "card"))).toBeGreaterThanOrEqual(AA_TEXTO);
    },
  );

  it.each([
    "app/(app)/wallet/tiendas/[tiendaId]/page.tsx",
    "app/(app)/wallet/mensajeros/[mensajeroId]/page.tsx",
    "app/(app)/wallet/satelites/[zonaId]/page.tsx",
    "components/shared/estado-cuenta/EstadoCuenta.tsx",
  ])("%s: sus enlaces usan text-primary-strong y ninguno el text-primary a secas", (archivo) => {
    const fuente = readFileSync(path.join(RAIZ, archivo), "utf8");
    expect(fuente).toContain("text-primary-strong");
    // `text-primary` seguido de espacio o comilla: el naranja base como tinta.
    expect(fuente).not.toMatch(/\btext-primary(?=[\s"'`])/);
  });
});

import { describe, expect, it } from "vitest";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";
import { archivosBajo, codigo } from "./_wallet-458-archivos";

// =================================================================================================
// GUARDIA — REVISION 458-A (m2) — LOS SERVICIOS Y LOS REPOSITORIOS NO IMPORTAN DE `app/`
// =================================================================================================
//
// docs/architecture.md: la dependencia va de la pantalla al servidor, nunca al reves. La 458-A hizo
// que `OrigenLegibleService`, `FiltrosWalletService` y `WalletEgresoService` importaran diccionarios
// y la hora de Costa Rica de `app/(app)/**/_components`; funcionaba porque esos modulos eran puros,
// pero un `'use client'` o un import de React en cualquiera de ellos habria metido la pantalla en el
// servidor sin que nadie lo decidiera. Lo compartido se mudo a `lib/` (`lib/constants/*-rotulos.ts`,
// `lib/utils/hora-cr.ts`, `lib/utils/cierre-enlace.ts`) y esta guardia impide que vuelva.
//
// Alcance: `lib/services` y `lib/repositories` enteros. (Fuera queda `lib/types/plantilla-datos.ts`,
// el unico `lib → app` de antes, que no es ni servicio ni repositorio.)

const IMPORTA_DE_APP = /\bfrom\s+["']@\/app\/|\bimport\s*\(\s*["']@\/app\/|\brequire\s*\(\s*["']@\/app\//;

function archivosDelServidor(): string[] {
  return archivosBajo(["lib/services", "lib/repositories"]);
}

describe("revision 458-A m2 — `lib/services` y `lib/repositories` no importan de `app/`", () => {
  it("no-vacuidad: el censo mira los servicios y repositorios de verdad", () => {
    const censo = archivosDelServidor();
    expect(censo.length).toBeGreaterThan(150);
    expect(censo).toContain("lib/services/OrigenLegibleService.ts");
    expect(censo).toContain("lib/services/FiltrosWalletService.ts");
    expect(censo).toContain("lib/services/WalletEgresoService.ts");
  });

  it("ninguno importa de `@/app/`", () => {
    const rojos = archivosDelServidor().filter((r) => IMPORTA_DE_APP.test(codigo(r)));
    expect(rojos).toEqual([]);
  });

  it("contraprueba: las importaciones de cd91bcf4 la ponen roja (y un comentario no)", () => {
    const antes = quitarComentarios(`
      import { horaCostaRica } from "@/app/(app)/analitica/_components/operativo/textos";
    `);
    expect(IMPORTA_DE_APP.test(antes)).toBe(true);
    expect(IMPORTA_DE_APP.test(`const m = await import("@/app/(app)/wallet/_components/wallet-labels");`)).toBe(true);
    expect(IMPORTA_DE_APP.test(quitarComentarios(`// antes: from "@/app/(app)/wallet/_components/wallet-labels"`))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { codigo, fuente } from "./_wallet-458-archivos";

// =================================================================================================
// GUARDIA — FICHA 458-A (TA.6, R101 + R4, R99) — LOS TEXTOS DESACTUALIZADOS NO VUELVEN
// =================================================================================================
//
// `design.md` §1.4 inventaria afirmaciones de la wallet que dejaron de ser ciertas. Esta guardia las
// fija UNA a UNA en su archivo (con comentarios: son comentarios lo que miente) y la contraprueba
// demuestra que el detector las ve en la fuente de antes.
//
//  - T1 `desglose-tienda-labels.ts` y T2 `lib/types/wallet-tienda.ts`: «Pagado a la tienda sale
//    siempre en 0,00 … lo emitirá la 172» — la 172 emite pagos desde hace meses.
//  - T9 `app/(app)/wallet/page.tsx`: el subtitulo decia «dinero en caja» en estado «flujo» (R101).
//  - R4 `WalletEgresoService.ts`: «Reverso de: <descripcion o, si falta, EL ID>».
//
// Fuera de esta guardia, anotado en `progress/impl_458-A.md`: T3/T4 viven en `db/schema.prisma`
// (los cierra la 458-B, TB.14) y T5/T6 son comentarios que describen el campo de texto y el filtro
// poblado del SEED que el FRONTEND de la 458-A retira: la parte frontend los añade a `AFIRMACIONES`
// en el mismo commit que retira el codigo que describen.

type Afirmacion = { id: string; archivo: string; patron: RegExp; conComentarios: boolean };

export const AFIRMACIONES: readonly Afirmacion[] = [
  {
    id: "T1",
    archivo: "app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts",
    patron: /hoy sale siempre en `?0[.,]00`?|lo emitirá la 172\)/,
    conComentarios: true,
  },
  {
    id: "T2",
    archivo: "lib/types/wallet-tienda.ts",
    patron: /hoy vale siempre "0\.00"|lo emitira la 172\)|hoy siempre "0\.00"/,
    conComentarios: true,
  },
  {
    id: "T9",
    archivo: "app/(app)/wallet/page.tsx",
    patron: /description="[^"]*dinero en caja/i,
    conComentarios: false,
  },
  {
    id: "R4",
    archivo: "lib/services/WalletEgresoService.ts",
    patron: /\?\?\s*original\.id\b/,
    conComentarios: false,
  },
];

function afirmaciones(texto: string, a: Afirmacion): boolean {
  return a.patron.test(texto);
}

describe("458-A R101/R4 — las afirmaciones desactualizadas de la wallet no vuelven", () => {
  it("no-vacuidad: las cuatro afirmaciones y sus archivos existen y se leen", () => {
    expect(AFIRMACIONES.map((a) => a.id)).toEqual(["T1", "T2", "T9", "R4"]);
    for (const a of AFIRMACIONES) expect(fuente(a.archivo).length).toBeGreaterThan(200);
  });

  it.each(AFIRMACIONES.map((a) => [a.id, a] as const))("%s: la afirmación no está en su archivo", (_id, a) => {
    const texto = a.conComentarios ? fuente(a.archivo) : codigo(a.archivo);
    expect(afirmaciones(texto, a)).toBe(false);
  });

  it("CONTRAPRUEBA: la fuente de antes de la 458-A la pone roja en las cuatro", () => {
    const antes: Record<string, string> = {
      T1: " * «Pagado a la tienda» hoy sale siempre en `0.00` porque ningún flujo emite `pago_tienda`\n * (lo emitirá la 172). Se muestra IGUAL",
      T2: "  pagado: string; // Σ debitos == pago_tienda (hoy siempre \"0.00\", ver R43)",
      T9: '      description="Caja principal de Ordenex: libro de movimientos, dinero en caja y ganancia de Ordenex"',
      R4: "        descripcion: `Reverso de: ${original.descripcion ?? original.id}`,",
    };
    for (const a of AFIRMACIONES) expect({ id: a.id, rojo: afirmaciones(antes[a.id], a) }).toEqual({ id: a.id, rojo: true });
  });
});

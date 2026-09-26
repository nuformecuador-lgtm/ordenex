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
// (los cierra la 458-B, TB.14). T5 (los tres filtros «poblados del SEED») y T6 (la ayuda que mandaba
// a pegar el identificador del cierre) los añadió la parte FRONTEND de la 458-A a `AFIRMACIONES` en
// el mismo commit que retiró el código que describían.

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
  // Parte frontend de la 458-A (TA.3/TA.4): T5 defendía poblar el filtro de concepto del SEED y T6
  // justificaba pegar el identificador del cierre. Se retiran en el mismo commit que el código.
  {
    id: "T5-caja",
    archivo: "app/(app)/wallet/_components/WalletFiltros.tsx",
    patron: /pobla\w*\s+(?:desde\s+el|del)\s+SEED|se\s+puebla\w*\s+del\s+SEED|la lista sigue siendo el SEED/i,
    conComentarios: true,
  },
  {
    id: "T5-tienda",
    archivo: "app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda.tsx",
    patron: /se\s+pueblan?\s+del\s+SEED|pobla\w*\s+(?:desde\s+el|del)\s+SEED/i,
    conComentarios: true,
  },
  {
    id: "T5-mi-wallet",
    archivo: "app/(app)/mi-wallet/_components/MiWalletFiltros.tsx",
    patron: /pobla\w*\s+(?:desde\s+el|del)\s+SEED|se\s+pueblan?\s+del\s+SEED/i,
    conComentarios: true,
  },
  {
    id: "T6",
    archivo: "app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts",
    patron: /copi[aá] su direcci[oó]n|copiar la DIRECCI[OÓ]N|Peg[aá] el identificador|se pega, no se teclea/i,
    conComentarios: true,
  },
  // Revision de la 458-A (m3): el comentario del desglose decia que su borde «NO es `.strict()`» y
  // descartaba claves en silencio; lo es desde TA.6, por herencia del `.extend`.
  {
    id: "m3",
    archivo: "lib/services/WalletTiendaService.ts",
    patron: /NO\s+es\s+(?:\*\s+)?`\.strict\(\)`|DESCARTA las claves desconocidas/,
    conComentarios: true,
  },
];

function afirmaciones(texto: string, a: Afirmacion): boolean {
  return a.patron.test(texto);
}

describe("458-A R101/R4 — las afirmaciones desactualizadas de la wallet no vuelven", () => {
  it("no-vacuidad: las nueve afirmaciones y sus archivos existen y se leen", () => {
    expect(AFIRMACIONES.map((a) => a.id)).toEqual(["T1", "T2", "T9", "R4", "T5-caja", "T5-tienda", "T5-mi-wallet", "T6", "m3"]);
    for (const a of AFIRMACIONES) expect(fuente(a.archivo).length).toBeGreaterThan(200);
  });

  it.each(AFIRMACIONES.map((a) => [a.id, a] as const))("%s: la afirmación no está en su archivo", (_id, a) => {
    const texto = a.conComentarios ? fuente(a.archivo) : codigo(a.archivo);
    expect(afirmaciones(texto, a)).toBe(false);
  });

  it("CONTRAPRUEBA: la fuente de antes de la 458-A la pone roja en las nueve", () => {
    const antes: Record<string, string> = {
      T1: " * «Pagado a la tienda» hoy sale siempre en `0.00` porque ningún flujo emite `pago_tienda`\n * (lo emitirá la 172). Se muestra IGUAL",
      T2: "  pagado: string; // Σ debitos == pago_tienda (hoy siempre \"0.00\", ver R43)",
      T9: '      description="Caja principal de Ordenex: libro de movimientos, dinero en caja y ganancia de Ordenex"',
      R4: "        descripcion: `Reverso de: ${original.descripcion ?? original.id}`,",
      "T5-caja":
        "// Feature 42 (T12, R20) — filtros del libro: tipo, categoría (poblada desde el SEED) y\n// —y no debe haberla—: lo que hay es un test que afirma que la lista sigue siendo el SEED.",
      "T5-tienda": "          R44 — las opciones se pueblan del SEED del enum, no de una lista escrita a mano:",
      "T5-mi-wallet": "// Feature 43 (T15, R22) — filtros del desglose: cierre, concepto (poblado desde el SEED) y",
      T6: '  cierrePlaceholder: "Pegá el identificador",\n    "El identificador del cierre sale del enlace «Ver el cierre» de la tabla: copiá su dirección y pegala en «Cierre».",',
      // `WalletTiendaService.ts:313-315` en cd91bcf4, tal cual.
      m3: "   * Precision sobre el borde de ESTE camino: `listarMovimientosDeTiendaSchema` NO es\n   * `.strict()`. Zod DESCARTA las claves desconocidas en vez de rechazarlas, asi que una",
    };
    for (const a of AFIRMACIONES) expect({ id: a.id, rojo: afirmaciones(antes[a.id], a) }).toEqual({ id: a.id, rojo: true });
  });
});

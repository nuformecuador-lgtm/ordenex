import { describe, expect, it } from "vitest";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";
import { archivosDeLaWallet, codigo } from "./_wallet-458-archivos";

// =================================================================================================
// GUARDIA — FICHA 458-A (TA.4, R93 + R2, R99) — NINGÚN CAMPO QUE PIDA UN IDENTIFICADOR
// =================================================================================================
//
// Hasta la 458-A, `/wallet/tiendas` pedía el cierre en un `<Input>` con el marcador «ID del
// cierre» y `/wallet/mensajeros` en otro con «Pegá el identificador» y una ayuda que mandaba a
// copiar la dirección de un enlace (C1.1/C1.2). Nadie conoce ese identificador. Hoy el cierre se
// elige en un `SelectorBuscable`. El gate falla si en alguna superficie de la wallet (censo POR
// CARPETA, `_wallet-458-archivos.ts`) reaparece:
//
//  1. un `<Input>` cuyo valor es un estado que se llama `…Id` (`value={draft.cierreId}`);
//  2. un texto de la pantalla —literal de cadena o texto JSX, sin comentarios— que pida un
//     identificador: «ID», «identificador», «pegá», «copiá su dirección».
//
// Contraprueba: la fuente de hoy de C1.1 y C1.2 (antes de la 458-A) la pone roja. No-vacuidad: el
// censo tiene archivos, y el detector de `<Input>` VE los `<Input>` que sí existen (los de fecha).

const INPUT_CON_ID = /<Input\b(?:(?!\/>|<\/Input>)[\s\S])*?\bvalue=\{[^}]*\w+Id\s*\}/g;
/** «ID» en MAYÚSCULAS (un `rowKey="id"` no es un texto de pantalla); lo demás, sin distinguir. */
const PIDE_ID = {
  // `(?![a-zñáéíóú])` y no `\b`: en una expresión sin `u`, «á» no es letra y `\b` fallaría tras «pegá».
  test: (t: string) =>
    /\bID\b/.test(t) || /identificador|\bpeg[aá](?![a-zñáéíóú])|copi[aá] su direcci[oó]n/i.test(t),
};
const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const TEXTO_JSX = />([^<>{}]+)</g;

type Hallazgo = { archivo: string; motivo: string };

export function hallazgosEnCodigo(fuente: string, archivo: string): Hallazgo[] {
  const salida: Hallazgo[] = [];
  for (const m of fuente.matchAll(INPUT_CON_ID)) salida.push({ archivo, motivo: `<Input> con ${m[0].match(/value=\{[^}]*\}/)?.[0]}` });
  for (const m of fuente.matchAll(LITERAL)) {
    // Los especificadores de import/rutas no son textos de pantalla.
    if (/^[@./]/.test(m[2])) continue;
    if (PIDE_ID.test(m[2])) salida.push({ archivo, motivo: `texto «${m[2]}»` });
  }
  for (const m of fuente.matchAll(TEXTO_JSX)) {
    if (PIDE_ID.test(m[1])) salida.push({ archivo, motivo: `texto JSX «${m[1].trim()}»` });
  }
  return salida;
}

describe("458-A R93 — ninguna superficie de la wallet pide un identificador", () => {
  it("no-vacuidad: el censo tiene las superficies y el detector ve los `<Input>` que existen", () => {
    const archivos = archivosDeLaWallet();
    expect(archivos.length).toBeGreaterThan(40);
    expect(archivos).toEqual(
      expect.arrayContaining([
        "app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda.tsx",
        "app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx",
        "app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts",
      ]),
    );
    const conInput = archivos.filter((r) => /<Input\b/.test(codigo(r)));
    expect(conInput.length).toBeGreaterThanOrEqual(3);
  });

  it("ningún `<Input>` sobre un estado `…Id` ni un texto que pida un identificador", () => {
    const rojos = archivosDeLaWallet().flatMap((r) => hallazgosEnCodigo(codigo(r), r));
    expect(rojos).toEqual([]);
  });

  it("contraprueba: la fuente de antes de la 458-A (C1.1 y C1.2) la pone roja", () => {
    const antes = quitarComentarios(`
      <Input
        id={cierreFiltroId}
        type="text"
        value={draft.cierreId}
        onChange={(e) => set("cierreId", e.target.value)}
        placeholder={DESGLOSE_TIENDA_FILTRO_LABEL.cierrePlaceholder}
      />
      export const DESGLOSE_TIENDA_FILTRO_LABEL = { cierre: "Cierre", cierrePlaceholder: "ID del cierre" };
      export const DESGLOSE_FILTRO_LABEL = {
        cierrePlaceholder: "Pegá el identificador",
        cierreAyuda:
          "El identificador del cierre sale del enlace «Ver el cierre» de la tabla: copiá su dirección y pegala en «Cierre».",
      };
      <p className="text-xs">Pegá acá el identificador</p>
    `);
    const motivos = hallazgosEnCodigo(antes, "fuente-de-antes.tsx").map((h) => h.motivo);
    expect(motivos).toContain("<Input> con value={draft.cierreId}");
    expect(motivos).toContain("texto «ID del cierre»");
    expect(motivos).toContain("texto «Pegá el identificador»");
    expect(motivos.some((m) => m.includes("copiá su dirección"))).toBe(true);
    expect(motivos).toContain("texto JSX «Pegá acá el identificador»");
    // Cada disparador por separado (sin «identificador» que lo tape).
    for (const t of ['"Pegá la dirección del cierre"', '"Copiá su dirección"', '"ID"']) {
      expect({ t, rojo: hallazgosEnCodigo(t, "x.ts").length }).toEqual({ t, rojo: 1 });
    }
    expect(hallazgosEnCodigo('"despegar"', "x.ts")).toEqual([]);
    // Y la forma de hoy (el selector) no la dispara.
    expect(
      hallazgosEnCodigo(`<Input id={desdeFiltroId} type="date" value={draft.desde} />`, "hoy.tsx"),
    ).toEqual([]);
  });
});

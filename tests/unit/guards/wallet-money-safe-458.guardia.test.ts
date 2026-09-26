import { describe, expect, it } from "vitest";

import { archivosBajo, codigo } from "./_wallet-458-archivos";
import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

// =================================================================================================
// GUARDIA — FICHA 458-C (T C.2, design §4.4, R90) — EL NAVEGADOR NO CONVIERTE NI OPERA IMPORTES
// =================================================================================================
//
// Las piezas compartidas de la wallet (`components/shared/wallet/**`: el registro único, «Así queda»,
// el panel «Ver», la anulación, el comprobante) reciben TODO importe como STRING calculado en el
// servidor. Esta guardia caza la puerta de entrada de la aritmética en el navegador: convertir a
// número (`Number(`, `parseFloat(`, `parseInt(`, `Number.parse…`, el `+` unario sobre un monto).
//
// La carpeta se descubre ENTERA (A7 descartada): un archivo nuevo entra solo. Control de NO-VACUIDAD
// (la carpeta tiene las piezas de la 458-C) y CONTRAPRUEBA (una fuente sintética que convierte cae).

const CARPETA = "components/shared/wallet";

/** La conversión a número, en cualquiera de sus formas habituales. */
const CONVIERTE = /\bNumber\s*\(|\bparseFloat\s*\(|\bparseInt\s*\(|\bNumber\.parse(?:Float|Int)\b|[=(,:]\s*\+\s*(?:monto|importe|saldo)\b/;

function infractores(fuentes: ReadonlyArray<[string, string]>): string[] {
  return fuentes.filter(([, texto]) => CONVIERTE.test(texto)).map(([ruta]) => ruta);
}

describe("458-C R90 — ninguna pieza compartida de la wallet convierte un importe a número", () => {
  const archivos = archivosBajo([CARPETA]);
  const censo = archivos.map((r): [string, string] => [r, codigo(r)]);

  it("control de NO-VACUIDAD: la carpeta tiene las piezas del registro, «Así queda» y el panel", () => {
    expect(archivos.length).toBeGreaterThanOrEqual(8);
    for (const pieza of ["RegistrarMovimientoDialog.tsx", "AsiQueda.tsx", "ComprobanteCampo.tsx"]) {
      expect(archivos.some((r) => r.endsWith(`/${pieza}`)), pieza).toBe(true);
    }
  });

  it("ningún archivo de la carpeta convierte a número (sin comentarios: pueden nombrarlo para explicarlo)", () => {
    expect(infractores(censo)).toEqual([]);
  });

  it("CONTRAPRUEBA: una fuente que convierte o suma un monto a mano cae", () => {
    const sinteticas: Array<[string, string]> = [
      ["a.tsx", "const total = Number(monto) + 1;"],
      ["b.tsx", "const x = parseFloat(saldo);"],
      ["c.tsx", "const y = Number.parseFloat(linea.despues);"],
      ["d.tsx", "const z = { v: +monto };"],
      ["e.tsx", "// Number(monto) solo en un comentario\nconst ok = money(monto);"],
    ];
    const limpias = sinteticas.map(([r, t]): [string, string] => [r, quitarComentarios(t)]);
    expect(infractores(limpias)).toEqual(["a.tsx", "b.tsx", "c.tsx", "d.tsx"]);
  });
});

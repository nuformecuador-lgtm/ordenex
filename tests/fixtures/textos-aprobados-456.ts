// FICHA 456 — los textos APROBADOS por el humano, leídos del disco
// (`specs/456-tooltip-estados/textos-aprobados.md`). Es un literal EXTERNO a la fuente
// (`DESCRIPCION_ESTADO`): los tests de componente comparan lo que se ve contra esto, nunca contra la
// constante que lo emite (memoria «Aserción contra su propia fuente»).
import { readFileSync } from "node:fs";
import path from "node:path";

const MD = readFileSync(
  path.resolve(__dirname, "../../specs/456-tooltip-estados/textos-aprobados.md"),
  "utf8",
);

function filas(trozo: string): Array<readonly [string, string]> {
  return trozo
    .split(/\r?\n/)
    .filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l))
    .slice(1)
    .map((l) => {
      const celdas = l.split("|").slice(1, -1).map((c) => c.trim());
      return [celdas[0], celdas[1]] as const;
    });
}

/** [nombre del estado, explicación] de la tabla aprobada (20 filas). */
export const TEXTOS_APROBADOS_ESTADOS = filas(MD.slice(0, MD.indexOf("## Validado contra el código")));

/** La explicación de la nota de ayuda (sección «Pendiente de visto bueno del humano»). */
export const TEXTO_APROBADO_NOTA_AYUDA = filas(MD.slice(MD.indexOf("## Pendiente de visto bueno del humano")))[0][1];

/** Explicación aprobada de un estado, por su NOMBRE visible. */
export function textoAprobadoDe(nombre: string): string {
  const fila = TEXTOS_APROBADOS_ESTADOS.find(([n]) => n === nombre);
  if (!fila) throw new Error(`«${nombre}» no está en la tabla aprobada`);
  return fila[1];
}

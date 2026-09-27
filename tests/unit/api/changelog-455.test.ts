import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CODIGO_VIGENTE_DE_ANTERIOR, NOMBRE_ESTADO } from "@/lib/types/order-status";

/**
 * FICHA 455 (T1.8, design §5.3; R30) — el aviso de la ruptura existe ANTES de la release y dice lo que
 * el integrador no puede adivinar. El texto de la entrada ES el aviso (convencion del propio
 * CHANGELOG): si no lo dice aqui, el integrador se entera en produccion.
 */

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const leer = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8");
const CHANGELOG = leer("docs/api/CHANGELOG.md");
const ENTRADA = (() => {
  const i = CHANGELOG.indexOf("## 2026-09-24 — ⚠️ RUPTURA");
  const j = CHANGELOG.indexOf("\n## ", i + 1);
  return i < 0 ? "" : CHANGELOG.slice(i, j < 0 ? undefined : j);
})();

/** Las filas `| \`a\` | \`b\` | Nombre |` de una tabla markdown. */
function filas(texto: string): [string, string, string][] {
  return [...texto.matchAll(/^\| `([a-z_]+)` \| `([a-z_]+)` \| ([^|]+?) \|$/gm)].map((m) => [m[1], m[2], m[3].trim()]);
}

describe("455/R30 — la entrada del CHANGELOG", () => {
  it("existe, esta fechada, es la PRIMERA y se marca como RUPTURA", () => {
    expect(ENTRADA).not.toBe("");
    expect(CHANGELOG.indexOf("## 2026-09-24 — ⚠️ RUPTURA")).toBe(CHANGELOG.indexOf("\n## ") + 1);
  });

  it("trae la tabla de los 7 estados y la de los 4 resultados, anterior → vigente → nombre", () => {
    const tabla = filas(ENTRADA);
    const anteriores = Object.entries(CODIGO_VIGENTE_DE_ANTERIOR).map(([a, v]) => [a, v, NOMBRE_ESTADO[v]]);
    // Los 7 estados, en cualquier orden, cada uno con el nombre de la fuente unica.
    for (const fila of anteriores) expect(tabla).toContainEqual(fila);
    // Y los 4 resultados: los mismos pares, repetidos en la segunda tabla (7 + 4 = 11 filas).
    expect(tabla).toHaveLength(11);
    const resultados = tabla.slice(7).map(([a]) => a);
    expect(resultados.sort()).toEqual(
      Object.keys(CODIGO_VIGENTE_DE_ANTERIOR)
        .filter((a) => ["entregado", "reprogramado", "novedad", "devolucion_a_origen_por_rechazo"].includes(CODIGO_VIGENTE_DE_ANTERIOR[a as keyof typeof CODIGO_VIGENTE_DE_ANTERIOR]))
        .sort(),
    );
  });

  it("anuncia los campos `…Nombre`, el campo renombrado de la carga, el 422 y la fecha de despliegue", () => {
    for (const campo of ["estadoNombre", "resultadoNombre", "estadoResultanteNombre", "estadoAnteriorNombre", "resultadoAnteriorNombre"]) {
      // `estadoNombre` o `gestiones[].resultadoNombre`: el nombre del campo, citado como codigo.
      expect(ENTRADA).toMatch(new RegExp(`[.\`]${campo}\``));
    }
    expect(ENTRADA).toContain("`filas[].estatus` → `filas[].estado`");
    expect(ENTRADA).toContain("responde `422`");
    expect(ENTRADA).toContain("Fecha de despliegue");
    expect(ENTRADA).toContain("`eventoId`");
  });

  it("la documentacion de integradores NO nombra un codigo anterior", () => {
    const anteriores = Object.keys(CODIGO_VIGENTE_DE_ANTERIOR);
    const re = new RegExp(`[\`'"](${anteriores.join("|")})[\`'"]`);
    for (const doc of ["docs/ayuda/oficina/configuracion-api.md", "docs/api/manual-metricas-por-mensajero.md"]) {
      expect(re.exec(leer(doc))?.[0] ?? null, doc).toBeNull();
    }
  });
});

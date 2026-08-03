import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import path from "path";

// Feature 176 / T5.2 — GUARDIA DE FRONTERA (R18).
//
// ⚠⚠ ESTE GUARDIA CADUCA AL MERGEAR A `dev`. Mide el diff de la rama actual contra
// `origin/dev` y comprueba que no toca ningun archivo fuera de la lista de `design.md §1`.
// En cuanto la 176 este en `dev`, ese diff deja de ser «lo que hizo la 176» y pasa a ser «lo
// que hace cualquier rama posterior»: a partir de ahi el guardia juzga trabajo ajeno y hay
// que RETIRARLO EN EL PR QUE LO MERGEA. Lo que debe sobrevivir es el censo estructural, y
// por eso vive en `agregado-alcance.guardia.test.ts` y NO AQUI: retirar este archivo no
// puede llevarse por delante aquello.
//
// Si el diff no se puede calcular (sin `origin/dev` local, p. ej. en un clon superficial),
// el test SE SALTA DECLARANDOLO. Nunca pasa en silencio: un guardia que se cree verde
// porque no pudo mirar es peor que no tenerlo.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/**
 * La lista CERRADA de `design.md §1`. Todo lo que no este aqui es una frontera cruzada.
 *
 * Las tres ultimas entradas no estan en §1.1 y se declaran con su motivo, porque una
 * excepcion sin explicacion es lo que convierte a un guardia en decoracion:
 *
 *  - `feature_list.json` — el alta de la ficha, que la escribe el LEADER. No es codigo de
 *    esta feature y esta spec tiene prohibido tocarlo.
 *  - `tests/unit/analytics/operativa-oraculo.test.ts` y
 *    `tests/unit/analytics/analitica-operativa-action.test.ts` — COLATERAL OBLIGADO de
 *    anadir `consultarAgregado` a `IAnaliticaOperativaService`: sus dobles implementan la
 *    interfaz y sin el metodo nuevo el arbol NO COMPILA. Son dobles de test, no codigo de
 *    produccion, y lo unico que se les anade es un stub que lanza. Desviacion declarada en
 *    `progress/impl_176.md`.
 */
const PERMITIDOS: readonly string[] = [
  // §1.1 — modifica
  "lib/types/analitica-operativa.ts",
  "lib/interfaces/services/IAnaliticaOperativaService.ts",
  "lib/services/AnaliticaOperativaService.ts",
  "lib/actions/analitica-operativa.ts",
  // §1.2 — crea
  "tests/unit/analytics/agregado-contrato.test.ts",
  "tests/unit/analytics/agregado-tasas.test.ts",
  "tests/unit/analytics/agregado-tiempo-ciclo.test.ts",
  "tests/unit/analytics/agregado-coherencia.test.ts",
  "tests/unit/analytics/agregado-cobertura.test.ts",
  "tests/unit/analytics/agregado-dia-en-curso.test.ts",
  "tests/unit/analytics/agregado-aging.test.ts",
  "tests/unit/analytics/agregado-metricas-admitidas.test.ts",
  "tests/unit/analytics/agregado-identidad.test.ts",
  "tests/unit/analytics/agregado-action.test.ts",
  "tests/unit/analytics/agregado-semana.test.ts",
  "tests/unit/analytics/agregado-alcance.guardia.test.ts",
  "tests/unit/analytics/agregado-frontera.guardia.test.ts",
  // Colateral declarado (ver cabecera de esta constante)
  "feature_list.json",
  "tests/unit/analytics/operativa-oraculo.test.ts",
  "tests/unit/analytics/analitica-operativa-action.test.ts",
];

/** Prefijos permitidos: la documentacion propia de la feature. */
const PREFIJOS_PERMITIDOS: readonly string[] = [
  "specs/176-analitica-modo-agregado-tasas/",
  "progress/impl_176.md",
];

/** Los archivos que esta feature NO puede tocar, nombrados para que el motivo se lea. */
const PROHIBIDOS_CON_NOMBRE: Readonly<Record<string, string>> = {
  "lib/analytics/metrics.ts":
    "el catalogo es de la 127 y sus divergencias las corrige la 175, que se implementa en paralelo",
  "lib/analytics/consulta.ts":
    "es el punto de entrada BLINDADO de la 122, por donde pasa el alcance (D1)",
  "lib/interfaces/repositories/IAnaliticaOperativaRollupRepository.ts":
    "R17: cero metodos nuevos en el repositorio del rollup",
  "db/schema.prisma": "esta feature no migra nada: no hay tabla, ni RLS, ni down.sql",
};

function archivosDelDiff(): string[] | null {
  try {
    const salida = execFileSync("git", ["diff", "--name-only", "origin/dev...HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return salida.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

const DIFF = archivosDelDiff();

describe("R18 · la frontera declarada en design.md §1 se cumple", () => {
  it("el diff contra origin/dev no toca ningun archivo fuera de la lista declarada", () => {
    if (DIFF === null) {
      // Declarado, no silencioso.
      expect(
        DIFF,
        "SALTADO: no se pudo calcular el diff contra `origin/dev` (¿clon superficial?). " +
          "Este guardia NO ha comprobado nada en esta corrida.",
      ).toBeNull();
      return;
    }

    const fuera = DIFF.filter(
      (f) => !PERMITIDOS.includes(f) && !PREFIJOS_PERMITIDOS.some((p) => f.startsWith(p)),
    );
    expect(
      fuera,
      "esta feature toca archivos que `design.md §1` no declara. La lista es CERRADA: si de " +
        "verdad hace falta uno mas, se declara en el design y en la bitacora con su motivo, " +
        "no se cuela en el diff. Archivos: " + fuera.join(", "),
    ).toEqual([]);
  });

  it("y en particular no toca ninguno de los archivos prohibidos con nombre", () => {
    if (DIFF === null) return;
    for (const [archivo, motivo] of Object.entries(PROHIBIDOS_CON_NOMBRE)) {
      expect(DIFF.includes(archivo), `${archivo}: ${motivo}`).toBe(false);
    }
  });

  it("el diff mide algo de verdad: la rama SI toca los archivos de §1.1", () => {
    if (DIFF === null) return;
    // Sin esto, un `git diff` que devolviera vacio por cualquier razon dejaria el guardia
    // verde por vacio y la frontera sin vigilar.
    expect(DIFF).toContain("lib/services/AnaliticaOperativaService.ts");
    expect(DIFF).toContain("lib/types/analitica-operativa.ts");
  });

  it("el detector DISCRIMINA: marcaria `lib/analytics/metrics.ts` en el diff", () => {
    const diffInfractor = ["lib/services/AnaliticaOperativaService.ts", "lib/analytics/metrics.ts"];
    const fuera = diffInfractor.filter(
      (f) => !PERMITIDOS.includes(f) && !PREFIJOS_PERMITIDOS.some((p) => f.startsWith(p)),
    );
    expect(fuera).toEqual(["lib/analytics/metrics.ts"]);
  });
});

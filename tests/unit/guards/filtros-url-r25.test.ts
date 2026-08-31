import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import { ESLint } from "eslint";
import type { Linter } from "eslint";

// Feature 335 / R25 — GUARDIA DE PROPIEDAD: la lectura inicial de la URL no escribe
// estado desde un efecto.
//
// POR QUE ESTE GUARDIA EJECUTA EL LINTER Y NO MIRA EL TEXTO DEL CODIGO
// -------------------------------------------------------------------
// La tabla de trazabilidad de la ficha despachaba R25 con "lint del repo en verde".
// Eso no es un test: nadie lo ejecuta con el nombre del requisito delante, y el dia que
// alguien silencie la regla con un `eslint-disable` el requisito se cae sin que ningun
// rojo lo diga.
//
// La tentacion es resolverlo con un `grep`: buscar `useEffect` junto a `setX` en los tres
// archivos y exigir cero coincidencias. NO SIRVE, y el repo ya lo tiene escrito en
// `CLAUDE.md`: un criterio de "hecho" tipo grep no prueba nada, porque se satisface
// renombrando. Basta con extraer el efecto a una funcion auxiliar, aliasar el setter
// (`const aplicar = setTermino`) o partir la linea para que el patron textual desaparezca
// mientras la violacion sigue viva. El grep vigila una CADENA.
//
// Lo que R25 protege no es una cadena, es una PROPIEDAD del flujo de datos: "no se lee una
// fuente externa (los query params) escribiendo estado desde un efecto". Quien sabe decidir
// esa propiedad —siguiendo alias, funciones auxiliares y hooks propios— es precisamente el
// analizador que el repo ya usa para prohibirla: `react-hooks/set-state-in-effect`. Asi que
// este test no reimplementa el analisis: invoca ESLint por su API con la config REAL del
// repo (`eslint.config.mjs`) sobre los tres archivos que la ficha toca, y exige cero
// mensajes. Cae con la violacion aunque el codigo este escrito de una forma que ningun
// patron textual anticipa.
//
// EL MODO DE FALLO QUE HAY QUE EVITAR ES EL VERDE FALSO. Filtrar por un `ruleId` que no
// existe (porque la regla cambio de nombre al subir de version, o porque el plugin dejo de
// cargarse) daria cero mensajes siempre, y el guardia pasaria a no vigilar nada sin avisar.
// Por eso el primer caso NO linta: comprueba contra la config resuelta que la regla existe
// y esta ACTIVA. Si algun dia deja de estarlo, este archivo se pone rojo en vez de mentir.

const RAIZ = path.join(__dirname, "..", "..", "..");

/**
 * Los archivos que la ficha 335 toca. La lectura inicial vive repartida entre el hook
 * (`useFiltrosUrl`) y los dos componentes canonicos que lo consumen, asi que la propiedad
 * hay que exigirla sobre los tres: cumplirla en el hook y romperla en la barra dejaria el
 * requisito igual de incumplido.
 */
const ARCHIVOS = [
  "components/shared/BuscadorFiltros.tsx",
  "components/shared/FilterComponent.tsx",
  "hooks/useFiltrosUrl.ts",
] as const;

/** La regla que codifica R25 palabra por palabra. */
const REGLA_R25 = "react-hooks/set-state-in-effect";

/** Severidad efectiva de una entrada de config, que puede ser `2`, `"error"` o `[2, ...]`. */
function severidad(entrada: Linter.RuleEntry | undefined): number {
  const valor = Array.isArray(entrada) ? entrada[0] : entrada;
  if (typeof valor === "number") return valor;
  if (valor === "error") return 2;
  if (valor === "warn") return 1;
  return 0;
}

/** Una linea legible por mensaje, para que el rojo diga DONDE sin abrir el informe. */
function describir(resultado: ESLint.LintResult, mensaje: Linter.LintMessage): string {
  const relativo = path.relative(RAIZ, resultado.filePath).split(path.sep).join("/");
  return `${relativo}:${mensaje.line}:${mensaje.column}  ${mensaje.ruleId ?? "(fatal)"}  ${mensaje.message}`;
}

describe("Feature 335 / R25 — la lectura inicial de la URL no escribe estado desde un efecto", () => {
  let eslint: ESLint;
  let resultados: ESLint.LintResult[];
  let configs: Linter.Config[];

  // Instanciar ESLint y resolver la config de flat config es caro (carga
  // `eslint-config-next` entero y su cadena de plugins). Se hace UNA sola vez para los tres
  // casos, con holgura sobre el `testTimeout` de 20s del repo.
  beforeAll(async () => {
    eslint = new ESLint({ cwd: RAIZ });
    configs = (await Promise.all(
      ARCHIVOS.map((archivo) => eslint.calculateConfigForFile(archivo)),
    )) as Linter.Config[];
    resultados = await eslint.lintFiles(ARCHIVOS as unknown as string[]);
  }, 60_000);

  it("R25 — la regla que codifica el requisito existe y esta ACTIVA en la config del repo", () => {
    // Sin este caso, los otros dos podrian filtrar sobre un `ruleId` inexistente y pasar en
    // vacio para siempre. Este es el que impide que el guardia se convierta en decorado.
    ARCHIVOS.forEach((archivo, i) => {
      const entrada = configs[i]?.rules?.[REGLA_R25];
      expect(
        entrada,
        `${archivo}: la regla ${REGLA_R25} no aparece en la config resuelta. ` +
          "O cambio de nombre al subir de version, o el plugin dejo de cargarse: " +
          "revisa el id antes de dar R25 por cubierto.",
      ).toBeDefined();
      expect(
        severidad(entrada),
        `${archivo}: ${REGLA_R25} esta configurada como "off"; R25 quedaria sin vigilancia.`,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it("R25 — el linter analiza los tres archivos de verdad (ninguno ignorado ni sin parsear)", () => {
    expect(
      resultados.map((r) => path.relative(RAIZ, r.filePath).split(path.sep).join("/")).sort(),
      "ESLint no devolvio un resultado por archivo: alguno esta fuera del alcance de la config.",
    ).toEqual([...ARCHIVOS].sort());

    // Un error de parseo produce UN mensaje fatal y CERO mensajes de reglas. Sin este
    // control, un archivo que ni siquiera compila pasaria el caso principal como si
    // estuviera limpio.
    const fatales = resultados.flatMap((r) =>
      r.messages.filter((m) => m.fatal === true).map((m) => describir(r, m)),
    );
    expect(fatales, `ESLint no pudo analizar el fuente:\n${fatales.join("\n")}`).toEqual([]);
  });

  it("R25 — ningun archivo de la ficha escribe estado desde un efecto para leer los query params", () => {
    const infracciones = resultados.flatMap((r) =>
      r.messages.filter((m) => m.ruleId === REGLA_R25).map((m) => describir(r, m)),
    );
    expect(
      infracciones,
      "R25 exige que la lectura inicial de la URL se resuelva sin escribir estado desde un " +
        "efecto (el precedente del repo es `useSyncExternalStore`). ESLint encontro:\n" +
        infracciones.join("\n"),
    ).toEqual([]);

    // Red mas ancha, mismo espiritu: si la lectura inicial se "arregla" desplazando el
    // problema a otra regla de la familia de hooks (escribir en render, romper las reglas de
    // los hooks, mutar en un efecto), el requisito sigue incumplido y el guardia lo dice.
    const familiaHooks = resultados.flatMap((r) =>
      r.messages
        .filter((m) => m.ruleId?.startsWith("react-hooks/") === true)
        .map((m) => describir(r, m)),
    );
    expect(
      familiaHooks,
      `Reglas de hooks de React incumplidas en los archivos de la ficha 335:\n${familiaHooks.join("\n")}`,
    ).toEqual([]);
  });
});

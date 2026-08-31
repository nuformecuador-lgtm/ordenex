// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ESLint } from "eslint";
import type { Linter } from "eslint";

import {
  FilterComponent,
  type FilterDef,
  type FilterSelection,
} from "@/components/shared/FilterComponent";

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
//
// POR QUE EL GUARDIA NECESITA DOS MITADES (hallazgo M2 del revisor)
// -----------------------------------------------------------------
// El linter vigila la FORMA: «no hay un setter de estado llamado desde un efecto». Pero
// R25 no existe por la forma, existe por lo que la forma protege: que la URL se lea UNA
// vez, al entrar. Y esa propiedad el linter NO puede verla. La ficha llego a tener un
// efecto que llamaba a `aplicar(...)` —una funcion auxiliar que por dentro hace
// `setSeleccion`— con valores leidos de una ref reescrita en cada render; la regla no
// sigue esa indireccion, asi que el fuente pasaba el lint mientras la propiedad estaba
// rota (era el bloqueante B2). Un guardia que solo linta habria firmado ese codigo.
//
// De ahi la segunda mitad, que es de COMPORTAMIENTO: renderiza el componente, muta los
// query params DESPUES del montaje, hace crecer `filters` —el disparador que volvia a leer
// la URL— y exige que gane la foto de entrada. Si alguien vuelve a colar una lectura
// tardia por una indireccion que el linter no atraviesa, este caso lo dice.

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

// -----------------------------------------------------------------------------------------
// SEGUNDA MITAD: la propiedad que el linter no puede ver.
// -----------------------------------------------------------------------------------------

const replaceMock = vi.fn();

/** La URL de la prueba. `let` porque el caso la MUTA a mitad de vida del componente. */
let parametros = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/fantasia",
  useSearchParams: () => parametros,
}));

const COLOR: FilterDef = {
  key: "color",
  label: "Color",
  kind: "multi",
  options: [
    { value: "rojo", label: "Rojo" },
    { value: "azul", label: "Azul" },
  ],
};

beforeEach(() => {
  replaceMock.mockClear();
  parametros = new URLSearchParams();
});

afterEach(() => {
  cleanup();
});

describe("Feature 335 / R25 — la lectura de la URL ocurre UNA vez, al entrar (propiedad, no forma)", () => {
  it("R25 — mutar los query params tras el montaje no entra por la siembra: gana la foto de entrada", async () => {
    // Se entra con `?color=rojo` y el filtro declarado SIN catalogo: su valor se descarta
    // por R14 y la clave queda pendiente de sembrar. Mientras tanto la URL cambia a `azul`
    // —lo hace el tablero de `/analitica` y el detalle de `cierres-admin`, que reescriben la
    // query durante la sesion— y despues llega el catalogo, que es el disparador de la
    // siembra pendiente. Lo que se siembra debe ser `rojo`: lo que la URL traia AL ENTRAR.
    parametros = new URLSearchParams("color=rojo");
    const onChange = vi.fn();

    const vista = render(
      createElement(FilterComponent, {
        filters: [{ ...COLOR, options: [] }],
        onChange,
        debounceMs: 0,
      }),
    );

    parametros = new URLSearchParams("color=azul");
    vista.rerender(
      createElement(FilterComponent, { filters: [COLOR], onChange, debounceMs: 0 }),
    );

    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toEqual({ color: ["rojo"] }),
    );
    expect(onChange.mock.calls.map(([sel]) => sel as FilterSelection)).not.toContainEqual({
      color: ["azul"],
    });
    expect(screen.getByRole("button", { name: /^Color:/ })).toHaveTextContent("Rojo");
  });
});

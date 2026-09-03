// GUARDIA — FEATURE 365: LA RED DE ERRORES EXISTE, NO AMORDAZA Y NO FILTRA.
//
// ## Por que existe, y por que censa el arbol en vez de ejecutar
//
// Las tres promesas de esta ficha son ciertas HOY porque se escribieron asi, y NINGUNA de las
// tres rompe un test el dia que alguien las deshaga sin querer:
//
//   · Si se borra `app/(app)/error.tsx`, la app vuelve a la pantalla en blanco. Compila, pasa
//     el lint y no falla ni un test: simplemente deja de existir una frontera.
//   · Si alguien quita el `reemitirEnCliente` de `ErrorState` «porque duplica el log», la
//     pantalla se ve IGUAL de bien y el error deja de salir del navegador. Es la mordaza, y es
//     invisible.
//   · Si alguien anade `{error.message}` a la pantalla «para depurar mejor», tampoco falla
//     nada: solo empieza a ensenarle al usuario lo que el servidor decidio redactar.
//
// Es exactamente la familia que este repo llama «el sistema no falla, aparenta». Por eso el
// control es un censo del arbol: un guardia que mirase el diff deja de proteger en cuanto la
// rama se mergea, y una frontera NUEVA (otra seccion, manana) entra sola en este barrido.
//
// ## Cada detector se prueba contra codigo que SI infringe
//
// Un detector que no puede fallar es decorado. Cada clausula lleva su caso positivo escrito
// abajo, y el censo lleva control de no-vacuidad: si el recorrido dejara de encontrar archivos
// —porque `app/` se mueva, o porque el filtro se rompa— este guardia diria «verde» sin haber
// mirado nada, que es el modo de fallo de la ficha de al lado.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { quitarComentarios, codigoSinComentarios } from "../../fixtures/sin-comentarios";

const RAIZ = path.resolve(__dirname, "../../..");

/** Las tres alturas de la red. Se nombran por ruta: son las que la ficha 365 se comprometio a poner. */
const FRONTERAS_OBLIGATORIAS = [
  // Cubre las 16 secciones del portal y sus subrutas, conservando el sidebar.
  "app/(app)/error.tsx",
  // Cubre el layout del portal (que la de arriba no puede ver caer) y las paginas publicas.
  "app/error.tsx",
  // Cubre el layout raiz, que ninguna de las otras dos puede cubrir.
  "app/global-error.tsx",
] as const;

/** La pieza compartida donde viven las cuatro garantias. */
const PANTALLA_COMPARTIDA = "components/shared/ErrorState.tsx";

/** El canal por el que el error vuelve a salir al registro. */
const REEMISOR = "lib/errors/reemitir-en-cliente.ts";

/** Recorre `app/` y devuelve TODA frontera de error, por ruta relativa a la raiz. */
function censarFronteras(): string[] {
  const encontradas: string[] = [];

  function recorrer(relativo: string): void {
    const absoluto = path.join(RAIZ, relativo);
    for (const entrada of readdirSync(absoluto, { withFileTypes: true })) {
      const hijo = `${relativo}/${entrada.name}`;
      if (entrada.isDirectory()) {
        if (entrada.name === "node_modules" || entrada.name === ".next") continue;
        recorrer(hijo);
      } else if (entrada.name === "error.tsx" || entrada.name === "global-error.tsx") {
        encontradas.push(hijo);
      }
    }
  }

  recorrer("app");
  return encontradas.sort();
}

const FRONTERAS = censarFronteras();

/* ── LOS DETECTORES ───────────────────────────────────────────────────────────────────────── */

/**
 * ¿La frontera devuelve el error al registro? Vale de las dos formas: montando la pantalla
 * compartida (que re-emite por dentro) o llamando al re-emisor directamente, que es lo que hace
 * la frontera global —no puede reusar `ErrorState` porque sustituye al documento entero—.
 */
const reemiteElError = (codigo: string): boolean =>
  /\bErrorState\b/.test(codigo) || /\breemitirEnCliente\b/.test(codigo);

/**
 * ¿La frontera le ensena al usuario el detalle tecnico del fallo? En produccion el `message` de
 * un error de servidor viene redactado por Next, pero el de un error de CLIENTE no: puede
 * llevar el dato que lo provoco (un telefono, una guia, una fila entera). `digest` esta fuera
 * de la lista a proposito: es un hash sin contenido y es justo lo que el usuario puede dictarnos.
 */
//
// El detector es DELIBERADAMENTE ROMO —cualquier `.message` / `.stack` / `.cause`, salga del
// identificador que salga— y no `error.message` acotado. MEDIDO el 2026-09-02: la mutacion
// `{(error as Error).message}` ESQUIVA el patron acotado (entre `error` y el punto se cuela un
// `as Error)`) y dejaba este guardia en verde con el filtrado ya puesto. Los cinco archivos
// vigilados son pequenos y dedicados: hoy no tienen ni un uso legitimo de esas tres
// propiedades, asi que la version roma no cuesta ningun falso positivo y cierra la evasion.
const PINTA_DETALLE = [
  /\.\s*(message|stack|cause)\b/,
  /JSON\s*\.\s*stringify\s*\(\s*error\b/,
  /\bString\s*\(\s*error\s*\)/,
];
const pintaDetalleTecnico = (codigo: string): boolean =>
  PINTA_DETALLE.some((patron) => patron.test(codigo));

/* ── LAS CLAUSULAS ────────────────────────────────────────────────────────────────────────── */

describe("guardia 365 — el censo mira algo", () => {
  it("encuentra al menos las tres fronteras de la red", () => {
    // Control de no-vacuidad: sin esto, un recorrido roto dejaria todo lo de abajo en verde
    // por no haber leido ni un archivo.
    expect(FRONTERAS.length).toBeGreaterThanOrEqual(FRONTERAS_OBLIGATORIAS.length);
  });
});

describe("guardia 365 — la red existe donde se dijo", () => {
  for (const ruta of FRONTERAS_OBLIGATORIAS) {
    it(`existe ${ruta}`, () => {
      // Borrar cualquiera de las tres devuelve a la app la pantalla en blanco en su tramo, sin
      // que nada mas lo denuncie.
      expect(existsSync(path.join(RAIZ, ruta))).toBe(true);
    });
  }

  it("la pantalla compartida y el re-emisor siguen en pie", () => {
    expect(existsSync(path.join(RAIZ, PANTALLA_COMPARTIDA))).toBe(true);
    expect(existsSync(path.join(RAIZ, REEMISOR))).toBe(true);
  });
});

describe("guardia 365 — ninguna frontera amordaza el error", () => {
  it("TODA frontera del arbol devuelve el error al registro", () => {
    const mudas = FRONTERAS.filter((ruta) => !reemiteElError(codigoSinComentarios(ruta)));
    expect(mudas).toEqual([]);
  });

  it("la pantalla compartida es la que re-emite, y sigue haciendolo", () => {
    expect(codigoSinComentarios(PANTALLA_COMPARTIDA)).toMatch(/reemitirEnCliente\s*\(/);
  });

  it("el re-emisor emite de verdad: reportError con respaldo de console.error", () => {
    const codigo = codigoSinComentarios(REEMISOR);
    // `reportError` es el canal fuerte (evento `error` de `window`, el que ve un monitor);
    // `console.error` es el respaldo donde no exista. Quedarse sin ninguno de los dos es la
    // mordaza que esta ficha vino a evitar.
    expect(codigo).toMatch(/reportError/);
    expect(codigo).toMatch(/console\s*\.\s*error\s*\(/);
  });

  it("el detector sabe distinguir una frontera muda de una que emite", () => {
    expect(reemiteElError("export default function E() { return <p>Ups</p>; }")).toBe(false);
    expect(reemiteElError("return <ErrorState error={error} reset={reset} />;")).toBe(true);
    expect(reemiteElError("useEffect(() => { reemitirEnCliente(error); }, [error]);")).toBe(true);
  });
});

describe("guardia 365 — ninguna frontera le ensena el detalle tecnico al usuario", () => {
  const VIGILADOS = [...FRONTERAS, PANTALLA_COMPARTIDA];

  it("ni el mensaje, ni el stack, ni la causa, ni el error serializado", () => {
    const filtradores = VIGILADOS.filter((ruta) =>
      pintaDetalleTecnico(codigoSinComentarios(ruta)),
    );
    expect(filtradores).toEqual([]);
  });

  it("el detector caza las formas de filtrarlo, incluida la que esquiva el patron acotado", () => {
    expect(pintaDetalleTecnico("<p>{error.message}</p>")).toBe(true);
    // Las dos que un patron acotado a `error.` dejaba pasar. La primera es la mutacion real
    // que se aplico el 2026-09-02 y que este guardia NO cazaba antes de robustecerlo.
    expect(pintaDetalleTecnico("<code>{(error as Error).message}</code>")).toBe(true);
    expect(pintaDetalleTecnico("const e = err; return <p>{e.message}</p>;")).toBe(true);
    expect(pintaDetalleTecnico("<pre>{error.stack}</pre>")).toBe(true);
    expect(pintaDetalleTecnico("<p>{error.cause}</p>")).toBe(true);
    expect(pintaDetalleTecnico("<pre>{JSON.stringify(error, null, 2)}</pre>")).toBe(true);
    expect(pintaDetalleTecnico("<p>{String(error)}</p>")).toBe(true);
  });

  it("el detector NO caza el identificador, que si se puede ensenar", () => {
    // El `digest` es un hash del mensaje + el stack calculado por Next: no lleva datos y es la
    // clave con la que se localiza la linea en el registro del servidor.
    expect(pintaDetalleTecnico("<code>{error.digest}</code>")).toBe(false);
  });

  it("el detector lee CODIGO, no prosa: un comentario que nombra la regla no la infringe", () => {
    // Sin esta pasada, este mismo guardia obligaria a borrar las explicaciones de por que no se
    // pinta `error.message` — que es justo lo que hace falta para no volver a pintarlo.
    const conComentario = "// nunca se pinta error.message\nreturn <p>Algo falló</p>;";
    expect(pintaDetalleTecnico(quitarComentarios(conComentario))).toBe(false);
    expect(pintaDetalleTecnico(conComentario)).toBe(true);
  });
});

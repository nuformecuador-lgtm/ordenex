import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { quitarComentarios } from "../../fixtures/sin-comentarios";
import { prepararConteoEntregas } from "@/lib/analytics/entregas-conteo";
import { recorteDePresentacion } from "@/lib/analytics/presentacion";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { ROLES_ACCESO_ANALITICA } from "@/lib/auth/menu-visibility";

/**
 * ⭑⭑ FICHA 443 — EL HEROE DE LA EFECTIVIDAD ES DE TODOS LOS ROLES QUE ENTRAN, NO DE DOS.
 *
 * ─── EL HECHO QUE ESTE ARCHIVO CONGELA ──────────────────────────────────────────────────
 *
 * Medido el 2026-09-17 en el navegador con sesion real de los tres roles, sobre `origin/dev`
 * (`8e602bf8`, con la 441 y la 442 ya dentro):
 *
 *   | rol             | cargadas | lo que dice el heroe                                     |
 *   | --------------- | -------- | -------------------------------------------------------- |
 *   | `maestro`       |    69    | «17,4 %», cifra a 68 px                                   |
 *   | `adminTienda`   |    68    | «17,6 %» — una orden menos: la que NO es suya             |
 *   | `adminSatelite` |     8    | «1 entregada de 8 ordenes» + «son muy pocas para un %»    |
 *
 * O sea: el heroe YA aparece para la tienda y para el satelite, y YA trae el alcance de cada
 * uno. Lo que faltaba no era el numero: era que nada impidiera perderlo. Este archivo es esa
 * pieza — la mutacion «el heroe desaparece para un rol» tiene DOS formas y aqui estan las dos.
 *
 * ─── LAS DOS FORMAS DE PERDERLO, Y POR QUE HACEN FALTA LOS DOS BLOQUES ──────────────────
 *
 * (a) **POR DATOS.** El heroe se alimenta de `consultarConteoPorStatus`, cuyo unico guardia es
 *     `prepararConteoEntregas`. Si ese resolutor denegara para un rol, la tarjeta seguiria
 *     montandose y pintaria «no tienes permiso»: la fila no desaparece, la CIFRA si. Se recorre
 *     `ROLES_ACCESO_ANALITICA` —la fuente unica de quien tiene puerta—, nunca una lista escrita
 *     aqui: el dia que se le abra la analitica al `mensajero`, este bloque lo exige sin tocarse.
 *
 * (b) **POR MONTAJE.** La pagina tiene DOS `return` (con y sin acceso total) y el heroe viaja en
 *     el slot `destacado` de los dos. Quitarlo de uno se lo quita a la tienda y al satelite sin
 *     romper ningun tipo y sin que ningun test de datos se entere. Por eso el segundo bloque
 *     censa el CODIGO de la ruta.
 *
 * ⚠ POR QUE (b) ES UN CENSO DE TEXTO Y NO UN RENDER. La pagina es un Server Component `async`
 * que llama a `resolveActorFromSession`, y sus dos guardias vecinos
 * (`AnaliticaPage.test.tsx`, `tablero-operativo-frontera.guardia.test.ts`) ya establecieron el
 * precedente de medirla leyendo su fuente. Un censo de texto es debil contra la reescritura y
 * fuerte contra el borrado, que es exactamente la mutacion que se teme aqui.
 */

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const RUTA_PAGINA = "app/(app)/analitica/page.tsx";

/** Un actor bien formado de cada rol. `zonaId` va SIEMPRE: sin ella el satelite deniega, y lo
 *  que se mide aqui es el rol, no un fallo de configuracion (ese caso tiene su propio test en
 *  `conteo-entregas-contrato.test.ts`). */
function actorDe(rol: string): ActorAnalitica {
  return { usuarioId: `u-${rol}`, rol, zonaId: "z-propia" };
}

const AHORA = new Date("2026-09-17T12:00:00.000Z");

function fuenteDeLaPagina(): string {
  return quitarComentarios(fs.readFileSync(path.join(REPO_ROOT, RUTA_PAGINA), "utf8"));
}

/** Cuantas veces aparece `aguja` en `texto`. Literal, no regex: las agujas llevan `<` y `{`. */
function veces(texto: string, aguja: string): number {
  return texto.split(aguja).length - 1;
}

describe("443/(a) — TODO rol con puerta a la analitica recibe la cifra del heroe", () => {
  // ANTI-VACIO: si la fuente de roles se quedara vacia, los `it.each` de abajo no correrian y
  // el archivo estaria verde sin comprobar nada.
  it("la lista de roles con puerta no esta vacia", () => {
    expect(ROLES_ACCESO_ANALITICA.length).toBeGreaterThan(0);
  });

  it.each([...ROLES_ACCESO_ANALITICA])(
    "`%s` obtiene una consulta CONCEDIDA, no un `forbidden`",
    (rol) => {
      const preparada = prepararConteoEntregas({}, actorDe(rol), AHORA);

      // ⭑ LA MUTACION QUE MATA: denegar la lectura para uno de los roles. La tarjeta seguiria
      // en su sitio y escribiria «no tienes permiso» donde antes habia un porcentaje.
      expect(
        preparada.status,
        `${rol} entra a /analitica pero el heroe no tendria ninguna cifra que pintar`,
      ).toBe("ok");
    },
  );

  it.each([...ROLES_ACCESO_ANALITICA])(
    "`%s` recibe EL MISMO alcance que la pantalla dice que tiene (`recorteDePresentacion`)",
    (rol) => {
      const preparada = prepararConteoEntregas({}, actorDe(rol), AHORA);
      if (preparada.status !== "ok") throw new Error(`${rol} fue denegado: ver el caso de arriba`);

      // NO se escribe una tabla rol -> alcance: eso seria la segunda tabla que R8/R37 de la 122
      // prohiben. Lo que se afirma es la COHERENCIA entre las dos lecturas que el usuario ve a la
      // vez: el `tipo` con el que se calcula su cifra y el que rotula su tablero y decide sus
      // facetas. Si divergieran, la pantalla diria «toda la operacion» sobre una cifra de una
      // sola zona, o al reves.
      expect(preparada.consulta.alcance.tipo, `el alcance de ${rol} discrepa entre datos y pantalla`).toBe(
        recorteDePresentacion(actorDe(rol)).alcance,
      );
    },
  );

  it("los roles con puerta NO resuelven todos el mismo alcance (el recorte hace algo)", () => {
    const tipos = new Set(
      ROLES_ACCESO_ANALITICA.map((rol) => {
        const p = prepararConteoEntregas({}, actorDe(rol), AHORA);
        return p.status === "ok" ? p.consulta.alcance.tipo : "denegado";
      }),
    );

    // Sin esta linea, un resolutor que devolviera `global` para todo el mundo pasaria los dos
    // bloques de arriba con nota: todos concedidos y todos coherentes con una presentacion
    // igualmente rota. Tres tipos distintos hoy: `global`, `tienda` y `zona`.
    expect(tipos.size, "todos los roles ven lo mismo: el recorte por rol no esta recortando").toBeGreaterThan(
      1,
    );
  });
});

describe("443/(b) — el heroe se monta en LOS DOS caminos de la pagina", () => {
  it("la ruta existe donde este censo cree que existe", () => {
    // Si alguien mueve la pagina, este archivo se pondria verde por vacio. Se comprueba antes.
    expect(fs.existsSync(path.join(REPO_ROOT, RUTA_PAGINA)), RUTA_PAGINA).toBe(true);
  });

  it("la fila de KPIs se monta UNA sola vez: no hay dos versiones por rol", () => {
    // Dos montajes serian la otra forma del mismo defecto: una fila para el maestro y otra
    // —recortada, o ausente— para los demas, que es justo lo que la ficha 443 vino a mirar.
    expect(veces(fuenteDeLaPagina(), "<KpisEfectividad")).toBe(1);
  });

  it("TODO `<AnaliticaShell` recibe el slot que lleva el heroe dentro", () => {
    const fuente = fuenteDeLaPagina();
    const montajes = veces(fuente, "<AnaliticaShell");
    const conDestacado = veces(fuente, "destacado={bloquesDestacados}");

    // ANTI-VACIO: si la pagina dejara de montar el shell, los dos conteos serian 0 y la
    // igualdad de abajo se cumpliria sin decir nada.
    expect(montajes, "la pagina ya no monta `AnaliticaShell`").toBeGreaterThan(1);

    // ⭑ LA MUTACION QUE MATA: quitar `destacado` del `return` de los roles SIN acceso total.
    // El maestro seguiria viendo el heroe; la tienda y el satelite se quedarian sin el, sin que
    // ningun tipo se rompa y sin que ninguna cifra cambie.
    expect(
      conDestacado,
      "hay un camino de la pagina que monta el shell SIN el bloque donde vive el heroe",
    ).toBe(montajes);
  });

  it("el bloque que contiene el heroe no se decide por rol", () => {
    const fuente = fuenteDeLaPagina();
    const desde = fuente.indexOf("const bloqueEntregas = (");
    expect(desde, "`bloqueEntregas` ya no se declara: este censo dejo de medir lo que cree").toBeGreaterThan(
      -1,
    );
    const hasta = fuente.indexOf("const bloquesDestacados", desde);
    const bloque = fuente.slice(desde, hasta === -1 ? undefined : hasta);

    // El bloque puede leer `recorte.facetas` y `recorte.productos` —son decisiones de
    // PRESENTACION ya resueltas fuera— pero no puede volver a razonar sobre el ROL: ahi es donde
    // se cuela un `esAccesoTotal(actor.rol) ? <KpisEfectividad/> : null`.
    for (const prohibido of ["esAccesoTotal", "actor.rol", "ROLES_ACCESO_ANALITICA"]) {
      expect(bloque.includes(prohibido), `el bloque del heroe razona sobre el rol (${prohibido})`).toBe(
        false,
      );
    }
  });
});

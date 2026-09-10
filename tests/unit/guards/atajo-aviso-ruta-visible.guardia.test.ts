import { describe, it, expect } from "vitest";
import type { RolValue } from "@prisma/client";
import { CATALOGO_AVISOS, accionDeAviso } from "@/lib/notificaciones/catalogo-avisos";
import { SIDEBAR_ITEMS, itemsVisibles } from "@/lib/auth/menu-visibility";
import type { NotificacionEvento } from "@/lib/types/notificacion";

// FICHA 409 (T1.5, R5) — LA GUARDIA QUE IMPIDE UNA PROMESA FALSA.
//
// Recorre TODAS las entradas del catalogo y, por cada destino declarado, afirma contra
// `SIDEBAR_ITEMS`/`itemsVisibles` que la ruta EXISTE **y** que el rol al que se le declara LA VE.
// Un atajo a una pantalla que el rol no ve no es un boton roto: es un `notFound()` en la cara de
// alguien que estaba intentando resolver algo — `/ordenes`, por ejemplo, hace `notFound()` al
// `adminSatelite`, que es justo por lo que `devoluciones_represadas` acaba con DOS destinos.
//
// SE DECLARA COMO GUARDIA (`*.guardia.test.ts`) PORQUE NO IMPORTA LO QUE VIGILA: recorre DATOS —el
// catalogo y el menu—, asi que ningun grafo de imports la seleccionaria en el modo rapido. Las
// guardias corren SIEMPRE.
//
// ⚠️ LO QUE ESTA GUARDIA **NO** CUBRE TODAVIA, DECLARADO CON NOMBRE: la segunda mitad de R6 —«si
// el destino lleva un parametro de consulta, la PAGINA DE DESTINO LO LEE»—. Hoy el unico destino
// con parametro es `/novedades?superficie=devolucion`, y quien tiene que leerlo es
// `app/(app)/novedades/page.tsx`, que es FRONTEND (tarea T6.5 del spec, fase 6). El agente de
// frontend añade aqui ese bloque cuando la pagina lo lea; hasta entonces el aserto seria rojo por
// una razon que no es la suya. Lo que SI se comprueba abajo es la mitad que depende del catalogo:
// que ningun destino invente un parametro fuera de la lista blanca declarada.

/** Actor minimo para preguntarle al menu «¿este rol ve esto?». */
function actorDe(rol: RolValue) {
  return { usuarioId: `usuario-${rol}`, rol, zonaId: null };
}

/** Todas las rutas navegables que un rol ve: los items y sus subitems, ya podados. */
function rutasVisiblesPara(rol: RolValue): Set<string> {
  const rutas = new Set<string>();
  for (const item of itemsVisibles(SIDEBAR_ITEMS, actorDe(rol))) {
    rutas.add(item.href);
    for (const hijo of item.children ?? []) rutas.add(hijo.href);
  }
  return rutas;
}

/** Cada (evento, rol destinatario, destino declarado) del catalogo entero. */
function destinosDeclarados(): Array<{ evento: string; rol: RolValue; href: string }> {
  const destinos: Array<{ evento: string; rol: RolValue; href: string }> = [];
  for (const [evento, entrada] of Object.entries(CATALOGO_AVISOS)) {
    for (const rol of entrada.destinatarios) {
      const accion = accionDeAviso(evento as NotificacionEvento, rol);
      if (accion.clase !== "accionable" || accion.atajo === null) continue;
      destinos.push({ evento, rol, href: accion.atajo.href });
    }
  }
  return destinos;
}

describe("R5 — todo atajo declarado apunta a una ruta que EXISTE y que ese rol VE", () => {
  it("el recorrido encuentra destinos (autocomprobacion antes de afirmar nada)", () => {
    // Sin esto, un fallo de extraccion dejaria la lista vacia y los bucles de abajo pasarian en
    // verde sin haber comprobado ni un destino. Este repo ya midio lo que cuesta un test que
    // reporta `passed` sin ejercitar nada.
    const destinos = destinosDeclarados();
    expect(destinos.length).toBeGreaterThanOrEqual(12);
    expect(destinos.map((d) => d.href)).toContain("/novedades?superficie=devolucion");
    expect(destinos.map((d) => d.href)).toContain("/recepcion-satelite/en-bodega");
  });

  it("cada destino, sin su parametro de consulta, es una ruta del menu de ese rol", () => {
    const invalidos: string[] = [];
    for (const { evento, rol, href } of destinosDeclarados()) {
      const ruta = href.split("?")[0];
      if (!rutasVisiblesPara(rol).has(ruta)) invalidos.push(`${evento} -> ${rol} -> ${href}`);
    }
    // El diagnostico nombra el evento, el rol y el destino: las tres cosas que hacen falta para
    // arreglarlo sin volver a investigar.
    expect(invalidos).toEqual([]);
  });

  it("el menu de cada rol NO esta vacio (si lo estuviera, lo de arriba no probaria nada)", () => {
    for (const rol of ["maestro", "admin", "adminTienda", "adminSatelite", "mensajero"] as const) {
      expect(rutasVisiblesPara(rol).size, `${rol} sin menu`).toBeGreaterThan(0);
    }
  });

  it("la guardia SI se pone roja ante el destino equivocado (mutacion, comprobada aqui)", () => {
    // La mutacion del design: «poner `/wallet` como destino del mensajero». Se ejercita el mismo
    // predicado que el bucle de arriba, para demostrar que ese bucle no es decorativo.
    expect(rutasVisiblesPara("mensajero").has("/wallet")).toBe(false);
    expect(rutasVisiblesPara("maestro").has("/wallet")).toBe(true);
    // Y la otra: «declarar una ruta que ya no existe».
    expect(rutasVisiblesPara("maestro").has("/notificaciones")).toBe(false);
  });
});

describe("R6 (mitad del catalogo) — ningun destino inventa un parametro de consulta", () => {
  /**
   * Lista BLANCA de los parametros que un atajo puede emitir hoy. Uno nuevo obliga a pasar por
   * aqui y, con el, a comprobar que la pagina de destino lo lee — que es la mitad que vive en la
   * guardia de frontend (T6.5). Con lista negra, un parametro inventado quedaria admitido solo.
   */
  const PARAMETROS_ADMITIDOS = new Set(["superficie"]);

  it("solo aparecen parametros de la lista blanca", () => {
    const inventados: string[] = [];
    for (const { evento, href } of destinosDeclarados()) {
      const [, query] = href.split("?");
      if (!query) continue;
      for (const par of query.split("&")) {
        const nombre = par.split("=")[0];
        if (!PARAMETROS_ADMITIDOS.has(nombre)) inventados.push(`${evento} -> ?${nombre}`);
      }
    }
    expect(inventados).toEqual([]);
  });

  it("el unico destino con parametro es el de novedades, y su valor es un grupo real", () => {
    const conParametro = destinosDeclarados().filter((d) => d.href.includes("?"));
    expect(conParametro.map((d) => d.href)).toEqual(["/novedades?superficie=devolucion"]);
  });
});

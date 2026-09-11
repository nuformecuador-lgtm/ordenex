import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
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
// ⚠️ LA SEGUNDA MITAD DE R6 —«si el destino lleva un parametro de consulta, la PAGINA DE DESTINO
// LO LEE»— YA ESTA CUBIERTA (T6.5, cerrada por el frontend el 2026-09-10): el ultimo `describe` de
// este archivo abre el FUENTE de la pagina de destino y comprueba que lee ese parametro. Un
// parametro que el destino ignora no rompe nada visible: deja al usuario en la pestaña equivocada
// con un 200, que es la clase de fallo mudo mas cara de este repo.

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
    expect(destinos.length).toBeGreaterThanOrEqual(13);
    expect(destinos.map((d) => d.href)).toContain("/novedades?superficie=devolucion");
    expect(destinos.map((d) => d.href)).toContain("/recepcion-satelite/en-bodega");
    // FICHA 412: si el recorrido dejara de ver la entrada nueva, el bucle de abajo saldria verde
    // sin haberla comprobado. Se nombra su par (evento, rol) para que eso no pueda pasar.
    expect(destinos.map((d) => `${d.evento}|${d.rol}`)).toContain("cierre_dia_rechazado|mensajero");
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

  it("⭑ 412/R21: el destino de `cierre_dia_rechazado` existe Y lo ve el `mensajero`", () => {
    // Nombrado aparte del barrido de arriba a proposito: R21 pide que ESTE par (evento, rol)
    // quede afirmado, no solo que el recorrido generico no encuentre invalidos —un recorrido que
    // dejara de ver esta entrada saldria verde igual—.
    const accion = accionDeAviso("cierre_dia_rechazado", "mensajero");
    expect(accion.clase).toBe("accionable");
    expect(accion.clase === "accionable" && accion.atajo?.href).toBe("/cierre-dia");
    expect(rutasVisiblesPara("mensajero").has("/cierre-dia")).toBe(true);

    // MUTACION del design (§12): declarar `/cierres-admin` como destino del mensajero. Es la
    // pantalla donde el ADMIN aprueba, y el mensajero no la ve: seria un `notFound()` en la cara
    // de alguien que estaba intentando resolver su cierre.
    expect(rutasVisiblesPara("mensajero").has("/cierres-admin")).toBe(false);
    expect(rutasVisiblesPara("maestro").has("/cierres-admin")).toBe(true);
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

describe("R6 (mitad de la pagina) — el destino que lleva parametro, LO LEE", () => {
  /**
   * De ruta a su archivo de pagina. Se escribe a mano y en un solo sitio: derivarlo del `href` con
   * un `glob` haria que un destino sin pagina pasara por «no encontre archivo» en vez de por rojo.
   */
  const PAGINA_DE_RUTA: Record<string, string> = {
    "/novedades": "app/(app)/novedades/page.tsx",
  };

  function fuenteDeLaPagina(ruta: string): string {
    const relativo = PAGINA_DE_RUTA[ruta];
    if (!relativo) throw new Error(`sin archivo declarado para la ruta ${ruta}`);
    return readFileSync(path.join(process.cwd(), relativo), "utf8");
  }

  it("cada destino con `?` apunta a una pagina que lee ESE parametro", () => {
    const conParametro = destinosDeclarados().filter((d) => d.href.includes("?"));
    // Autocomprobacion antes de afirmar nada: si la extraccion fallara, el bucle de abajo pasaria
    // en verde sin haber leido un solo fuente.
    expect(conParametro.length).toBeGreaterThan(0);

    const sordos: string[] = [];
    for (const { evento, href } of conParametro) {
      const [ruta, query] = href.split("?");
      const fuente = fuenteDeLaPagina(ruta);
      // `searchParams` es la UNICA via por la que un Server Component recibe la query: sin ella,
      // el nombre del parametro podria estar escrito en un comentario y no leerse nunca.
      if (!fuente.includes("searchParams")) sordos.push(`${evento} -> ${ruta} no lee searchParams`);
      for (const par of (query ?? "").split("&")) {
        const nombre = par.split("=")[0];
        if (!fuente.includes(nombre)) sordos.push(`${evento} -> ${ruta} ignora ?${nombre}`);
      }
    }
    expect(sordos).toEqual([]);
  });

  it("la guardia SI se pone roja ante un parametro que la pagina ignora (mutacion)", () => {
    // Se ejercita EL MISMO predicado del bucle de arriba con un parametro inventado, para
    // demostrar que ese bucle no es decorativo. La mutacion del design es «inventar `?estado=x`
    // en un destino»: la pagina de novedades no contiene `estadoInventado` por ningun lado.
    const fuente = fuenteDeLaPagina("/novedades");
    expect(fuente.includes("superficie")).toBe(true);
    expect(fuente.includes("estadoInventado")).toBe(false);
  });

  it("la pagina de novedades valida contra la lista blanca, y no con un `as`", () => {
    // Un valor arbitrario que llegara hasta `TabsGroup` activaria una pestaña que no existe y
    // base-ui desmontaria su panel: pantalla en blanco con un 200 (R66). La validacion es de
    // borde y se escribe con zod contra `GRUPOS_NOVEDAD`, como pide `docs/conventions.md`.
    const fuente = fuenteDeLaPagina("/novedades");
    expect(fuente).toContain("GRUPOS_NOVEDAD");
    expect(fuente).not.toMatch(/as GrupoNovedad/);
  });
});

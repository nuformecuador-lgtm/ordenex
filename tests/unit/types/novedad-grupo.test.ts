import { describe, it, expect } from "vitest";

import {
  ESTATUS_POR_GRUPO,
  GRUPOS_NOVEDAD,
  grupoDeEstatus,
  type GrupoNovedad,
} from "@/lib/types/novedad-grupo";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 236 (T1.1, R5/R6/R7) — la DECLARACION UNICA de los grupos de `/novedades`.
//
// Lo que este archivo protege, y que el typecheck NO puede:
//
//  - que `GRUPOS_NOVEDAD` cubra TODAS las claves del mapa. El `satisfies readonly GrupoNovedad[]`
//    comprueba que cada elemento sea un grupo, no que esten todos: se puede borrar `"devolucion"`
//    de la lista y el proyecto compila, con la pestaña desaparecida y la invariante de T2.3
//    iterando sobre la mitad del universo.
//  - que `grupoDeEstatus` sea la INVERSA EXACTA del mapa, comprobada RECORRIENDO el `Record` y no
//    contra una lista escrita a mano aqui: si se comparara contra literales propios, este test
//    seria una segunda verdad y estaria verde el dia que las dos se separaran.
//  - que los dos values existan en el catalogo real de estatus.

describe("236/R5/R7 — los grupos de novedad estan declarados una sola vez", () => {
  it("los DOS grupos existen y el mapa les da un estado a cada uno", () => {
    // Censo CERRADO: ni uno mas ni uno menos. Un grupo de mas tendria que pasar por aqui y por la
    // tabla de acciones de la pantalla (R6/R20); uno de menos seria una pestaña que desaparece.
    expect(Object.keys(ESTATUS_POR_GRUPO).sort()).toEqual(["ayuda", "devolucion"]);
    expect(ESTATUS_POR_GRUPO.ayuda).toBe("ayuda_tienda");
    expect(ESTATUS_POR_GRUPO.devolucion).toBe("devuelta");
  });

  it("R7: los dos values existen en `ORDER_STATUS_SEED` (el catalogo real)", () => {
    // El `satisfies Record<GrupoNovedad, OrderStatusValue>` ya lo exige en el typecheck; esto es
    // la mitad EJECUTABLE de R7, y es la que sigue viva si alguien afloja el tipo a `string`.
    const catalogo = ORDER_STATUS_SEED as readonly string[];
    for (const [grupo, value] of Object.entries(ESTATUS_POR_GRUPO)) {
      expect(catalogo, `\`${value}\` (grupo ${grupo}) no esta en el catalogo`).toContain(value);
    }
  });

  it("`GRUPOS_NOVEDAD` cubre TODAS las claves del mapa, sin repetir ninguna", () => {
    // Lo que el `satisfies` de la lista NO comprueba. Sin este caso, borrar un grupo de la lista
    // compila y deja la pestaña sin enseñar y la invariante de T2.3 iterando media verdad.
    expect([...GRUPOS_NOVEDAD].sort()).toEqual(Object.keys(ESTATUS_POR_GRUPO).sort());
    expect(new Set(GRUPOS_NOVEDAD).size).toBe(GRUPOS_NOVEDAD.length);
  });

  it("D6: el ORDEN de la lista es el de las pestañas — la ayuda va PRIMERA", () => {
    // Firmado por el humano el 2026-08-19: alguien esta esperando respuesta AHORA. El orden vive
    // junto al mapa para que la pantalla y la descarga no puedan enumerarlos distinto.
    expect([...GRUPOS_NOVEDAD]).toEqual(["ayuda", "devolucion"]);
  });
});

describe("236/R5 — `grupoDeEstatus` es la INVERSA del mapa, no un segundo literal", () => {
  it("para CADA entrada del mapa devuelve su grupo (recorriendo el Record, no una lista propia)", () => {
    for (const [grupo, value] of Object.entries(ESTATUS_POR_GRUPO) as Array<
      [GrupoNovedad, string]
    >) {
      expect(grupoDeEstatus(value), `${value} deberia ser del grupo ${grupo}`).toBe(grupo);
    }
    // No-vacuidad: el bucle de arriba recorrio algo. Un `Record` vacio lo dejaria verde.
    expect(Object.keys(ESTATUS_POR_GRUPO).length).toBeGreaterThan(0);
  });

  it("un estatus AJENO devuelve `null` — la fila no pertenece a ninguna pestaña (R21)", () => {
    // Los cinco estados por los que pasa una orden DESPUES de salir de la ayuda, mas el pre-estado
    // de la devolucion. Ninguno puede reclamar un grupo: si lo hiciera, la pantalla ofreceria sobre
    // esa fila acciones que la resuelven.
    for (const ajeno of [
      "en_reparto",
      "sin_gestionar",
      "en_bodega_central",
      "entregada",
      "devolucion_por_confirmar",
      "rechazada",
    ]) {
      expect(grupoDeEstatus(ajeno), `${ajeno} no es de ningun grupo`).toBeNull();
    }
    // Y tampoco lo son el vacio ni el nombre de un GRUPO (que no es un estatus).
    expect(grupoDeEstatus("")).toBeNull();
    expect(grupoDeEstatus("ayuda")).toBeNull();
  });

  it("NINGUN estatus del catalogo fuera del mapa reclama grupo (censo entero, no una muestra)", () => {
    // El caso de arriba prueba seis; este prueba los 22. Es la version exhaustiva: si alguien
    // añadiera una segunda via de asignacion de grupo (un `if` extra, un alias), esto lo caza.
    const delMapa = new Set<string>(Object.values(ESTATUS_POR_GRUPO));
    const ajenos = (ORDER_STATUS_SEED as readonly string[]).filter((v) => !delMapa.has(v));
    expect(ajenos.length).toBeGreaterThan(0); // no-vacuidad
    for (const ajeno of ajenos) expect(grupoDeEstatus(ajeno), ajeno).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ESTADOS_BODEGA_SATELITE } from "@/lib/utils/estados-bodega-satelite";

/**
 * FICHA 349 — GUARDIA: LA BODEGA SATELITE Y `/ordenes` LEEN LA **MISMA** PROYECCION.
 *
 * ─── QUE FALLO VIGILA ──────────────────────────────────────────────────────────────────────
 *
 * El defecto que cerro esta ficha no fue una columna mal pintada: fueron DOS proyecciones de la
 * misma fila de `orden`. `/ordenes` leia siete relaciones y declaraba 19 columnas; la bodega
 * satelite tenia un `select` propio de quince campos y declaraba 12. Las siete que faltaban
 * —mensajero, fecha de creacion, tiempo, flete, comision, fulfillment y «Liberada el»— no
 * faltaban por una decision: faltaban porque nadie las copio a la segunda lista, y **no
 * copiarlas no ponia rojo absolutamente nada**. Ni el typecheck, ni el lint, ni un test.
 *
 * Esa es la familia de fallo que este repo llama «el sistema no falla, aparenta», y volveria a
 * pasar el dia que alguien, por ahorrarse un JOIN o por acotar una lectura, le devuelva a la
 * bodega un `select` propio. Este guardia lo convierte en rojo.
 *
 * ─── COMO LO MIDE, Y POR QUE ASI ───────────────────────────────────────────────────────────
 *
 * No compara nombres de columna escritos a mano —eso seria una TERCERA lista, con el mismo
 * defecto—. Captura el argumento REAL que cada camino le pasa a `prisma.orden.findMany` y
 * compara la proyeccion de los dos: si son el mismo objeto de include, son iguales; si alguien
 * introduce un segundo `select`, dejan de serlo.
 *
 * Los TRES caminos de lectura del modulo satelite entran: el listado sin paginar (`listar()`),
 * la pagina y el conjunto de la descarga hidratan por el mismo sitio, asi que basta con
 * afirmarlo sobre la hidratacion y sobre el listado directo.
 *
 * ─── LA CONTRAPRUEBA (no-vacuidad) ─────────────────────────────────────────────────────────
 *
 * Un guardia que compara dos `undefined` esta verde por vacio. Por eso se afirma ADEMAS que la
 * proyeccion capturada es un `include` con relaciones DENTRO, y en particular con las dos que
 * la proyeccion vieja no traia (`mensajeroAsignado` y `gestiones`), que son las que alimentan
 * «Mensajero» y «Liberada el».
 */

/** Prisma doblado a lo justo: solo se captura con que se le llama. */
function prismaQueSoloCaptura() {
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    orden: { findMany, count: vi.fn().mockResolvedValue(0) },
    tarifa: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { prisma: prisma as unknown as PrismaClient, findMany };
}

/** La proyeccion de una llamada a `findMany`: lo que decide QUE columnas se leen. */
function proyeccionDe(argumento: Record<string, unknown>): {
  include?: unknown;
  select?: unknown;
} {
  return { include: argumento.include, select: argumento.select };
}

const PARAMS_ORDENES = {
  where: {},
  skip: 0,
  take: 25,
  sortBy: "created_at",
  sortDir: "desc",
} as const;

describe("FICHA 349 — la bodega satelite proyecta como `/ordenes`, no aparte", () => {
  it("el listado de la bodega pide a Prisma EXACTAMENTE la proyeccion del listado de ordenes", async () => {
    const central = prismaQueSoloCaptura();
    await new OrdenRepository(central.prisma).list({
      ...PARAMS_ORDENES,
      where: {},
    } as unknown as Parameters<OrdenRepository["list"]>[0]);

    const satelite = prismaQueSoloCaptura();
    await new OrdenRepository(satelite.prisma).findRecepcionSateliteByZona("z-1", [
      ...ESTADOS_BODEGA_SATELITE,
    ]);

    const deCentral = proyeccionDe(central.findMany.mock.calls[0]![0]);
    const deSatelite = proyeccionDe(satelite.findMany.mock.calls[0]![0]);

    // No-vacuidad: los dos caminos consultaron, y lo que consultaron es un `include` real.
    expect(central.findMany).toHaveBeenCalledTimes(1);
    expect(satelite.findMany).toHaveBeenCalledTimes(1);
    expect(deSatelite.select).toBeUndefined();
    expect(deSatelite.include).toEqual(expect.any(Object));

    expect(deSatelite).toEqual(deCentral);
  });

  it("la hidratacion de la PAGINA usa esa misma proyeccion (es por donde entran las tres consultas)", async () => {
    const central = prismaQueSoloCaptura();
    await new OrdenRepository(central.prisma).list({
      ...PARAMS_ORDENES,
      where: {},
    } as unknown as Parameters<OrdenRepository["list"]>[0]);

    // `findRecepcionSateliteCompleta` ordena con SQL crudo y luego HIDRATA con `findMany`. Se
    // dobla el `$queryRaw` para que devuelva un id y la hidratacion llegue a ocurrir.
    const satelite = prismaQueSoloCaptura();
    const conRaw = Object.assign(satelite.prisma as object, {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "o-1" }]),
    }) as unknown as PrismaClient;

    await new OrdenRepository(conRaw).findRecepcionSateliteCompleta({
      zonaId: "z-1",
      estatusValues: [...ESTADOS_BODEGA_SATELITE],
    });

    const deCentral = proyeccionDe(central.findMany.mock.calls[0]![0]);
    const deSatelite = proyeccionDe(satelite.findMany.mock.calls[0]![0]);

    expect(satelite.findMany).toHaveBeenCalledTimes(1);
    expect(deSatelite).toEqual(deCentral);
  });

  it("esa proyeccion trae las DOS relaciones que la vieja no traia (contraprueba de no-vacuidad)", async () => {
    const satelite = prismaQueSoloCaptura();
    await new OrdenRepository(satelite.prisma).findRecepcionSateliteByZona("z-1", [
      ...ESTADOS_BODEGA_SATELITE,
    ]);

    const include = satelite.findMany.mock.calls[0]![0].include as Record<string, unknown>;
    // «Mensajero»: el nombre resuelto, no el id.
    expect(include.mensajeroAsignado).toBeDefined();
    // «Liberada el»: la gestion de reprogramacion VIGENTE.
    expect(include.gestiones).toBeDefined();
    // Y las que ya traia, para que este caso no pueda pasar con un include de dos claves.
    for (const relacion of ["estatus", "tienda", "zona", "provincia", "canton", "distrito"]) {
      expect(include[relacion]).toBeDefined();
    }
  });
});

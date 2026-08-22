import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

import {
  FECHA_CR,
  crearOrden,
  crearTarifaActiva,
  instanteCR,
  sembrarBase,
  type BaseSembrada,
  type TxDeTest,
} from "./_semilla-tablero-dia";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./db/_postgres-real";

// FEATURE 260 (B4) — R11, R19. EL `WHERE` DE LA HIDRATACION, PROBADO DONDE VIVE.
//
// ⛔ POR QUE ESTE ARCHIVO NO ES OPCIONAL. `tests/unit/repositories/orden-repository-list-items-by-ids.test.ts`
// comprueba el OBJETO que se le pasa a Prisma; eso no demuestra que la base recorte nada. En
// este repo ya se midio cuatro veces: un test de servicio con dobles NO VE EL SQL y una
// mutacion del `WHERE` lo pasa en verde. Lo que aqui se prueba es un hecho del motor —una
// orden borrada y una de otra zona NO VUELVEN, aunque su id vaya en la lista—, y solo Postgres
// puede responderlo.
//
// Es la mitad de datos del aislamiento multi-tenant de esta feature: si este `WHERE` se
// aflojara, un satelite recibiria la orden de otra zona **por id**, sin pasar por la consulta
// del dia que lo recorta.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

interface Sembrado {
  readonly base: BaseSembrada;
  readonly viva: string;
  readonly borrada: string;
  readonly deOtraZona: string;
  readonly todos: readonly string[];
}

async function sembrar(tx: TxDeTest): Promise<Sembrado> {
  const base = await sembrarBase(tx);
  await crearTarifaActiva(tx, base);

  const comun = {
    estatus: "en_reparto",
    mensajeroId: base.mensajero1,
    asignadoAt: instanteCR(FECHA_CR, "07:00"),
  } as const;

  const viva = await crearOrden(tx, base, { ...comun, clave: "viva", zonaId: base.zonaA });
  const borrada = await crearOrden(tx, base, { ...comun, clave: "borrada", zonaId: base.zonaA });
  const deOtraZona = await crearOrden(tx, base, { ...comun, clave: "de-b", zonaId: base.zonaB });

  // El borrado de este repo es logico: la fila sigue ahi y su id sigue siendo un id valido.
  // Por eso `deletedAt: null` en el `where` no es decorativo.
  await tx.orden.update({
    where: { id: borrada },
    data: { deletedAt: instanteCR(FECHA_CR, "10:00") },
  });

  return { base, viva, borrada, deOtraZona, todos: [viva, borrada, deOtraZona] };
}

describeSiHayBase("OrdenRepository.findListItemsByIds — el WHERE contra Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("R19 — una orden BORRADA no vuelve, aunque su id vaya en la lista", async () => {
    const { ids, sembrado } = await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const items = await new OrdenRepository(tx as unknown as PrismaClient).findListItemsByIds(
        s.todos,
        { tipo: "global" },
      );
      return { ids: items.map((i) => i.id).sort(), sembrado: s };
    });

    expect(ids).not.toContain(sembrado.borrada);
    // Y NO es verde por vacio: las otras dos SI vuelven con la misma llamada.
    expect(ids).toEqual([sembrado.viva, sembrado.deOtraZona].sort());
  });

  it("R11 — con alcance ZONA, una orden de OTRA zona no vuelve, aunque su id vaya en la lista", async () => {
    const { ids, sembrado } = await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const items = await new OrdenRepository(tx as unknown as PrismaClient).findListItemsByIds(
        s.todos,
        { tipo: "zona", zonaId: s.base.zonaA },
      );
      return { ids: items.map((i) => i.id), sembrado: s };
    });

    expect(ids).toEqual([sembrado.viva]);
    expect(ids).not.toContain(sembrado.deOtraZona);
    expect(ids).not.toContain(sembrado.borrada);
  });

  it("el recorte mira la zona de la ORDEN, no la del mensajero", async () => {
    // Los dos mensajeros de la siembra pertenecen a la zona B y sus ordenes viven en la A. Si
    // el recorte mirase `usuario.zona_id`, el alcance de la zona A devolveria vacio.
    const ids = await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const items = await new OrdenRepository(tx as unknown as PrismaClient).findListItemsByIds(
        [s.viva],
        { tipo: "zona", zonaId: s.base.zonaA },
      );
      return items.map((i) => i.id);
    });

    expect(ids).toHaveLength(1);
  });

  it("R2 — lo que vuelve es el elemento del LISTADO: relaciones resueltas y dinero derivado", async () => {
    const item = await enTransaccionRevertida(prisma, async (tx) => {
      const s = await sembrar(tx);
      const items = await new OrdenRepository(tx as unknown as PrismaClient).findListItemsByIds(
        [s.viva],
        { tipo: "global" },
      );
      return items[0];
    });

    // Si esto fuera una proyeccion propia y no `WITH_ESTATUS_Y_TIENDA` + `toListItemDTO`, aqui
    // faltaria la mitad: son los campos que el listado de ordenes pinta en sus columnas.
    expect(item.destinatario).toBe("Cliente viva");
    expect(item.relaciones?.tienda?.nombre).toBe("Tienda");
    expect(item.relaciones?.zona?.nombre).toContain("zonaA");
    expect(item.relaciones?.estatus?.value).toBe("en_reparto");
    // Feature 204: los dos importes vienen DERIVADOS del servidor, como cadena escala 2.
    expect(item.fleteConIva).toMatch(/^\d+\.\d{2}$/);
    expect(item.comisionConIva).toMatch(/^\d+\.\d{2}$/);
  });

  it("R5 — con la lista vacia devuelve `[]`", async () => {
    const items = await enTransaccionRevertida(prisma, async (tx) => {
      await sembrar(tx);
      return new OrdenRepository(tx as unknown as PrismaClient).findListItemsByIds([], {
        tipo: "global",
      });
    });

    expect(items).toEqual([]);
  });
});

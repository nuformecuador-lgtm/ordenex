import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CorteDiarioRepository } from "@/lib/repositories/CorteDiarioRepository";

// Feature 41/C2 (R7/R10) + feature 109 (R4/R10/R29) — repo del corte diario.
// `findMensajerosConActividadSinCierre` devuelve la UNION de (a) mensajeros con gestiones sin
// cerrar (cierre_id IS NULL, anulada_at IS NULL) y (b) mensajeros con >=1 orden en `en_reparto`
// no borrada, menos los que ya tienen un cierre ABIERTO ('solicitado'|'vencido'|'rechazado').
// Mockea Prisma (sin DB real).

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    gestionOrden: { findMany: vi.fn().mockResolvedValue([]) },
    orden: { findMany: vi.fn().mockResolvedValue([]) },
    cierreDia: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

describe("CorteDiarioRepository.findMensajerosConActividadSinCierre (R7/R10)", () => {
  it("R7: filtra gestiones por cierreId null, distinct por mensajero, trae su zona", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: "z1" } },
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    const arg = prisma.gestionOrden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ cierreId: null });
    expect(arg.distinct).toEqual(["mensajeroId"]);
    expect(rows).toEqual([{ mensajeroId: "m1", zonaId: "z1" }]);
  });

  // Feature 109/R4: la seleccion suma a los mensajeros con ordenes en `en_reparto` (sin gestiones).
  it("R4: incluye mensajeros con >=1 orden en `en_reparto` no borrada (sin gestiones pendientes)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      { mensajeroAsignadoId: "m2", mensajeroAsignado: { zonaId: "z2" } },
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      deletedAt: null,
      // Feature 235 (R26): la rama (b) barre los DOS estados. UNION, no sustitucion.
      estatus: { value: { in: ["en_reparto", "ayuda_tienda"] } },
      mensajeroAsignadoId: { not: null },
    });
    expect(arg.distinct).toEqual(["mensajeroAsignadoId"]);
    expect(rows).toEqual([{ mensajeroId: "m2", zonaId: "z2" }]);
  });

  // Feature 109/R4: UNION sin duplicar — un mensajero con gestiones Y en_reparto aparece 1 vez.
  it("R4: UNION de gestiones + en_reparto, sin duplicar mensajeros", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: "z1" } },
    ]);
    prisma.orden.findMany.mockResolvedValue([
      { mensajeroAsignadoId: "m1", mensajeroAsignado: { zonaId: "z1" } }, // ya esta por gestiones
      { mensajeroAsignadoId: "m2", mensajeroAsignado: { zonaId: "z2" } }, // nuevo por en_reparto
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    expect(rows.map((r) => r.mensajeroId).sort()).toEqual(["m1", "m2"]);
    expect(rows.filter((r) => r.mensajeroId === "m1")).toHaveLength(1);
  });

  it("R10/R29: excluye al mensajero que ya tiene un cierre ABIERTO (solicitado/vencido/rechazado)", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: "z1" } },
      { mensajeroId: "m2", mensajero: { zonaId: "z2" } },
    ]);
    // m2 ya tiene un cierre abierto -> no se le crea otro.
    prisma.cierreDia.findMany.mockResolvedValue([{ mensajeroId: "m2" }]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    expect(rows).toEqual([{ mensajeroId: "m1", zonaId: "z1" }]);
    // R10/R29: la consulta de excluidos filtra por los 3 estados ABIERTOS sobre los ids candidatos.
    const cierreArg = prisma.cierreDia.findMany.mock.calls[0][0];
    expect(cierreArg.where.estado).toEqual({ in: ["solicitado", "vencido", "rechazado"] });
    expect(cierreArg.where.mensajeroId.in.sort()).toEqual(["m1", "m2"]);
  });

  // Feature 109/R29: `rechazado` es AHORA bloqueante -> un mensajero con `rechazado` no recibe un 2.º.
  it("R29: un mensajero con un cierre `rechazado` NO recibe un 2.º cierre del corte", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      { mensajeroAsignadoId: "m1", mensajeroAsignado: { zonaId: "z1" } },
    ]);
    // Simula el filtro por estado: m1 esta en `rechazado` -> devuelto por la query de excluidos.
    prisma.cierreDia.findMany.mockImplementation(
      async (args: { where: { estado: { in: string[] } } }) => {
        expect(args.where.estado.in).toContain("rechazado");
        return [{ mensajeroId: "m1" }];
      },
    );
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    expect(rows).toEqual([]);
  });

  it("sin actividad (ni gestiones ni en_reparto) -> lista vacia, sin consultar cierres", async () => {
    const prisma = buildPrisma();
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    expect(rows).toEqual([]);
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
  });

  // Feature 67/R17: una gestion ANULADA (deshecha) NO es "actividad del dia pendiente de cierre".
  it("67/R17: el WHERE de gestiones exige `anuladaAt: null` (las deshechas no son actividad pendiente)", async () => {
    const prisma = buildPrisma();
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    await repo.findMensajerosConActividadSinCierre();

    const arg = prisma.gestionOrden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ cierreId: null, anuladaAt: null });
  });

  it("propaga zonaId null (P2 lo maneja el service, no el repo)", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: null } },
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    expect(rows).toEqual([{ mensajeroId: "m1", zonaId: null }]);
  });
});

// =================================================================================================
// FEATURE 235 (R26) — LA SELECCION DEL CORTE TIENE QUE VER LA ORDEN EN AYUDA.
//
// ⚠️ ESTO ES UNA REGRESION QUE LA 235 INTRODUJO Y QUE LA SUITE NO VIO. Mientras la solicitud de
// ayuda fue un BOOLEANO, la orden seguia en `en_reparto` y esta rama la pescaba sola. Al moverla a
// un estatus propio, la rama se quedo mirando el estado viejo: un mensajero que recoge una guia,
// pide ayuda y se va a casa **no entraba en la lista que itera `ejecutarCorte`** —pedir ayuda NO
// crea `gestion_orden`, asi que la rama (a) tampoco lo pesca— y por tanto no se le creaba el cierre
// `vencido` ni se barria su orden NUNCA.
//
// El test que sonaba a que cubria esto (`235/R26: un mensajero cuyo dia entero acabo EN AYUDA...`,
// en `cierre-dia-repository.test.ts`) llama a `crearCierre` A MANO: afirma la propiedad un nivel por
// debajo de donde fallaba. Se conserva —mide la ESCRITURA, que tambien hay que medir— y aqui se
// añade la mitad que faltaba: la SELECCION.
// =================================================================================================
describe("235/R26 — la seleccion del corte alcanza `ayuda_tienda`", () => {
  it("incluye al mensajero cuyo dia entero acabo en `ayuda_tienda`, SIN gestiones pendientes", async () => {
    const prisma = buildPrisma();
    // Rama (a) vacia a proposito: pedir ayuda no crea `gestion_orden`, asi que este mensajero solo
    // puede entrar por la rama (b). Es EL caso de la regresion.
    prisma.gestionOrden.findMany.mockResolvedValue([]);
    prisma.orden.findMany.mockResolvedValue([
      { mensajeroAsignadoId: "m-ayuda", mensajeroAsignado: { zonaId: "z9" } },
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    expect(rows).toEqual([{ mensajeroId: "m-ayuda", zonaId: "z9" }]);
  });

  it("el predicado, aplicado a filas, pesca `en_reparto` Y `ayuda_tienda` y deja fuera el resto", async () => {
    // El `where` es lo unico que decide (este doble no ejecuta SQL), asi que se le da semantica.
    // Sin esto, el caso de arriba pasaria igual con un `where` que trajera CUALQUIER orden.
    const prisma = buildPrisma();
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    await repo.findMensajerosConActividadSinCierre();
    const { where } = prisma.orden.findMany.mock.calls[0][0] as {
      where: { deletedAt: null; estatus: { value: { in: string[] } }; mensajeroAsignadoId: unknown };
    };
    const casa = (estatus: string) => where.estatus.value.in.includes(estatus);

    // Los DOS que el corte barre.
    expect(casa("en_reparto")).toBe(true);
    expect(casa("ayuda_tienda")).toBe(true);
    // Y los que NO: `por_recoger` es la guarda de la 109/R5 (el mensajero ni siquiera la recogio),
    // y los desenlaces ya estan cerrados.
    for (const fuera of ["por_recoger", "entregada", "sin_gestionar", "recolectando", "devuelta"]) {
      expect(casa(fuera), `${fuera} NO debe barrerse`).toBe(false);
    }
    // Censo CERRADO: ni uno mas. Un tercer estado aqui barreria trabajo que no toca.
    expect([...where.estatus.value.in].sort()).toEqual(["ayuda_tienda", "en_reparto"]);
  });

  it("UNION sin duplicar: el mensajero con gestiones Y una orden en ayuda aparece UNA vez", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      { mensajeroId: "m1", mensajero: { zonaId: "z1" } },
    ]);
    prisma.orden.findMany.mockResolvedValue([
      { mensajeroAsignadoId: "m1", mensajeroAsignado: { zonaId: "z1" } },
    ]);
    const repo = new CorteDiarioRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findMensajerosConActividadSinCierre();

    expect(rows).toEqual([{ mensajeroId: "m1", zonaId: "z1" }]);
  });
});

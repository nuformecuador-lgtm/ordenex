import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { RecuperacionBodegaRepository } from "@/lib/repositories/RecuperacionBodegaRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 140: la guardia del choke point es de FALLO CERRADO. Los ids de estatus son los del
// catalogo (`idEstado`) y el catalogo se siembra antes de cada test, asi el append valida de
// verdad el par `origen -> destino` contra `TRANSICIONES` en vez de saltarselo.

// Feature 100 (T2.2) — repo de la RECUPERACION a bodega (molde de
// DevolucionSlaRepository.liberarDevueltaSla). Mockea Prisma (sin DB real; mocks bare +
// mockResolvedValue). El fake pasa el propio prisma como `tx` (tiene orden.updateMany + el choke
// point ordenHistorialEstado.createMany). Cubre R13 (destino por zona ya resuelto por el service),
// R14 (limpia mensajero + asignado_at), R17 (append actor=admin, origen_tipo=recuperacion_manual),
// R20 (append falla -> revierte), R21 (UPDATE guardado por estatus=devuelta; count 0 -> false).
// Feature 110 (R2/R4/R6): la recuperacion MANUAL SI enciende prioridad=true DENTRO del mismo
// updateMany.data guardado (invierte la decision de la 101/R3); count 0 -> no toca prioridad (R3).

function buildPrisma() {
  const prisma = {
    orden: { updateMany: vi.fn() },
    ordenHistorialEstado: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.orden.updateMany.mockResolvedValue({ count: 1 });
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

function repoWith(prisma: ReturnType<typeof buildPrisma>) {
  return new RecuperacionBodegaRepository(prisma as unknown as PrismaClient);
}

beforeEach(async () => {
  await sembrarCatalogoEstados();
});

describe("recuperarABodega (R13/R14/R17/R21)", () => {
  it("R13/R14/R17: UPDATE guardado por estatus=devuelta -> destino, limpia mensajero + asignado_at, append actor=admin", async () => {
    const prisma = buildPrisma();

    const ok = await repoWith(prisma).recuperarABodega({
      ordenId: "o1",
      destinoEstatusId: idEstado("en_bodega_satelite"),
      estatusDevueltaId: idEstado("devuelta"),
      actorUsuarioId: "admin-1",
    });

    expect(ok).toBe(true);
    const upd = prisma.orden.updateMany.mock.calls[0][0];
    // R21: guarda por estado + no borrada.
    expect(upd.where).toEqual({ id: "o1", estatusId: idEstado("devuelta"), deletedAt: null });
    // R13/R14: destino de bodega + handoff limpio (mensajero + asignado_at a null).
    // Feature 110/R2/R4/R6: prioridad=true va DENTRO del mismo data (una sola escritura).
    // Feature 246 (T3.5, R9/R10): `fechaReparto: null` entra en la MISMA igualdad EXACTA, y por
    // el mismo motivo que el resto: la invariante es que el dia de reparto solo tiene valor
    // mientras la orden tenga mensajero. Una reserva sin duenno seria un dato que el corte
    // tendria que interpretar — la clase de dato que la 235 pago con una fuga permanente.
    expect(upd.data).toEqual({
      estatusId: idEstado("en_bodega_satelite"),
      mensajeroAsignadoId: null,
      asignadoAt: null,
      fechaReparto: null, // feature 246/R9/R10
      prioridad: true,
    });
    // R17: append por el choke point, actor = el admin (NO NULL), origen_tipo recuperacion_manual.
    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const hist = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(hist.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("devuelta"),
        estatusDestinoId: idEstado("en_bodega_satelite"),
        actorUsuarioId: "admin-1", // R17: trazabilidad del actor (no del cron)
        origenTipo: "recuperacion_manual", // R17
        motivo: null, // el choke point normaliza a null (no hay motivo en una recuperacion)
        gestionOrdenId: null, // R14: no enlaza gestion (handoff limpio, molde de liberarDevueltaSla)
      },
    ]);
  });

  it("R13: el destino de bodega CENTRAL (resuelto por el service) se aplica tal cual", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).recuperarABodega({
      ordenId: "o1",
      destinoEstatusId: idEstado("en_bodega_central"), // central
      estatusDevueltaId: idEstado("devuelta"),
      actorUsuarioId: "maestro-1",
    });
    expect(prisma.orden.updateMany.mock.calls[0][0].data.estatusId).toBe(idEstado("en_bodega_central"));
    expect(prisma.ordenHistorialEstado.createMany.mock.calls[0][0].data[0].estatusDestinoId).toBe(
      idEstado("en_bodega_central"),
    );
  });

  it("feature 110/R2/R4: la recuperacion MANUAL SI enciende `orden.prioridad = true` DENTRO del unico updateMany.data (una sola escritura, sin segunda transicion)", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).recuperarABodega({
      ordenId: "o1",
      destinoEstatusId: idEstado("en_bodega_central"),
      estatusDevueltaId: idEstado("devuelta"),
      actorUsuarioId: "maestro-1",
    });
    // R4: una sola llamada a orden.updateMany (no hay segunda escritura para encender prioridad).
    expect(prisma.orden.updateMany).toHaveBeenCalledTimes(1);
    const data = prisma.orden.updateMany.mock.calls[0][0].data;
    // R2: prioridad encendida en el mismo data del updateMany guardado.
    expect(data.prioridad).toBe(true);
    // Feature 246 (T3.5, R9/R10): el censo CERRADO de claves gana `fechaReparto`. Que sea cerrado
    // es lo que hace que un olvido en cualquiera de los seis sitios de limpieza se vea.
    expect(Object.keys(data).sort()).toEqual([
      "asignadoAt",
      "estatusId",
      "fechaReparto",
      "mensajeroAsignadoId",
      "prioridad",
    ]);
  });

  it("R21: 2.ª corrida / carrera con el cron 99 -> count 0 -> false, sin append", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 0 });

    const ok = await repoWith(prisma).recuperarABodega({
      ordenId: "o1",
      destinoEstatusId: idEstado("en_bodega_central"),
      estatusDevueltaId: idEstado("devuelta"),
      actorUsuarioId: "admin-1",
    });

    expect(ok).toBe(false);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("R20: si el append al historial falla, la tx revierte (propaga el error -> rollback)", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.createMany.mockRejectedValue(new Error("historial down"));

    await expect(
      repoWith(prisma).recuperarABodega({
        ordenId: "o1",
        destinoEstatusId: idEstado("en_bodega_central"),
        estatusDevueltaId: idEstado("devuelta"),
        actorUsuarioId: "admin-1",
      }),
    ).rejects.toThrow("historial down");
  });
});

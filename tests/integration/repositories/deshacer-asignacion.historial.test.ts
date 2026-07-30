import { describe, it, expect, vi, beforeEach } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
import { TransicionIlegalError } from "@/lib/types/order-status-transiciones";
import {
  filasCatalogoEstados,
  idEstado,
  sembrarCatalogoEstados,
} from "@/tests/fixtures/catalogo-estados";

// Feature 149 — T5.1 (R23/R31/R32/R33) y T5.2 (R27): integracion del writer con el CHOKE POINT
// real (`appendCambioEstado`): guardia de la 140 SIN mockear, append del historial y emision
// transactional-outbox del webhook, todo en la MISMA transaccion.
//
// Prisma/tx mockeados con SEMANTICA (patron `tests/integration/repositories`): el `$queryRaw`
// interpreta cada consulta por su SQL —pre-read, UPDATE de dominio, resolucion de owners
// suscritos (§5 de la 99), catalogo de estados y el INSERT de `jobs`— y devuelve lo que
// devolveria Postgres. Asi el test recorre UPDATE -> guardia -> historial -> webhook completo.

const HIST = {
  actorUsuarioId: "u-maestro",
  origenTipo: "deshacer_asignacion",
  motivo: "el mensajero no paso por la bodega: la orden vuelve al inventario",
} as const;

interface Opts {
  /** Ordenes cuyo owner tiene suscripcion activa y rol apiKey (§5 de la 99). */
  elegibles?: Set<string>;
  /** Ordenes que PIERDEN la guarda del UPDATE (carrera). */
  perdedoras?: Set<string>;
  /** Fuerza el fallo del append (simula la reversion de la tx). */
  fallaHistorial?: boolean;
}

function buildPrisma(opts: Opts = {}) {
  const elegibles = opts.elegibles ?? new Set<string>();
  const perdedoras = opts.perdedoras ?? new Set<string>();
  const jobs: { tipo: string; payload: string }[] = [];
  const createMany = vi.fn(async (_args: { data: Record<string, unknown>[] }) => {
    if (opts.fallaHistorial) throw new Error("tx abortada");
    return { count: 1 };
  });
  const $queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = (strings as unknown as string[]).join(" ");
    const args = values.flatMap((v) => {
      const inner = (v as { values?: unknown[] } | null)?.values;
      return Array.isArray(inner) ? inner : [v];
    });
    if (sql.includes('INSERT INTO "jobs"')) {
      jobs.push({ tipo: args[1] as string, payload: args[2] as string });
      return []; // ON CONFLICT DO NOTHING: el DTO no se usa aqui
    }
    if (sql.includes("UPDATE")) {
      const ordenId = values[1] as string;
      return perdedoras.has(ordenId) ? [] : [{ id: ordenId }];
    }
    if (sql.includes("webhook_suscripcion")) {
      return args.filter((id) => elegibles.has(id as string)).map((id) => ({ orden_id: id }));
    }
    if (sql.includes("order_status")) {
      const pedidos = new Set(args.map(String));
      return filasCatalogoEstados().filter((f) => pedidos.size === 0 || pedidos.has(f.id));
    }
    // Pre-read del lote: la orden tenia mensajero asignado (caso a).
    return [{ id: "o1", mensajero_asignado_id: "m-1" }];
  });
  const tx = { $queryRaw, $executeRaw: vi.fn(), ordenHistorialEstado: { createMany } };
  const prisma = { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)) };
  return { prisma, tx, createMany, jobs };
}

beforeEach(async () => {
  await sembrarCatalogoEstados();
});

describe("R23/R31 — EXACTAMENTE una fila de historial por orden, con motivo", () => {
  it("origen real, destino, actor, origen_tipo `deshacer_asignacion` y motivo", async () => {
    const { prisma, createMany } = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.deshacerAsignacionLote(
      [{ ordenId: "o1", destinoEstatusId: idEstado("en_bodega_central") }],
      new Map([["o1", idEstado("por_recoger")]]),
      HIST,
      null,
    );

    expect(createMany).toHaveBeenCalledTimes(1); // UNA invocacion, UNA fila por orden
    const data = createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0]).toEqual({
      ordenId: "o1",
      estatusOrigenId: idEstado("por_recoger"),
      estatusDestinoId: idEstado("en_bodega_central"),
      actorUsuarioId: "u-maestro",
      origenTipo: "deshacer_asignacion",
      motivo: HIST.motivo, // R23: legible en la linea de tiempo
      gestionOrdenId: null,
    });
  });
});

describe("R32 — el webhook de estado se encola en la MISMA transaccion", () => {
  it("una orden con owner suscrito (apiKey) deja el job `webhook_estado` pendiente", async () => {
    const { prisma, jobs } = buildPrisma({ elegibles: new Set(["o1"]) });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.deshacerAsignacionLote(
      [{ ordenId: "o1", destinoEstatusId: idEstado("en_bodega_central") }],
      new Map([["o1", idEstado("por_recoger")]]),
      HIST,
      null,
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0].tipo).toBe("webhook_estado");
    expect(JSON.parse(jobs[0].payload)).toMatchObject({ ordenId: "o1" });
  });

  it("R33: si el append revierte la tx, no queda ni fila de historial ni job", async () => {
    const { prisma, jobs } = buildPrisma({ elegibles: new Set(["o1"]), fallaHistorial: true });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(
      repo.deshacerAsignacionLote(
        [{ ordenId: "o1", destinoEstatusId: idEstado("en_bodega_central") }],
        new Map([["o1", idEstado("por_recoger")]]),
        HIST,
        null,
      ),
    ).rejects.toThrow("tx abortada");
    expect(jobs).toHaveLength(0); // el emisor corre DESPUES del append: nunca llego
  });

  it("R33: una orden que pierde la carrera no deja historial ni job (lote revertido)", async () => {
    const { prisma, createMany, jobs } = buildPrisma({
      elegibles: new Set(["o1", "o2"]),
      perdedoras: new Set(["o2"]),
    });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await expect(
      repo.deshacerAsignacionLote(
        [
          { ordenId: "o1", destinoEstatusId: idEstado("en_bodega_central") },
          { ordenId: "o2", destinoEstatusId: idEstado("en_bodega_central") },
        ],
        new Map([
          ["o1", idEstado("por_recoger")],
          ["o2", idEstado("por_recoger")],
        ]),
        HIST,
        null,
      ),
    ).rejects.toThrow();
    expect(createMany).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });
});

describe("T5.2/R27 — la guardia REAL de la 140 acepta las TRES aristas nuevas", () => {
  it.each([
    ["#43", "por_recoger", "en_bodega_central"],
    ["#44", "por_recoger", "en_bodega_satelite"],
    ["#45", "en_ruta_bodega_satelite", "en_bodega_central"],
  ] as const)(
    "%s %s -> %s pasa por appendCambioEstado sin TransicionIlegalError",
    async (_n, origen, destino) => {
      const { tx, createMany } = buildPrisma();
      await expect(
        appendCambioEstado(tx as never, [
          {
            ordenId: "o1",
            estatusOrigenId: idEstado(origen),
            estatusDestinoId: idEstado(destino),
            actorUsuarioId: "u-maestro",
            origenTipo: "deshacer_asignacion",
            motivo: HIST.motivo,
          },
        ]),
      ).resolves.toBeUndefined();
      expect(createMany).toHaveBeenCalledTimes(1);
    },
  );

  it("R28: un destino NO declarado (por_recoger -> en_preparacion) sigue siendo ilegal", async () => {
    const { tx, createMany } = buildPrisma();
    await expect(
      appendCambioEstado(tx as never, [
        {
          ordenId: "o1",
          estatusOrigenId: idEstado("por_recoger"),
          estatusDestinoId: idEstado("en_preparacion"),
          actorUsuarioId: "u-maestro",
          origenTipo: "deshacer_asignacion",
        },
      ]),
    ).rejects.toThrow(TransicionIlegalError);
    expect(createMany).not.toHaveBeenCalled();
  });
});

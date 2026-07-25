import { describe, it, expect, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { RecuperacionBodegaRepository } from "@/lib/repositories/RecuperacionBodegaRepository";
import { DevolucionSlaRepository } from "@/lib/repositories/DevolucionSlaRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 100 (T5.2) — INTEGRACION de la recuperacion a bodega con el cron SLA vecino, con los repos
// REALES (`RecuperacionBodegaRepository.recuperarABodega` de la 100 y
// `DevolucionSlaRepository.findDevueltasSla` de la 99). Propiedad probada (R18): tras recuperar, la
// orden sale de `devuelta` a `en_bodega_central`/`en_bodega_satelite` y SIN mensajero -> el cron SLA 99 la
// SALTA (su query filtra `estatus = devuelta`) y queda ASIGNABLE por la bodega (handoff limpio:
// mensajero_asignado_id + asignado_at a null). Patron `cierre-detail-congelado.test.ts`: no hay
// Postgres en la suite; se usa una "base" en memoria con la semantica de las queries Prisma.

const ESTATUS: Record<string, string> = {
  devuelta: idEstado("devuelta"),
  en_bodega_central: idEstado("en_bodega_central"),
  en_bodega_satelite: idEstado("en_bodega_satelite"),
};
const valueByEstatusId = (id: string): string =>
  Object.keys(ESTATUS).find((v) => ESTATUS[v] === id) ?? "desconocido";

interface OrdenRow {
  id: string;
  estatusId: string;
  deletedAt: Date | null;
  zonaId: string;
  mensajeroAsignadoId: string | null;
  asignadoAt: Date | null;
  prioridad: boolean; // feature 101/110: flag de reasignacion prioritaria
}
interface GestionRow {
  id: string;
  ordenId: string;
  mensajeroId: string;
  resultado: string;
  anuladaAt: Date | null;
  createdAt: Date;
  causaDevolucion: string | null;
}

function pick<T extends Record<string, unknown>>(row: T, select: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(select)) {
    if (select[k] === true) out[k] = row[k];
  }
  return out;
}

function makeDb(zonaId: string) {
  const ordenes: OrdenRow[] = [
    {
      id: "o1",
      estatusId: ESTATUS.devuelta, // reposa en `devuelta` (feature 99), con mensajero asignado
      deletedAt: null,
      zonaId,
      mensajeroAsignadoId: "m1",
      asignadoAt: new Date("2026-07-20T10:00:00.000Z"),
      prioridad: false, // parte no prioritaria; la recuperacion manual la enciende (feature 110/R2)
    },
  ];
  const gestiones: GestionRow[] = [
    {
      id: "g-devuelta",
      ordenId: "o1",
      mensajeroId: "m1",
      resultado: "devuelta",
      anuladaAt: null,
      createdAt: new Date("2026-07-20T18:00:00.000Z"),
      causaDevolucion: "cliente_ausente",
    },
  ];
  const historial: Array<Record<string, unknown>> = [];
  let seq = 0;

  function resolveGestiones(ordenId: string, sub: Record<string, unknown>) {
    const where = (sub.where ?? {}) as { resultado?: string; anuladaAt?: null };
    let cands = gestiones.filter(
      (g) =>
        g.ordenId === ordenId &&
        (where.resultado === undefined || g.resultado === where.resultado) &&
        (where.anuladaAt === null ? g.anuladaAt === null : true),
    );
    const orderBy = sub.orderBy as { createdAt?: "asc" | "desc" } | undefined;
    if (orderBy?.createdAt === "desc") {
      cands = [...cands].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    const take = sub.take as number | undefined;
    if (take !== undefined) cands = cands.slice(0, take);
    const sel = sub.select as Record<string, unknown> | undefined;
    return cands.map((g) => (sel ? pick(g as unknown as Record<string, unknown>, sel) : g));
  }

  const client = {
    orden: {
      findMany: async ({
        where,
        select,
      }: {
        where: { deletedAt?: null; estatus?: { value?: string } };
        select: Record<string, unknown>;
      }) => {
        return ordenes
          .filter((o) => {
            if (where.deletedAt === null && o.deletedAt !== null) return false;
            if (where.estatus?.value !== undefined) {
              return valueByEstatusId(o.estatusId) === where.estatus.value;
            }
            return true;
          })
          .map((o) => {
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(select)) {
              if (k === "gestiones") {
                out.gestiones = resolveGestiones(o.id, select.gestiones as Record<string, unknown>);
              } else if (select[k] === true) {
                out[k] = (o as unknown as Record<string, unknown>)[k];
              }
            }
            return out;
          });
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; estatusId?: string; deletedAt?: null };
        data: Partial<OrdenRow>;
      }) => {
        let count = 0;
        for (const o of ordenes) {
          if (o.id !== where.id) continue;
          if (where.estatusId !== undefined && o.estatusId !== where.estatusId) continue;
          if (where.deletedAt === null && o.deletedAt !== null) continue;
          Object.assign(o, data);
          count += 1;
        }
        return { count };
      },
    },
    ordenHistorialEstado: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        for (const d of data) historial.push({ id: `h${++seq}`, ...d });
        return { count: data.length };
      },
    },
  };

  const prisma = {
    ...client,
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  };

  return { prisma, ordenes, gestiones, historial };
}

type Db = ReturnType<typeof makeDb>;

function recuperar(db: Db, destinoValue: "en_bodega_central" | "en_bodega_satelite") {
  const repo = new RecuperacionBodegaRepository(db.prisma as unknown as PrismaClient);
  return repo.recuperarABodega({
    ordenId: "o1",
    destinoEstatusId: ESTATUS[destinoValue],
    estatusDevueltaId: ESTATUS.devuelta,
    actorUsuarioId: "admin-1",
  });
}

const slaRepo = (db: Db) => new DevolucionSlaRepository(db.prisma as unknown as PrismaClient);

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO (catalogo real + pares legales)
});

describe("Feature 100 T5.2 — recuperar (satelite) saca la orden de `devuelta`: el cron SLA 99 la salta + queda asignable (R18)", () => {
  it("ANTES de recuperar, el cron SLA 99 SI ve la orden `devuelta`", async () => {
    const db = makeDb("z-satelite");
    const devueltas = await slaRepo(db).findDevueltasSla();
    expect(devueltas.map((d) => d.ordenId)).toEqual(["o1"]);
  });

  it("DESPUES de recuperar a bodega satelite: en_bodega_satelite, SIN mensajero, el cron SLA 99 la salta", async () => {
    const db = makeDb("z-satelite");
    const ok = await recuperar(db, "en_bodega_satelite");
    expect(ok).toBe(true);

    const orden = db.ordenes[0];
    expect(orden.estatusId).toBe(ESTATUS.en_bodega_satelite);
    // R14/R18: handoff limpio -> asignable de nuevo por la bodega (nuevo intento).
    expect(orden.mensajeroAsignadoId).toBeNull();
    expect(orden.asignadoAt).toBeNull();
    // Feature 110/R2: la recuperacion manual dejo la orden PRIORITARIA para la reasignacion.
    expect(orden.prioridad).toBe(true);
    // El cron SLA 99 filtra `estatus = devuelta`: ya no la incluye (la salta).
    expect(await slaRepo(db).findDevueltasSla()).toEqual([]);
  });
});

describe("Feature 100 T5.2 — recuperar (central) rutea a en_bodega_central y tambien sale del radar del cron SLA (R13/R18)", () => {
  it("DESPUES de recuperar a bodega central: en_bodega_central, SIN mensajero, el cron SLA 99 la salta", async () => {
    const db = makeDb("z-central");
    const ok = await recuperar(db, "en_bodega_central");
    expect(ok).toBe(true);

    const orden = db.ordenes[0];
    expect(orden.estatusId).toBe(ESTATUS.en_bodega_central);
    expect(orden.mensajeroAsignadoId).toBeNull();
    expect(orden.asignadoAt).toBeNull();
    // Feature 110/R2: recuperada a bodega central -> tambien prioritaria.
    expect(orden.prioridad).toBe(true);
    expect(await slaRepo(db).findDevueltasSla()).toEqual([]);
  });

  it("R21: una 2.a recuperacion (o carrera con el cron 99) es no-op -> false, sin re-salir de un estado ajeno", async () => {
    const db = makeDb("z-central");
    expect(await recuperar(db, "en_bodega_central")).toBe(true);
    // La orden ya no esta en `devuelta`: el UPDATE guardado no afecta filas -> false (idempotente).
    expect(await recuperar(db, "en_bodega_central")).toBe(false);
    expect(db.ordenes[0].estatusId).toBe(ESTATUS.en_bodega_central);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { DevolucionSlaRepository } from "@/lib/repositories/DevolucionSlaRepository";
import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 100 (T5.1) — INTEGRACION de la reprogramacion de la tienda con los dos crons vecinos, con
// los repos REALES (`GestionOrdenRepository.reprogramarDesdeDevuelta` de la 100,
// `DevolucionSlaRepository.findDevueltasSla` de la 99 y
// `LiberacionReprogramadaRepository.findOrdenesLiberables` de la 46). Propiedad probada (R9): tras
// reprogramar, la orden sale de `devuelta` -> el cron SLA 99 la SALTA (su query filtra
// `estatus = devuelta`); queda en `reprogramada` con `fecha_reprogramacion` futura -> el cron 46 la
// mantiene BLOQUEADA hasta la fecha y la LIBERA al llegar. Patron `cierre-detail-congelado.test.ts`:
// no hay Postgres en la suite; se usa una "base" en memoria con la semantica de las queries Prisma
// (estatus por relacion, gestiones anidadas con where/orderBy/take). Money-safe: no aplica (sin $).

// El jobRepo del constructor no se usa en reprogramarDesdeDevuelta (no reoptimiza ruta).
const noopJobRepo = {} as unknown as ConstructorParameters<typeof GestionOrdenRepository>[1];

// --- Catalogo de estados (value <-> id), como el seed de order_status ---
// ---------------------------------------------------------------------------------------------
// INVERTIDO el 2026-08-19 por la feature 239 (T3.3/T4.1). Este emulador sembraba la orden EN
// `devuelta` sin mas, porque hasta hoy eso era lo que dejaba una gestion del mensajero. Ya no: la
// gestion deja la orden en `devolucion_por_confirmar`, y a `devuelta` se llega SOLO por el
// ANCLAJE, la transicion que escribe la aprobacion del cierre con `origen_tipo =
// anclaje_devolucion`.
//
// La semilla lo refleja: la orden esta en `devuelta` Y tiene su fila de anclaje en el historial,
// que es el unico estado de la base que hoy puede producir ese `devuelta`. Sin esa fila, el cron
// la leeria por la RAMA LEGADA (R14) y este archivo estaria midiendo un camino que la feature
// declara en extincion, no el vigente.
//
// El cron ademas PROYECTA esa fila (`select.historialEstados`), asi que el emulador tiene que
// resolverla: un doble que devolviera `undefined` reventaria, y uno que devolviera `[]` en
// silencio dejaria pasar una version del repositorio que no la pide.
// ---------------------------------------------------------------------------------------------

const ESTATUS: Record<string, string> = {
  devuelta: idEstado("devuelta"),
  reprogramada: idEstado("reprogramada"),
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
  prioridad: boolean; // feature 110/R1: la liberacion de la reprogramada la enciende
}
interface GestionRow {
  id: string;
  ordenId: string;
  mensajeroId: string;
  resultado: string;
  anuladaAt: Date | null;
  createdAt: Date;
  fechaReprogramacion: Date | null;
  causaDevolucion: string | null;
  motivo: string | null;
  cierreId: string | null;
}

// Selecciona los campos scalar pedidos por un `select` de Prisma (key: true).
function pick<T extends Record<string, unknown>>(row: T, select: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(select)) {
    if (select[k] === true) out[k] = row[k];
  }
  return out;
}

function makeDb() {
  const ordenes: OrdenRow[] = [
    {
      id: "o1",
      estatusId: ESTATUS.devuelta, // reposa en `devuelta` (feature 99)
      deletedAt: null,
      zonaId: "z1",
      mensajeroAsignadoId: "m1",
      asignadoAt: new Date("2026-07-20T10:00:00.000Z"),
      prioridad: false, // parte no prioritaria; la liberacion del cron 46 la enciende (feature 110/R1)
    },
  ];
  // FEATURE 273: los cierres del emulador. Vacio a proposito: la gestion sintetica de la 100 nace
  // con `cierre_id NULL`, que es la forma que este archivo mide.
  const cierres: { id: string; estado: string }[] = [];
  const gestiones: GestionRow[] = [
    {
      id: "g-devuelta",
      ordenId: "o1",
      mensajeroId: "m1",
      resultado: "devuelta", // la gestion que ancla la ventana SLA (99) y el mensajero (R5)
      anuladaAt: null,
      createdAt: new Date("2026-07-20T18:00:00.000Z"),
      fechaReprogramacion: null,
      causaDevolucion: "cliente_ausente",
      motivo: "ausente",
      cierreId: null,
    },
  ];
  // Feature 239 (T4.1): el historial arranca CON la fila del ANCLAJE. Es lo que hace que la
  // orden este legitimamente en `devuelta`: la aprobacion del cierre la puso ahi, y ese instante
  // es el ancla de su ventana de SLA (R12).
  const historial: Array<Record<string, unknown>> = [
    {
      id: "h-anclaje",
      ordenId: "o1",
      origenTipo: "anclaje_devolucion",
      createdAt: new Date("2026-07-21T02:00:00.000Z"), // el cierre se aprobo 8 h despues
    },
  ];
  let seq = 0;

  // Resuelve la sub-relacion `gestiones` de una orden segun el `select.gestiones`
  // (where resultado+anuladaAt, orderBy createdAt desc, take N, select scalar).
  /**
   * Feature 239 (T3.3): resuelve `select.historialEstados` con la semantica REAL de la consulta
   * del cron — filtro por `origenTipo`, `orderBy createdAt desc` y `take`. Honrar el `where` y el
   * orden no es celo: si devolviera siempre la misma fila, una version del repositorio que NO
   * filtrara por familia (o que no ordenara) pasaria en verde, y esa version ancla el reloj en la
   * transicion equivocada.
   */
  function resolveHistorial(ordenId: string, sub: Record<string, unknown>) {
    const where = (sub.where ?? {}) as { origenTipo?: string };
    let cands = historial.filter(
      (h) =>
        h.ordenId === ordenId &&
        (where.origenTipo === undefined || h.origenTipo === where.origenTipo),
    );
    const orderBy = sub.orderBy as { createdAt?: "asc" | "desc" } | undefined;
    if (orderBy?.createdAt === "desc") {
      cands = [...cands].sort(
        (a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
      );
    }
    const take = sub.take as number | undefined;
    if (take !== undefined) cands = cands.slice(0, take);
    const sel = sub.select as Record<string, unknown> | undefined;
    return cands.map((h) => (sel ? pick(h, sel) : h));
  }

  /**
   * FEATURE 273 (T6.1) — el emulador tiene que resolver la SONDA DE VISITA REAL y el `cierre` de la
   * gestion, porque el cron 46 ahora los proyecta. Un emulador que los ignorase devolveria
   * `undefined` para los dos, el repositorio los traduciria a `null`/`false` y este archivo pasaria
   * en verde afirmando «se libera» POR OMISION — cuando lo que tiene que demostrar es que se libera
   * porque la gestion de la 100 es SINTETICA (`reprogramacion_tienda` NO esta en
   * `ORIGEN_TIPOS_VISITA_REAL`) y por tanto no puede subir ningun contador.
   */
  function resolveSondaVisitaReal(gestionId: string, sub: Record<string, unknown>) {
    const where = (sub.where ?? {}) as { origenTipo?: { in?: string[] } };
    const familias = where.origenTipo?.in;
    let cands = historial.filter(
      (h) =>
        h.gestionOrdenId === gestionId &&
        (familias === undefined || familias.includes(h.origenTipo as string)),
    );
    const take = sub.take as number | undefined;
    if (take !== undefined) cands = cands.slice(0, take);
    const sel = sub.select as Record<string, unknown> | undefined;
    return cands.map((h) => (sel ? pick(h, sel) : h));
  }

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
    if (!sel) return cands;
    return cands.map((g) => {
      const fila = g as unknown as Record<string, unknown>;
      const out = pick(fila, sel);
      // FEATURE 273: las dos proyecciones de RELACION del `select` de la gestion.
      if (sel.cierre !== undefined) {
        const cierre = cierres.find((c) => c.id === g.cierreId);
        out.cierre = cierre ? { estado: cierre.estado } : null;
      }
      if (sel.historialEstados !== undefined) {
        out.historialEstados = resolveSondaVisitaReal(
          g.id,
          sel.historialEstados as Record<string, unknown>,
        );
      }
      return out;
    });
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
              } else if (k === "historialEstados") {
                // Feature 239 (T3.3): la proyeccion del ANCLA.
                out.historialEstados = resolveHistorial(
                  o.id,
                  select.historialEstados as Record<string, unknown>,
                );
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
    gestionOrden: {
      findFirst: async ({
        where,
        select,
      }: {
        where: { ordenId: string; resultado: string; anuladaAt: null };
        select?: Record<string, unknown>;
      }) => {
        const cands = gestiones
          .filter(
            (g) =>
              g.ordenId === where.ordenId &&
              g.resultado === where.resultado &&
              (where.anuladaAt === null ? g.anuladaAt === null : true),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const first = cands[0];
        if (!first) return null;
        return select ? pick(first as unknown as Record<string, unknown>, select) : first;
      },
      create: async ({
        data,
        select,
      }: {
        data: Partial<GestionRow>;
        select?: Record<string, unknown>;
      }) => {
        const row: GestionRow = {
          id: `g-new-${++seq}`,
          ordenId: data.ordenId!,
          mensajeroId: data.mensajeroId!,
          resultado: data.resultado!,
          anuladaAt: null,
          createdAt: new Date("2026-07-21T12:00:00.000Z"),
          fechaReprogramacion: data.fechaReprogramacion ?? null,
          causaDevolucion: data.causaDevolucion ?? null,
          motivo: data.motivo ?? null,
          cierreId: data.cierreId ?? null,
        };
        gestiones.push(row);
        return select ? pick(row as unknown as Record<string, unknown>, select) : row;
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

function reprogramar(db: Db, fecha: string) {
  const repo = new GestionOrdenRepository(db.prisma as unknown as PrismaClient, noopJobRepo);
  return repo.reprogramarDesdeDevuelta({
    ordenId: "o1",
    estatusDevueltaId: ESTATUS.devuelta,
    estatusReprogramadaId: ESTATUS.reprogramada,
    fechaReprogramacion: fecha,
    motivo: "cliente pidio otra fecha",
    actorUsuarioId: "tienda-1",
  });
}

const slaRepo = (db: Db) => new DevolucionSlaRepository(db.prisma as unknown as PrismaClient);
const cron46Repo = (db: Db) =>
  new LiberacionReprogramadaRepository(db.prisma as unknown as PrismaClient);

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO (catalogo real + pares legales)
});

describe("Feature 100 T5.1 — reprogramar saca la orden de `devuelta`: el cron SLA 99 la salta (R9)", () => {
  it("ANTES de reprogramar, el cron SLA 99 SI ve la orden `devuelta`", async () => {
    const db = makeDb();
    const devueltas = await slaRepo(db).findDevueltasSla();
    expect(devueltas.map((d) => d.ordenId)).toEqual(["o1"]);
  });

  // Feature 239 (T3.3/T4.1) — LA SEMILLA ES LOAD-BEARING, no decorado. Ver el gemelo de
  // `resolver-novedad-recupera-sla.test.ts`: sin esta asercion, la fila de anclaje que la semilla
  // anade podria dejar de leerse y nadie se enteraria.
  it("239/R12: el cron ancla en la APROBACION del cierre, no en la gestion del mensajero", async () => {
    const db = makeDb();
    const [devuelta] = await slaRepo(db).findDevueltasSla();
    expect(devuelta.origenAncla).toBe("aprobacion");
    expect(devuelta.ancladaAt).toEqual(new Date("2026-07-21T02:00:00.000Z")); // aprobacion
    expect(devuelta.ancladaAt).not.toEqual(db.gestiones[0].createdAt); // NO la gestion
  });

  it("DESPUES de reprogramar, la orden esta en `reprogramada` y el cron SLA 99 ya NO la ve (la salta)", async () => {
    const db = makeDb();
    const ok = await reprogramar(db, "2026-07-25");
    expect(ok).toBe(true);

    // La orden salio de `devuelta` -> `reprogramada`.
    expect(db.ordenes[0].estatusId).toBe(ESTATUS.reprogramada);
    // El cron SLA 99 filtra `estatus = devuelta`: ya no la incluye (la salta, sin escalar ni liberar).
    const devueltas = await slaRepo(db).findDevueltasSla();
    expect(devueltas).toEqual([]);
  });
});

describe("Feature 100 T5.1 — el cron 46 mantiene bloqueada la reprogramada y la libera al llegar la fecha (R9)", () => {
  it("con fecha FUTURA la orden permanece bloqueada (el cron 46 no la libera todavia)", async () => {
    const db = makeDb();
    await reprogramar(db, "2026-07-25");

    // Se creo la gestion sintetica `reprogramada` con la fecha elegida (la que lee el cron 46).
    const sintetica = db.gestiones.find((g) => g.resultado === "reprogramada");
    expect(sintetica?.fechaReprogramacion).toEqual(new Date("2026-07-25T00:00:00.000Z"));

    // hoyCR = 2026-07-24 (antes de la fecha) -> NO liberable.
    const liberables = await cron46Repo(db).findOrdenesLiberables(
      new Date("2026-07-24T00:00:00.000Z"),
    );
    expect(liberables).toEqual([]);
  });

  it("al LLEGAR la fecha, el cron 46 la marca liberable (fecha <= hoyCR)", async () => {
    const db = makeDb();
    await reprogramar(db, "2026-07-25");

    // hoyCR = 2026-07-25 (la fecha) -> liberable por el cron 46.
    const liberables = await cron46Repo(db).findOrdenesLiberables(
      new Date("2026-07-25T00:00:00.000Z"),
    );
    expect(liberables.map((l) => l.id)).toEqual(["o1"]);
    expect(liberables[0].fechaReprogramacion).toEqual(new Date("2026-07-25T00:00:00.000Z"));
    // Y el cron SLA 99 sigue sin verla en ese mismo momento (esta en `reprogramada`, no `devuelta`).
    expect(await slaRepo(db).findDevueltasSla()).toEqual([]);
  });

  // Feature 110/R1 — al LIBERAR la reprogramada, el repo REAL la deja en bodega y PRIORITARIA.
  it("R1: liberar la reprogramada la lleva a bodega y la deja PRIORITARIA (prioridad=true)", async () => {
    const db = makeDb();
    await reprogramar(db, "2026-07-25");

    const ok = await cron46Repo(db).liberarOrden({
      ordenId: "o1",
      destinoEstatusId: ESTATUS.en_bodega_central,
      estatusReprogramadaId: ESTATUS.reprogramada,
      corridaAt: new Date("2026-07-25T06:00:00.000Z"),
    });

    expect(ok).toBe(true);
    const orden = db.ordenes[0];
    expect(orden.estatusId).toBe(ESTATUS.en_bodega_central);
    // Feature 110/R1: la orden liberada sale prioritaria para la reasignacion desde bodega.
    expect(orden.prioridad).toBe(true);
    // Handoff limpio (sigue vigente): sin mensajero asignado.
    expect(orden.mensajeroAsignadoId).toBeNull();
  });
});

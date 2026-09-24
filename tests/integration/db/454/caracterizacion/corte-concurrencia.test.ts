import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  HAY_BASE_DE_DATOS,
  clienteConTransaccionAnidada,
  crearPrismaDeTest,
} from "../../_postgres-real";
import {
  entradaGestion,
  limpiarComprometido,
  montarServicios,
  prepararMundo,
  sembrarComprometido,
  type Comprometido,
  type Mundo,
} from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C02 (R44). CONCURRENCIA corte ↔ registro de gestion, sobre el codigo de HOY.
 *
 * La transaccion A registra una gestion sobre O (inserta la gestion y bloquea la fila de `orden`) y
 * se queda SIN confirmar. La B corre el corte: su pre-SELECT ve O en `en_reparto` y su `updateMany`
 * se queda ESPERANDO el candado de A. Solo cuando se OBSERVA a B esperando (pg_stat_activity), A
 * confirma. Invariante: NUNCA a la vez una gestion vigente de O y una fila `cierre_sin_gestion` de O.
 *
 * Es el unico escenario de la fase que CONFIRMA datos (dos conexiones reales): cada repeticion siembra
 * su mundo y lo borra por id al terminar.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const REPETICIONES = 20;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describeSiHayBase("454/C02 — corte y gestion concurrentes (Postgres real, dos conexiones)", () => {
  let mundo: Mundo;
  let prismaA: PrismaClient;
  let prismaB: PrismaClient;
  let sonda: PrismaClient;
  const sembrados: Comprometido[] = [];
  const resultados: { vigentes: number; barridas: number; bEsperoAlCandado: boolean; gestion: string }[] = [];

  async function bloqueadoEnUpdateDeOrden(): Promise<boolean> {
    const filas = await sonda.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND query ILIKE 'UPDATE "public"."orden"%'`;
    return (filas[0]?.n ?? 0) > 0;
  }

  async function unaRepeticion(): Promise<(typeof resultados)[number]> {
    const s = await sembrarComprometido(mundo, async (e) => {
      const o = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 4000 });
      return { ordenIds: [o.ordenId] };
    });
    sembrados.push(s);
    const ordenId = s.ordenIds[0];

    let soltarA!: () => void;
    const soltar = new Promise<void>((r) => (soltarA = r));
    let aListo!: () => void;
    const listo = new Promise<void>((r) => (aListo = r));

    // A: registra la gestion por el SERVICIO real, dentro de su tx, y espera antes de confirmar.
    const a = prismaA.$transaction(
      async (txA) => {
        const svc = montarServicios(clienteConTransaccionAnidada(txA));
        await svc.misAsignaciones.escogerParaGestion(ordenId, s.actorMensajero);
        const r = await svc.misAsignaciones.gestionar(
          entradaGestion(ordenId, "entregado", { monto: 4000 }),
          s.actorMensajero,
        );
        aListo();
        await soltar;
        return r.status;
      },
      { timeout: 30_000, maxWait: 15_000 },
    );
    await listo;

    // B: el corte REAL, con su propia conexion, recortado a este mensajero.
    const b = montarServicios(prismaB).corteDe([s.mensajeroId]).ejecutarCorte(new Date());

    let bEsperoAlCandado = false;
    for (let i = 0; i < 100 && !bEsperoAlCandado; i++) {
      bEsperoAlCandado = await bloqueadoEnUpdateDeOrden();
      if (!bEsperoAlCandado) await esperar(50);
    }
    soltarA();
    const estadoA = await a;
    await b;

    const vigentes = await sonda.gestionOrden.count({ where: { ordenId, anuladaAt: null } });
    const barridas = await sonda.cierreSinGestion.count({ where: { ordenId } });
    return { vigentes, barridas, bEsperoAlCandado, gestion: estadoA };
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    prismaA = crearPrismaDeTest();
    prismaB = crearPrismaDeTest();
    sonda = crearPrismaDeTest();
    for (let i = 0; i < REPETICIONES; i++) resultados.push(await unaRepeticion());
  }, 600_000);

  afterAll(async () => {
    for (const s of sembrados) await limpiarComprometido(mundo.prisma, s);
    await prismaA?.$disconnect();
    await prismaB?.$disconnect();
    await sonda?.$disconnect();
    await mundo?.prisma.$disconnect();
  }, 120_000);

  it(`precondicion: en las ${REPETICIONES} repeticiones el corte QUEDO ESPERANDO el candado de la gestion`, () => {
    expect(resultados).toHaveLength(REPETICIONES);
    expect(resultados.every((r) => r.bEsperoAlCandado)).toBe(true);
    expect(resultados.every((r) => r.gestion === "ok")).toBe(true);
  });

  it("invariante: nunca a la vez gestion vigente de O Y fila `cierre_sin_gestion` de O", () => {
    for (const r of resultados) {
      expect(r.vigentes > 0 && r.barridas > 0).toBe(false);
      // Exactamente uno de los dos desenlaces.
      expect((r.vigentes > 0 ? 1 : 0) + (r.barridas > 0 ? 1 : 0)).toBe(1);
    }
  });
});

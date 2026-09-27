import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "../_postgres-real";
import {
  entradaGestion,
  limpiarComprometido,
  montarServicios,
  prepararMundo,
  sembrarComprometido,
  type Comprometido,
  type Mundo,
} from "./_escenario";

/**
 * FICHA 454 (T1.4, design §5; R4) — DOS REGISTROS CONCURRENTES SOBRE LA MISMA ORDEN DEJAN EXACTAMENTE
 * UNO, con DOS conexiones reales (`Promise.all`) y datos CONFIRMADOS que se borran por id al final.
 *
 * C07 (caracterizacion) ya mide el doble envio del MENSAJERO. Aqui van los otros dos de R4:
 *   (a) doble envio de la TIENDA desde una ayuda abierta (237);
 *   (b) mensajero y tienda a la vez: la tienda registra desde la ayuda mientras el mensajero
 *       «Recupera» y gestiona.
 * En cada repeticion: UNA gestion, UN evento `gestion_registrada`, las evidencias de esa sola
 * gestion, y la otra respuesta es `conflict` (nunca un 500).
 *
 * Mutacion registrada en `progress/impl_454_backend.md` (§Mutaciones T1.4).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const REPETICIONES = 5;
const FOTO = [{ contentType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) }];

type Medida = { estados: string[]; gestiones: number; eventos: number; evidencias: number };

describeSiHayBase("454/T1.4 — registro concurrente: exactamente uno (Postgres real)", () => {
  let mundo: Mundo;
  const dobleTienda: Medida[] = [];
  const mensajeroYTienda: Medida[] = [];
  const sembrados: Comprometido[] = [];
  let c1: PrismaClient;
  let c2: PrismaClient;

  async function sembrarConAyuda(): Promise<Comprometido> {
    const s = await sembrarComprometido(mundo, async (e) => {
      const o = await e.sembrarOrden({ estatus: "en_reparto" });
      const p = await e.pedirAyuda(o.ordenId);
      if (p.status !== "ok") throw new Error(`pedirAyuda: ${JSON.stringify(p)}`);
      return { ordenIds: [o.ordenId] };
    });
    sembrados.push(s);
    return s;
  }

  async function medir(ordenId: string, estados: string[]): Promise<Medida> {
    const gestiones = await mundo.prisma.gestionOrden.findMany({ where: { ordenId }, select: { id: true } });
    return {
      estados: [...estados].sort(),
      gestiones: gestiones.length,
      eventos: await mundo.prisma.ordenEvento.count({ where: { ordenId, tipo: "gestion_registrada" } }),
      evidencias: await mundo.prisma.gestionOrdenEvidencia.count({
        where: { gestionId: { in: gestiones.map((g) => g.id) } },
      }),
    };
  }

  const desdeAyuda = (cliente: PrismaClient, s: Comprometido) =>
    montarServicios(cliente)
      .gestionDesdeAyuda.gestionar(
        { ordenId: s.ordenIds[0], resultado: "devolucion_a_origen_por_rechazo", motivo: "El cliente no la quiere", evidencias: FOTO } as never,
        s.actorTienda,
      )
      .then((x) => x.status);

  beforeAll(async () => {
    mundo = await prepararMundo();
    c1 = crearPrismaDeTest();
    c2 = crearPrismaDeTest();
    for (let i = 0; i < REPETICIONES; i++) {
      const a = await sembrarConAyuda();
      const estadosA = await Promise.all([desdeAyuda(c1, a), desdeAyuda(c2, a)]);
      dobleTienda.push(await medir(a.ordenIds[0], estadosA));

      const b = await sembrarConAyuda();
      const mensajero = async () => {
        const svc = montarServicios(c2);
        await svc.solicitudAyuda.recuperar({ ordenId: b.ordenIds[0] }, b.actorMensajero);
        return (await svc.misAsignaciones.gestionar(entradaGestion(b.ordenIds[0], "novedad"), b.actorMensajero)).status;
      };
      const estadosB = await Promise.all([desdeAyuda(c1, b), mensajero()]);
      mensajeroYTienda.push(await medir(b.ordenIds[0], estadosB));
    }
  }, 300_000);

  afterAll(async () => {
    for (const s of sembrados) await limpiarComprometido(mundo.prisma, s);
    await c1?.$disconnect();
    await c2?.$disconnect();
    await mundo?.prisma.$disconnect();
  }, 120_000);

  it(`R4 (a): doble envio de la tienda (${REPETICIONES} repeticiones) — una gestion, un evento, la otra conflict`, () => {
    expect(dobleTienda).toHaveLength(REPETICIONES);
    for (const m of dobleTienda) {
      expect(m).toEqual({ estados: ["conflict", "ok"], gestiones: 1, eventos: 1, evidencias: 1 });
    }
  });

  it(`R4 (b): mensajero y tienda a la vez (${REPETICIONES} repeticiones) — exactamente una gestion y un evento`, () => {
    expect(mensajeroYTienda).toHaveLength(REPETICIONES);
    for (const m of mensajeroYTienda) {
      expect(m.gestiones).toBe(1);
      expect(m.eventos).toBe(1);
      expect(m.evidencias).toBe(1);
      expect(m.estados).toContain("ok");
      expect(m.estados).toContain("conflict");
    }
  });
});

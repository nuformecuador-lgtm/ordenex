import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "../../_postgres-real";
import {
  conEscenario,
  entradaGestion,
  limpiarComprometido,
  montarServicios,
  prepararMundo,
  sembrarComprometido,
  type Comprometido,
  type Mundo,
} from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C07 (R3, R4). UNA ORDEN NO SE GESTIONA DOS VECES.
 *
 * (1) Secuencial, en tx revertida: gestionar O y volver a gestionarla -> la segunda es `conflict` y
 *     queda UNA fila de `gestion_orden`.
 * (2) Doble envio CONCURRENTE (`Promise.all`, dos conexiones reales, datos confirmados y borrados por
 *     id): exactamente UNA gestion.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const REPETICIONES = 10;

describeSiHayBase("454/C07 — no se registra una segunda gestion (Postgres real)", () => {
  let mundo: Mundo;
  let secuencial: { primera: string; segunda: { status: string; motivo?: string }; filas: number };
  const concurrente: { estados: string[]; filas: number }[] = [];
  const sembrados: Comprometido[] = [];
  let c1: PrismaClient;
  let c2: PrismaClient;

  beforeAll(async () => {
    mundo = await prepararMundo();
    secuencial = await conEscenario(mundo, async (e) => {
      const o = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 3000 });
      const primera = await e.gestionar(o.ordenId, "entregada", { monto: 3000 });
      const segunda = await e.gestionar(o.ordenId, "rechazada");
      const filas = await e.tx.gestionOrden.count({ where: { ordenId: o.ordenId } });
      return { primera: primera.status, segunda: segunda as { status: string; motivo?: string }, filas };
    });

    c1 = crearPrismaDeTest();
    c2 = crearPrismaDeTest();
    for (let i = 0; i < REPETICIONES; i++) {
      const s = await sembrarComprometido(mundo, async (e) => {
        const o = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 3000 });
        return { ordenIds: [o.ordenId] };
      });
      sembrados.push(s);
      const ordenId = s.ordenIds[0];
      const enviar = async (cliente: PrismaClient) => {
        const svc = montarServicios(cliente).misAsignaciones;
        return (await svc.gestionar(entradaGestion(ordenId, "entregada", { monto: 3000 }), s.actorMensajero))
          .status;
      };
      const estados = await Promise.all([enviar(c1), enviar(c2)]);
      const filas = await mundo.prisma.gestionOrden.count({ where: { ordenId } });
      concurrente.push({ estados, filas });
    }
  }, 300_000);

  afterAll(async () => {
    for (const s of sembrados) await limpiarComprometido(mundo.prisma, s);
    await c1?.$disconnect();
    await c2?.$disconnect();
    await mundo?.prisma.$disconnect();
  }, 120_000);

  it("secuencial: la segunda gestion sobre la misma orden es `conflict` y queda UNA fila", () => {
    expect(secuencial.primera).toBe("ok");
    expect(secuencial.segunda.status).toBe("conflict");
    expect(secuencial.filas).toBe(1);
  });

  /**
   * ⚠️ DEFECTO MEDIDO HOY (2026-09-23), no invariante: sobre el codigo actual el doble envio
   * concurrente deja DOS gestiones en 10 de 10 repeticiones (las dos respuestas `ok`), porque
   * `crearGestionYTransicionar` hace `orden.update` por PK sin re-comprobar el estado de origen (la
   * «deuda declarada» de `MisAsignacionesService.gestionar`, feature 261). R4 lo exige NUEVO.
   *
   * `it.fails`: esta verde MIENTRAS el defecto exista. Cuando T1.4 lo cierre se pondra ROJO, y ahi
   * se convierte en `it` normal (con nota fechada) — es la señal de que R4 quedo cumplido.
   */
  describe("[INTERMEDIO] defecto medido hoy que R4 cambia", () => {
    it.fails(`doble envio concurrente (${REPETICIONES} repeticiones): exactamente UNA gestion`, () => {
      expect(concurrente).toHaveLength(REPETICIONES);
      for (const c of concurrente) expect(c.filas).toBe(1);
    });
  });
});

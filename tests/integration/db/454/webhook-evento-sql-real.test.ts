import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { WebhookEventoReader } from "@/lib/repositories/WebhookEventoReader";
import { dedupeKeyWebhookEvento, encolarWebhookEvento } from "@/lib/services/jobs/webhook-evento-encolado";
import { MAX_INTENTOS_WEBHOOK } from "@/lib/services/jobs/webhook-estado-encolado";
import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Escenario, type Mundo } from "./_escenario";

/**
 * FICHA 454 (T1.5, design §12.1; R33) — EL ENCOLADO DE `webhook_evento` Y SU LECTOR, CONTRA POSTGRES.
 *
 * - Encola SOLO si el dueño de la orden tiene una suscripcion ACTIVA (ni inactiva, ni ausente, ni
 *   orden borrada).
 * - Payload MINIMO `{ ordenEventoId }`: ni nombre, ni telefono, ni direccion (R33).
 * - Un hecho = un job: encolar dos veces el mismo evento deja UNA fila (dedupe por id).
 * - Dentro de la transaccion del hecho (outbox): la transaccion del test se revierte y el job con ella.
 * - El lector publica la causa TIPIFICADA y nunca el texto libre.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/T1.5 — encolado de webhook_evento (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  async function evento(e: Escenario, ordenId: string) {
    const g = await e.tx.gestionOrden.create({
      data: {
        ordenId,
        mensajeroId: e.mensajeroId,
        resultado: "novedad",
        causaDevolucion: "wrong_address",
        motivo: "TEXTO LIBRE QUE NO SE PUBLICA",
      },
      select: { id: true },
    });
    const ev = await e.tx.ordenEvento.create({
      data: {
        ordenId,
        tipo: "gestion_registrada",
        gestionOrdenId: g.id,
        familiaAplicacion: "gestion",
        resultado: "novedad",
        mensajeroId: e.mensajeroId,
        actorUsuarioId: e.mensajeroId,
        actorRol: "mensajero",
        motivo: "wrong_address",
      },
      select: { id: true },
    });
    return { gestionId: g.id, ordenEventoId: ev.id };
  }

  const jobsDe = (e: Escenario, ordenEventoId: string) =>
    e.tx.job.findMany({
      where: { tipo: "webhook_evento", payload: { path: ["ordenEventoId"], equals: ordenEventoId } },
      select: { payload: true, dedupeKey: true, maxIntentos: true, estado: true },
    });

  function correr() {
    return conEscenario(mundo, async (e) => {
      // 1) sin suscripcion
      const o1 = await e.sembrarOrden({ estatus: "en_reparto" });
      const ev1 = await evento(e, o1.ordenId);
      const sinSuscripcion = await encolarWebhookEvento(e.tx, { ordenEventoId: ev1.ordenEventoId, ordenId: o1.ordenId });
      const jobsSin = await jobsDe(e, ev1.ordenEventoId);

      // 2) suscripcion INACTIVA
      const sub = await e.tx.webhookSuscripcion.create({
        data: { ownerUsuarioId: e.tiendaId, url: "https://example.test/hook-454", secret: "cifrado", activa: false },
        select: { id: true },
      });
      const inactiva = await encolarWebhookEvento(e.tx, { ordenEventoId: ev1.ordenEventoId, ordenId: o1.ordenId });

      // 3) suscripcion ACTIVA, dos veces el mismo evento
      await e.tx.webhookSuscripcion.update({ where: { id: sub.id }, data: { activa: true } });
      const primera = await encolarWebhookEvento(e.tx, { ordenEventoId: ev1.ordenEventoId, ordenId: o1.ordenId });
      const segunda = await encolarWebhookEvento(e.tx, { ordenEventoId: ev1.ordenEventoId, ordenId: o1.ordenId });
      const jobsCon = await jobsDe(e, ev1.ordenEventoId);

      // 4) orden BORRADA con suscripcion activa
      const o2 = await e.sembrarOrden({ estatus: "en_reparto" });
      const ev2 = await evento(e, o2.ordenId);
      await e.tx.orden.update({ where: { id: o2.ordenId }, data: { deletedAt: new Date() } });
      const borrada = await encolarWebhookEvento(e.tx, { ordenEventoId: ev2.ordenEventoId, ordenId: o2.ordenId });

      const leido = await new WebhookEventoReader(e.tx).findDatosEntrega(ev1.ordenEventoId);
      const orden = await e.tx.orden.findUniqueOrThrow({
        where: { id: o1.ordenId },
        select: { destinatario: true, telefonoDest: true },
      });
      return { ev1, sinSuscripcion, jobsSin, inactiva, primera, segunda, jobsCon, borrada, leido, orden, tiendaId: e.tiendaId, mensajeroId: e.mensajeroId };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("sin suscripcion, o con la suscripcion inactiva, NO encola", () => {
    expect(r.sinSuscripcion).toBe(false);
    expect(r.jobsSin).toEqual([]);
    expect(r.inactiva).toBe(false);
  });

  it("con suscripcion activa encola UN job: dos encolados del mismo evento dejan una fila", () => {
    expect(r.primera).toBe(true);
    expect(r.segunda).toBe(true);
    expect(r.jobsCon).toHaveLength(1);
    expect(r.jobsCon[0]).toMatchObject({
      dedupeKey: dedupeKeyWebhookEvento(r.ev1.ordenEventoId),
      maxIntentos: MAX_INTENTOS_WEBHOOK,
      estado: "pending",
    });
  });

  it("R33: el payload es SOLO `{ ordenEventoId }`, sin datos personales", () => {
    const p = r.jobsCon[0].payload as Record<string, unknown>;
    expect(p).toEqual({ ordenEventoId: r.ev1.ordenEventoId });
    const texto = JSON.stringify(p);
    expect(texto).not.toContain(r.orden.destinatario);
    expect(texto).not.toContain(r.orden.telefonoDest);
  });

  it("orden borrada → no encola", () => {
    expect(r.borrada).toBe(false);
  });

  it("el lector publica la causa TIPIFICADA, el dueño y el mensajero congelado; nunca el texto libre", () => {
    expect(r.leido).toMatchObject({
      tipo: "gestion_registrada",
      resultado: "novedad",
      gestionId: r.ev1.gestionId,
      causa: "wrong_address",
      orden: { tiendaId: r.tiendaId, deletedAt: null },
    });
    expect(r.leido?.mensajero?.id).toBe(r.mensajeroId);
    expect(JSON.stringify(r.leido)).not.toContain("TEXTO LIBRE");
  });
});

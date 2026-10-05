import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { WhatsappEnvioRepository } from "@/lib/repositories/WhatsappEnvioRepository";
import { WhatsappEjecucionRepository } from "@/lib/repositories/WhatsappEjecucionRepository";
import { JobRepository } from "@/lib/repositories/JobRepository";
import type { EnqueueOpts, IJobRepository, JobDTO, JobTxClient } from "@/lib/interfaces/repositories/IJobRepository";
import { crearWhatsappEnvioEventoHandler } from "@/lib/services/jobs/whatsapp-envio-evento-handler";
import {
  HAY_BASE_DE_DATOS,
  clienteConTransaccionAnidada,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import { aislarEnvios, crearEnvio, crearPlantilla } from "./_whatsapp-envios-474";

// Ficha 474 (T6.2, R27/R19) — el HANDLER REAL de `whatsapp_envio_evento` con los repositorios
// REALES: corrido dos veces con la misma referencia -> UNA ejecucion por envio encendido; dos envios
// encendidos -> dos; uno apagado -> ninguna. La unicidad la da el indice PARCIAL por
// (envio, evento, entidad).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

function job(payload: Record<string, unknown>): JobDTO {
  return {
    id: "j",
    tipo: "whatsapp_envio_evento",
    payload,
    estado: "processing",
    intentos: 1,
    maxIntentos: 3,
    runAfter: new Date(),
    lockedAt: null,
    lastError: null,
    dedupeKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describeSiHayBase("474/R27 — una ejecucion por (envio, evento, entidad)", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ handler x2 misma referencia: 1 ejecucion por envio encendido, 0 para el apagado, 1 job por ejecucion", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await aislarEnvios(tx);
      const p = await crearPlantilla(tx, { informeClave: "aviso_interno" });
      const e1 = await crearEnvio(tx, { plantillaId: p.id, disparo: "evento", eventoClave: "cierre_dia_por_aprobar", activo: true });
      const e2 = await crearEnvio(tx, { plantillaId: p.id, disparo: "evento", eventoClave: "cierre_dia_por_aprobar", activo: true });
      const apagado = await crearEnvio(tx, { plantillaId: p.id, disparo: "evento", eventoClave: "cierre_dia_por_aprobar", activo: false });
      const otroEvento = await crearEnvio(tx, { plantillaId: p.id, disparo: "evento", eventoClave: "geocodificacion_caida", activo: true });

      const cliente = clienteConTransaccionAnidada(tx);
      const real = new JobRepository(cliente);
      const cola = {
        enqueue: (t: JobDTO["tipo"], pl: Record<string, unknown>, o?: EnqueueOpts) =>
          real.enqueue(t, pl, o, tx as unknown as JobTxClient),
      } as unknown as IJobRepository;
      const handler = crearWhatsappEnvioEventoHandler(() => ({
        envios: new WhatsappEnvioRepository(cliente),
        ejecuciones: new WhatsappEjecucionRepository(cliente),
        cola,
      }));
      const payload = {
        evento: "cierre_dia_por_aprobar",
        referencia: "cierre-474-x",
        notificacionId: "n1",
        datos: { texto: "Un mensajero envió su cierre del día para aprobación.", rolFila: "maestro", creadoAt: "2026-10-05T11:00:00.000Z" },
      };
      await handler(job(payload));
      await handler(job({ ...payload, notificacionId: "n2" })); // la fila hermana del admin
      const filas = await tx.$queryRawUnsafe<{ envio_id: string; n: number }[]>(
        `SELECT "envio_id", count(*)::int AS n FROM "whatsapp_envio_ejecucion"
          WHERE "origen" = 'evento' AND "evento_referencia" = 'cierre-474-x' GROUP BY "envio_id"`,
      );
      const jobs = await tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "jobs" WHERE "tipo" = 'whatsapp_envio_ejecucion'
          AND "payload"->>'ejecucionId' IN (SELECT "id" FROM "whatsapp_envio_ejecucion" WHERE "evento_referencia" = 'cierre-474-x')`,
      );
      const datos = await tx.$queryRawUnsafe<{ evento_datos: unknown; notificacion_id: string }[]>(
        `SELECT "evento_datos", "notificacion_id" FROM "whatsapp_envio_ejecucion" WHERE "envio_id" = $1 AND "evento_referencia" = 'cierre-474-x'`,
        e1,
      );
      const porEnvio = Object.fromEntries(filas.map((f) => [f.envio_id, f.n]));
      return {
        e1: porEnvio[e1],
        e2: porEnvio[e2],
        apagado: porEnvio[apagado] ?? 0,
        otroEvento: porEnvio[otroEvento] ?? 0,
        jobs: jobs[0].n,
        notificacion: datos[0].notificacion_id,
        datos: datos[0].evento_datos,
      };
    });
    expect(r).toEqual({
      e1: 1,
      e2: 1,
      apagado: 0,
      otroEvento: 0,
      jobs: 2,
      notificacion: "n1", // la primera fila gano; la hermana no crea otra
      datos: { texto: "Un mensajero envió su cierre del día para aprobación.", rolFila: "maestro", creadoAt: "2026-10-05T11:00:00.000Z" },
    });
  });

  it("otra entidad del mismo evento es otra ejecucion", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await crearPlantilla(tx, { informeClave: "aviso_interno" });
      const e = await crearEnvio(tx, { plantillaId: p.id, disparo: "evento", activo: true });
      const repo = new WhatsappEjecucionRepository(tx as unknown as PrismaClient);
      const datos = { texto: "t", rolFila: "maestro" as const, creadoAt: "2026-10-05T11:00:00.000Z" };
      const a = await repo.insertarEvento({ envioId: e, eventoClave: "geocodificacion_caida", eventoReferencia: "2099-01-01", eventoDatos: datos, notificacionId: null });
      const b = await repo.insertarEvento({ envioId: e, eventoClave: "geocodificacion_caida", eventoReferencia: "2099-01-02", eventoDatos: datos, notificacionId: null });
      const c = await repo.insertarEvento({ envioId: e, eventoClave: "geocodificacion_caida", eventoReferencia: "2099-01-01", eventoDatos: datos, notificacionId: null });
      return { ab: a.id !== b.id, ac: a.id === c.id, cCreada: c.creada };
    });
    expect(r).toEqual({ ab: true, ac: true, cCreada: false });
  });
});

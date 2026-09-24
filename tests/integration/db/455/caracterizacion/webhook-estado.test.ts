import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";

import { pausaConfigDe, type WebhookConfig } from "@/lib/config/webhook";
import { cifrarSecreto } from "@/lib/crypto/webhook-secret-cipher";
import type { IWebhookSender } from "@/lib/interfaces/external/IWebhookSender";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import { WebhookOrdenReader } from "@/lib/repositories/WebhookOrdenReader";
import { WebhookSuscripcionRepository } from "@/lib/repositories/WebhookSuscripcionRepository";
import { dedupeKeyWebhookEstado } from "@/lib/services/jobs/webhook-estado-encolado";
import { WebhookEstadoService } from "@/lib/services/WebhookEstadoService";
import { C, R, claveDe } from "../../../../fixtures/codigos-455";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../../454/_escenario";

/**
 * FEATURE 455 — FASE 0 · C11 (R28, R50). EL WEBHOOK `orden.estado_actualizado`.
 *
 * La lista de estados que emiten (`EVENTOS_PUBLICOS`) es de CODIGOS, y el job `webhook_estado` guarda el
 * ID del estado destino y resuelve el CODIGO al entregar. Mundo propio en tx revertida, la tienda con una
 * suscripcion activa, por los servicios reales: tres ordenes gestionadas (`R.entregado`, `R.rechazo`,
 * `R.novedad`) y su cierre aprobado.
 * Invariantes:
 *  - los eventos encolados (orden, destino en clave, `eventoId` = la dedupe determinista por ids e
 *    instante): exactamente uno por transicion publica, y ninguno para `C.porDevolverATienda`;
 *  - entregar cada job por el servicio REAL manda el `eventoId` de su job;
 *  - R28: si la fila del catalogo del destino se RENOMBRA despues de encolar (aqui, a un valor centinela
 *    dentro de la tx), el MISMO job entrega el valor nuevo con el MISMO `eventoId`.
 * `[INTERMEDIO]`: la forma del `data` entregado (hoy sin `estadoNombre`; la Fase 1, T1.7, lo añade).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const CLAVE = randomBytes(32).toString("base64");
const CONFIG: WebhookConfig = {
  WEBHOOK_TIMEOUT_MS: 10_000,
  WEBHOOK_REPLAY_WINDOW_S: 300,
  WEBHOOK_SECRET_ENC_KEY: CLAVE,
  WEBHOOK_APP_ORIGIN: "https://app.ordenex.co",
  WEBHOOK_PAUSA_FALLOS_MINIMOS: 3,
  WEBHOOK_PAUSA_VENTANA_MS: 30 * 60_000,
  WEBHOOK_PAUSA_INTERVALO_MS: 3_600_000,
};
const CENTINELA = `${C.entregado}__renombrado_455`;

describeSiHayBase("455/C11 — webhook de estado (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      await e.tx.webhookSuscripcion.create({
        data: {
          ownerUsuarioId: e.tiendaId,
          url: "https://example.test/hook-455",
          secret: cifrarSecreto(CLAVE, "ordx_whsec_455"),
          activa: true,
        },
      });
      const ent = await e.sembrarOrden({ estatus: C.enReparto as never, montoCobrar: 4000 });
      const rec = await e.sembrarOrden({ estatus: C.enReparto as never, montoCobrar: 3000 });
      const dev = await e.sembrarOrden({ estatus: C.enReparto as never, montoCobrar: 2000 });
      await e.gestionarOk(ent.ordenId, R.entregado as never, { monto: 4000 });
      await e.gestionarOk(rec.ordenId, R.rechazo as never);
      await e.gestionarOk(dev.ordenId, R.novedad as never);
      const cierreId = await e.solicitarCierreOk();
      const aprobacion = await e.aprobar(cierreId);

      const nombre = new Map([
        [ent.ordenId, "ent"],
        [rec.ordenId, "rec"],
        [dev.ordenId, "dev"],
      ]);
      const jobs = await e.tx.job.findMany({
        where: {
          tipo: "webhook_estado",
          OR: [...nombre.keys()].map((id) => ({ payload: { path: ["ordenId"], equals: id } })),
        },
        orderBy: { createdAt: "asc" },
      });
      const eventos = jobs
        .map((j) => {
          const p = j.payload as { ordenId: string; estatusDestinoId: string; ocurridoAt: string };
          return {
            orden: nombre.get(p.ordenId) as string,
            destino: claveDe(mundo.valorDeEstatus.get(p.estatusDestinoId)),
            dedupeCoincide:
              j.dedupeKey === dedupeKeyWebhookEstado(p.ordenId, p.estatusDestinoId, p.ocurridoAt),
          };
        })
        .sort((a, b) => `${a.orden}${a.destino}`.localeCompare(`${b.orden}${b.destino}`));

      const cuerpos: string[] = [];
      const sender: IWebhookSender = {
        entregar: async (_url: string, cuerpo: string) => {
          cuerpos.push(cuerpo);
          return { status: "ok" };
        },
      } as IWebhookSender;
      const servicio = new WebhookEstadoService(
        new WebhookOrdenReader(e.cliente),
        new WebhookSuscripcionRepository(e.cliente, pausaConfigDe(CONFIG)),
        sender,
        CONFIG,
      );
      const entregar = async (job: (typeof jobs)[number]) => {
        cuerpos.length = 0;
        await servicio.ejecutar(job as unknown as JobDTO);
        if (cuerpos.length !== 1) throw new Error(`se esperaba UNA entrega y hubo ${cuerpos.length}`);
        return JSON.parse(cuerpos[0]) as { evento: string; eventoId: string; data: Record<string, unknown> };
      };
      const entregas = [];
      for (const j of jobs) {
        const b = await entregar(j);
        entregas.push({
          orden: nombre.get((j.payload as { ordenId: string }).ordenId),
          evento: b.evento,
          eventoIdEsElDelJob: b.eventoId === j.dedupeKey,
          estado: claveDe(b.data.estado as string),
          claves: Object.keys(b.data),
          // ⏳ 2026-09-24 (T1.7): el nombre que acompana al codigo (solo lo lee el bloque [INTERMEDIO]).
          estadoNombre: b.data.estadoNombre,
        });
      }

      // R28: el catalogo se renombra DESPUES de encolar; el mismo job entrega el valor nuevo.
      // Sin job de la entrega no hay nada que re-entregar: `renombre` queda `null` y la asercion de R28
      // cae (no se salta: el `null` se COMPARA contra el valor esperado).
      const jobEnt = jobs.find((j) => (j.payload as { ordenId: string }).ordenId === ent.ordenId);
      let renombre: { estadoAntes: unknown; estadoDespues: unknown; mismoEventoId: boolean } | null = null;
      if (jobEnt !== undefined) {
        const antes = await entregar(jobEnt);
        await e.tx.orderStatus.update({ where: { id: e.id(C.entregado) }, data: { value: CENTINELA } });
        const despues = await entregar(jobEnt);
        renombre = {
          estadoAntes: antes.data.estado,
          estadoDespues: despues.data.estado,
          mismoEventoId: antes.eventoId === despues.eventoId && despues.eventoId === jobEnt.dedupeKey,
        };
      }

      return {
        aprobacion: aprobacion.status,
        eventos,
        entregas: entregas.sort((a, b) => String(a.orden).localeCompare(String(b.orden))),
        renombre,
      };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  describe("invariantes", () => {
    it("un evento por transicion publica, con la dedupe determinista, y ninguno para la devolucion a tienda", () => {
      expect(r.aprobacion).toBe("ok");
      expect(r.eventos).toEqual([
        { orden: "dev", destino: "novedad", dedupeCoincide: true },
        { orden: "ent", destino: "entregado", dedupeCoincide: true },
        { orden: "rec", destino: "rechazo", dedupeCoincide: true },
      ]);
    });

    it("cada entrega lleva el eventoId de su job y el estado de su destino", () => {
      expect(r.entregas.map((x) => [x.orden, x.evento, x.eventoIdEsElDelJob, x.estado])).toEqual([
        ["dev", "orden.estado_actualizado", true, "novedad"],
        ["ent", "orden.estado_actualizado", true, "entregado"],
        ["rec", "orden.estado_actualizado", true, "rechazo"],
      ]);
    });

    it("R28: renombrado el catalogo tras encolar, el mismo job entrega el valor nuevo con el mismo eventoId", () => {
      expect(r.renombre).toEqual({ estadoAntes: C.entregado, estadoDespues: CENTINELA, mismoEventoId: true });
    });
  });

  describe("[INTERMEDIO] lo que la 455 cambia por diseño (R25)", () => {
    // ⏳ 2026-09-24 (T1.7, Fase 1): REESCRITO. En la Fase 0 fijaba el `data` sin `estadoNombre`. Ahora
    // el nombre visible va INMEDIATAMENTE despues de `estado` (el cuerpo firmado cambia a proposito) y
    // se compara contra el literal esperado, no contra la funcion que lo genera.
    it("las claves del data entregado: `estadoNombre` pegado detras de `estado`", () => {
      expect(r.entregas.map((x) => x.claves)).toEqual([
        ["numGuia", "numRemision", "estado", "estadoNombre", "motivo", "mensajero"],
        ["numGuia", "numRemision", "estado", "estadoNombre", "motivo", "mensajero"],
        ["numGuia", "numRemision", "estado", "estadoNombre", "motivo", "mensajero"],
      ]);
    });

    it("R25: el nombre es el visible de cada destino", () => {
      expect(r.entregas.map((x) => x.estadoNombre)).toEqual(["Novedad", "Entregado", "Devolución a origen por rechazo"]);
    });
  });
});

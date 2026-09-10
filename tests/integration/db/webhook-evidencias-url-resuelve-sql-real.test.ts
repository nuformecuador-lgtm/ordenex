import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ApiOrdenResolucionService } from "@/lib/services/ApiOrdenResolucionService";
import { WebhookEstadoService } from "@/lib/services/WebhookEstadoService";
import { cifrarSecreto } from "@/lib/crypto/webhook-secret-cipher";
import { ESTADOS_CREACION } from "@/lib/types/order-status-transiciones";
import type { WebhookConfig } from "@/lib/config/webhook";
import type { IWebhookOrdenReader } from "@/lib/interfaces/repositories/IWebhookOrdenReader";
import type { IWebhookSuscripcionRepository } from "@/lib/interfaces/repositories/IWebhookSuscripcionRepository";
import type { IWebhookSender, WebhookOutcome } from "@/lib/interfaces/external/IWebhookSender";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type FksDeOrden,
} from "./_postgres-real";

/**
 * ⏳ 2026-09-10 — FEATURE 406 (T10, R3): EL `WHERE` DONDE VIVE.
 *
 * POR QUE CONTRA POSTGRES Y NO CON UN DOBLE. El cierre de lazo de
 * `tests/integration/api/webhook-evidencias-url-resuelve.route.test.ts` usa un repo fake, y un
 * doble NO VE EL SQL: en este repo se midio cuatro veces seguidas que una mutacion del `where`
 * deja los tests de servicio en verde. Aqui el identificador que sale del cuerpo REAL del webhook
 * se resuelve contra `OrdenRepository.findByGuiaORemisionForOwner` REAL —con su
 * `tienda_id = ownerId` y su `deleted_at IS NULL`— sobre filas sembradas de verdad.
 *
 * QUE SE MIDE, y cada caso tiene DATOS que lo ejercitan (nada de `if (!fila) return;`, que reporta
 * `passed` sin comprobar nada):
 *   1. orden CON guia: el segmento del enlace resuelve a ESA orden, por `num_guia`;
 *   2. orden SIN guia: resuelve por `num_remision`;
 *   3. el owner del `where` decide: la MISMA remision en OTRA tienda no se devuelve;
 *   4. `deleted_at` decide: una orden borrada con esa remision no se devuelve.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte, con el lock de aviso de
 * `_postgres-real` como primera sentencia: este archivo escribe en `usuario` y `orden` reales.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), y eso se VE en la salida de vitest. CON base
 * pero sin catalogo, FALLA RUIDOSAMENTE.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: aunque todo se revierta, dos corridas simultaneas no deben chocar. */
const SUFIJO = `406-${Date.now().toString(36)}`;

/** `orden.num_guia` es `@unique` GLOBAL: se toma una banda alta y aleatoria para no chocar. */
function guiaLibre(): number {
  return 1_500_000_000 + Math.floor(Math.random() * 100_000_000);
}

const ORIGIN = "https://app.ordenex.co";
const CLAVE = randomBytes(32).toString("base64");
const SECRET_ENC = cifrarSecreto(CLAVE, "ordx_whsec_secreto-de-firma-de-prueba");

const config: WebhookConfig = {
  WEBHOOK_TIMEOUT_MS: 10_000,
  WEBHOOK_REPLAY_WINDOW_S: 300,
  WEBHOOK_SECRET_ENC_KEY: CLAVE,
  WEBHOOK_APP_ORIGIN: ORIGIN,
  WEBHOOK_PAUSA_FALLOS_MINIMOS: 3,
  WEBHOOK_PAUSA_VENTANA_MS: 30 * 60_000,
  WEBHOOK_PAUSA_INTERVALO_MS: 3_600_000,
};

/** Cola de jobs que no escribe nada: el encolado no es lo que mide este archivo. */
const jobsNoOp = {
  enqueue: async () => null,
  claimBatch: async () => [],
  findByDedupeKeys: async () => [],
  complete: async () => {},
  fail: async () => {},
} as unknown as IJobRepository;

describeSiHayBase("406/R3 — el identificador del enlace resuelve contra el SQL REAL", () => {
  let prisma: PrismaClient;
  let fks: FksDeOrden;
  let estatusInicialId: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const encontradas = await fksDeOrden(prisma);
    if (encontradas === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar el caso. " +
          "Corre `pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    fks = encontradas;
    const inicial = await prisma.orderStatus.findFirst({
      where: { value: ESTADOS_CREACION[0] },
      select: { id: true },
    });
    if (inicial === null) {
      throw new Error(
        `falta el estatus «${ESTADOS_CREACION[0]}» en el catalogo \`order_status\`. Corre ` +
          "`pnpm run db:seed`: sin el, este archivo NO debe pasar en verde.",
      );
    }
    estatusInicialId = inicial.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Una transaccion revertida, con el lock tomado y una TIENDA nueva creada dentro. */
  async function conTienda<T>(
    fn: (ctx: {
      tx: Prisma.TransactionClient;
      tiendaId: string;
      crearTienda: () => Promise<string>;
      repo: OrdenRepository;
    }) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const plantilla = await tx.usuario.findUniqueOrThrow({
        where: { id: fks.tiendaId },
        select: { rolId: true, tipoIdentificacionId: true },
      });
      const crearTienda = async () => {
        const marca = `${SUFIJO}-${Math.random().toString(36).slice(2, 8)}`;
        const tienda = await tx.usuario.create({
          data: {
            nombre: `Tienda 406 ${marca}`,
            email: `tienda-${marca}@ordenex.test`,
            telefono: "22220000",
            passwordHash: "x",
            cedula: `406${marca}`,
            tipoIdentificacionId: plantilla.tipoIdentificacionId,
            rolId: plantilla.rolId,
          },
          select: { id: true },
        });
        return tienda.id;
      };
      const tiendaId = await crearTienda();
      // El repositorio REAL, atado a ESTA transaccion. `findByGuiaORemisionForOwner` solo lee, asi
      // que no hace falta el puente de `$transaction` de otros archivos.
      const repo = new OrdenRepository(tx as unknown as PrismaClient, jobsNoOp);
      return fn({ tx, tiendaId, crearTienda, repo });
    });
  }

  /** INSERT directo de una orden con las FKs reales. Devuelve su `orden.id`. */
  async function sembrarOrden(
    tx: Prisma.TransactionClient,
    tiendaId: string,
    datos: { numRemision: string; numGuia?: number | null; borrada?: boolean },
  ): Promise<string> {
    const fila = await tx.orden.create({
      data: {
        numRemision: datos.numRemision,
        numGuia: datos.numGuia ?? null,
        estatusId: estatusInicialId,
        destinatario: "Destinatario 406",
        telefonoDest: "88880000",
        tiendaId,
        zonaId: fks.zonaId,
        provinciaId: fks.provinciaId,
        cantonId: fks.cantonId,
        producto: "Caja",
        deletedAt: datos.borrada ? new Date() : null,
      },
      select: { id: true },
    });
    return fila.id;
  }

  /**
   * Emite el evento de `incidente` de una orden LEIDA DE LA BASE y devuelve el identificador que
   * el integrador extraeria del enlace. Nada de esto conoce al resolutor.
   */
  async function identificadorDelEnlaceDe(
    tx: Prisma.TransactionClient,
    ordenId: string,
    tiendaId: string,
  ): Promise<string> {
    const fila = await tx.orden.findUniqueOrThrow({
      where: { id: ordenId },
      select: { numGuia: true, numRemision: true },
    });
    const ordenes: IWebhookOrdenReader = {
      findDatosEntrega: vi.fn(async () => ({
        tiendaId,
        numGuia: fila.numGuia,
        numRemision: fila.numRemision,
        deletedAt: null,
        estado: "incidente",
        causaDevolucion: null,
        causaIncidente: "robado" as const,
        mensajero: null,
      })),
    };
    const suscripciones = {
      findActivaByOwner: vi.fn(async () => ({
        url: "https://a.example.com/hook",
        secret: SECRET_ENC,
      })),
      registrarEntregaOk: vi.fn(async () => {}),
      incrementarFalloYLeer: vi.fn(async () => null),
    } as unknown as IWebhookSuscripcionRepository;
    const entregar = vi.fn(async () => ({ status: "ok" }) as WebhookOutcome);
    const sender: IWebhookSender = { entregar };
    const job: JobDTO = {
      id: "job-406",
      tipo: "webhook_estado",
      payload: {
        ordenId,
        estatusDestinoId: "s-incidente",
        ocurridoAt: "2026-08-22T14:30:00.000Z",
      },
      estado: "processing",
      intentos: 1,
      maxIntentos: 5,
      runAfter: new Date(),
      lockedAt: new Date(),
      lastError: null,
      dedupeKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const service = new WebhookEstadoService(
      ordenes,
      suscripciones,
      sender,
      config,
      () => new Date("2026-08-22T14:30:05.000Z"),
    );
    await service.ejecutar(job);
    const cuerpo = (entregar.mock.calls[0] as unknown as [string, string])[1];
    const enlace = (JSON.parse(cuerpo) as { data: { evidenciasUrl?: string } }).data.evidenciasUrl;
    expect(enlace, "el evento de incidente tiene que traer el enlace").toBeDefined();
    const segmentos = new URL(enlace as string).pathname.split("/");
    return decodeURIComponent(segmentos[segmentos.length - 1]);
  }

  it("406/R3: orden CON guia -> el segmento resuelve por `num_guia` a ESA fila", async () => {
    await conTienda(async ({ tx, tiendaId, repo }) => {
      const guia = guiaLibre();
      const remision = `REM-${SUFIJO}-CON-GUIA`;
      const ordenId = await sembrarOrden(tx, tiendaId, { numRemision: remision, numGuia: guia });
      // Una VECINA viva de la misma tienda: si el `where` se aflojara, tendria por donde colarse.
      const vecinaId = await sembrarOrden(tx, tiendaId, {
        numRemision: `REM-${SUFIJO}-VECINA`,
        numGuia: guiaLibre(),
      });

      const identificador = await identificadorDelEnlaceDe(tx, ordenId, tiendaId);
      expect(identificador).toBe(String(guia));

      const actor: Actor = { usuarioId: tiendaId, rol: "apiKey" };
      const resuelta = await new ApiOrdenResolucionService(repo).resolver(actor, identificador);

      expect(resuelta.status).toBe("ok");
      if (resuelta.status !== "ok") throw new Error("inalcanzable"); // estrecha el tipo, no un guard
      expect(resuelta.orden.id).toBe(ordenId);
      expect(resuelta.orden.id).not.toBe(vecinaId);
      expect(resuelta.via).toBe("num_guia");

      // Y el SQL, a pelo: la consulta devuelve EXACTAMENTE la fila sembrada.
      const filas = await repo.findByGuiaORemisionForOwner(
        { numGuia: guia, numRemision: identificador },
        tiendaId,
      );
      expect(filas).toEqual([{ id: ordenId, numGuia: guia, numRemision: remision }]);
    });
  });

  it("406/R3: orden SIN guia -> el segmento resuelve por `num_remision` a ESA fila", async () => {
    await conTienda(async ({ tx, tiendaId, repo }) => {
      const remision = `REM-${SUFIJO}-SIN-GUIA`;
      const ordenId = await sembrarOrden(tx, tiendaId, { numRemision: remision, numGuia: null });
      const vecinaId = await sembrarOrden(tx, tiendaId, {
        numRemision: `REM-${SUFIJO}-VECINA-2`,
        numGuia: guiaLibre(),
      });

      const identificador = await identificadorDelEnlaceDe(tx, ordenId, tiendaId);
      expect(identificador).toBe(remision);

      const actor: Actor = { usuarioId: tiendaId, rol: "apiKey" };
      const resuelta = await new ApiOrdenResolucionService(repo).resolver(actor, identificador);

      expect(resuelta.status).toBe("ok");
      if (resuelta.status !== "ok") throw new Error("inalcanzable");
      expect(resuelta.orden.id).toBe(ordenId);
      expect(resuelta.orden.id).not.toBe(vecinaId);
      expect(resuelta.via).toBe("num_remision");

      const filas = await repo.findByGuiaORemisionForOwner(
        { numGuia: null, numRemision: identificador },
        tiendaId,
      );
      expect(filas).toEqual([{ id: ordenId, numGuia: null, numRemision: remision }]);
    });
  });

  it("406/R3: el `tienda_id` del `where` decide — la MISMA remision de OTRA tienda no se devuelve", async () => {
    await conTienda(async ({ tx, tiendaId, crearTienda, repo }) => {
      // La misma remision existe en las DOS tiendas: el indice parcial solo la hace unica POR
      // tienda, asi que este escenario es real y es el que el owner forzado tiene que separar.
      const remision = `REM-${SUFIJO}-AJENA`;
      const propiaId = await sembrarOrden(tx, tiendaId, { numRemision: remision });
      const otraTiendaId = await crearTienda();
      const ajenaId = await sembrarOrden(tx, otraTiendaId, { numRemision: remision });

      const identificador = await identificadorDelEnlaceDe(tx, propiaId, tiendaId);
      const filas = await repo.findByGuiaORemisionForOwner(
        { numGuia: null, numRemision: identificador },
        tiendaId,
      );

      expect(filas.map((f) => f.id)).toEqual([propiaId]);
      expect(filas.map((f) => f.id)).not.toContain(ajenaId);
      // CONTRAPRUEBA (si no, un id mal escrito se leeria como «la frontera funciona»): su propio
      // dueño SI la ve.
      const desdeSuDueno = await repo.findByGuiaORemisionForOwner(
        { numGuia: null, numRemision: identificador },
        otraTiendaId,
      );
      expect(desdeSuDueno.map((f) => f.id)).toEqual([ajenaId]);
    });
  });

  it("406/R3: el `deleted_at` del `where` decide — una BORRADA con esa remision no se devuelve", async () => {
    await conTienda(async ({ tx, tiendaId, repo }) => {
      const remision = `REM-${SUFIJO}-BORRADA`;
      const borradaId = await sembrarOrden(tx, tiendaId, { numRemision: remision, borrada: true });
      const vivaId = await sembrarOrden(tx, tiendaId, { numRemision: remision });

      const identificador = await identificadorDelEnlaceDe(tx, vivaId, tiendaId);
      const filas = await repo.findByGuiaORemisionForOwner(
        { numGuia: null, numRemision: identificador },
        tiendaId,
      );

      // Las DOS filas existen en la base con esa remision (el indice parcial lo permite): la
      // consulta tiene que devolver UNA, la viva.
      const enBase = await tx.orden.findMany({
        where: { tiendaId, numRemision: remision },
        select: { id: true },
      });
      expect(enBase).toHaveLength(2);
      expect(filas.map((f) => f.id)).toEqual([vivaId]);
      expect(filas.map((f) => f.id)).not.toContain(borradaId);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
import {
  emitirWebhooksEstado,
  type WebhookEmisor,
} from "@/lib/services/jobs/webhook-estado-encolado";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { CambioEstadoEntrada } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { OrderStatusValue } from "@/lib/types/order-status";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 99 (R10/R11/R12/R16/R25) — emision transactional-outbox desde el choke point
// `appendCambioEstado`. Prisma/tx mockeados con SEMANTICA (patron tests/integration): el
// `tx.$queryRaw` resuelve §5 (owner suscrito activo Y rol apiKey) y el `value` del destino;
// `repo.enqueue` va espiado. El emisor inyectado envuelve el emisor REAL (emitirWebhooksEstado),
// asi el test recorre append -> emitir -> enqueue de punta a punta.

const VALUE_POR_ID: Record<string, string> = {
  [idEstado("entregada")]: "entregada",
  [idEstado("en_ruta")]: "en_ruta",
  [idEstado("en_ruta_bodega_central")]: "en_ruta_bodega_central",
};

// Feature 140: la guardia del choke point valida el par `origen -> destino` contra
// `TRANSICIONES` (fallo CERRADO), asi que cada destino de este test se emite desde SU origen
// legal del mapa: `en_ruta -> entregada` (#12) y `por_recoger -> en_ruta` (#11). La creacion
// (`carga_api`) nace en `en_ruta_bodega_central`, uno de los tres ESTADOS_CREACION (A.1) y
// ademas evento publico, que es lo que este test necesita para ver el encolado; ese caso NO
// lleva entrada aqui: su `estatusOrigenId` es `null` (A.1), asi que nunca consulta este mapa.
const ORIGEN_LEGAL: Record<string, OrderStatusValue> = {
  [idEstado("entregada")]: "en_ruta",
  [idEstado("en_ruta")]: "por_recoger",
};

beforeEach(async () => {
  await sembrarCatalogoEstados();
});

function buildTx(elegibles: Set<string>) {
  const createMany = vi.fn(async () => ({ count: 1 }));
  const $queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join(" ");
    const args = values.flatMap((v) => {
      const inner = (v as { values?: unknown[] })?.values;
      return Array.isArray(inner) ? inner : [v];
    });
    if (sql.includes("webhook_suscripcion")) {
      return args.filter((id) => elegibles.has(id as string)).map((id) => ({ orden_id: id }));
    }
    if (sql.includes("order_status")) {
      return args
        .filter((id) => VALUE_POR_ID[id as string] !== undefined)
        .map((id) => ({ id, value: VALUE_POR_ID[id as string] }));
    }
    return [];
  });
  const tx = { ordenHistorialEstado: { createMany }, $queryRaw, $executeRaw: vi.fn() };
  return { tx, createMany, $queryRaw };
}

function buildRepo() {
  const enqueue = vi.fn<(...args: unknown[]) => Promise<null>>(async () => null);
  return { repo: { enqueue } as unknown as IJobRepository, enqueue };
}

function emisorReal(repo: IJobRepository, now?: () => Date): WebhookEmisor {
  return (tx, entradas) => emitirWebhooksEstado(tx, entradas, repo, now);
}

function entrada(
  ordenId: string,
  estatusDestinoId: string,
  origenTipo: CambioEstadoEntrada["origenTipo"] = "gestion",
): CambioEstadoEntrada {
  return {
    ordenId,
    estatusOrigenId:
      origenTipo === "carga_masiva" || origenTipo === "carga_api"
        ? null // creacion (A.1)
        : idEstado(ORIGEN_LEGAL[estatusDestinoId]),
    estatusDestinoId,
    actorUsuarioId: "u1",
    origenTipo,
  };
}

describe("R10 — transicion de orden con owner suscrito deja job pendiente", () => {
  it("una transicion de una orden con owner suscrito (apiKey, activa) encola un webhook_estado", async () => {
    const { tx, createMany } = buildTx(new Set(["o1"]));
    const { repo, enqueue } = buildRepo();
    await appendCambioEstado(
      tx as never,
      [entrada("o1", idEstado("entregada"))],
      emisorReal(repo, () => new Date("2026-07-21T10:00:00.000Z")),
    );
    expect(createMany).toHaveBeenCalledTimes(1); // append del historial
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toBe("webhook_estado");
    expect(enqueue.mock.calls[0][3]).toBe(tx); // outbox: mismo tx (R11)
  });
});

describe("R11 — si el cambio de estado falla no queda job huerfano", () => {
  it("si el createMany del historial revierte, el emisor no llega a encolar", async () => {
    const { tx, createMany } = buildTx(new Set(["o1"]));
    createMany.mockRejectedValueOnce(new Error("tx abortada"));
    const { repo, enqueue } = buildRepo();
    await expect(
      appendCambioEstado(tx as never, [entrada("o1", idEstado("entregada"))], emisorReal(repo)),
    ).rejects.toThrow("tx abortada");
    expect(enqueue).not.toHaveBeenCalled(); // ningun job encolado
  });
});

describe("R12 — solo owner rol apiKey con suscripcion activa", () => {
  it("no encola para una orden cuyo owner no es elegible (sin sub / no apiKey)", async () => {
    const { tx } = buildTx(new Set()); // §5 devuelve vacio (adminTienda o sin suscripcion)
    const { repo, enqueue } = buildRepo();
    await appendCambioEstado(tx as never, [entrada("o1", idEstado("entregada"))], emisorReal(repo));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("de un lote mixto, solo encola las ordenes elegibles", async () => {
    const { tx } = buildTx(new Set(["o-api"])); // o-adminTienda no es elegible
    const { repo, enqueue } = buildRepo();
    await appendCambioEstado(
      tx as never,
      [entrada("o-api", idEstado("entregada")), entrada("o-adminTienda", idEstado("entregada"))],
      emisorReal(repo),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][1]).toMatchObject({ ordenId: "o-api" });
  });
});

describe("R16 — transiciones por dos mecanismos encolan por igual", () => {
  it("creacion (carga por API) y gestion encolan ambas al pasar por el mismo choke point", async () => {
    const { repo, enqueue } = buildRepo();
    const a = buildTx(new Set(["o-creada"]));
    await appendCambioEstado(
      a.tx as never,
      [entrada("o-creada", idEstado("en_ruta_bodega_central"), "carga_api")],
      emisorReal(repo),
    );
    const b = buildTx(new Set(["o-gestion"]));
    await appendCambioEstado(
      b.tx as never,
      [entrada("o-gestion", idEstado("entregada"), "gestion")],
      emisorReal(repo),
    );
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls.map((c) => (c[1] as { ordenId: string }).ordenId).sort()).toEqual([
      "o-creada",
      "o-gestion",
    ]);
  });
});

describe("R25 — con dos owners suscritos cada job lleva su propia orden", () => {
  it("dos ordenes de dos owners distintos producen dos jobs, cada uno con su ordenId", async () => {
    const { tx } = buildTx(new Set(["o-ownerA", "o-ownerB"]));
    const { repo, enqueue } = buildRepo();
    await appendCambioEstado(
      tx as never,
      [entrada("o-ownerA", idEstado("entregada")), entrada("o-ownerB", idEstado("en_ruta"))],
      emisorReal(repo),
    );
    expect(enqueue).toHaveBeenCalledTimes(2);
    const ordenIds = enqueue.mock.calls.map((c) => (c[1] as { ordenId: string }).ordenId).sort();
    expect(ordenIds).toEqual(["o-ownerA", "o-ownerB"]);
  });
});

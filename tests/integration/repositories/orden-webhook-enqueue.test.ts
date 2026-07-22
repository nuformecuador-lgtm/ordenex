import { describe, it, expect, vi } from "vitest";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
import {
  emitirWebhooksEstado,
  type WebhookEmisor,
} from "@/lib/services/jobs/webhook-estado-encolado";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { CambioEstadoEntrada } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";

// Feature 99 (R10/R11/R12/R16/R25) — emision transactional-outbox desde el choke point
// `appendCambioEstado`. Prisma/tx mockeados con SEMANTICA (patron tests/integration): el
// `tx.$queryRaw` resuelve §5 (owner suscrito activo Y rol apiKey) y el `value` del destino;
// `repo.enqueue` va espiado. El emisor inyectado envuelve el emisor REAL (emitirWebhooksEstado),
// asi el test recorre append -> emitir -> enqueue de punta a punta.

const VALUE_POR_ID: Record<string, string> = {
  "s-entregada": "entregada",
  "s-en-reparto": "en_reparto",
};

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
    estatusOrigenId: origenTipo === "carga_masiva" ? null : "s-previo",
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
      [entrada("o1", "s-entregada")],
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
      appendCambioEstado(tx as never, [entrada("o1", "s-entregada")], emisorReal(repo)),
    ).rejects.toThrow("tx abortada");
    expect(enqueue).not.toHaveBeenCalled(); // ningun job encolado
  });
});

describe("R12 — solo owner rol apiKey con suscripcion activa", () => {
  it("no encola para una orden cuyo owner no es elegible (sin sub / no apiKey)", async () => {
    const { tx } = buildTx(new Set()); // §5 devuelve vacio (adminTienda o sin suscripcion)
    const { repo, enqueue } = buildRepo();
    await appendCambioEstado(tx as never, [entrada("o1", "s-entregada")], emisorReal(repo));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("de un lote mixto, solo encola las ordenes elegibles", async () => {
    const { tx } = buildTx(new Set(["o-api"])); // o-adminTienda no es elegible
    const { repo, enqueue } = buildRepo();
    await appendCambioEstado(
      tx as never,
      [entrada("o-api", "s-entregada"), entrada("o-adminTienda", "s-entregada")],
      emisorReal(repo),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][1]).toMatchObject({ ordenId: "o-api" });
  });
});

describe("R16 — transiciones por dos mecanismos encolan por igual", () => {
  it("creacion (carga_masiva) y gestion encolan ambas al pasar por el mismo choke point", async () => {
    const { repo, enqueue } = buildRepo();
    const a = buildTx(new Set(["o-creada"]));
    await appendCambioEstado(
      a.tx as never,
      [entrada("o-creada", "s-en-reparto", "carga_masiva")],
      emisorReal(repo),
    );
    const b = buildTx(new Set(["o-gestion"]));
    await appendCambioEstado(
      b.tx as never,
      [entrada("o-gestion", "s-entregada", "gestion")],
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
      [entrada("o-ownerA", "s-entregada"), entrada("o-ownerB", "s-en-reparto")],
      emisorReal(repo),
    );
    expect(enqueue).toHaveBeenCalledTimes(2);
    const ordenIds = enqueue.mock.calls.map((c) => (c[1] as { ordenId: string }).ordenId).sort();
    expect(ordenIds).toEqual(["o-ownerA", "o-ownerB"]);
  });
});

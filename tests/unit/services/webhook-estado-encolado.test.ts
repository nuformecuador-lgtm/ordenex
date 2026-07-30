import { describe, it, expect, vi } from "vitest";
import {
  dedupeKeyWebhookEstado,
  emitirWebhooksEstado,
  MAX_INTENTOS_WEBHOOK,
  type WebhookEmisorTx,
} from "@/lib/services/jobs/webhook-estado-encolado";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { CambioEstadoEntrada } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";

// Feature 99 (R13/R14/R15/R27) — helper de emision. Fake `tx.$queryRaw` con semantica: la
// 1.a consulta (§5) resuelve las ordenes con owner suscrito activo y rol apiKey; la 2.a
// resuelve el `value` del estatus destino. `repo.enqueue` va espiado.

/** Mapa estatusDestinoId -> value del catalogo. */
const VALUE_POR_ID: Record<string, string> = {
  "s-entregada": "entregada", // publico
  "s-en-reparto": "en_reparto", // publico
  "s-fulfillment": "en_preparacion", // NO publico (interno de preparacion en bodega)
};

function buildTx(ordenesElegibles: Set<string>): WebhookEmisorTx {
  const $queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join(" ");
    const args = values.flatMap((v) => {
      const inner = (v as { values?: unknown[] })?.values;
      return Array.isArray(inner) ? inner : [v];
    });
    if (sql.includes("webhook_suscripcion")) {
      // §5: solo las ordenes elegibles (owner suscrito activo Y rol apiKey).
      return args.filter((id) => ordenesElegibles.has(id as string)).map((id) => ({ orden_id: id }));
    }
    if (sql.includes("order_status")) {
      return args
        .filter((id) => VALUE_POR_ID[id as string] !== undefined)
        .map((id) => ({ id, value: VALUE_POR_ID[id as string] }));
    }
    return [];
  });
  return { $queryRaw, $executeRaw: vi.fn() } as unknown as WebhookEmisorTx;
}

function buildRepo() {
  const enqueue = vi.fn(async () => null);
  const repo = { enqueue } as unknown as IJobRepository;
  return { repo, enqueue };
}

function entrada(ordenId: string, estatusDestinoId: string): CambioEstadoEntrada {
  return {
    ordenId,
    estatusOrigenId: "s-previo",
    estatusDestinoId,
    actorUsuarioId: "u1",
    origenTipo: "gestion",
  };
}

describe("R14 — dedupeKey por evento unico", () => {
  it("dos transiciones distintas (incluida la repeticion del mismo estado) producen claves distintas", () => {
    // Dos ordenes distintas al mismo estado -> distinto.
    expect(dedupeKeyWebhookEstado("o1", "s-entregada", "2026-07-21T00:00:00.000Z")).not.toBe(
      dedupeKeyWebhookEstado("o2", "s-entregada", "2026-07-21T00:00:00.000Z"),
    );
    // Misma orden que REINGRESA al mismo estado en dos instantes -> distinto (el instante
    // desambigua; sin el, el ON CONFLICT descartaria el 2.o evento en silencio).
    expect(dedupeKeyWebhookEstado("o1", "s-entregada", "2026-07-21T00:00:00.000Z")).not.toBe(
      dedupeKeyWebhookEstado("o1", "s-entregada", "2026-07-21T01:00:00.000Z"),
    );
    // Determinista: misma entrada -> misma clave.
    expect(dedupeKeyWebhookEstado("o1", "s1", "t")).toBe(dedupeKeyWebhookEstado("o1", "s1", "t"));
  });
});

describe("R13/R27 — payload minimo y maxIntentos=5", () => {
  it("el payload lleva ordenId/estatusDestinoId/ocurridoAt y NO lleva secreto; maxIntentos=5", async () => {
    const { repo, enqueue } = buildRepo();
    const tx = buildTx(new Set(["o1"]));
    const now = () => new Date("2026-07-21T10:00:00.000Z");

    await emitirWebhooksEstado(tx, [entrada("o1", "s-entregada")], repo, now);

    expect(enqueue).toHaveBeenCalledTimes(1);
    const [tipo, payload, opts, txArg] = enqueue.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      { maxIntentos: number; dedupeKey: string },
      unknown,
    ];
    expect(tipo).toBe("webhook_estado");
    expect(payload).toEqual({
      ordenId: "o1",
      estatusDestinoId: "s-entregada",
      ocurridoAt: "2026-07-21T10:00:00.000Z",
    });
    expect(JSON.stringify(payload)).not.toMatch(/secret/i); // R13: sin secreto
    expect(opts.maxIntentos).toBe(MAX_INTENTOS_WEBHOOK);
    expect(opts.maxIntentos).toBe(5); // R27/D5
    expect(opts.dedupeKey).toBe(
      dedupeKeyWebhookEstado("o1", "s-entregada", "2026-07-21T10:00:00.000Z"),
    );
    expect(txArg).toBe(tx); // outbox: encola DENTRO de la misma tx (R11)
  });
});

describe("R15 — politica EVENTOS_PUBLICOS", () => {
  it("un estado dentro de EVENTOS_PUBLICOS emite y uno fuera de ella no", async () => {
    const { repo, enqueue } = buildRepo();
    const tx = buildTx(new Set(["o1", "o2"]));

    await emitirWebhooksEstado(
      tx,
      [entrada("o1", "s-en-reparto"), entrada("o2", "s-fulfillment")],
      repo,
    );

    // Solo la transicion publica (en_reparto) encola; la interna (en_preparacion) no.
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect((enqueue.mock.calls[0] as unknown as unknown[])[1]).toMatchObject({ ordenId: "o1" });
  });
});

describe("R12 — solo ordenes elegibles (owner suscrito activo y rol apiKey)", () => {
  it("no encola nada si ninguna orden del lote es elegible", async () => {
    const { repo, enqueue } = buildRepo();
    const tx = buildTx(new Set()); // sin suscripciones -> §5 vacio
    await emitirWebhooksEstado(tx, [entrada("o1", "s-entregada")], repo);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
import { emitirWebhooksEstado } from "@/lib/services/jobs/webhook-estado-encolado";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { CambioEstadoEntrada } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 266 (T6.2, R17) — LA RAMA A SI NOTIFICA, Y AQUI SE AFIRMA EN VEZ DE ASUMIRSE.
//
// No hay codigo de emision nuevo en esta feature: la transicion pasa por `appendCambioEstado`
// (el choke point), que en la MISMA transaccion invoca al emisor, y el emisor pregunta a la
// POLITICA (`esTransicionEmitible`). Con `dev` de hoy `en_reparto` es evento publico y la lista
// de familias exceptuadas esta VACIA desde la 268, asi que `habilitacion_api` emite **por no
// haber sido anadida a ninguna lista**. Eso es exactamente lo que hace fragil el resultado —una
// no-accion no deja rastro— y por eso se afirma de extremo a extremo, con el emisor REAL y solo
// el `JobRepository` falso.
//
// ⚠️ EL ESPEJO DE LA RAMA B NO ESTA AQUI, Y NO ES UN OLVIDO: la rama B no produce transicion, asi
// que no existe ninguna entrada que pasarle a este choke point. Se afirma donde se puede afirmar,
// en el service (`transicionarAyuda` NO llamado) -> R22.

const ORDEN_ID = "o-266";
const ID_AYUDA = idEstado("ayuda_tienda");
const ID_EN_REPARTO = idEstado("en_reparto");

/** La entrada EXACTA que la rama A del service produce via `transicionarAyuda`. */
function entradaRamaA(): CambioEstadoEntrada {
  return {
    ordenId: ORDEN_ID,
    estatusOrigenId: ID_AYUDA,
    estatusDestinoId: ID_EN_REPARTO,
    actorUsuarioId: "store-1", // el usuario dedicado de la key
    origenTipo: "habilitacion_api",
  };
}

/**
 * `tx` con SEMANTICA para las dos consultas del emisor: la de elegibilidad (§5, owner suscrito
 * activo con rol `apiKey`) y la del catalogo del estado destino. La del guardia de transiciones
 * la resuelve la cache, sembrada en `beforeEach`.
 */
function buildTx(ordenesElegibles: string[]) {
  const createMany = vi.fn(async () => ({ count: 1 }));
  const $queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join(" ");
    const args = values.flatMap((v) => {
      const inner = (v as { values?: unknown[] })?.values;
      return Array.isArray(inner) ? inner : [v];
    });
    if (sql.includes("webhook_suscripcion")) {
      return args.filter((id) => ordenesElegibles.includes(id as string)).map((id) => ({
        orden_id: id,
      }));
    }
    if (sql.includes("order_status")) {
      return [{ id: ID_EN_REPARTO, value: "en_reparto" }];
    }
    return [];
  });
  return { tx: { ordenHistorialEstado: { createMany }, $queryRaw, $executeRaw: vi.fn() }, createMany };
}

function buildJobRepo() {
  const enqueue = vi.fn(async () => null);
  return { repo: { enqueue } as unknown as IJobRepository, enqueue };
}

beforeEach(async () => {
  await sembrarCatalogoEstados();
});

describe("266/R17 — la habilitacion por API que devuelve la orden a `en_reparto` encola su webhook", () => {
  it("una entrada `habilitacion_api` hacia `en_reparto` encola UN job `webhook_estado` para esa orden", async () => {
    const { tx, createMany } = buildTx([ORDEN_ID]);
    const { repo, enqueue } = buildJobRepo();
    const emitir = (txArg: never, entradas: CambioEstadoEntrada[]) =>
      emitirWebhooksEstado(txArg, entradas, repo, () => new Date("2026-08-23T10:00:00.000Z"));

    await appendCambioEstado(
      tx as never,
      [entradaRamaA()],
      emitir as never,
      undefined,
      async () => {}, // notificaciones internas fuera de alcance de este assert
    );

    expect(createMany).toHaveBeenCalledTimes(1); // la fila de historial existe
    expect(enqueue).toHaveBeenCalledTimes(1); // R17: UN job, ni cero ni dos
    const [tipo, payload] = enqueue.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(tipo).toBe("webhook_estado");
    expect(payload).toMatchObject({ ordenId: ORDEN_ID, estatusDestinoId: ID_EN_REPARTO });
  });

  it("la familia `habilitacion_api` no esta exceptuada: emite igual que el rescate del boton", async () => {
    // El control que detecta una exencion por familia reintroducida a escondidas. Mismo `tx`,
    // misma orden, mismo estado destino: lo unico que cambia entre las dos entradas es la familia,
    // y las dos tienen que encolar.
    const { tx } = buildTx([ORDEN_ID]);
    const { repo, enqueue } = buildJobRepo();
    const emitir = (txArg: never, entradas: CambioEstadoEntrada[]) =>
      emitirWebhooksEstado(txArg, entradas, repo, () => new Date("2026-08-23T11:00:00.000Z"));

    await appendCambioEstado(tx as never, [entradaRamaA()], emitir as never, undefined, async () => {});
    await appendCambioEstado(
      tx as never,
      [{ ...entradaRamaA(), origenTipo: "rescate_ayuda_tienda" }],
      emitir as never,
      undefined,
      async () => {},
    );

    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it("sin integrador suscrito no se encola nada, aunque la transicion se registre", async () => {
    // La emision es POR SUSCRIPCION, no por familia: la orden se transiciona igual.
    const { tx, createMany } = buildTx([]); // ninguna orden elegible
    const { repo, enqueue } = buildJobRepo();
    const emitir = (txArg: never, entradas: CambioEstadoEntrada[]) =>
      emitirWebhooksEstado(txArg, entradas, repo);

    await appendCambioEstado(tx as never, [entradaRamaA()], emitir as never, undefined, async () => {});

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

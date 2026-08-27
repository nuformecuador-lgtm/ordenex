import { describe, it, expect, vi } from "vitest";
import {
  dedupeKeyBienvenida,
  emitirBienvenidaRecogida,
  MAX_INTENTOS_BIENVENIDA,
  type BienvenidaEmisorTx,
} from "@/lib/services/jobs/whatsapp-bienvenida-encolado";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { CambioEstadoEntrada } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { OrderStatusValue } from "@/lib/types/order-status";

// MENSAJE DE BIENVENIDA — encolado desde el choke point de transiciones.
//
// Lo que fija esta suite: que el envio se dispara SOLO al recoger, que no cuesta nada en el
// resto de transiciones del sistema (este emisor corre en TODAS), y que dos recogidas de la
// misma orden encolan DOS jobs — la decision humana fue «se reenvia cada vez que se recoge», y
// esa es justo la que una `dedupeKey` sin instante mataria en silencio.

const EN_REPARTO_ID = "est-en-reparto";
const ENTREGADA_ID = "est-entregada";
const POR_RECOGER_ID = "est-por-recoger";

const VALUES: ReadonlyMap<string, OrderStatusValue> = new Map<string, OrderStatusValue>([
  [EN_REPARTO_ID, "en_reparto"],
  [ENTREGADA_ID, "entregada"],
  [POR_RECOGER_ID, "por_recoger"],
]);

const AHORA = new Date("2026-08-27T15:00:00.000Z");
const AHORA_ISO = AHORA.toISOString();

function recogida(ordenId: string, mensajeroId = "men-1"): CambioEstadoEntrada {
  return {
    ordenId,
    estatusOrigenId: POR_RECOGER_ID,
    estatusDestinoId: EN_REPARTO_ID,
    actorUsuarioId: mensajeroId,
    origenTipo: "recoleccion",
  };
}

/**
 * `tx` fake: el emisor solo usa `$queryRaw`; `$executeRaw` esta para satisfacer el tipo.
 * El cast es por el generico de `$queryRaw<T>`, que un `vi.fn` no puede expresar.
 */
function fakeTx(filas: unknown[]) {
  const $queryRaw = vi.fn(async () => filas);
  const $executeRaw = vi.fn(async () => 0);
  const tx = { $queryRaw, $executeRaw } as unknown as BienvenidaEmisorTx;
  return Object.assign(tx, { $queryRaw, $executeRaw });
}

function fakeRepo(): IJobRepository {
  return { enqueue: vi.fn(async () => null) } as unknown as IJobRepository;
}

describe("emitirBienvenidaRecogida · cuando SI encola", () => {
  it("una recogida con bienvenida configurada encola el job con su payload y su clave", async () => {
    const tx = fakeTx([{ id: "plt-1" }]);
    const repo = fakeRepo();

    await emitirBienvenidaRecogida(tx, [recogida("orden-1")], VALUES, repo, () => AHORA);

    expect(repo.enqueue).toHaveBeenCalledTimes(1);
    expect(repo.enqueue).toHaveBeenCalledWith(
      "whatsapp_bienvenida",
      { ordenId: "orden-1", mensajeroId: "men-1", ocurridoAt: AHORA_ISO },
      {
        dedupeKey: dedupeKeyBienvenida("orden-1", AHORA_ISO),
        maxIntentos: MAX_INTENTOS_BIENVENIDA,
      },
      tx, // transactional outbox: si la recogida revierte, el job se va con ella
    );
  });

  it("el payload NO lleva PII ni el id de la plantilla (se relee al enviar)", async () => {
    const tx = fakeTx([{ id: "plt-1" }]);
    const repo = fakeRepo();

    await emitirBienvenidaRecogida(tx, [recogida("orden-1")], VALUES, repo, () => AHORA);

    const payload = (repo.enqueue as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(["mensajeroId", "ocurridoAt", "ordenId"]);
  });

  it("un lote de dos ordenes encola dos jobs con claves distintas", async () => {
    const tx = fakeTx([{ id: "plt-1" }]);
    const repo = fakeRepo();

    await emitirBienvenidaRecogida(
      tx,
      [recogida("orden-1"), recogida("orden-2")],
      VALUES,
      repo,
      () => AHORA,
    );

    expect(repo.enqueue).toHaveBeenCalledTimes(2);
    const claves = (repo.enqueue as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[2].dedupeKey,
    );
    expect(new Set(claves).size).toBe(2); // mismo instante, distinta orden
  });

  it("⚠️ dos recogidas de la MISMA orden en instantes distintos encolan DOS jobs", async () => {
    // La decision humana fue «se reenvia cada vez que se recoge»: una orden reprogramada que
    // vuelve a salir avisa otra vez. Con una clave sin instante, el `ON CONFLICT DO NOTHING`
    // chocaria contra la fila `done` de la primera y descartaria la segunda EN SILENCIO —sin
    // excepcion, sin log y sin fila—, porque el indice unico de `dedupe_key` no esta acotado
    // por estado y las filas de `jobs` no se purgan. Este test es el que blinda eso.
    const repo = fakeRepo();
    const despues = new Date(AHORA.getTime() + 3 * 60 * 60 * 1000);

    await emitirBienvenidaRecogida(fakeTx([{ id: "plt-1" }]), [recogida("orden-1")], VALUES, repo, () => AHORA);
    await emitirBienvenidaRecogida(fakeTx([{ id: "plt-1" }]), [recogida("orden-1")], VALUES, repo, () => despues);

    expect(repo.enqueue).toHaveBeenCalledTimes(2);
    const [primera, segunda] = (repo.enqueue as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[2].dedupeKey,
    );
    expect(primera).not.toBe(segunda);
  });
});

describe("emitirBienvenidaRecogida · cuando NO encola", () => {
  it("sin plantilla marcada: ni un job (no es un fallo, es que no esta configurada)", async () => {
    const tx = fakeTx([]);
    const repo = fakeRepo();

    await emitirBienvenidaRecogida(tx, [recogida("orden-1")], VALUES, repo, () => AHORA);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1); // si pregunto...
    expect(repo.enqueue).not.toHaveBeenCalled(); // ...pero no encolo nada
  });

  it("otra familia de transicion: NI SIQUIERA consulta la base", async () => {
    // Este emisor cuelga del choke point, asi que corre en TODA transicion del sistema. El
    // caso mayoritario tiene que costar cero consultas.
    const tx = fakeTx([{ id: "plt-1" }]);
    const repo = fakeRepo();

    await emitirBienvenidaRecogida(
      tx,
      [
        {
          ordenId: "orden-1",
          estatusOrigenId: EN_REPARTO_ID,
          estatusDestinoId: ENTREGADA_ID,
          actorUsuarioId: "men-1",
          origenTipo: "gestion",
        },
      ],
      VALUES,
      repo,
      () => AHORA,
    );

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(repo.enqueue).not.toHaveBeenCalled();
  });

  it("destino `en_reparto` pero origen `rescate_ayuda_tienda`: no es una recogida", async () => {
    // Rescatar una orden detenida en ayuda tambien aterriza en `en_reparto`, pero el paquete
    // no se acaba de recoger: el cliente ya recibio su bienvenida cuando salio la primera vez.
    const tx = fakeTx([{ id: "plt-1" }]);
    const repo = fakeRepo();

    await emitirBienvenidaRecogida(
      tx,
      [
        {
          ordenId: "orden-1",
          estatusOrigenId: "est-ayuda",
          estatusDestinoId: EN_REPARTO_ID,
          actorUsuarioId: "adm-1",
          origenTipo: "rescate_ayuda_tienda",
        },
      ],
      VALUES,
      repo,
      () => AHORA,
    );

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(repo.enqueue).not.toHaveBeenCalled();
  });

  it("recoleccion sin actor: se salta (el envio necesita el mensajero como scope)", async () => {
    const tx = fakeTx([{ id: "plt-1" }]);
    const repo = fakeRepo();

    await emitirBienvenidaRecogida(
      tx,
      [{ ...recogida("orden-1"), actorUsuarioId: null }],
      VALUES,
      repo,
      () => AHORA,
    );

    expect(repo.enqueue).not.toHaveBeenCalled();
  });

  it("lote vacio: no hace nada", async () => {
    const tx = fakeTx([{ id: "plt-1" }]);
    const repo = fakeRepo();

    await emitirBienvenidaRecogida(tx, [], VALUES, repo, () => AHORA);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(repo.enqueue).not.toHaveBeenCalled();
  });
});

describe("dedupeKeyBienvenida", () => {
  it("lleva prefijo, orden e INSTANTE", () => {
    expect(dedupeKeyBienvenida("orden-1", AHORA_ISO)).toBe(
      `whatsapp_bienvenida:orden-1:${AHORA_ISO}`,
    );
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  appendCambioEstado,
  resetCatalogoEstadosCache,
} from "@/lib/repositories/registrar-cambio-estado";
import type { CambioEstadoEntrada } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import { filasCatalogoEstados, idEstado } from "@/tests/fixtures/catalogo-estados";

// MENSAJE DE BIENVENIDA — el enganche en el choke point de transiciones.
//
// Esta suite no comprueba QUE se encola (eso es `whatsapp-bienvenida-encolado.test.ts`), sino
// que el choke point LLAMA al emisor, con que datos, en que momento, y que el parametro nuevo
// no cambia la firma para los ~18 call-sites historicos, que llaman con dos argumentos.

function buildTx() {
  const createMany = vi.fn(async (arg: { data: unknown[] }) => ({ count: arg.data.length }));
  const $queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
    return strings.join(" ").includes("order_status") ? filasCatalogoEstados() : [];
  });
  return { ordenHistorialEstado: { createMany }, $queryRaw, $executeRaw: vi.fn() };
}

function recogida(ordenId = "o1"): CambioEstadoEntrada {
  return {
    ordenId,
    estatusOrigenId: idEstado("por_recoger"),
    estatusDestinoId: idEstado("en_reparto"),
    actorUsuarioId: "men-1",
    origenTipo: "recoleccion",
  };
}

/** Emisores neutros para los tres hermanos, que aqui no interesan. */
const noop = vi.fn(async () => {});

beforeEach(() => {
  resetCatalogoEstadosCache();
  noop.mockClear();
});

describe("appendCambioEstado invoca al emisor de bienvenida", () => {
  it("le pasa las entradas y el catalogo YA resuelto (id -> value)", async () => {
    const tx = buildTx();
    const emitirBienvenida = vi.fn(async () => {});

    await appendCambioEstado(
      tx as never,
      [recogida()],
      noop,
      undefined,
      noop,
      emitirBienvenida,
    );

    expect(emitirBienvenida).toHaveBeenCalledTimes(1);
    const [txRecibido, entradas, valuePorEstatusId] = emitirBienvenida.mock.calls[0] as never[];
    expect(txRecibido).toBe(tx); // el MISMO tx: el encolado va en la transaccion de la recogida
    expect(entradas).toHaveLength(1);
    // El emisor no tiene que resolver el catalogo por su cuenta: se lo dan hecho.
    expect(
      (valuePorEstatusId as ReadonlyMap<string, string>).get(idEstado("en_reparto")),
    ).toBe("en_reparto");
  });

  it("se invoca DESPUES de escribir el historial (nunca antes)", async () => {
    const tx = buildTx();
    const orden: string[] = [];
    tx.ordenHistorialEstado.createMany = vi.fn(async (arg: { data: unknown[] }) => {
      orden.push("historial");
      return { count: arg.data.length };
    });
    const emitirBienvenida = vi.fn(async () => {
      orden.push("bienvenida");
    });

    await appendCambioEstado(tx as never, [recogida()], noop, undefined, noop, emitirBienvenida);

    expect(orden).toEqual(["historial", "bienvenida"]);
  });

  it("una transicion ILEGAL no llega al emisor: no hay historial ni bienvenida", async () => {
    // La guardia de la 140 lanza antes de escribir nada. Sin esto, un cambio de estado
    // rechazado podria mandarle igualmente un WhatsApp al cliente.
    const tx = buildTx();
    const emitirBienvenida = vi.fn(async () => {});

    await expect(
      appendCambioEstado(
        tx as never,
        [
          {
            ordenId: "o1",
            estatusOrigenId: idEstado("entregada"),
            estatusDestinoId: idEstado("por_recoger"),
            actorUsuarioId: "men-1",
            origenTipo: "recoleccion",
          },
        ],
        noop,
        undefined,
        noop,
        emitirBienvenida,
      ),
    ).rejects.toThrow();

    expect(emitirBienvenida).not.toHaveBeenCalled();
  });

  it("lote vacio: no se invoca (no-op temprano del choke point)", async () => {
    const emitirBienvenida = vi.fn(async () => {});
    await appendCambioEstado(buildTx() as never, [], noop, undefined, noop, emitirBienvenida);
    expect(emitirBienvenida).not.toHaveBeenCalled();
  });
});

describe("el parametro nuevo no rompe a los call-sites historicos", () => {
  it("una llamada de DOS argumentos sigue funcionando, con los emisores REALES", async () => {
    // Los ~18 call-sites llaman `appendCambioEstado(tx, [...])`: si el parametro nuevo no
    // tuviera default real, o su default lanzara, se caerian todos. Aqui no se inyecta ningun
    // emisor, asi que corre `emisorBienvenidaReal` de verdad; el `$queryRaw` del doble responde
    // el catalogo y una lista vacia de plantillas, o sea "no hay bienvenida marcada" -> retorna
    // sin encolar.
    const tx = buildTx();
    await expect(appendCambioEstado(tx as never, [recogida()])).resolves.toBeUndefined();
    expect(tx.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
  });

  it("un `tx` sin `$queryRaw` (mock legado) no revienta al emisor de bienvenida", async () => {
    // Las suites historicas de los call-sites mockean `tx` con solo `ordenHistorialEstado`.
    // Con el catalogo inyectado —que es como lo hacen— el guard defensivo del emisor tiene que
    // dejar pasar la llamada sin tocar nada.
    const tx = { ordenHistorialEstado: { createMany: vi.fn(async () => ({ count: 1 })) } };
    const catalogo = async () =>
      new Map([[idEstado("en_reparto"), "en_reparto" as const], [idEstado("por_recoger"), "por_recoger" as const]]);

    await expect(
      appendCambioEstado(tx as never, [recogida()], noop, catalogo, noop),
    ).resolves.toBeUndefined();
  });
});

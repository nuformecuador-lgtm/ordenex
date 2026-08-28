// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";

import type { CursorHilo } from "@/lib/types/historico-conversaciones";
import { HistoricoConversacionesModule } from "@/app/(app)/historico/conversaciones/_components/HistoricoConversacionesModule";

import {
  AHORA,
  dispararCentinela,
  hilo,
  instalarObservador,
  okHilos,
  okMensajes,
  renderHistorico,
} from "./_historico-harness";

// Feature 318 / T6.1 (R11/R13/R41/R43/R44) — el LISTADO de hilos.
//
// Cuatro propiedades, y ninguna se satisface «existiendo»:
//
//   R11/R13 — la fila dice orden, destinatario y mensajero, y el centinela pide la SIGUIENTE
//     página con el cursor QUE DEVOLVIÓ el servidor (no con un número de página).
//   R41 — CARGA PEREZOSA: con el listado en pantalla y ningún hilo abierto, la acción de
//     mensajes NO se llama ni una vez. Es la mitad visible de una propiedad que el DTO ya hace
//     estructural (no tiene dónde poner mensajes).
//   R43 — el hilo que fusiona dos números lo DICE; el que tiene uno, no.
//   R44 — dos mensajeros de la misma orden son dos filas, no un duplicado.

const CURSOR_PAGINA_2: CursorHilo = {
  ultimaActividadAt: "2026-08-28T19:00:00.000Z",
  ordenId: "orden-2",
  mensajeroId: "mensajero-1",
};

const listarMensajes = vi.fn(async () => okMensajes([]));

beforeEach(() => {
  instalarObservador();
  listarMensajes.mockClear();
});

afterEach(cleanup);

function renderPantalla(listarHilos: ReturnType<typeof vi.fn>) {
  return renderHistorico(
    <HistoricoConversacionesModule
      mensajeros={[]}
      acciones={{
        listarHilos: listarHilos as never,
        listarMensajes,
      }}
      ahora={AHORA}
    />,
  );
}

/** Las filas del listado (los `<li>` de la lista de conversaciones). */
function filas(): HTMLElement[] {
  const lista = screen.queryByRole("list", { name: "Conversaciones del histórico" });
  return lista === null ? [] : within(lista).getAllByRole("listitem");
}

describe("T6.1 — el listado pinta la fila del hilo (R11)", () => {
  it("muestra guía, destinatario y mensajero de cada hilo", async () => {
    const listarHilos = vi.fn(async () => okHilos([hilo()]));
    renderPantalla(listarHilos);

    expect(await screen.findByText("María González")).toBeInTheDocument();
    expect(screen.getByText("12345")).toBeInTheDocument();
    expect(screen.getByText("Ana Mora")).toBeInTheDocument();
  });

  // La guía puede no existir: entonces la fila se identifica por la remisión (R11), que es lo
  // único que el operador tiene en la mano para esa orden.
  it("sin número de guía, la fila se identifica por la remisión", async () => {
    const listarHilos = vi.fn(async () => okHilos([hilo({ numGuia: null })]));
    renderPantalla(listarHilos);

    expect(await screen.findByText("REM-1001")).toBeInTheDocument();
  });
});

describe("T6.1 — scroll infinito con cursor (R13)", () => {
  it("al entrar el centinela en vista pide la SIGUIENTE página con el cursor devuelto", async () => {
    const listarHilos = vi
      .fn()
      .mockResolvedValueOnce(
        okHilos([hilo({ ordenId: "orden-1" }), hilo({ ordenId: "orden-2" })], CURSOR_PAGINA_2),
      )
      .mockResolvedValueOnce(
        okHilos([hilo({ ordenId: "orden-3" }), hilo({ ordenId: "orden-4" })], null),
      );

    renderPantalla(listarHilos);
    await screen.findByRole("list", { name: "Conversaciones del histórico" });
    expect(filas()).toHaveLength(2);

    await act(async () => {
      expect(dispararCentinela(screen.getByTestId("hilos-centinela"))).toBe(true);
    });

    expect(listarHilos).toHaveBeenCalledTimes(2);
    expect(listarHilos).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: CURSOR_PAGINA_2 }),
    );
    // Las dos páginas juntas, sin duplicados y sin reordenar.
    expect(filas()).toHaveLength(4);
  });

  it("sin cursor devuelto, el centinela NO vuelve a pedir: el recorrido terminó", async () => {
    const listarHilos = vi.fn(async () => okHilos([hilo()], null));
    renderPantalla(listarHilos);
    await screen.findByRole("list", { name: "Conversaciones del histórico" });

    await act(async () => {
      dispararCentinela(screen.getByTestId("hilos-centinela"));
    });

    expect(listarHilos).toHaveBeenCalledTimes(1);
  });

  // Un servidor que repitiera un hilo entre páginas dejaría dos `key` de React iguales: un
  // fallo mudo. La fila se deduplica por su clave de contrato `(orden, mensajero)`.
  it("un hilo repetido entre páginas se pinta UNA sola vez", async () => {
    const listarHilos = vi
      .fn()
      .mockResolvedValueOnce(okHilos([hilo({ ordenId: "orden-1" })], CURSOR_PAGINA_2))
      .mockResolvedValueOnce(okHilos([hilo({ ordenId: "orden-1" })], null));

    renderPantalla(listarHilos);
    await screen.findByRole("list", { name: "Conversaciones del histórico" });

    await act(async () => {
      dispararCentinela(screen.getByTestId("hilos-centinela"));
    });

    expect(filas()).toHaveLength(1);
  });
});

describe("T6.1 — carga perezosa: el listado no pide mensajes (R41)", () => {
  it("con el listado en pantalla y ningún hilo abierto, no se pide ni un mensaje", async () => {
    const listarHilos = vi.fn(async () => okHilos([hilo()]));
    renderPantalla(listarHilos);
    await screen.findByText("María González");

    expect(listarMensajes).not.toHaveBeenCalled();
  });

  it("al hacer clic en una fila se pide UNA vez la página de mensajes de ese par", async () => {
    const listarHilos = vi.fn(async () =>
      okHilos([hilo({ ordenId: "orden-9", mensajeroId: "mensajero-9" })]),
    );
    renderPantalla(listarHilos);

    fireEvent.click(await screen.findByRole("button", { name: /María González/ }));
    await act(async () => {});

    expect(listarMensajes).toHaveBeenCalledTimes(1);
    expect(listarMensajes).toHaveBeenCalledWith(
      expect.objectContaining({ ordenId: "orden-9", mensajeroId: "mensajero-9" }),
    );
  });
});

describe("T6.1 — la fusión de números se ve en la fila (R43)", () => {
  it("un hilo con dos números muestra el distintivo «2 números» y el vigente enmascarado", async () => {
    const listarHilos = vi.fn(async () =>
      okHilos([hilo({ telefonosCount: 2, telefonoVigenteMasked: "4321" })]),
    );
    renderPantalla(listarHilos);

    expect(await screen.findByText("2 números")).toBeInTheDocument();
    expect(screen.getByText("···4321")).toBeInTheDocument();
  });

  it("un hilo con un solo número NO muestra el distintivo", async () => {
    const listarHilos = vi.fn(async () => okHilos([hilo({ telefonosCount: 1 })]));
    renderPantalla(listarHilos);
    await screen.findByText("María González");

    expect(screen.queryByText(/\d+ números/)).toBeNull();
  });
});

describe("T6.1 — dos mensajeros de la misma orden son dos filas (R44)", () => {
  it("no se deduplican: cada fila lleva el nombre de su mensajero", async () => {
    const listarHilos = vi.fn(async () =>
      okHilos([
        hilo({ ordenId: "orden-1", mensajeroId: "m1", mensajeroNombre: "Ana Mora" }),
        hilo({ ordenId: "orden-1", mensajeroId: "m2", mensajeroNombre: "Luis Vargas" }),
      ]),
    );
    renderPantalla(listarHilos);

    await screen.findByText("Ana Mora");
    expect(filas()).toHaveLength(2);
    expect(screen.getByText("Luis Vargas")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { CursorHilo } from "@/lib/types/historico-conversaciones";
import { HistoricoConversacionesModule } from "@/app/(app)/historico/conversaciones/_components/HistoricoConversacionesModule";

import {
  AHORA,
  dispararCentinela,
  hilo,
  instalarObservador,
  mantenerCentinelaVisible,
  okHilos,
  okMensajes,
  renderHistorico,
} from "./_historico-harness";

// Feature 321 / T6.1 (R11/R13/R41/R43/R44) — el LISTADO de hilos.
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

const CURSOR_PAGINA_3: CursorHilo = {
  ultimaActividadAt: "2026-08-28T18:00:00.000Z",
  ordenId: "orden-3",
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

  // REGRESIÓN medida el 2026-08-31 (prod y local): el listado se paraba en seco a las dos
  // páginas, sin error, sin petición y sin nada en el log. `IntersectionObserver` sólo avisa
  // cuando la visibilidad CAMBIA, así que cuando la página que aterriza no llega a empujar el
  // centinela fuera de vista —páginas cortas, pantalla alta— no hay transición que notificar y
  // el recorrido muere. Con páginas de 5 en un panel de 642 px y filas de 61, el listado se
  // quedaba en 10 de 18 hilos.
  //
  // El caso NO simula scroll: `dispararCentinela` no se llama ni una vez. El centinela está a
  // la vista desde el principio y ahí se queda, que es la condición exacta del fallo. QUÉ
  // MUTACIÓN MATA: quitar el efecto que re-arma el observador en `HilosLista` deja el conteo
  // en 1 y el caso falla.
  it("con el panel sin desbordar, sigue pidiendo páginas sin que el usuario haga scroll", async () => {
    mantenerCentinelaVisible();
    const listarHilos = vi
      .fn()
      .mockResolvedValueOnce(
        okHilos([hilo({ ordenId: "orden-1", destinatario: "Cliente uno" })], CURSOR_PAGINA_2),
      )
      .mockResolvedValueOnce(
        okHilos([hilo({ ordenId: "orden-2", destinatario: "Cliente dos" })], CURSOR_PAGINA_3),
      )
      .mockResolvedValueOnce(
        okHilos([hilo({ ordenId: "orden-3", destinatario: "Cliente tres" })], null),
      );

    renderPantalla(listarHilos);

    // El ancla es el destinatario de la TERCERA página, no el conteo: un número de filas lo
    // cumpliría también un estado a medio camino.
    await waitFor(() => {
      expect(screen.getByText("Cliente tres")).toBeInTheDocument();
      expect(filas()).toHaveLength(3);
    });
    expect(listarHilos).toHaveBeenCalledTimes(3);
    // Y se detiene donde debe: sin cursor no se pide una cuarta.
    expect(listarHilos).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: CURSOR_PAGINA_3 }),
    );
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
  it("un hilo con dos números muestra el distintivo «2 números» y el vigente COMPLETO", async () => {
    const listarHilos = vi.fn(async () =>
      okHilos([hilo({ telefonosCount: 2, telefonoVigente: "+50688884321" })]),
    );
    renderPantalla(listarHilos);

    expect(await screen.findByText("2 números")).toBeInTheDocument();
    // Pedido humano (2026-08-31): el numero ENTERO, no `···4321`. La contraprueba es la forma
    // vieja: si volviera el enmascarado, el texto completo dejaria de estar en el DOM.
    expect(screen.getByText("+50688884321")).toBeInTheDocument();
    expect(screen.queryByText("···4321")).toBeNull();
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

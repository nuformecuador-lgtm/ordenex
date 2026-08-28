// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { HistoricoConversacionesModule } from "@/app/(app)/historico/conversaciones/_components/HistoricoConversacionesModule";
import { AVISO_FECHA_DIFERENCIADA } from "@/app/(app)/historico/conversaciones/_components/HistoricoHilo";

import {
  AHORA,
  HOY_ISO,
  hilo,
  instalarObservador,
  mensaje,
  okHilos,
  okMensajes,
  renderHistorico,
} from "./_historico-harness";

// Feature 321 / T5.4 (R39, con R17) — el filtro de fecha se comporta DIFERENCIADO.
//
// En el LISTADO el rango SELECCIONA qué hilos aparecen; en el HILO abierto NO recorta nada. Sin
// decírselo al lector, quien viene de filtrar por un día cree que está leyendo un hilo
// recortado y da por perdida una conversación que sí está entera. Ésa es la mitad de R17 que
// se ve en pantalla, y por eso el aviso es un requisito y no una cortesía.
//
// El rango se aplica POR LA BARRA REAL (selector «Filtros» → «Fecha» → un rango predefinido),
// no pasándole una prop al hilo: lo que se está probando es justamente el cableado entre las
// dos superficies.

/** Un mensaje MUY anterior a cualquier rango que el atajo de 7 días pueda producir. */
const MENSAJE_DE_OTRO_MES = "mensaje de otro mes";

const listarHilos = vi.fn(async () => okHilos([hilo()]));
const listarMensajes = vi.fn(async () =>
  okMensajes([
    mensaje({
      id: "viejo",
      cuerpo: MENSAJE_DE_OTRO_MES,
      ocurridoAt: "2026-06-15T18:00:00.000Z",
    }),
    mensaje({ id: "nuevo", cuerpo: "mensaje de hoy", ocurridoAt: HOY_ISO }),
  ]),
);

beforeEach(() => {
  instalarObservador();
  listarHilos.mockClear();
  listarMensajes.mockClear();
});

afterEach(cleanup);

function renderPantalla() {
  return renderHistorico(
    <HistoricoConversacionesModule
      mensajeros={[]}
      acciones={{ listarHilos, listarMensajes }}
      ahora={AHORA}
      debounceMs={0}
    />,
  );
}

/** Pone el filtro «Fecha» en la barra y elige el rango predefinido de los últimos 7 días. */
async function aplicarRangoDeFecha() {
  const user = userEvent.setup();
  fireEvent.click(await screen.findByRole("button", { name: /filtros/i }));
  const opcion = await screen.findByRole("option", { name: /fecha/i });
  fireEvent.click(opcion);
  fireEvent.keyDown(opcion, { key: "Escape" });

  await user.click(await screen.findByRole("button", { name: "Fecha" }));
  const grupo = await screen.findByRole("group", { name: "Rangos predefinidos" });
  await user.click(within(grupo).getByRole("button", { name: "Últimos 7 días" }));
}

/** Abre el único hilo del listado. */
async function abrirHilo() {
  fireEvent.click(await screen.findByRole("button", { name: /María González/ }));
  return screen.findByRole("list", { name: "Historial de mensajes" });
}

describe("T5.4 — aviso de fecha diferenciada (R39)", () => {
  it("(a) con rango aplicado y un hilo abierto, avisa de que la conversación va completa", async () => {
    renderPantalla();
    await aplicarRangoDeFecha();
    await abrirHilo();

    expect(
      screen.getByText(/se muestra la conversación completa/i),
    ).toBeInTheDocument();
  });

  it("(b) sin rango aplicado, el aviso NO aparece: no hay nada que aclarar", async () => {
    renderPantalla();
    await abrirHilo();

    expect(screen.queryByText(/conversación completa/i)).toBeNull();
  });

  it("(c) el hilo abierto con rango aplicado sigue mostrando mensajes FUERA del rango (R17)", async () => {
    renderPantalla();
    await aplicarRangoDeFecha();
    await abrirHilo();

    expect(screen.getByText(MENSAJE_DE_OTRO_MES)).toBeInTheDocument();
  });

  // El aviso dice EXACTAMENTE lo pactado en el design §5.3. Se compara contra la constante
  // exportada para que cambiarlo sea una decisión con su test, no una edición de paso.
  it("el texto del aviso es el del spec", async () => {
    renderPantalla();
    await aplicarRangoDeFecha();
    await abrirHilo();

    expect(screen.getByText(AVISO_FECHA_DIFERENCIADA)).toBeInTheDocument();
  });

  // La otra mitad de R39: el rango SÍ viaja al listado. Si no llegara, el aviso estaría
  // avisando de un recorte que nadie aplicó.
  it("el rango SÍ recorta el listado: viaja en el filtro de la consulta de hilos", async () => {
    renderPantalla();
    await aplicarRangoDeFecha();

    await waitFor(() => {
      expect(listarHilos).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filtro: expect.objectContaining({
            fecha_desde: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            fecha_hasta: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          }),
        }),
      );
    });
  });
});

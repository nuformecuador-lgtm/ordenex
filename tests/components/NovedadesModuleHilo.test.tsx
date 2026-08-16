// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";
import userEvent from "@testing-library/user-event";

import { NovedadesModule } from "@/app/(app)/novedades/_components/NovedadesModule";
import {
  borrarNotaOrden,
  listarNotasOrden,
  publicarNotaOrden,
} from "@/lib/actions/orden-notas";
import type { NovedadDTO } from "@/lib/types/novedad";

// Feature 227 (T3.5, design §5.1) — montaje del hilo del lado TIENDA.
//
// Lo que este archivo verifica no es la UI del hilo (eso es `HiloNotasOrden.test.tsx`), sino
// el CABLEADO y, sobre todo, CUÁNDO se pide el hilo: al abrir UNA orden y nunca por fila del
// listado paginado. Meter el hilo en `NovedadDTO` sería una consulta por orden de la página
// (N+1, alternativa A6 descartada en design §4/§6) para un dato que solo se mira al abrir.
vi.mock("@/lib/actions/orden-notas", () => ({
  listarNotasOrden: vi.fn(),
  publicarNotaOrden: vi.fn(),
  borrarNotaOrden: vi.fn(),
}));

vi.mock("@/lib/actions/novedades", () => ({
  listarNovedadesAction: vi.fn(),
}));

vi.mock("@/lib/actions/resolver-novedad", () => ({
  reprogramarNovedad: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const listarMock = vi.mocked(listarNotasOrden);
const publicarMock = vi.mocked(publicarNotaOrden);
const borrarMock = vi.mocked(borrarNotaOrden);

const novedad = (over: Partial<NovedadDTO> = {}): NovedadDTO => ({
  id: "o1",
  numGuia: 12345,
  numRemision: "REM-90210",
  estatusValue: "devuelta",
  destinatario: "Ana Cliente",
  telefonoDest: "88887777",
  causa: "not_found",
  producto: "Zapatos deportivos",
  peso: 1.5,
  direccion: "Av. Central 120",
  montoCobrar: 24500,
  latitud: 9.9281,
  longitud: -84.0907,
  notas: "Llamar antes de llegar",
  tiendaNombre: "Tienda Demo",
  zonaNombre: "GAM Oeste",
  provinciaNombre: "San José",
  cantonNombre: "Escazú",
  distritoNombre: "San Rafael",
  secuenciaRuta: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue({
    status: "ok",
    puedeEscribir: true,
    notas: [
      {
        id: "n1",
        cuerpo: "El cliente pidió reintentar mañana.",
        autorNombre: "Tienda Demo",
        rolAutor: "adminTienda",
        createdAt: "2026-08-14T15:30:00.000Z",
        esPropia: true,
        eliminada: false,
      },
    ],
  });
  publicarMock.mockResolvedValue({ status: "forbidden" });
  borrarMock.mockResolvedValue({ status: "forbidden" });
});

afterEach(() => {
  cleanup();
});

/**
 * El hilo se lee con SWR (Server Action como fetcher). Caché propia por caso y sin dedupe:
 * si no, la segunda apertura de la misma orden se serviría del caché del caso anterior y el
 * conteo de llamadas —lo que este archivo mide— dejaría de significar nada.
 */
function montar(ui: ReactElement) {
  return render(
    <SWRConfig
      value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}
    >
      {ui}
    </SWRConfig>,
  );
}

describe("NovedadesModule — hilo de notas", () => {
  it("no pide el hilo al listar las órdenes y lo carga solo al abrir una", async () => {
    const user = userEvent.setup();
    montar(
      <NovedadesModule
        items={[
          novedad({ id: "o1", destinatario: "Ana Cliente" }),
          novedad({ id: "o2", destinatario: "Beto Cliente", numGuia: 222 }),
          novedad({ id: "o3", destinatario: "Caro Cliente", numGuia: 333 }),
        ]}
        total={3}
        page={1}
        pageSize={10}
      />,
    );

    // Tres órdenes en pantalla y CERO lecturas del hilo: el listado no lo pide (no-N+1).
    expect(listarMock).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Notas la orden de Beto Cliente" }),
    );

    // Una sola lectura, la de la orden abierta.
    await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(1));
    expect(listarMock).toHaveBeenCalledWith({ ordenId: "o2" });
  });

  it("al abrir una orden monta su hilo con el compositor que autoriza el servidor", async () => {
    const user = userEvent.setup();
    montar(
      <NovedadesModule
        items={[novedad({ id: "o1", destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Notas la orden de Ana Cliente" }),
    );

    expect(
      await screen.findByText("El cliente pidió reintentar mañana."),
    ).toBeTruthy();
    // `puedeEscribir: true` viene del servidor; la UI no lo deduce del estatus.
    expect(screen.getByLabelText("Escribí una nota")).toBeTruthy();
    expect(listarMock).toHaveBeenCalledTimes(1);
  });
});

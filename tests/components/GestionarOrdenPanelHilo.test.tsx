// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";

import { GestionarOrdenPanel } from "@/app/(app)/mis-asignaciones/_components/GestionarOrdenPanel";
import { RepartoModule } from "@/app/(app)/mis-asignaciones/_components/RepartoModule";
import {
  borrarNotaOrden,
  listarNotasOrden,
  publicarNotaOrden,
} from "@/lib/actions/orden-notas";
import type {
  MiAsignacionDTO,
  RutaResumenDTO,
} from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 227 (T3.5, design §5.2) — montaje del hilo del lado MENSAJERO, en el panel que YA
// existe (P6: sin pantalla nueva) y justo donde estaba el editor de la nota privada retirada.
//
// Lo que se mide aquí es CUÁNDO se pide el hilo: al abrir UNA orden, y jamás una vez por
// asignación de la lista. El hilo NO viaja dentro de `listarMisAsignaciones` (sería N+1 sobre
// la pantalla más caliente del portal, alternativa A6) y esta feature no toca el conjunto de
// estatus que esa lectura hace (R36, corte de la feature 167/R34).
vi.mock("@/lib/actions/orden-notas", () => ({
  listarNotasOrden: vi.fn(),
  publicarNotaOrden: vi.fn(),
  borrarNotaOrden: vi.fn(),
}));

vi.mock("@/lib/actions/mis-asignaciones", () => ({
  recogerAsignaciones: vi.fn(),
  escogerParaGestion: vi.fn().mockResolvedValue({ status: "ok", ordenId: "g1" }),
  gestionar: vi.fn(),
  liberarGestion: vi.fn().mockResolvedValue({ status: "ok" }),
}));

vi.mock("@/lib/actions/orden-mensajero-meta", () => ({
  marcarGestionarLuego: vi.fn(),
}));

vi.mock("@/lib/actions/ruta-mensajero", () => ({
  sincronizarRuta: vi.fn().mockResolvedValue({ status: "ok", omitida: false }),
}));

vi.mock("@/app/(app)/mis-asignaciones/_components/RutaMapa", () => ({
  RutaMapa: () => <div data-testid="ruta-mapa" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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

function orden(over: Partial<MiAsignacionDTO> = {}): MiAsignacionDTO {
  return {
    id: "g1",
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_reparto",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    peso: 1.5,
    montoCobrar: 150,
    latitud: 9.9281244,
    longitud: -84.0907246,
    notas: "Dejar en portería",
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    secuenciaRuta: 1,
    ...over,
  };
}

const RUTA: RutaResumenDTO = {
  estado: "vigente",
  calculadaAt: null,
  origenFuente: "gps",
  paradasSinOptimizar: 0,
};

/**
 * El hilo se lee con SWR (Server Action como fetcher, patrón de `ChatConversacion`), así que
 * cada caso necesita su PROPIA caché y sin dedupe: si no, la segunda apertura de la misma
 * orden se serviría del caché del caso anterior y el conteo de llamadas —que es justo lo que
 * este archivo mide— dejaría de significar nada.
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

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue({
    status: "ok",
    puedeEscribir: true,
    notas: [
      {
        id: "n1",
        cuerpo: "La tienda avisa que el cliente cambió de dirección.",
        autorNombre: "Tienda X",
        rolAutor: "adminTienda",
        createdAt: "2026-08-14T15:30:00.000Z",
        esPropia: false,
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

describe("GestionarOrdenPanel — hilo de notas", () => {
  it("al abrir la orden carga su hilo una sola vez y lo monta en el panel", async () => {
    montar(
      <GestionarOrdenPanel
        orden={orden()}
        yaActiva={false}
        onGestionarPedido={vi.fn().mockResolvedValue(true)}
        onCancelarGestion={vi.fn()}
        onSuccess={vi.fn()}
        onAbrirChat={vi.fn()}
        count={1}
      />,
    );

    expect(
      await screen.findByText("La tienda avisa que el cliente cambió de dirección."),
    ).toBeTruthy();
    expect(listarMock).toHaveBeenCalledTimes(1);
    expect(listarMock).toHaveBeenCalledWith({ ordenId: "g1" });
    // El hilo es del mensajero con la tienda, y no se confunde con la nota de la TIENDA
    // (`orden.notas`), que sigue viva en el detalle (R25).
    expect(screen.getByRole("region", { name: "Notas con la tienda" })).toBeTruthy();
    expect(screen.getByText("Dejar en portería")).toBeTruthy();
  });

  it("la lista de asignaciones no pide el hilo de todas las órdenes", async () => {
    montar(
      <RepartoModule
        porGestionar={[
          orden({ id: "g1", numGuia: 1001, secuenciaRuta: 1 }),
          orden({ id: "g2", numGuia: 1002, destinatario: "Beto Ruiz", secuenciaRuta: 2 }),
          orden({ id: "g3", numGuia: 1003, destinatario: "Caro Díaz", secuenciaRuta: 3 }),
        ]}
        ordenEnGestionId={null}
        ruta={RUTA}
        bloqueado={false}
      />,
    );

    // Tres asignaciones, UNA sola lectura: la de la orden abierta en el panel. Si el hilo
    // viajara en el listado (o el módulo lo pidiera por card), aquí habría tres.
    await screen.findByRole("region", { name: "Notas con la tienda" });
    expect(listarMock).toHaveBeenCalledTimes(1);
    expect(listarMock).toHaveBeenCalledWith({ ordenId: "g1" });
  });

  it("el compositor del mensajero lo autoriza el servidor, no el estatus de la orden", async () => {
    listarMock.mockResolvedValue({
      status: "ok",
      puedeEscribir: false,
      notas: [
        {
          id: "n1",
          cuerpo: "Nota de la tienda",
          autorNombre: "Tienda X",
          rolAutor: "adminTienda",
          createdAt: "2026-08-14T15:30:00.000Z",
          esPropia: false,
          eliminada: false,
        },
      ],
    });

    montar(
      <GestionarOrdenPanel
        // La orden está `en_reparto` —la ventana del mensajero— y aun así el servidor dice
        // que no puede escribir: manda el servidor (R19), la UI no re-deriva la regla.
        orden={orden({ estatusValue: "en_reparto" })}
        yaActiva={false}
        onGestionarPedido={vi.fn().mockResolvedValue(true)}
        onCancelarGestion={vi.fn()}
        onSuccess={vi.fn()}
        onAbrirChat={vi.fn()}
        count={1}
      />,
    );

    expect(await screen.findByText("Nota de la tienda")).toBeTruthy();
    // Solo lectura: ni compositor ni controles de borrado, con la orden en `en_reparto`.
    expect(screen.queryByLabelText("Escribí una nota")).toBeNull();
    expect(screen.queryByRole("button", { name: /Publicar nota/ })).toBeNull();
    expect(publicarMock).not.toHaveBeenCalled();
  });
});

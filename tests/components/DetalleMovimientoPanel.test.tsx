// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

// =================================================================================================
// FICHA 458-C (T C.4, design §3.7/§5.1) — EL PANEL «VER» (R58, R63, R65, R71, R72, R100)
// =================================================================================================
//
// El panel es presentación de lo que la fila trae del SERVIDOR (estado, anulable, comprobante) más
// dos lecturas al abrir («Cómo quedó», y la autoría la pasa quien lo monta). Lo que se mide:
//  - R58: quién, por qué, cómo (si la superficie lo conoce), comprobante, registró, estado y
//    «Cómo quedó» con las cifras DEL SERVIDOR (cargando y error sin cifras);
//  - R63/R65: «Anular…» solo si la fila es `anulable` y no está anulada;
//  - R71/R72: «Anulado» y «motivo no registrado» salen de la fila, no de ninguna otra;
//  - R100/R73: el cobro por rechazo dice en palabras que es un cargo (y que se anuló).
//  - H6: ningún id en el texto ni en los nombres accesibles.

const comoQuedoMock = vi.fn();
const anularMock = vi.fn();
const verMock = vi.fn();
const adjuntarMock = vi.fn();
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: (...a: unknown[]) => comoQuedoMock(...a) }));
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: (...a: unknown[]) => anularMock(...a) }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({
  verComprobanteAction: (...a: unknown[]) => verMock(...a),
  adjuntarComprobanteAction: (...a: unknown[]) => adjuntarMock(...a),
}));
const successMock = vi.fn();
const infoMock = vi.fn();
const errorMock = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: successMock, error: errorMock, info: infoMock, warning: vi.fn(), show: vi.fn(), dismiss: vi.fn() }),
}));

import { DetalleMovimientoPanel, type DetalleMovimiento } from "@/components/shared/wallet/DetalleMovimientoPanel";
import { COBRO_RECHAZO_TEXTO } from "@/components/shared/wallet/detalle-movimiento-panel-labels";

const ID = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";

function movimiento(over: Partial<DetalleMovimiento> = {}): DetalleMovimiento {
  return {
    destino: { libro: "caja", movimientoId: ID },
    concepto: "Sueldo",
    fecha: "2026-09-12",
    monto: "25000.00",
    direccion: "sale",
    motivo: "Sueldo de septiembre",
    estado: { anulado: false },
    anulable: true,
    nombreParaAnular: "«Sueldo»",
    tieneComprobante: true,
    admiteAdjuntar: true,
    ...over,
  };
}

const AUTORIA = {
  aQuien: { nombre: "María Solano", beneficiario: null, cuenta: null, esOrdenex: false },
  registro: { nombre: "Ana Maestra", automatico: null },
};

const COMO_QUEDO = {
  status: "ok",
  comoQuedo: {
    caja: { cifraPrincipal: "75000.00", rotulo: "flujo", ganancia: "15000.00", deTiendas: "60000.00", capital: "0.00" },
    cuenta: null,
  },
};

function Envoltura({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

function pintar(m: DetalleMovimiento = movimiento(), autoria: unknown = AUTORIA, onCambio = vi.fn()) {
  const onAbiertoChange = vi.fn();
  render(
    <Envoltura>
      <DetalleMovimientoPanel
        abierto
        onAbiertoChange={onAbiertoChange}
        movimiento={m}
        autoria={(autoria === "cargando" ? undefined : autoria) as never}
        onCambio={onCambio}
      />
    </Envoltura>,
  );
  return { onAbiertoChange, onCambio };
}

async function panel(): Promise<HTMLElement> {
  return screen.findByRole("dialog", { name: "Sueldo" });
}

beforeEach(() => {
  vi.clearAllMocks();
  comoQuedoMock.mockResolvedValue(COMO_QUEDO);
  anularMock.mockResolvedValue({ status: "ok", camino: "egreso_caja" });
});
afterEach(() => cleanup());

describe("458-C R58 — lo que dice el panel", () => {
  it("quién, por qué, comprobante con su rótulo, registró, estado y «Cómo quedó» del servidor", async () => {
    pintar();
    const p = await panel();
    expect(within(p).getByText("María Solano")).toBeTruthy();
    expect(within(p).getByText("Sueldo de septiembre")).toBeTruthy();
    // R80: el rótulo legible del comprobante, nunca su ruta.
    expect(within(p).getByText("Comprobante de «Sueldo» del 2026-09-12")).toBeTruthy();
    expect(within(p).getByText("Ana Maestra")).toBeTruthy();
    expect(within(p).getByText("Vigente")).toBeTruthy();
    const comoQuedo = within(p).getByRole("region", { name: "Cómo quedó" });
    expect(await within(comoQuedo).findByText("₡75.000")).toBeTruthy();
    expect(within(comoQuedo).getByText("Flujo de dinero registrado")).toBeTruthy();
    expect(within(comoQuedo).getByText("₡15.000")).toBeTruthy();
    expect(comoQuedoMock).toHaveBeenCalledWith({ destino: { libro: "caja", movimientoId: ID } });
  });

  it("«Cómo quedó» sin respuesta del servidor lo dice y NO pinta cifras", async () => {
    comoQuedoMock.mockResolvedValue({ status: "forbidden" });
    pintar();
    const region = within(await panel()).getByRole("region", { name: "Cómo quedó" });
    expect(await within(region).findByText("No se pudo leer cómo quedó la caja tras este movimiento.")).toBeTruthy();
    expect(region.textContent).not.toMatch(/₡/);
  });

  it("un movimiento sin línea de caja lo dice; la cuenta afectada se pinta con su saldo", async () => {
    comoQuedoMock.mockResolvedValue({
      status: "ok",
      comoQuedo: { caja: null, cuenta: { tipo: "mensajero", id: ID, saldo: "2000.00" } },
    });
    pintar();
    const region = within(await panel()).getByRole("region", { name: "Cómo quedó" });
    expect(await within(region).findByText("Este movimiento no tiene línea en la caja: la caja no cambió con él.")).toBeTruthy();
    expect(within(region).getByText("Lo que Ordenex le debe al mensajero")).toBeTruthy();
    expect(within(region).getByText("₡2.000")).toBeTruthy();
    expect(region.textContent).not.toContain(ID);
  });

  it("R57: lo automático dice «Automático» y la acción; el beneficiario del pago de un gasto va con «a …»", async () => {
    pintar(movimiento(), {
      aQuien: { nombre: "Tania Tienda", beneficiario: "Facebook", cuenta: null, esOrdenex: false },
      registro: { nombre: null, automatico: { accion: "cobro_por_rechazo", por: "Ana" } },
    });
    const p = await panel();
    expect(within(p).getByText("Tania Tienda · a Facebook")).toBeTruthy();
    expect(within(p).getByText("Automático · Cobro por rechazo aprobado por Ana")).toBeTruthy();
  });

  it("mientras la autoría carga lo dice; si falla, no inventa un nombre", async () => {
    pintar(movimiento(), "cargando");
    expect(within(await panel()).getAllByText("Cargando…")).toHaveLength(2);
    cleanup();
    pintar(movimiento(), null);
    expect(within(await panel()).getByText("No se pudo leer quién lo registró.")).toBeTruthy();
  });

  it("H6: ningún id en el texto del panel ni en sus nombres accesibles", async () => {
    pintar();
    const p = await panel();
    await within(p).findByText("₡75.000");
    expect(p.textContent).not.toContain(ID);
    for (const el of p.querySelectorAll("[aria-label]")) expect(el.getAttribute("aria-label")).not.toContain(ID);
  });
});

describe("458-C R63/R65/R71/R72 — el estado y «Anular…» los decide la fila del servidor", () => {
  it("R63: vigente y anulable ofrece «Anular…»", async () => {
    pintar();
    expect(within(await panel()).getByRole("button", { name: "Anular…" })).toBeTruthy();
  });

  it("R65: no anulable (contra-asiento, cierre) NO ofrece «Anular…»", async () => {
    pintar(movimiento({ anulable: false }));
    expect(within(await panel()).queryByRole("button", { name: "Anular…" })).toBeNull();
  });

  it("R71: anulado dice «Anulado» y NO ofrece «Anular…» ni «Adjuntar»", async () => {
    pintar(movimiento({ estado: { anulado: true }, anulable: false, tieneComprobante: false }));
    const p = await panel();
    expect(within(p).getByText("Anulado")).toBeTruthy();
    expect(within(p).queryByRole("button", { name: "Anular…" })).toBeNull();
    expect(within(p).queryByRole("button", { name: "Adjuntar comprobante" })).toBeNull();
  });

  it("R72: anulado por una vía de antes sin constancia dice «motivo no registrado»", async () => {
    pintar(movimiento({ estado: { anulado: true, motivoNoRegistrado: true }, anulable: false }));
    expect(within(await panel()).getByText("Anulado · motivo no registrado")).toBeTruthy();
  });

  it("B3 (revisión): sin estado del servidor (`null`) NO afirma «Vigente»: la línea dice «—»", async () => {
    pintar(movimiento({ estado: null, anulable: false }));
    const p = await panel();
    const dt = within(p).getByText("Estado", { selector: "dt" });
    expect(dt.nextElementSibling?.textContent).toBe("—");
    expect(within(p).queryByText("Vigente")).toBeNull();
  });

  it("vigente (el servidor lo dijo): la línea dice «Vigente»", async () => {
    pintar();
    const dt = within(await panel()).getByText("Estado", { selector: "dt" });
    expect(dt.nextElementSibling?.textContent).toBe("Vigente");
  });

  it("R71: con el detalle de la anulación, dice cuándo, quién y por qué", async () => {
    pintar(movimiento({ estado: { anulado: true, detalle: { fecha: "2026-09-20", por: "Ana", motivo: "Duplicado" } }, anulable: false }));
    expect(within(await panel()).getByText("Anulado el 2026-09-20 por Ana · Duplicado")).toBeTruthy();
  });

  it("«Anular…» abre el diálogo; al anular manda el DESTINO de la fila y un motivo, cierra y avisa al módulo", async () => {
    const user = userEvent.setup();
    const { onAbiertoChange, onCambio } = pintar();
    await user.click(within(await panel()).getByRole("button", { name: "Anular…" }));
    const dialogo = await screen.findByRole("dialog", { name: "Anular «Sueldo»" });
    await user.type(within(dialogo).getByLabelText(/^Motivo de la anulación/), "Registrado dos veces");
    await user.click(within(dialogo).getByRole("button", { name: "Anular" }));
    await waitFor(() => expect(anularMock).toHaveBeenCalledTimes(1));
    expect(anularMock).toHaveBeenCalledWith({ destino: { libro: "caja", movimientoId: ID }, motivo: "Registrado dos veces" });
    await waitFor(() => expect(onCambio).toHaveBeenCalledTimes(1));
    expect(onAbiertoChange).toHaveBeenCalledWith(false);
    expect(successMock).toHaveBeenCalledWith("Anulado. Se registró el movimiento contrario.");
  });
});

describe("458-C R100/R73 — el cobro por rechazo dice que es un cargo", () => {
  it("vigente: la ganancia sube y el saldo de la tienda baja, sin dinero nuevo", async () => {
    pintar(movimiento({ nota: COBRO_RECHAZO_TEXTO.vigente }));
    expect(
      within(await panel()).getByText(
        "Es un cobro a la tienda por el flete de un rechazo: la ganancia de Ordenex sube y el saldo de la tienda baja, sin dinero nuevo en la caja.",
      ),
    ).toBeTruthy();
  });

  it("anulado: dice que se anuló, que la ganancia bajó y que no se vuelve a ofrecer", async () => {
    pintar(movimiento({ nota: COBRO_RECHAZO_TEXTO.anulado, estado: { anulado: true }, anulable: false }));
    expect(within(await panel()).getByText(/Este cobro por rechazo se anuló: la ganancia de Ordenex bajó/)).toBeTruthy();
  });
});

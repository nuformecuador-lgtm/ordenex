// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// =================================================================================================
// FICHA 458-C (T C.4, design §4.2) — «ANULAR…» UNIFORME (R63–R67)
// =================================================================================================
//
// Molde `AnularPagoDialog` (172). Lo que se mide:
//  - R64: motivo obligatorio con DOS barreras (botón deshabilitado y comprobación al confirmar); se
//    manda `{ destino, motivo }` SIN monto (la clave `monto` no existe en la llamada);
//  - R66: `ya_anulado` cierra, avisa «Ya estaba anulado» y relee, sin toast de error;
//  - R65: `no_anulable` se dice DENTRO del diálogo con el motivo del servidor, en palabras, y no cierra;
//  - `no_encontrado`, `forbidden` y un fallo de red, dentro del diálogo; `validation_error` del motivo,
//    bajo el campo.

const anularMock = vi.fn();
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: (...a: unknown[]) => anularMock(...a) }));
const successMock = vi.fn();
const infoMock = vi.fn();
const errorMock = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: successMock, error: errorMock, info: infoMock, warning: vi.fn(), show: vi.fn(), dismiss: vi.fn() }),
}));

import { AnularMovimientoDialog } from "@/components/shared/wallet/AnularMovimientoDialog";

const DESTINO = { libro: "caja" as const, movimientoId: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e" };

function pintar() {
  const onAnulado = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <AnularMovimientoDialog
      open
      onOpenChange={onOpenChange}
      destino={DESTINO}
      nombre="el cobro por rechazo a una tienda"
      resumen="Flete por rechazo cobrado a la tienda · 2026-09-12 · ₡1.800"
      montoPintado="₡1.800"
      onAnulado={onAnulado}
    />,
  );
  return { onAnulado, onOpenChange, user: userEvent.setup() };
}

async function dialogo() {
  return screen.findByRole("dialog", { name: "Anular el cobro por rechazo a una tienda" });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("458-C R64 — motivo obligatorio y sin monto", () => {
  it("sin motivo el botón está deshabilitado y no se llama a nadie", async () => {
    pintar();
    const d = await dialogo();
    expect(within(d).getByRole("button", { name: "Anular" })).toBeDisabled();
    expect(anularMock).not.toHaveBeenCalled();
    expect(within(d).getByText(/Se registrará hoy un movimiento contrario por ₡1\.800/)).toBeTruthy();
  });

  it("manda EXACTAMENTE { destino, motivo } recortado, sin monto; `ok` avisa, cierra y relee", async () => {
    anularMock.mockResolvedValue({ status: "ok", camino: "rechazo_tienda_cobro" });
    const { user, onAnulado, onOpenChange } = pintar();
    const d = await dialogo();
    await user.type(within(d).getByLabelText(/^Motivo de la anulación/), "  Se cobró por error  ");
    await user.click(within(d).getByRole("button", { name: "Anular" }));
    await waitFor(() => expect(anularMock).toHaveBeenCalledTimes(1));
    expect(anularMock.mock.calls[0][0]).toEqual({ destino: DESTINO, motivo: "Se cobró por error" });
    expect(Object.keys(anularMock.mock.calls[0][0])).not.toContain("monto");
    expect(successMock).toHaveBeenCalledWith("Anulado. Se registró el movimiento contrario.");
    expect(onAnulado).toHaveBeenCalledWith("ok");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("solo espacios no es un motivo", async () => {
    const { user } = pintar();
    const d = await dialogo();
    await user.type(within(d).getByLabelText(/^Motivo de la anulación/), "    ");
    expect(within(d).getByRole("button", { name: "Anular" })).toBeDisabled();
  });

  it("un `validation_error` del motivo se pinta bajo el campo", async () => {
    anularMock.mockResolvedValue({ status: "validation_error", fieldErrors: { motivo: ["El motivo de la anulación es obligatorio."] } });
    const { user, onAnulado } = pintar();
    const d = await dialogo();
    await user.type(within(d).getByLabelText(/^Motivo de la anulación/), "x");
    await user.click(within(d).getByRole("button", { name: "Anular" }));
    expect(await within(d).findByText("El motivo de la anulación es obligatorio.")).toBeTruthy();
    expect(onAnulado).not.toHaveBeenCalled();
  });
});

describe("458-C R65/R66 — lo que responde el servidor", () => {
  it("R66: `ya_anulado` cierra con «Ya estaba anulado» y relee, sin toast de error", async () => {
    anularMock.mockResolvedValue({ status: "ya_anulado", camino: "egreso_caja" });
    const { user, onAnulado } = pintar();
    const d = await dialogo();
    await user.type(within(d).getByLabelText(/^Motivo de la anulación/), "otra vez");
    await user.click(within(d).getByRole("button", { name: "Anular" }));
    await waitFor(() => expect(onAnulado).toHaveBeenCalledWith("ya_anulado"));
    expect(infoMock).toHaveBeenCalledWith("Ya estaba anulado; no se registró nada más.");
    expect(errorMock).not.toHaveBeenCalled();
  });

  for (const [motivo, texto] of [
    ["contra_asiento", "Este movimiento no se puede anular: es la anulación de otro movimiento."],
    ["nace_de_un_cierre", "Este movimiento no se puede anular: lo produjo la aprobación de un cierre."],
    ["reclasificado", "Este movimiento no se puede anular: se reclasificó como pago de un gasto de la tienda."],
    ["no_aprobado", "Este movimiento no se puede anular: el cobro por rechazo no está aprobado."],
    ["sin_linea_de_caja", "Este movimiento no se puede anular: no tiene su línea en la caja."],
    ["no_es_anulable", "Este movimiento no se puede anular: es un registro automático que no se anula desde aquí."],
  ] as const) {
    it(`R65: \`no_anulable: ${motivo}\` se dice en palabras dentro del diálogo, que no se cierra`, async () => {
      anularMock.mockResolvedValue({ status: "no_anulable", motivo });
      const { user, onAnulado } = pintar();
      const d = await dialogo();
      await user.type(within(d).getByLabelText(/^Motivo de la anulación/), "x");
      await user.click(within(d).getByRole("button", { name: "Anular" }));
      expect((await within(d).findByRole("alert")).textContent).toBe(texto);
      expect(onAnulado).not.toHaveBeenCalled();
    });
  }

  it("`no_encontrado`, `forbidden` y un fallo de red se dicen dentro del diálogo", async () => {
    anularMock.mockResolvedValueOnce({ status: "no_encontrado" });
    anularMock.mockResolvedValueOnce({ status: "forbidden" });
    anularMock.mockRejectedValueOnce(new Error("red"));
    const { user } = pintar();
    const d = await dialogo();
    await user.type(within(d).getByLabelText(/^Motivo de la anulación/), "x");
    await user.click(within(d).getByRole("button", { name: "Anular" }));
    expect((await within(d).findByRole("alert")).textContent).toBe("No se encontró ese registro.");
    await user.click(within(d).getByRole("button", { name: "Anular" }));
    await waitFor(() => expect(within(d).getByRole("alert").textContent).toBe("No tenés permiso para anular este registro."));
    await user.click(within(d).getByRole("button", { name: "Anular" }));
    await waitFor(() => expect(within(d).getByRole("alert").textContent).toBe("No se pudo anular ahora. Probá de nuevo."));
  });
});

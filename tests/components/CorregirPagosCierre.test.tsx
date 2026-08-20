// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CorregirPagosDialog } from "@/app/(app)/cierres-admin/_components/CorregirPagosDialog";
import {
  CierreFacturaDetalle,
  type CierreFacturaCabecera,
} from "@/app/(app)/cierres-admin/_components/cierre-factura";
import { actualizarPagosGestion } from "@/lib/actions/cierres-admin";
import type {
  CierreDetalleGestion,
  CierreGrupos,
} from "@/lib/interfaces/services/ICierreDiaService";

/**
 * Pedido humano (2026-08-19) — la CORRECCIÓN del desglose de pago desde el detalle de un cierre,
 * por el lado de la PANTALLA.
 *
 * Lo que el servidor ya cubre no se repite aquí (el rol, el alcance, el estado del cierre y el
 * cuadre contra `monto_recibido` viven en `cierres-admin-corregir-pagos.test.ts`). Aquí se
 * afirma lo que SOLO se ve montando la pantalla, que son tres cosas y las tres se rompen en
 * silencio:
 *   1. el acceso se ofrece donde hay algo que repartir, y NO se ofrece cuando el padre no lo
 *      autoriza (cierre resuelto, rol sin permiso, vista del mensajero);
 *   2. el editor abre con las líneas VIGENTES de esa orden, no en blanco ni con las de la
 *      anterior;
 *   3. lo que viaja es el desglose NUEVO y nada más — el total no es una clave del contrato.
 */

vi.mock("@/lib/actions/cierres-admin", () => ({
  actualizarPagosGestion: vi.fn(),
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

const accionMock = vi.mocked(actualizarPagosGestion);

function gestion(over: Partial<CierreDetalleGestion> = {}): CierreDetalleGestion {
  return {
    gestionId: "g1",
    ordenId: "o1",
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Ana Pérez",
    direccion: "Calle 1",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    producto: "Caja",
    tiendaNombre: "Tienda X",
    resultado: "entregada",
    montoRecibido: "8000.00",
    metodoPago: null,
    pagos: [{ metodo: "efectivo", monto: "8000.00" }],
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    esRechazoSla: false,
    desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
    causaIncidente: null,
    indemnizacion: null,
    ...over,
  };
}

function grupos(g: CierreDetalleGestion): CierreGrupos {
  return {
    entregada: g.resultado === "entregada" ? [g] : [],
    reprogramada: [],
    devuelta: g.resultado === "devuelta" ? [g] : [],
    rechazada: [],
    incidente: [],
  };
}

const CABECERA: CierreFacturaCabecera = {
  cierreId: "c1",
  estado: "solicitado",
  destinoTipo: "bodega_central",
  destinoZonaNombre: "GAM",
  totales: {
    efectivo: "8000.00",
    simpe: "0.00",
    transferencia: "0.00",
    general: "8000.00",
  },
  totalPagoMensajero: "0.00",
  totalIngresoBodegaRechazos: "0.00",
  solicitadoAt: "2026-08-11T10:00:00.000Z",
  resueltoAt: null,
  motivoRechazo: null,
};

const BOTON_CORREGIR = "Corregir métodos de pago de la orden REM-001 · Ana Pérez";

/** Despliega el renglón de la orden en el comprobante, que es donde vive el acceso. */
async function abrirRenglon(
  g: CierreDetalleGestion,
  onCorregirPagos?: (g: CierreDetalleGestion) => void,
) {
  const user = userEvent.setup();
  render(
    <CierreFacturaDetalle
      cierre={CABECERA}
      grupos={grupos(g)}
      onCorregirPagos={onCorregirPagos}
    />,
  );
  await user.click(
    screen.getByRole("button", { name: `Detalle de la orden ${g.numRemision} · ${g.destinatario}` }),
  );
  return user;
}

beforeEach(() => {
  accionMock.mockReset();
  accionMock.mockResolvedValue({
    status: "ok",
    gestionId: "g1",
    totales: {
      efectivo: "5000.00",
      simpe: "3000.00",
      transferencia: "0.00",
      general: "8000.00",
    },
  });
});

afterEach(() => {
  cleanup();
});

describe("dónde se ofrece corregir el desglose", () => {
  it("en una entrega con desglose, cuando el padre lo autoriza", async () => {
    await abrirRenglon(gestion(), vi.fn());
    expect(screen.getByRole("button", { name: BOTON_CORREGIR })).toBeInTheDocument();
  });

  it("sin autorización del padre NO se ofrece: la hoja es de solo lectura", async () => {
    // Es el caso del cierre ya aprobado/rechazado, el del rol que no corrige y el de la vista
    // del mensajero: los tres llegan aquí como «sin callback».
    await abrirRenglon(gestion(), undefined);
    expect(screen.queryByRole("button", { name: BOTON_CORREGIR })).toBeNull();
  });

  it("una entrega SIN cobro no ofrece repartir cero colones", async () => {
    await abrirRenglon(gestion({ montoRecibido: "0.00", pagos: [] }), vi.fn());
    expect(screen.queryByRole("button", { name: BOTON_CORREGIR })).toBeNull();
  });

  it("un resultado que no es entrega tampoco: no hay desglose que corregir", async () => {
    await abrirRenglon(
      gestion({ resultado: "devuelta", montoRecibido: null, pagos: [], motivo: "Nadie" }),
      vi.fn(),
    );
    expect(screen.queryByRole("button", { name: BOTON_CORREGIR })).toBeNull();
  });

  it("pulsarlo abre la corrección de ESA gestión", async () => {
    const onCorregir = vi.fn();
    const user = await abrirRenglon(gestion(), onCorregir);
    await user.click(screen.getByRole("button", { name: BOTON_CORREGIR }));
    expect(onCorregir).toHaveBeenCalledWith(expect.objectContaining({ gestionId: "g1" }));
  });
});

describe("el editor del desglose", () => {
  function renderDialogo(g: CierreDetalleGestion | null, onCorregido = vi.fn()) {
    return render(
      <CorregirPagosDialog gestion={g} onOpenChange={vi.fn()} onCorregido={onCorregido} />,
    );
  }

  it("abre con las líneas VIGENTES de la orden, no en blanco", () => {
    renderDialogo(
      gestion({
        pagos: [
          { metodo: "efectivo", monto: "5000.00" },
          { metodo: "SINPE", monto: "3000.00" },
        ],
      }),
    );

    expect(screen.getByLabelText("Monto línea 1")).toHaveValue("5000");
    expect(screen.getByLabelText("Monto línea 2")).toHaveValue("3000");
  });

  it("el «A cobrar» del resumen es lo que declaró el mensajero, y no se puede editar", () => {
    renderDialogo(gestion());
    // El resumen es una `<dl>` con `aria-label`: se localiza por su etiqueta, no por un rol.
    const resumen = screen.getByLabelText("Resumen del cobro");
    // El total es un dato del resumen, no un control: no hay input que lo cambie.
    // Con la moneda de configuración y su separador de miles, tal como lo ve el mensajero.
    expect(resumen.textContent).toContain("8.000");
    expect(within(resumen).queryByRole("textbox")).toBeNull();
  });

  it("con la suma descuadrada NO deja guardar y lo dice antes de pulsar", async () => {
    const user = userEvent.setup();
    renderDialogo(gestion());

    await user.clear(screen.getByLabelText("Monto línea 1"));
    await user.type(screen.getByLabelText("Monto línea 1"), "5000");

    expect(
      screen.getByText("El desglose debe sumar exactamente el monto a cobrar."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(accionMock).not.toHaveBeenCalled();
  });

  it("cuadrado, envía SOLO el desglose nuevo: el total no es una clave del contrato", async () => {
    const user = userEvent.setup();
    const onCorregido = vi.fn();
    renderDialogo(gestion(), onCorregido);

    // Se reparte: 5.000 en efectivo (línea 1) y 3.000 por SINPE (línea nueva, que nace con lo
    // que falta).
    await user.clear(screen.getByLabelText("Monto línea 1"));
    await user.type(screen.getByLabelText("Monto línea 1"), "5000");
    await user.click(screen.getByRole("button", { name: "Añadir método" }));
    await user.click(screen.getByLabelText("Método de pago línea 2"));
    await user.click(await screen.findByRole("option", { name: "SINPE" }));

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(accionMock).toHaveBeenCalledTimes(1));
    const enviado = accionMock.mock.calls[0]![0] as {
      gestionId: string;
      lineas: { metodo: string; monto: string }[];
    };
    expect(enviado.gestionId).toBe("g1");
    expect(enviado.lineas).toEqual([
      { metodo: "efectivo", monto: "5000" },
      { metodo: "SINPE", monto: "3000" },
    ]);
    // Ninguna clave de total: el servidor lo lee de la base.
    expect(Object.keys(enviado).sort()).toEqual(["gestionId", "lineas"]);
    await waitFor(() => expect(onCorregido).toHaveBeenCalledTimes(1));
  });

  it("si el cierre se cerró mientras corregías, lo dice y NO se relee el detalle", async () => {
    accionMock.mockResolvedValue({ status: "conflict" });
    const user = userEvent.setup();
    const onCorregido = vi.fn();
    renderDialogo(gestion(), onCorregido);

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText(
        "El cierre dejó de estar abierto mientras corregías: recarga el detalle para ver su estado.",
      ),
    ).toBeInTheDocument();
    expect(onCorregido).not.toHaveBeenCalled();
  });
});

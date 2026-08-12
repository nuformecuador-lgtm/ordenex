// @vitest-environment jsdom
// Feature 205 (T5.3/T6.3) — el DESGLOSE de un mensajero: el bloque de pago en su cabecera y el
// enlace al cierre en cada fila. Cubre R3, R43 y R44.
//
// Las dos cosas que se miden acá y que no puede medir ningún test de servidor:
//
//  - **el pago se ofrece DESDE esta pantalla** (R3): el desglose monta el bloque, y el bloque
//    pide el imputable al servidor. Sin esto, las dos Server Actions del reparto quedarían sin
//    superficie —el estado exacto que la guardia `superficie-de-uso` existe para impedir— y
//    nadie podría disparar el reparto aunque el backend entero estuviera verde;
//  - **el enlace es por fila y solo donde hay cierre** (R43): la fila que no identifica ningún
//    cierre no lleva un enlace roto ni uno deshabilitado. Es un ajuste manual y no hay cierre
//    que abrir.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

import type {
  CuentaPorPagarResumenDTO,
  PagoMensajeroMovimientoDTO,
} from "@/lib/types/wallet-mensajero";

const { desgloseMock, previsualizarMock } = vi.hoisted(() => ({
  desgloseMock: vi.fn(),
  previsualizarMock: vi.fn(),
}));

vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarPagosDeMensajeroAction: (...args: unknown[]) => desgloseMock(...args),
  listarPagosDeMensajeroCompletoAction: vi.fn(),
}));

vi.mock("@/lib/actions/liquidacion", () => ({
  previsualizarRepartoMensajeroAction: (...args: unknown[]) => previsualizarMock(...args),
  registrarRepartoMensajeroAction: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { DesglosePagosMensajero } from "@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero";

// --- Datos ---------------------------------------------------------------

const MENSAJERO = "1e2d3c4b-5a69-4788-9900-aabbccddeeff";
const CIERRE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const PAGO = "dddddddd-4444-4444-8444-dddddddddddd";

const RESUMEN: CuentaPorPagarResumenDTO = {
  mensajeroId: MENSAJERO,
  mensajeroNombre: "Ana Mensajera",
  devengado: "96000.00",
  pagado: "74850.00",
  cuentaPorPagar: "21150.00",
  signo: "positivo",
};

/** Tres filas: la del cierre, la del pago (que también cuelga de un cierre) y un ajuste. */
const MOVIMIENTOS: PagoMensajeroMovimientoDTO[] = [
  {
    id: "mov-1",
    mensajeroId: MENSAJERO,
    tipo: "devengo",
    categoria: "pago_devengado",
    monto: "4000.00",
    origenTipo: "cierre_dia",
    origenId: CIERRE,
    descripcion: null,
    fechaMovimiento: "2026-07-28T06:00:00.000Z",
    cierreId: CIERRE,
  },
  {
    id: "mov-2",
    mensajeroId: MENSAJERO,
    tipo: "pago",
    categoria: "liquidacion",
    monto: "1000.00",
    origenTipo: "pago_mensajero",
    origenId: PAGO,
    descripcion: "SINPE · 1234567",
    fechaMovimiento: "2026-07-29T06:00:00.000Z",
    // El cierre lo DERIVÓ el servidor a partir del pago: la fila lo lleva igual.
    cierreId: CIERRE,
  },
  {
    id: "mov-3",
    mensajeroId: MENSAJERO,
    tipo: "devengo",
    categoria: "ajuste_devengo",
    monto: "500.00",
    origenTipo: "manual",
    origenId: null,
    descripcion: "Ajuste manual",
    fechaMovimiento: "2026-07-30T06:00:00.000Z",
    // Un ajuste manual no cuelga de ningún cierre: acá no hay nada que enlazar.
    cierreId: null,
  },
];

function montar() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <DesglosePagosMensajero resumen={RESUMEN} />
    </SWRConfig>,
  );
}

const tabla = () =>
  screen.getByRole("table", { name: "Desglose por cierre de Ana Mensajera" });

beforeEach(() => {
  vi.clearAllMocks();
  desgloseMock.mockResolvedValue({
    status: "ok",
    data: {
      movimientos: MOVIMIENTOS,
      total: MOVIMIENTOS.length,
      page: 1,
      pageSize: 20,
      cuenta: {
        devengado: "96000.00",
        pagado: "74850.00",
        cuentaPorPagar: "21150.00",
        signo: "positivo",
      },
    },
  });
  // Los TRES imputables valen tres cifras distintas, como en los otros dos fixtures de la 205:
  // ₡21.150 de cuenta por pagar, de los que ₡2.300 no cuelgan de ningún cierre; ₡18.850
  // imputables en total; y ₡12.400 en la ventana, porque el tope deja DOS cierres fuera por
  // ₡6.450. Con los tres iguales, pintar aquí el total en vez del de la ventana no se veía.
  previsualizarMock.mockResolvedValue({
    status: "ok",
    previsualizacion: {
      mensajeroNombre: "Ana Mensajera",
      imputable: "12400.00",
      imputableTotal: "18850.00",
      cuentaPorPagar: "21150.00",
      deudaNoImputable: { hay: true, monto: "2300.00" },
      recorte: { aplicado: true, tope: 3, enVentana: 3, fuera: 2, montoFuera: "6450.00" },
      imputaciones: [],
      sobrante: "0.00",
      excede: false,
      excluidos: [],
    },
  });
});

afterEach(() => {
  cleanup();
});

// -------------------------------------------------------------------------

describe("R3 — se paga desde acá, sin ir a otra pantalla", () => {
  it("el desglose monta el bloque de pago, con lo que dice el servidor que se puede pagar", async () => {
    montar();

    const bloque = await screen.findByRole("region", {
      name: "Pago al mensajero: Ana Mensajera",
    });
    // Lo que un pago puede saldar AHORA (₡12.400), no el imputable total (₡18.850) ni la
    // cuenta por pagar (₡21.150): las otras dos no se pueden cobrar en este registro.
    expect(within(bloque).getByText("₡12.400,00")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(bloque).getByRole("button", { name: "Registrar pago" })).toBeEnabled(),
    );
    // Y el imputable se le pide al servidor para ESTE mensajero.
    expect(previsualizarMock).toHaveBeenCalledWith({ mensajeroId: MENSAJERO });
  });
});

describe("R43 — el enlace al cierre, por fila y solo donde hay cierre", () => {
  it("la fila con cierre lleva enlace a su detalle, con nombre accesible propio", async () => {
    montar();
    await screen.findByText("Liquidación · SINPE · 1234567");

    const enlaces = within(tabla()).getAllByRole("link", { name: /^Ver el cierre/ });
    // Las DOS filas que identifican un cierre: la del devengo y la del pago (cuyo cierre lo
    // derivó el servidor). El ajuste manual no.
    expect(enlaces).toHaveLength(2);
    for (const enlace of enlaces) {
      expect(enlace).toHaveAttribute("href", `/cierres-admin?cierre=${CIERRE}`);
    }
    expect(
      within(tabla()).getAllByRole("link", {
        name: new RegExp(`^Ver el cierre\\s*\\(${CIERRE}\\)$`),
      }),
    ).toHaveLength(2);
  });

  it("la fila SIN cierre no lleva enlace: ni roto ni deshabilitado", async () => {
    montar();
    const celda = await within(tabla()).findByText("Manual · Ajuste manual");
    const fila = celda.closest("tr") as HTMLElement;

    expect(within(fila).queryByRole("link")).not.toBeInTheDocument();
    // Y su celda dice que no hay dato, en vez de quedarse muda.
    expect(within(fila).getByText("—")).toBeInTheDocument();
  });

  it("todas las filas mantienen su cierre aunque cambie la página de datos", async () => {
    // Un `cierreId` inventado en el cliente (por ejemplo, a partir del `origenId`) daría un
    // enlace roto justo en la fila del pago, cuyo `origenId` es el ID DEL PAGO y no el del
    // cierre. Acá se comprueba que ninguna URL lleva ese id.
    montar();
    await screen.findByText("Liquidación · SINPE · 1234567");

    for (const enlace of within(tabla()).getAllByRole("link", { name: /^Ver el cierre/ })) {
      expect(enlace.getAttribute("href")).not.toContain(PAGO);
    }
  });
});

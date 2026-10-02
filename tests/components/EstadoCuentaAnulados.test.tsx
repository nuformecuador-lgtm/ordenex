// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import type { EstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import { estado, fila } from "@/tests/fixtures/estado-cuenta";

// =================================================================================================
// FICHA 458-D (T D.1; R25, R71, R72) — LOS ANULADOS EN EL ESTADO DE CUENTA.
//
//  - R25: el anulado SIGUE en el extracto, tachado, con el motivo, quién y cuándo; su contra-asiento es
//    una fila propia rotulada «Anulación».
//  - R72: lo revertido antes de la 458 sin constancia dice «motivo no registrado».
//  - R71: el estado lo decide el SERVIDOR y viaja en la fila. Con el contra-asiento EN LA MISMA PÁGINA
//    pero `anulacion: null` en el original, la pantalla NO lo pinta anulado (no deduce nada mirando
//    otras filas; guardia R98 aparte).
// =================================================================================================

vi.mock("@/lib/actions/estado-cuenta", () => ({ verEstadoCuentaAction: vi.fn(async () => ({ status: "forbidden" })) }));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: vi.fn(async () => ({ status: "forbidden" })) }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: vi.fn() }));

import { EstadoCuenta } from "@/components/shared/estado-cuenta/EstadoCuenta";
import { PANEL_TIENDA, ROTULOS_TIENDA } from "@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda";

function montar(inicial: EstadoCuentaDTO) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <EstadoCuenta descargaDeLaSuperficie={{ ambitoColumnas: "prueba-estado-cuenta" }} inicial={inicial} rotulos={ROTULOS_TIENDA} panel={PANEL_TIENDA} />
      </ToastProvider>
    </SWRConfig>,
  );
}

function filas() {
  const tabla = screen.getByRole("table", { name: "Estado de cuenta de Tania Tienda" });
  // FICHA 463 (R39): de entrada el orden es «Más recientes» y el saldo inicial es la ÚLTIMA fila.
  return within(tabla).getAllByRole("row").slice(1, -1); // sin cabecera ni saldo inicial
}

const PAGO_ANULADO = fila({
  n: 1,
  categoria: "pago_tienda",
  origenTipo: "pago_tienda",
  chip: "pagos",
  abono: null,
  cargo: "4000.00",
  saldoCorrido: "-4000.00",
  anulacion: { motivo: "Se pagó dos veces", por: "Ana Admin", fecha: "2026-09-20", hora: "10:30" },
  registro: { nombre: "Ana Admin", automatico: null },
  anulable: false,
  naceDeUnCierre: false,
});
const SU_ANULACION = fila({
  n: 2,
  fecha: "2026-09-20",
  categoria: "ajuste_credito",
  origenTipo: "pago_tienda",
  chip: "pagos",
  abono: "4000.00",
  cargo: null,
  saldoCorrido: "0.00",
  esContraAsiento: true,
  registro: { nombre: "Ana Admin", automatico: null },
  naceDeUnCierre: false,
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("R25 — el anulado se queda, tachado, con motivo, quién y cuándo", () => {
  it("la fila anulada dice «Anulado el 2026-09-20 por Ana Admin · Se pagó dos veces» y su concepto e importe van tachados", () => {
    montar(estado({ filas: [PAGO_ANULADO, SU_ANULACION], total: 2 }));
    const [anulada] = filas();
    expect(anulada.textContent).toContain("Anulado el 2026-09-20 por Ana Admin · Se pagó dos veces");
    const concepto = within(anulada).getByText("Ordenex le paga a la tienda");
    expect(concepto.className).toContain("line-through");
    const importe = within(anulada).getByText("₡4.000");
    expect(importe.className).toContain("line-through");
  });

  it("el contra-asiento es una fila propia rotulada «Anulación», sin tachar", () => {
    montar(estado({ filas: [PAGO_ANULADO, SU_ANULACION], total: 2 }));
    const [, contra] = filas();
    expect(within(contra).getByText("Anulación")).toBeTruthy();
    expect(within(contra).getByText("Corrección a favor de la tienda").className).not.toContain("line-through");
    expect(contra.textContent).not.toContain("Anulado el");
  });

  it("«Ver» sobre el anulado: el panel dice el estado con quién, cuándo y por qué, y NO ofrece «Anular…»", async () => {
    montar(estado({ filas: [PAGO_ANULADO], total: 1 }));
    fireEvent.click(screen.getByRole("button", { name: /^Ver Ordenex le paga a la tienda/ }));
    const panel = await screen.findByRole("dialog");
    // 458 (revisión final, n3): el panel de la oficina dice también la HORA, como `/mi-wallet`.
    expect(panel.textContent).toContain("Anulado el 2026-09-20 a las 10:30 por Ana Admin · Se pagó dos veces");
    expect(within(panel).queryByRole("button", { name: "Anular…" })).toBeNull();
  });
});

describe("R72 — lo revertido antes de la 458, sin constancia", () => {
  it("dice «motivo no registrado»", () => {
    montar(
      estado({
        filas: [{ ...PAGO_ANULADO, anulacion: { motivo: null, por: null, fecha: "2026-08-01", hora: "10:30" } }],
        total: 1,
      }),
    );
    expect(filas()[0].textContent).toContain("Anulado el 2026-08-01 · motivo no registrado");
  });
});

describe("R71 — el estado lo decide el servidor, no la página", () => {
  it("con su contra-asiento en la MISMA página pero sin `anulacion`, el original NO se pinta anulado", () => {
    montar(estado({ filas: [{ ...PAGO_ANULADO, anulacion: null, anulable: true }, SU_ANULACION], total: 2 }));
    const [original] = filas();
    expect(original.textContent).not.toContain("Anulado");
    expect(within(original).getByText("Ordenex le paga a la tienda").className).not.toContain("line-through");
  });

  it("un anulable vigente ofrece «Anular…» en el panel; el servidor dice `anulable`", async () => {
    montar(estado({ filas: [{ ...PAGO_ANULADO, anulacion: null, anulable: true }], total: 1 }));
    fireEvent.click(screen.getByRole("button", { name: /^Ver Ordenex le paga a la tienda/ }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByRole("button", { name: "Anular…" })).toBeTruthy();
  });
});

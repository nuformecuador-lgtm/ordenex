// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import type { DocumentoCajaDTO, WalletMovimientoDTO } from "@/lib/types/wallet";

// =================================================================================================
// FICHA 458-C (T C.5, design §5.2, D11) — EL LIBRO DE LA CAJA ACTUAL CON «VER» (R58, R60, R63, R65,
// R71, R100)
// =================================================================================================
//
// SUSTITUYE a los bloques de acciones que se retiran con `DocumentoCajaAcciones` y «Reversar»:
// `WalletLedgerAcciones457/459/461` (qué filas ofrecen acciones, anular, ver el comprobante),
// `WalletLedgerAcciones458.test.tsx` entero y `wallet-ledger-reversa.test.tsx` entero (lista en
// `progress/impl_458-C.md`). Lo que medían se mide aquí contra el camino NUEVO:
//
//  - la columna de acciones pasa a «Ver» en TODA fila, con un nombre accesible que identifica la fila;
//    ni «Reversar» ni «Anular…» sueltos en la tabla (D11);
//  - «Anular…» (en el panel) solo en las filas cuyo `documento` del servidor está vigente (R63/R65/R71);
//    y para TODOS los caminos —pago de un gasto, aporte, cobro (propio y completado), corrección, pago
//    de la tienda, gasto/sueldo, indemnización, cobro por rechazo— la llamada es la MISMA:
//    `anularMovimientoAction({ destino: { libro: "caja", movimientoId: <id de la PROPIA fila> }, motivo })`,
//    sin monto; el servidor decide el camino (458-B, TB.9);
//  - una fila anulada se pinta tachada y apagada y su panel dice «Anulado» (R71), sin mirar otras filas;
//  - «Ver comprobante» va al servidor por el destino de la fila (TC.3 heredado);
//  - tras anular, el módulo relee (R60).

const anularMock = vi.fn();
const verMock = vi.fn();
const autoriaMock = vi.fn();
const comoQuedoMock = vi.fn();
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: (...a: unknown[]) => anularMock(...a) }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({
  verComprobanteAction: (...a: unknown[]) => verMock(...a),
  adjuntarComprobanteAction: vi.fn(),
}));
vi.mock("@/lib/actions/libro-caja-autoria", () => ({ autoriaDelLibroCajaAction: (...a: unknown[]) => autoriaMock(...a) }));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: (...a: unknown[]) => comoQuedoMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), show: vi.fn(), dismiss: vi.fn() }),
}));

import { WalletLedger } from "@/app/(app)/wallet/_components/WalletLedger";

let n = 0;
function uuid(): string {
  n += 1;
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function fila(over: Partial<WalletMovimientoDTO>): WalletMovimientoDTO {
  return {
    id: uuid(),
    tipo: "egreso",
    categoria: "egreso_sueldo",
    monto: "1000.00",
    origenTipo: "gasto",
    origenId: null,
    descripcion: "x",
    registradoPor: null,
    fechaMovimiento: "2026-09-20T15:00:00.000Z",
    dueno: "propio",
    documento: null,
    ...over,
  };
}

function doc(tipo: DocumentoCajaDTO["tipo"], extra: Partial<DocumentoCajaDTO> = {}): DocumentoCajaDTO {
  return { tipo, anulado: false, tieneComprobante: false, ...extra };
}

/** Una fila ORIGINAL vigente por cada camino anulable del libro de la caja. */
const ANULABLES: Array<[string, WalletMovimientoDTO]> = [
  ["sueldo", fila({ categoria: "egreso_sueldo", monto: "25000.00", documento: doc("egreso_caja") })],
  ["gasto de Ordenex", fila({ categoria: "egreso_gasto_variable", monto: "1200.00", documento: doc("egreso_caja") })],
  [
    "pago de un gasto de una tienda",
    fila({ categoria: "egreso_pago_por_cuenta_tienda", origenTipo: "pago_por_cuenta_tienda", origenId: uuid(), dueno: "terceros", monto: "10000.00", documento: doc("pago_por_cuenta_tienda", { tieneComprobante: true }) }),
  ],
  [
    "aporte",
    fila({ tipo: "ingreso", categoria: "ingreso_aporte_capital", origenTipo: "aporte_capital", origenId: uuid(), dueno: "capital", monto: "5000.00", documento: doc("aporte_capital") }),
  ],
  [
    "cobro de Ordenex",
    fila({ tipo: "ingreso", categoria: "ingreso_cobro_tienda", origenTipo: "cobro_tienda", origenId: uuid(), monto: "700.00", documento: doc("cobro_tienda") }),
  ],
  [
    "cobro completado por la migración",
    fila({ tipo: "ingreso", categoria: "ingreso_cobro_tienda", origenTipo: "cobro_tienda_completado", origenId: uuid(), monto: "710.00", documento: doc("cobro_tienda") }),
  ],
  [
    "corrección",
    fila({ tipo: "ingreso", categoria: "ingreso_ajuste", origenTipo: "manual", monto: "50.00", documento: doc("ajuste_caja") }),
  ],
  [
    "pago de una tienda a Ordenex",
    fila({ tipo: "ingreso", categoria: "ingreso_abono_tienda", origenTipo: "abono_tienda", origenId: uuid(), dueno: "terceros", monto: "4000.00", documento: doc("abono_tienda") }),
  ],
  [
    "indemnización",
    fila({ categoria: "egreso_indemnizacion", origenTipo: "orden_incidente", origenId: uuid(), monto: "3000.00", documento: doc("indemnizacion") }),
  ],
  [
    "flete del cobro por rechazo",
    fila({ tipo: "ingreso", categoria: "ingreso_flete_devolucion", origenTipo: "gestion_orden", origenId: uuid(), monto: "1800.00", documento: doc("rechazo_tienda_cobro") }),
  ],
  // B3 de la revisión: los dos egresos que el servidor ya anulaba desde la caja y que no traían documento.
  [
    "pago de Ordenex a una tienda",
    fila({ categoria: "egreso_pago_tienda", origenTipo: "pago_tienda", origenId: uuid(), dueno: "terceros", monto: "3000.00", documento: doc("pago_tienda") }),
  ],
  [
    "premio del ranking",
    fila({ categoria: "egreso_pago_mensajero", origenTipo: "ranking_snapshot_fila", origenId: uuid(), monto: "5000.00", documento: doc("premio_del_ranking") }),
  ],
];

const ANULADO = fila({ categoria: "egreso_gasto_variable", monto: "999.00", documento: doc("egreso_caja", { anulado: true, motivoNoRegistrado: true }) });
const CONTRA_ASIENTO = fila({ tipo: "ingreso", categoria: "ingreso_ajuste", monto: "999.00", origenId: ANULADO.id, documento: null });
const DEL_CIERRE = fila({ tipo: "ingreso", categoria: "ingreso_flete", origenTipo: "cierre_dia", origenId: uuid(), monto: "250.00", documento: null });

function Envoltura({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

function pintar(filas: WalletMovimientoDTO[], onCambio = vi.fn()) {
  render(
    <Envoltura>
      <WalletLedger movimientos={filas} onCambio={onCambio} />
    </Envoltura>,
  );
  return { onCambio, user: userEvent.setup() };
}

async function abrirPanel(user: ReturnType<typeof userEvent.setup>, m: WalletMovimientoDTO): Promise<HTMLElement> {
  const tabla = screen.getByRole("table", { name: "Libro de movimientos" });
  const filas = within(tabla).getAllByRole("row").slice(1);
  const indice = filasActuales.indexOf(m);
  await user.click(within(filas[indice]).getByRole("button", { name: /^Ver .+ del .+ por / }));
  return screen.findByRole("dialog");
}

let filasActuales: WalletMovimientoDTO[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  anularMock.mockResolvedValue({ status: "ok", camino: "egreso_caja" });
  autoriaMock.mockImplementation(async ({ movimientoIds }: { movimientoIds: string[] }) => ({
    status: "ok",
    filas: movimientoIds.map((id) => ({
      movimientoId: id,
      aQuien: { nombre: "Ana Mora", beneficiario: null, cuenta: null, esOrdenex: false },
      registro: { nombre: "Maestra", automatico: null },
    })),
  }));
  comoQuedoMock.mockResolvedValue({ status: "ok", comoQuedo: { caja: null, cuenta: null } });
});
afterEach(() => cleanup());

describe("458-C TC.5 — la columna de acciones pasa a «Ver» (D11)", () => {
  it("TODA fila tiene «Ver» con un nombre que la identifica; no quedan «Reversar» ni «Anular…» en la tabla", () => {
    filasActuales = [...ANULABLES.map(([, m]) => m), ANULADO, CONTRA_ASIENTO, DEL_CIERRE];
    pintar(filasActuales);
    const tabla = screen.getByRole("table", { name: "Libro de movimientos" });
    const ver = within(tabla).getAllByRole("button", { name: /^Ver .+ del .+ por / });
    expect(ver).toHaveLength(filasActuales.length);
    expect(ver[0].getAttribute("aria-label")).toBe("Ver Sueldo del 2026-09-20 por ₡25.000");
    expect(new Set(ver.map((b) => b.getAttribute("aria-label"))).size).toBe(filasActuales.length);
    expect(within(tabla).queryAllByRole("button", { name: /Reversar/ })).toHaveLength(0);
    expect(within(tabla).queryAllByRole("button", { name: /^Anular/ })).toHaveLength(0);
    expect(within(tabla).getByRole("columnheader", { name: "Ver" })).toBeTruthy();
  });

  it("R71: la fila anulada por el servidor se pinta tachada y apagada; las demás no", () => {
    filasActuales = [ANULABLES[0][1], ANULADO, CONTRA_ASIENTO];
    pintar(filasActuales);
    const filas = within(screen.getByRole("table", { name: "Libro de movimientos" })).getAllByRole("row").slice(1);
    expect(filas[1].className).toMatch(/line-through/);
    expect(filas[0].className).not.toMatch(/line-through/);
    // El contra-asiento no se tacha: el estado lo trae SU fila (null), no se deduce de la otra.
    expect(filas[2].className).not.toMatch(/line-through/);
  });

  it("H6: ningún id de fila ni de documento en la tabla ni en sus nombres accesibles", () => {
    filasActuales = [...ANULABLES.map(([, m]) => m), ANULADO, CONTRA_ASIENTO, DEL_CIERRE];
    pintar(filasActuales);
    const tabla = screen.getByRole("table", { name: "Libro de movimientos" });
    for (const m of filasActuales) {
      expect(tabla.textContent).not.toContain(m.id);
      if (m.origenId) expect(tabla.textContent).not.toContain(m.origenId);
    }
    for (const el of tabla.querySelectorAll("[aria-label]")) {
      expect(el.getAttribute("aria-label")).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
  });
});

describe("458-C R63/R64 — «Anular…» desde el panel, por la acción ÚNICA con el id de la PROPIA fila", () => {
  for (const [nombre, m] of ANULABLES) {
    it(`${nombre}: el panel ofrece «Anular…» y manda { destino: caja + id de la fila, motivo }, sin monto; relee`, async () => {
      filasActuales = [m];
      const { user, onCambio } = pintar(filasActuales);
      const panel = await abrirPanel(user, m);
      await user.click(within(panel).getByRole("button", { name: "Anular…" }));
      const dialogo = await screen.findByRole("dialog", { name: /^Anular / });
      await user.type(within(dialogo).getByLabelText(/^Motivo de la anulación/), "Error de registro");
      await user.click(within(dialogo).getByRole("button", { name: "Anular" }));
      await waitFor(() => expect(anularMock).toHaveBeenCalledTimes(1));
      expect(anularMock).toHaveBeenCalledWith({ destino: { libro: "caja", movimientoId: m.id }, motivo: "Error de registro" });
      await waitFor(() => expect(onCambio).toHaveBeenCalledTimes(1));
    });
  }

  for (const [nombre, m] of [
    ["un contra-asiento", CONTRA_ASIENTO],
    ["una fila del cierre", DEL_CIERRE],
    ["una fila ya anulada", ANULADO],
  ] as const) {
    it(`R65: ${nombre} NO ofrece «Anular…» en su panel`, async () => {
      filasActuales = [m];
      const { user } = pintar(filasActuales);
      const panel = await abrirPanel(user, m);
      expect(within(panel).queryByRole("button", { name: "Anular…" })).toBeNull();
    });
  }

  it("R71/R72: el panel de la fila anulada dice «Anulado · motivo no registrado» (lo trae SU fila)", async () => {
    filasActuales = [ANULADO];
    const { user } = pintar(filasActuales);
    const panel = await abrirPanel(user, ANULADO);
    expect(within(panel).getByText("Anulado · motivo no registrado")).toBeTruthy();
  });
});

describe("458-C — lo demás del panel desde el libro", () => {
  it("R56/R57: pide la autoría de ESA fila al abrir (una lectura) y la pinta; «Cómo quedó» por su destino", async () => {
    const m = ANULABLES[0][1];
    filasActuales = [m];
    const { user } = pintar(filasActuales);
    expect(autoriaMock).not.toHaveBeenCalled();
    const panel = await abrirPanel(user, m);
    expect(await within(panel).findByText("Ana Mora")).toBeTruthy();
    expect(within(panel).getByText("Maestra")).toBeTruthy();
    expect(autoriaMock).toHaveBeenCalledWith({ movimientoIds: [m.id] });
    expect(comoQuedoMock).toHaveBeenCalledWith({ destino: { libro: "caja", movimientoId: m.id } });
  });

  it("TC.3: «Ver comprobante» del pago de un gasto va al servidor por el destino de la fila", async () => {
    const m = ANULABLES[2][1];
    verMock.mockResolvedValue({ status: "sin_comprobante" });
    const open = vi.spyOn(window, "open").mockReturnValue({ close: vi.fn(), opener: null, location: { href: "" } } as unknown as Window);
    filasActuales = [m];
    const { user } = pintar(filasActuales);
    const panel = await abrirPanel(user, m);
    await user.click(within(panel).getByRole("button", { name: /^Ver comprobante/ }));
    await waitFor(() => expect(verMock).toHaveBeenCalledWith({ destino: { libro: "caja", movimientoId: m.id } }));
    open.mockRestore();
  });

  it("R79: la corrección y el sueldo sin comprobante ofrecen «Adjuntar»; el aporte (en su documento) no", async () => {
    for (const [i, espera] of [[0, true], [6, true], [3, false]] as const) {
      const m = ANULABLES[i][1];
      filasActuales = [m];
      const { user } = pintar(filasActuales);
      const panel = await abrirPanel(user, m);
      expect(within(panel).queryByRole("button", { name: "Adjuntar comprobante" }) !== null, ANULABLES[i][0]).toBe(espera);
      cleanup();
    }
  });

  it("R100: el cobro por rechazo dice en palabras que es un cargo a la tienda", async () => {
    const m = ANULABLES[9][1];
    filasActuales = [m];
    const { user } = pintar(filasActuales);
    const panel = await abrirPanel(user, m);
    expect(within(panel).getByText(/Es un cobro a la tienda por el flete de un rechazo/)).toBeTruthy();
  });
});


// ─── Revisión 458-C: B2 (la fila anulada DICE «Anulado»), B3 (sin documento no hay «Vigente»; el pago a
// una tienda y el premio, anulados, lo dicen) y M1 (quién anuló, cuándo, por qué y cómo, en el panel) ──

const PAGO_TIENDA_ANULADO = fila({
  categoria: "egreso_pago_tienda",
  origenTipo: "pago_tienda",
  origenId: uuid(),
  dueno: "terceros",
  monto: "5000.00",
  documento: doc("pago_tienda", { anulado: true }),
});
const PREMIO_ANULADO = fila({
  categoria: "egreso_pago_mensajero",
  origenTipo: "ranking_snapshot_fila",
  origenId: uuid(),
  monto: "4000.00",
  documento: doc("premio_del_ranking", { anulado: true }),
});
/** Un pago a una tienda que el servidor manda SIN documento (lo que llegaba antes de B3). */
const PAGO_TIENDA_SIN_DOCUMENTO = fila({
  categoria: "egreso_pago_tienda",
  origenTipo: "pago_tienda",
  origenId: uuid(),
  dueno: "terceros",
  monto: "2000.00",
  documento: null,
});

function filaDe(m: WalletMovimientoDTO): HTMLElement {
  const filas = within(screen.getByRole("table", { name: "Libro de movimientos" })).getAllByRole("row").slice(1);
  return filas[filasActuales.indexOf(m)];
}

function lineaDelPanel(panel: HTMLElement, nombre: string): string | null | undefined {
  return within(panel).getByText(nombre, { selector: "dt" }).nextElementSibling?.textContent;
}

describe("458-C revisión B2 — la fila anulada del libro DICE «Anulado» (457 R41, 459 R66, 461 R20/R71)", () => {
  it("la anulada lleva la palabra y su «Ver» lo dice en el nombre accesible; las vigentes y el contra-asiento no", () => {
    filasActuales = [ANULABLES[0][1], ANULADO, CONTRA_ASIENTO, PAGO_TIENDA_ANULADO, PREMIO_ANULADO];
    pintar(filasActuales);
    for (const m of [ANULADO, PAGO_TIENDA_ANULADO, PREMIO_ANULADO]) {
      expect(within(filaDe(m)).getByText("Anulado")).toBeTruthy();
      expect(within(filaDe(m)).getByRole("button", { name: /^Ver / }).getAttribute("aria-label")).toMatch(/ · Anulado$/);
    }
    expect(within(filaDe(ANULADO)).getByRole("button", { name: /^Ver / }).getAttribute("aria-label")).toBe(
      "Ver Gasto de Ordenex del 2026-09-20 por ₡999 · Anulado",
    );
    for (const m of [ANULABLES[0][1], CONTRA_ASIENTO]) {
      expect(within(filaDe(m)).queryByText("Anulado")).toBeNull();
      expect(within(filaDe(m)).getByRole("button", { name: /^Ver / }).getAttribute("aria-label")).not.toMatch(/Anulado/);
    }
  });
});

describe("458-C revisión B3 — el estado del panel es el del servidor, también en el pago a una tienda y el premio", () => {
  for (const [nombre, m] of [
    ["el pago de Ordenex a una tienda", PAGO_TIENDA_ANULADO],
    ["el premio del ranking", PREMIO_ANULADO],
  ] as const) {
    it(`${nombre} anulado: la fila sale tachada, el panel dice «Anulado» y no ofrece «Anular…»`, async () => {
      filasActuales = [m];
      const { user } = pintar(filasActuales);
      expect(filaDe(m).className).toMatch(/line-through/);
      const panel = await abrirPanel(user, m);
      expect(lineaDelPanel(panel, "Estado")).toMatch(/^Anulado/);
      expect(within(panel).queryByText("Vigente")).toBeNull();
      expect(within(panel).queryByRole("button", { name: "Anular…" })).toBeNull();
    });
  }

  it("una fila SIN documento (contra-asiento, cierre, o lo que el servidor no clasificó) NO dice «Vigente»", async () => {
    for (const m of [PAGO_TIENDA_SIN_DOCUMENTO, CONTRA_ASIENTO, DEL_CIERRE]) {
      filasActuales = [m];
      const { user } = pintar(filasActuales);
      const panel = await abrirPanel(user, m);
      expect(lineaDelPanel(panel, "Estado")).toBe("—");
      expect(within(panel).queryByText("Vigente")).toBeNull();
      cleanup();
    }
  });

  it("el pago a una tienda VIGENTE dice «Vigente» y se anula por la acción única con el id de su fila", async () => {
    const m = ANULABLES[10][1];
    filasActuales = [m];
    const { user } = pintar(filasActuales);
    const panel = await abrirPanel(user, m);
    expect(lineaDelPanel(panel, "Estado")).toBe("Vigente");
    await user.click(within(panel).getByRole("button", { name: "Anular…" }));
    const dialogo = await screen.findByRole("dialog", { name: "Anular el pago de Ordenex a una tienda" });
    await user.type(within(dialogo).getByLabelText(/^Motivo de la anulación/), "Cuenta equivocada");
    await user.click(within(dialogo).getByRole("button", { name: "Anular" }));
    await waitFor(() =>
      expect(anularMock).toHaveBeenCalledWith({ destino: { libro: "caja", movimientoId: m.id }, motivo: "Cuenta equivocada" }),
    );
  });
});

describe("458-C revisión M1 — R58: quién anuló, cuándo, por qué y cómo, con lo que devuelve el servidor", () => {
  it("anulado: «Anulado el <día> por <quién> · <motivo>»; «Cómo»: el método y la referencia", async () => {
    autoriaMock.mockResolvedValue({
      status: "ok",
      filas: [
        {
          movimientoId: PAGO_TIENDA_ANULADO.id,
          aQuien: { nombre: "Tienda Norte", beneficiario: null, cuenta: null, esOrdenex: false },
          registro: { nombre: "Maestra", automatico: null },
          como: { metodo: "SINPE", referencia: "SINPE-77" },
          anulacion: { motivo: "Se pagó a la cuenta equivocada", por: "Carla Ruiz", fecha: "2026-09-25" },
        },
      ],
    });
    filasActuales = [PAGO_TIENDA_ANULADO];
    const { user } = pintar(filasActuales);
    const panel = await abrirPanel(user, PAGO_TIENDA_ANULADO);
    await within(panel).findByText("Tienda Norte");
    expect(lineaDelPanel(panel, "Estado")).toBe("Anulado el 2026-09-25 por Carla Ruiz · Se pagó a la cuenta equivocada");
    expect(lineaDelPanel(panel, "Cómo")).toBe("SINPE · referencia SINPE-77");
  });

  it("la referencia anotada a mano sin método; sin «cómo» del servidor, «—»; mientras carga, «Cargando…»", async () => {
    const m = ANULABLES[0][1];
    let responder: (v: unknown) => void = () => undefined;
    autoriaMock.mockReturnValueOnce(new Promise((r) => (responder = r)));
    filasActuales = [m];
    const { user } = pintar(filasActuales);
    const panel = await abrirPanel(user, m);
    expect(lineaDelPanel(panel, "Cómo")).toBe("Cargando…");
    responder({
      status: "ok",
      filas: [
        {
          movimientoId: m.id,
          aQuien: { nombre: "Ana Mora", beneficiario: null, cuenta: null, esOrdenex: false },
          registro: { nombre: "Maestra", automatico: null },
          como: { metodo: null, referencia: "SINPE 8899" },
          anulacion: null,
        },
      ],
    });
    await waitFor(() => expect(lineaDelPanel(panel, "Cómo")).toBe("Referencia SINPE 8899"));
    cleanup();

    autoriaMock.mockResolvedValueOnce({
      status: "ok",
      filas: [
        {
          movimientoId: DEL_CIERRE.id,
          aQuien: { nombre: "Juan", beneficiario: null, cuenta: null, esOrdenex: false },
          registro: { nombre: null, automatico: { accion: "aprobacion_cierre", por: null } },
          como: null,
          anulacion: null,
        },
      ],
    });
    filasActuales = [DEL_CIERRE];
    const otro = pintar(filasActuales);
    const panel2 = await abrirPanel(otro.user, DEL_CIERRE);
    await within(panel2).findByText("Juan");
    expect(lineaDelPanel(panel2, "Cómo")).toBe("—");
  });

  it("vigente: aunque la autoría trajera una anulación, el estado lo decide el `documento` de la fila", async () => {
    const m = ANULABLES[10][1];
    autoriaMock.mockResolvedValue({
      status: "ok",
      filas: [
        {
          movimientoId: m.id,
          aQuien: { nombre: "Tienda Norte", beneficiario: null, cuenta: null, esOrdenex: false },
          registro: { nombre: "Maestra", automatico: null },
          como: { metodo: "efectivo", referencia: null },
          anulacion: { motivo: "x", por: "y", fecha: "2026-09-25" },
        },
      ],
    });
    filasActuales = [m];
    const { user } = pintar(filasActuales);
    const panel = await abrirPanel(user, m);
    await within(panel).findByText("Tienda Norte");
    expect(lineaDelPanel(panel, "Estado")).toBe("Vigente");
    expect(lineaDelPanel(panel, "Cómo")).toBe("Efectivo");
  });
});

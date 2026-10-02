// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import userEvent from "@testing-library/user-event";
import { aplicarPeriodo, diaDelMesActual } from "@/tests/fixtures/periodo-calendario";
import { alternarCasillas, elegirEnBarra, opcionesDelControl, textoDelControl } from "@/tests/fixtures/barra-libro-wallet";

import { ToastProvider } from "@/providers/ToastProvider";
import type { EstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import { FORMA_UUID, UUID_MOV, UUID_TIENDA, estado, fila } from "@/tests/fixtures/estado-cuenta";

// =================================================================================================
// FICHA 458-D (T D.1, design §3.2/§5.1) — EL ESTADO DE CUENTA COMPARTIDO: tarjetas con la frase de quién
// le debe a quién (R18), extracto con el saldo inicial arriba (R20), orden y saldo corrido tal cual los
// manda el servidor (R19, R21, R23), chips por tipo de cuenta (R24), periodo en día CR (R16), «Ver» →
// panel de la 458-C, y ningún identificador en pantalla (H6).
//
// Se monta el módulo con los rótulos REALES de cada superficie (`ROTULOS_TIENDA`, `ROTULOS_MENSAJERO`,
// `ROTULOS_BODEGA`): lo que se mide es lo que el usuario lee.
// =================================================================================================

const verEstadoCuentaMock = vi.fn();
vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: (...a: unknown[]) => verEstadoCuentaMock(...a),
}));
vi.mock("@/lib/actions/como-quedo", () => ({
  comoQuedoAction: vi.fn(async () => ({ status: "forbidden" })),
}));
vi.mock("@/lib/actions/wallet-comprobante", () => ({
  verComprobanteAction: vi.fn(),
  adjuntarComprobanteAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-anulacion", () => ({
  anularMovimientoAction: vi.fn(),
}));

import { EstadoCuenta } from "@/components/shared/estado-cuenta/EstadoCuenta";
import { EstadoCuentaTienda, ROTULOS_TIENDA, PANEL_TIENDA } from "@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda";
import { ROTULOS_MENSAJERO } from "@/app/(app)/wallet/mensajeros/_components/EstadoCuentaMensajero";
import { ROTULOS_BODEGA } from "@/app/(app)/wallet/satelites/_components/EstadoCuentaSatelite";

function envolver(nodo: ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

function montarTienda(inicial: EstadoCuentaDTO) {
  return envolver(<EstadoCuenta descargaDeLaSuperficie={{ ambitoColumnas: "prueba-estado-cuenta" }} inicial={inicial} rotulos={ROTULOS_TIENDA} panel={PANEL_TIENDA} />);
}

function filasDeLaTabla(nombre = "Tania Tienda") {
  const tabla = screen.getByRole("table", { name: `Estado de cuenta de ${nombre}` });
  return within(tabla).getAllByRole("row").slice(1); // sin la cabecera
}

beforeEach(() => {
  vi.clearAllMocks();
  verEstadoCuentaMock.mockImplementation(async () => ({ status: "ok", estado: estado() }));
});

afterEach(() => cleanup());

describe("R18 — las tarjetas dicen quién le debe a quién, en palabras", () => {
  it("tienda con saldo a favor: «Ordenex le debe ₡1.000 a Tania Tienda»", () => {
    montarTienda(estado({ saldoActual: "1000.00", signo: "positivo", sentido: "ordenex_debe" }));
    expect(screen.getByText("Ordenex le debe ₡1.000 a Tania Tienda")).toBeTruthy();
  });

  it("tienda con saldo en contra: «Tania Tienda le debe ₡2.500 a Ordenex» y el saldo con su signo", () => {
    montarTienda(estado({ saldoActual: "-2500.00", signo: "negativo", sentido: "cuenta_debe", saldoFinal: "-2500.00" }));
    expect(screen.getByText("Tania Tienda le debe ₡2.500 a Ordenex")).toBeTruthy();
    const tarjetas = screen.getByRole("region", { name: "Saldo de Tania Tienda" });
    expect(tarjetas.textContent).toContain("-₡2.500");
  });

  it("mensajero: «Ordenex le debe ₡3.500 a Mario Mensajero»", () => {
    envolver(
      <EstadoCuenta descargaDeLaSuperficie={{ ambitoColumnas: "prueba-estado-cuenta" }}
        inicial={estado({ tipo: "mensajero", nombre: "Mario Mensajero", saldoActual: "3500.00", filas: [], total: 0 })}
        rotulos={ROTULOS_MENSAJERO}
      />,
    );
    expect(screen.getByText("Ordenex le debe ₡3.500 a Mario Mensajero")).toBeTruthy();
  });

  it("bodega: «Bodega Norte tiene ₡4.000,10 por entregar»", () => {
    envolver(
      <EstadoCuenta descargaDeLaSuperficie={{ ambitoColumnas: "prueba-estado-cuenta" }}
        inicial={estado({ tipo: "bodega", nombre: "Bodega Norte", saldoActual: "4000.10", filas: [], total: 0 })}
        rotulos={ROTULOS_BODEGA}
      />,
    );
    expect(screen.getByText("Bodega Norte tiene ₡4.000,10 por entregar")).toBeTruthy();
  });

  it("abonos, cargos, saldo inicial y final del periodo: las cifras del SERVIDOR, sin recalcular", () => {
    // Cifras que NO cuadran a propósito: si la pantalla sumara, se notaría.
    montarTienda(estado({ saldoInicial: "10.00", abonos: "20.00", cargos: "5.00", saldoFinal: "999.99" }));
    const tarjetas = screen.getByRole("region", { name: "Saldo de Tania Tienda" });
    expect(tarjetas.textContent).toContain("Saldo inicial₡10");
    expect(tarjetas.textContent).toContain("Abonos del periodo₡20");
    expect(tarjetas.textContent).toContain("Cargos del periodo₡5");
    expect(tarjetas.textContent).toContain("Saldo al final del periodo₡999,99");
  });
});

describe("R19–R21/R23 — el extracto: saldo inicial arriba, orden y saldo corrido del servidor", () => {
  const TRES = [
    fila({ n: 1, fecha: "2026-09-10", abono: "1000.00", saldoCorrido: "1000.00" }),
    fila({
      n: 2,
      fecha: "2026-09-11",
      categoria: "cobro_manual",
      origenTipo: "manual",
      chip: "cobros",
      abono: null,
      cargo: "300.00",
      saldoCorrido: "700.00",
      descripcion: "Cobro de etiquetas",
      registro: { nombre: "Ana Admin", automatico: null },
      tieneComprobante: true,
      anulable: true,
      naceDeUnCierre: false,
    }),
    // El servidor la manda ÚLTIMA aunque su fecha sea anterior: la pantalla no reordena.
    fila({ n: 3, fecha: "2026-09-09", abono: "50.00", saldoCorrido: "750.00" }),
  ];

  // FICHA 463 (R34/R39) — REESCRITO: se entra en «Más recientes» y ahí el saldo inicial cae AL FINAL
  // (la última línea de la última página), donde cae en el tiempo. Antes era siempre la primera.
  it("463 R39: el saldo inicial es la ÚLTIMA línea; las demás, en el orden del servidor con SU saldo corrido", () => {
    montarTienda(estado({ saldoInicial: "0.00", filas: TRES, total: 3 }));
    const filas = filasDeLaTabla();
    expect(filas).toHaveLength(4);
    expect(filas[3].textContent).toContain("Saldo inicial");
    expect(filas[3].textContent).toContain("₡0");
    expect(filas[0].textContent).toContain("2026-09-10");
    expect(filas[0].textContent).toContain("Contra-entrega cobrado a los clientes de la tienda");
    expect(filas[0].textContent).toContain("₡1.000");
    expect(filas[1].textContent).toContain("Ordenex le cobra a la tienda");
    expect(filas[1].textContent).toContain("Cobro de etiquetas");
    expect(filas[1].textContent).toContain("Registró: Ana Admin");
    expect(filas[1].textContent).toContain("Con comprobante");
    expect(filas[1].textContent).toContain("₡700");
    expect(filas[2].textContent).toContain("2026-09-09");
    expect(filas[2].textContent).toContain("₡750");
  });

  it("lo automático dice qué lo produjo y quién lo decidió (R57)", () => {
    montarTienda(estado({ filas: [TRES[0]], total: 1 }));
    expect(filasDeLaTabla()[0].textContent).toContain("Registró: Automático · Aprobación del cierre por Ana Admin");
  });

  it("R21: con un chip, el saldo corrido sigue siendo el de la cuenta ENTERA (el que manda el servidor)", async () => {
    const user = userEvent.setup();
    montarTienda(estado({ filas: TRES, total: 3 }));
    verEstadoCuentaMock.mockResolvedValueOnce({
      status: "ok",
      estado: estado({ filas: [TRES[1]], total: 1 }),
    });
    // FICHA 467: el chip es una opción de la casilla «Tipo de movimiento».
    await elegirEnBarra(user, document.body, "Tipo de movimiento", "Cobros");
    await waitFor(() => {
      expect(filasDeLaTabla()).toHaveLength(2);
      expect(filasDeLaTabla()[0].textContent).toContain("Ordenex le cobra a la tienda");
    });
    expect(filasDeLaTabla()[0].textContent).toContain("₡700");
  });

  // FICHA 463 (R39) — REESCRITO: con «Más recientes» el saldo inicial va en la ÚLTIMA página y en
  // ninguna otra. 21 movimientos de 20 en 20: la página 1 no lo lleva y la 2 lo cierra.
  it("463 R39: la página 1 no lleva el saldo inicial; la última lo lleva al final, una sola vez", async () => {
    const muchas = Array.from({ length: 20 }, (_, i) => fila({ n: i + 1 }));
    verEstadoCuentaMock.mockImplementation(async (input: { page: number }) => ({
      status: "ok",
      estado:
        input.page === 2
          ? estado({ filas: [fila({ n: 30, fecha: "2026-09-30" })], total: 21, page: 2 })
          : estado({ filas: muchas, total: 21 }),
    }));
    montarTienda(estado({ filas: muchas, total: 21 }));
    expect(filasDeLaTabla()).toHaveLength(20);
    for (const f of filasDeLaTabla()) expect(f.textContent).not.toContain("Saldo inicial");
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    await waitFor(() => {
      expect(filasDeLaTabla()).toHaveLength(2);
      expect(filasDeLaTabla()[0].textContent).toContain("2026-09-30");
    });
    expect(verEstadoCuentaMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cuenta: { tipo: "tienda", id: UUID_TIENDA }, page: 2 }),
    );
    expect(filasDeLaTabla()[0].textContent).not.toContain("Saldo inicial");
    expect(filasDeLaTabla()[1].textContent).toContain("Saldo inicial");
  });
});

// FICHA 467 (R21) — los chips son las opciones de la casilla «Tipo de movimiento», sin «Todo»: sin
// elección ya son todos, y lo dice el disparador («Tipo de movimiento: Todo»).
describe("R24 — los chips por tipo de cuenta (D10)", () => {
  async function chips(): Promise<string[]> {
    return opcionesDelControl(userEvent.setup(), document.body, "Tipo de movimiento");
  }

  it("tienda: Cierres · Pagos · Cobros · Correcciones", async () => {
    montarTienda(estado());
    expect(await chips()).toEqual(["Cierres", "Pagos", "Cobros", "Correcciones"]);
    expect(textoDelControl(document.body, "Tipo de movimiento")).toBe("Tipo de movimiento: Todo");
  });

  it("mensajero: Cierres · Pagos · Premios · Correcciones", async () => {
    envolver(<EstadoCuenta descargaDeLaSuperficie={{ ambitoColumnas: "prueba-estado-cuenta" }} inicial={estado({ tipo: "mensajero", nombre: "Mario" })} rotulos={ROTULOS_MENSAJERO} />);
    expect(await chips()).toEqual(["Cierres", "Pagos", "Premios", "Correcciones"]);
  });

  it("bodega: Declarado · Recibido", async () => {
    envolver(<EstadoCuenta descargaDeLaSuperficie={{ ambitoColumnas: "prueba-estado-cuenta" }} inicial={estado({ tipo: "bodega", nombre: "Bodega", filas: [] })} rotulos={ROTULOS_BODEGA} />);
    expect(await chips()).toEqual(["Declarado", "Recibido"]);
  });

  it("elegir un chip lo pide al servidor desde la página 1; quitar la casilla («Todo») no manda chip", async () => {
    const user = userEvent.setup();
    montarTienda(estado());
    await elegirEnBarra(user, document.body, "Tipo de movimiento", "Pagos");
    await waitFor(() =>
      expect(verEstadoCuentaMock).toHaveBeenLastCalledWith({
        cuenta: { tipo: "tienda", id: UUID_TIENDA },
        chip: "pagos",
        page: 1,
        pageSize: 20,
      }),
    );
    await alternarCasillas(user, document.body, "Tipo de movimiento");
    // «Todo» con la página 1 es la lectura inicial: la trae el caché, sin clave `chip`.
    const llamadas = verEstadoCuentaMock.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(llamadas.every((l) => l.chip === undefined || l.chip === "pagos")).toBe(true);
  });
});

// FICHA 463 — REESCRITO: el periodo es un calendario (antes, dos `input[type=date]`). Con el calendario
// un «desde» posterior a «hasta» no se puede elegir: los extremos se ordenan solos.
// FICHA 467 — y vive en la casilla «Periodo» de la barra única, sin «Aplicar»: se aplica solo.
describe("R16 — el periodo: días de Costa Rica tal como se eligen", () => {
  it("aplicar manda `desde` y `hasta` como YYYY-MM-DD y vuelve a la página 1", async () => {
    const user = userEvent.setup();
    montarTienda(estado());
    await aplicarPeriodo(user, document.body, 1, 15);
    await waitFor(() =>
      expect(verEstadoCuentaMock).toHaveBeenLastCalledWith({
        cuenta: { tipo: "tienda", id: UUID_TIENDA },
        desde: diaDelMesActual(1),
        hasta: diaDelMesActual(15),
        page: 1,
        pageSize: 20,
      }),
    );
    expect(verEstadoCuentaMock).toHaveBeenCalledTimes(1); // 463 R16 / 467 R14: una sola lectura
    // R20: con periodo, la línea del saldo inicial es la DEL PERIODO, fechada el primer día. Con «Más
    // recientes» (463 R39) cierra la última página.
    await waitFor(() => {
      const filas = filasDeLaTabla();
      expect(filas[filas.length - 1].textContent).toContain("Saldo inicial del periodo");
    });
    const filas = filasDeLaTabla();
    expect(filas[filas.length - 1].textContent).toContain(diaDelMesActual(1));
  });

  it("467 R3/R35: no hay «Aplicar» y no se lee nada al entrar", () => {
    montarTienda(estado());
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
    expect(verEstadoCuentaMock).not.toHaveBeenCalled();
  });
});

describe("«Ver» → el panel de la 458-C, y H6", () => {
  it("«Ver» abre el panel con el concepto de la fila; el nombre accesible dice concepto, día e importe", async () => {
    montarTienda(
      estado({
        filas: [fila({ n: 2, categoria: "cobro_manual", origenTipo: "manual", abono: null, cargo: "300.00", naceDeUnCierre: false })],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ver Ordenex le cobra a la tienda del 2026-09-12 por ₡300" }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Ordenex le cobra a la tienda")).toBeTruthy();
    // «A quién» = la cuenta; «Registró» = lo que trae la fila.
    expect(panel.textContent).toContain("Tania Tienda");
    expect(panel.textContent).toContain("Automático · Aprobación del cierre por Ana Admin");
  });

  it("la bodega no tiene filas de libro: sin «Ver»", () => {
    envolver(
      <EstadoCuenta descargaDeLaSuperficie={{ ambitoColumnas: "prueba-estado-cuenta" }}
        inicial={estado({
          tipo: "bodega",
          nombre: "Bodega",
          filas: [fila({ ref: null, consolidacionId: UUID_MOV(9), categoria: "declarado", origenTipo: "cierre_bodega", cargo: "500.00", abono: null, chip: "declarado" })],
        })}
        rotulos={ROTULOS_BODEGA}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Ver / })).toBeNull();
    expect(filasDeLaTabla("Bodega")[0].textContent).toContain("Consolidación declarada");
  });

  it("H6: ningún uuid en el texto ni en los nombres accesibles", () => {
    const { container } = montarTienda(
      estado({ filas: [fila({ n: 1 }), fila({ n: 2, categoria: "pago_tienda", origenTipo: "pago_tienda", chip: "pagos", anulable: true })], total: 2 }),
    );
    expect(container.textContent ?? "").not.toMatch(FORMA_UUID);
    for (const el of Array.from(container.querySelectorAll("[aria-label]"))) {
      expect(el.getAttribute("aria-label") ?? "").not.toMatch(FORMA_UUID);
    }
  });
});

describe("R5 (171) / R82 — el fallo se dice y el permiso lo decide el servidor", () => {
  // FICHA 463 (R49) — el contrato pasa de «el aviso SUSTITUYE la tabla» a «el aviso va JUNTO al libro,
  // que se queda con la última lectura buena, y el filtro vuelve a la de esa lectura».
  it("si la lectura con otro chip falla, se dice JUNTO al libro, que sigue en pie con las tarjetas y el chip de antes", async () => {
    const user = userEvent.setup();
    montarTienda(estado());
    const filasAntes = filasDeLaTabla().map((f) => f.textContent);
    verEstadoCuentaMock.mockResolvedValue({ status: "forbidden" });
    await elegirEnBarra(user, document.body, "Tipo de movimiento", "Pagos");
    const aviso = await screen.findByText(/^No se pudo cargar el estado de cuenta\. Se sigue mostrando lo último/);
    expect(aviso).toHaveAttribute("role", "alert");
    expect(screen.getByRole("region", { name: "Saldo de Tania Tienda" })).toBeInTheDocument();
    expect(filasDeLaTabla().map((f) => f.textContent)).toEqual(filasAntes);
    expect(filasAntes.length).toBeGreaterThan(1);
    await waitFor(() => expect(textoDelControl(document.body, "Tipo de movimiento")).toBe("Tipo de movimiento: Todo"));
  });

  it("sin permiso de registrar (lo decide la página con `esAccesoTotal`), no hay acciones", () => {
    envolver(<EstadoCuentaTienda inicial={estado()} puedeRegistrar={false} />);
    expect(screen.queryByRole("region", { name: "Acciones sobre la cuenta de Tania Tienda" })).toBeNull();
    expect(screen.queryByRole("button", { name: /le paga|le cobra/ })).toBeNull();
  });
});

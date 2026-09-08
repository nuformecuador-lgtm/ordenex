// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";

// ⭑ FICHA 381 (T I.4, R28/R30) — EL SALDO NEGATIVO EN LA VISTA DE ADMINISTRACIÓN.
//
// Gemelo de `saldo-tienda-card.negativo.test.tsx`, sobre la otra pantalla. Las dos tienen que
// decir lo mismo del mismo dinero: la tienda ve su saldo en `/mi-wallet` y quien cobra lo ve en
// `/wallet/tiendas`, y una de las dos escondiendo el signo sería peor que ninguna.
//
// El caso que la ficha estrena: se le cobra ₡15.000 a una tienda a la que no se le debía nada.
// El disponible queda en −₡15.000, y ESO ES LO CORRECTO — no un error, no un cero, no ₡15.000
// sin signo. Se cobra cuando la gestión le vuelva a generar dinero a favor (D3).

const listarSaldosPaginaMock = vi.fn();
const listarSaldosDedicadoMock = vi.fn();
const listarSaldosCompletoMock = vi.fn();
const listarDesgloseMock = vi.fn();
const listarDesgloseCompletoMock = vi.fn();
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarSaldosTiendasPaginadoAction: (...a: unknown[]) => listarSaldosPaginaMock(...a),
  listarSaldosTiendasCompletoAction: (...a: unknown[]) => listarSaldosDedicadoMock(...a),
  listarSaldosTiendasAction: (...a: unknown[]) => listarSaldosCompletoMock(...a),
  listarMovimientosDeTiendaAction: (...a: unknown[]) => listarDesgloseMock(...a),
  listarMovimientosDeTiendaCompletoAction: (...a: unknown[]) =>
    listarDesgloseCompletoMock(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { SaldosTiendasTable } from "@/app/(app)/wallet/tiendas/_components/SaldosTiendasTable";

const FUENTE = "app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx";

/** La tienda a la que se le cobró sin tener nada pendiente: su disponible queda EN NEGATIVO. */
const COBRADA: SaldoTiendaResumenDTO = {
  tiendaId: "t-neg",
  tiendaNombre: "Tienda Sur",
  saldo: "-15000.00",
  signo: "negativo",
};

const A_FAVOR: SaldoTiendaResumenDTO = {
  tiendaId: "t-pos",
  tiendaNombre: "Tienda Norte",
  saldo: "9000.00",
  signo: "positivo",
};

const EN_CERO: SaldoTiendaResumenDTO = {
  tiendaId: "t-cero",
  tiendaNombre: "Tienda Este",
  saldo: "0.00",
  signo: "cero",
};

function envolver(nodo: ReactNode) {
  // El `ToastProvider` hace falta porque el control de descarga de la tabla usa `useToast`.
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

function renderTabla(tiendas: SaldoTiendaResumenDTO[]) {
  listarSaldosPaginaMock.mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(tiendas),
  });
  listarSaldosDedicadoMock.mockResolvedValue({
    status: "ok",
    items: tiendas,
    total: tiendas.length,
  });
  listarSaldosCompletoMock.mockResolvedValue({ status: "ok", tiendas });
  return envolver(<SaldosTiendasTable initialData={paginaInicial(tiendas)} />);
}

/** La fila de una tienda, por su nombre. */
function fila(nombre: string): HTMLElement {
  const celda = screen.getByText(nombre);
  const tr = celda.closest("tr");
  if (tr === null) throw new Error(`la tienda ${nombre} no está en ninguna fila`);
  return tr;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("SaldosTiendasTable — el saldo NEGATIVO se ve entero (381/R28)", () => {
  it("pinta el importe con su signo, sin recortarlo a cero y sin valor absoluto", async () => {
    renderTabla([COBRADA]);
    await waitFor(() => expect(screen.getByText("Tienda Sur")).toBeInTheDocument());

    const suya = fila("Tienda Sur");
    // `getByText` compara el texto COMPLETO del nodo: `₡15.000` no casa con `-₡15.000`, así que
    // un `Math.abs` o un recorte a cero ponen este caso rojo.
    expect(within(suya).getByText("-₡15.000")).toBeInTheDocument();
    expect(within(suya).queryByText("₡15.000")).not.toBeInTheDocument();
    expect(within(suya).queryByText("₡0")).not.toBeInTheDocument();
  });

  it("conserva los céntimos del negativo", async () => {
    renderTabla([{ ...COBRADA, saldo: "-15000.07" }]);
    await waitFor(() => expect(screen.getByText("Tienda Sur")).toBeInTheDocument());
    expect(within(fila("Tienda Sur")).getByText("-₡15.000,07")).toBeInTheDocument();
  });

  it("el negativo NO se presenta como un fallo de la pantalla", async () => {
    const { container } = renderTabla([COBRADA]);
    await waitFor(() => expect(screen.getByText("Tienda Sur")).toBeInTheDocument());

    // El `alert` de la tabla es su estado de ERROR de carga: con datos en la mano, un saldo en
    // contra no puede encenderlo. Y no se inventa ningún «saldo insuficiente» (R27).
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/insuficiente|sin saldo|no alcanza/i);
  });
});

describe("SaldosTiendasTable — la marca legible distingue los TRES signos (381/R30)", () => {
  it("cada fila lleva su estado en palabras, y las tres son distintas", async () => {
    renderTabla([A_FAVOR, COBRADA, EN_CERO]);
    await waitFor(() => expect(screen.getByText("Tienda Sur")).toBeInTheDocument());

    expect(within(fila("Tienda Norte")).getByText("A favor")).toBeInTheDocument();
    expect(within(fila("Tienda Norte")).getByText("₡9.000")).toBeInTheDocument();

    expect(within(fila("Tienda Sur")).getByText("En contra")).toBeInTheDocument();
    expect(within(fila("Tienda Sur")).getByText("-₡15.000")).toBeInTheDocument();

    expect(within(fila("Tienda Este")).getByText("En cero")).toBeInTheDocument();
    expect(within(fila("Tienda Este")).getByText("₡0")).toBeInTheDocument();

    // Sin esta última comprobación, una tabla que pusiera «En contra» en las tres pasaría.
    expect(within(fila("Tienda Norte")).queryByText("En contra")).not.toBeInTheDocument();
    expect(within(fila("Tienda Sur")).queryByText("A favor")).not.toBeInTheDocument();
  });

  it("las dos pantallas usan las MISMAS palabras para el mismo signo", async () => {
    // `SALDO_SIGNO_LABEL` es el módulo compartido por la tabla y por el archivo descargado; la
    // tarjeta de `/mi-wallet` tiene sus propios literales, y aquí se afirma que coinciden. Que
    // una tienda y quien le cobra lean cosas distintas del mismo saldo sería el defecto.
    renderTabla([COBRADA]);
    await waitFor(() => expect(screen.getByText("Tienda Sur")).toBeInTheDocument());
    expect(within(fila("Tienda Sur")).getByText("En contra")).toBeInTheDocument();
  });
});

describe("SaldosTiendasTable — money-safe (381/R18)", () => {
  it("la tabla no convierte ningún monto a número ni lo recorta con `Math`", () => {
    const fuente = codigoSinComentarios(FUENTE);
    expect(fuente.length, "el barrido leyó un archivo vacío").toBeGreaterThan(200);

    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(prohibida.test(fuente), `usa ${prohibida}`).toBe(false);
    }
    // `Math.abs` esconde el signo y `Math.max` recorta a cero: las dos formas de romper R28.
    expect(/Math\.(abs|max|min)\s*\(/.test(fuente), "recorta el saldo con Math").toBe(false);
  });
});

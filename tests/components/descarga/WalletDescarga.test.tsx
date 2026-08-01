// @vitest-environment jsdom
// Feature 170 (T C.4) — descarga de los CUATRO ledgers de dinero paginados: libro de caja,
// desglose de un mensajero (maestro/admin), mi wallet (tienda) y mis pagos (mensajero).
// Cubre R1, R3, R9, R10, R13 y R32.
//
// Los cuatro son de FAMILIA A y tres de ellos son componentes de PRESENTACIÓN que reciben la
// página por props. Eso plantea el riesgo que estos tests cierran: para descargar el ledger
// entero hace falta la acción del modo completo CON los filtros vigentes, y la tentación es
// que la tabla se ponga a fetchear. No lo hace: el módulo padre —que es quien conoce los
// filtros— baja un callback (design §5). Aquí se comprueban las dos mitades: que el archivo
// trae el ledger entero con los filtros aplicados y que los tres componentes de presentación
// siguen sin importar una sola Server Action.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows, XLSX_MIME } from "@/lib/utils/xlsx-template";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";
import type {
  CuentaPorPagarResumenDTO,
  PagoMensajeroMovimientoDTO,
} from "@/lib/types/wallet-mensajero";

const listarMovimientosMock = vi.fn();
const listarMovimientosCompletoMock = vi.fn();
const verBalanceMock = vi.fn();
vi.mock("@/lib/actions/wallet", () => ({
  listarMovimientosAction: (...a: unknown[]) => listarMovimientosMock(...a),
  listarMovimientosCompletoAction: (...a: unknown[]) => listarMovimientosCompletoMock(...a),
  verBalanceAction: (...a: unknown[]) => verBalanceMock(...a),
}));

const listarMisMovimientosMock = vi.fn();
const listarMisMovimientosCompletoMock = vi.fn();
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarMisMovimientosAction: (...a: unknown[]) => listarMisMovimientosMock(...a),
  listarMisMovimientosCompletoAction: (...a: unknown[]) =>
    listarMisMovimientosCompletoMock(...a),
}));

const listarMisPagosMock = vi.fn();
const listarMisPagosCompletoMock = vi.fn();
const listarPagosDeMensajeroMock = vi.fn();
const listarPagosDeMensajeroCompletoMock = vi.fn();
vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarMisPagosAction: (...a: unknown[]) => listarMisPagosMock(...a),
  listarMisPagosCompletoAction: (...a: unknown[]) => listarMisPagosCompletoMock(...a),
  listarPagosDeMensajeroAction: (...a: unknown[]) => listarPagosDeMensajeroMock(...a),
  listarPagosDeMensajeroCompletoAction: (...a: unknown[]) =>
    listarPagosDeMensajeroCompletoMock(...a),
}));

vi.mock("@/lib/actions/wallet-egresos", () => ({
  reversarEgresoAdministrativoAction: vi.fn(),
  verDesgloseEgresosAction: vi.fn(async () => ({ status: "ok", desglose: {} })),
}));
vi.mock("@/lib/actions/gasto-fijo-plantilla", () => ({
  listarPlantillasAction: vi.fn(async () => ({ status: "ok", plantillas: [] })),
  setActivaPlantillaAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

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

import { WalletModule } from "@/app/(app)/wallet/_components/WalletModule";
import { MiWalletModule } from "@/app/(app)/mi-wallet/_components/MiWalletModule";
import { MisPagosModule } from "@/app/(app)/mis-pagos/_components/MisPagosModule";
import { DesglosePagosMensajero } from "@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero";

// --- Datos ---------------------------------------------------------------

function movimientoCaja(i: number): WalletMovimientoDTO {
  return {
    id: `m-${i}`,
    tipo: "ingreso",
    categoria: "ingreso_flete",
    monto: `${1000 + i}.10`,
    origenTipo: "cierre_dia",
    origenId: `o-${i}`,
    descripcion: `Movimiento ${i}`,
    registradoPor: null,
    fechaMovimiento: `2026-07-${String(10 + i).padStart(2, "0")}T14:00:00.000Z`,
  };
}

function movimientoTienda(i: number): WalletTiendaMovimientoDTO {
  return {
    id: `t-${i}`,
    tiendaId: "tienda-1",
    tipo: "credito",
    categoria: "cod_recaudado",
    monto: `${500 + i}.25`,
    origenTipo: "cierre_dia",
    origenId: `o-${i}`,
    descripcion: `Crédito ${i}`,
    fechaMovimiento: `2026-07-${String(10 + i).padStart(2, "0")}T14:00:00.000Z`,
  };
}

function pagoMensajero(i: number): PagoMensajeroMovimientoDTO {
  return {
    id: `p-${i}`,
    mensajeroId: "mensajero-1",
    tipo: "devengo",
    categoria: "pago_devengado",
    monto: `${300 + i}.50`,
    origenTipo: "cierre_dia",
    origenId: `o-${i}`,
    descripcion: `Devengo ${i}`,
    fechaMovimiento: `2026-07-${String(10 + i).padStart(2, "0")}T14:00:00.000Z`,
  };
}

const CAJA_PAGINA = [movimientoCaja(1), movimientoCaja(2)];
const CAJA_TODOS = Array.from({ length: 5 }, (_, i) => movimientoCaja(i + 1));
const TIENDA_PAGINA = [movimientoTienda(1)];
const TIENDA_TODOS = Array.from({ length: 4 }, (_, i) => movimientoTienda(i + 1));
const PAGOS_PAGINA = [pagoMensajero(1)];
const PAGOS_TODOS = Array.from({ length: 4 }, (_, i) => pagoMensajero(i + 1));

const BALANCE = { ingresos: "1.00", egresos: "0.00", balance: "1.00", signo: "positivo" as const };
const DESGLOSE_EGRESOS = {} as never;
const SALDO_TIENDA = {
  creditos: "500.25",
  debitos: "0.00",
  saldo: "500.25",
  signo: "positivo" as const,
};
const CUENTA = {
  devengado: "300.50",
  pagado: "0.00",
  cuentaPorPagar: "300.50",
  signo: "positivo" as const,
};
const RESUMEN_MENSAJERO: CuentaPorPagarResumenDTO = {
  mensajeroId: "mensajero-1",
  mensajeroNombre: "Ana Mensajera",
  devengado: "300.50",
  pagado: "0.00",
  cuentaPorPagar: "300.50",
  signo: "positivo",
};

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

function renderCaja() {
  return envolver(
    <WalletModule
      movimientos={CAJA_PAGINA}
      total={80}
      page={1}
      pageSize={20}
      balance={BALANCE}
      desglose={DESGLOSE_EGRESOS}
      plantillas={[]}
    />,
  );
}

function renderMiWallet() {
  return envolver(
    <MiWalletModule
      movimientos={TIENDA_PAGINA}
      total={60}
      page={1}
      pageSize={20}
      saldo={SALDO_TIENDA}
    />,
  );
}

function renderMisPagos() {
  return envolver(
    <MisPagosModule
      movimientos={PAGOS_PAGINA}
      total={60}
      page={1}
      pageSize={20}
      cuenta={CUENTA}
    />,
  );
}

function renderDesgloseMensajero() {
  return envolver(<DesglosePagosMensajero resumen={RESUMEN_MENSAJERO} />);
}

/** Los cuatro ledgers: cómo se montan, cómo se llama su control y qué acción usan. */
const LEDGERS = [
  {
    titulo: "Libro de movimientos",
    tabla: "Libro de movimientos",
    montar: renderCaja,
    completo: listarMovimientosCompletoMock,
    todos: CAJA_TODOS,
    pagina: CAJA_PAGINA,
  },
  {
    titulo: "Desglose de movimientos",
    tabla: "Desglose de movimientos",
    montar: renderMiWallet,
    completo: listarMisMovimientosCompletoMock,
    todos: TIENDA_TODOS,
    pagina: TIENDA_PAGINA,
  },
  {
    titulo: "Desglose de pagos",
    tabla: "Desglose de pagos",
    montar: renderMisPagos,
    completo: listarMisPagosCompletoMock,
    todos: PAGOS_TODOS,
    pagina: PAGOS_PAGINA,
  },
  {
    titulo: `Desglose de ${RESUMEN_MENSAJERO.mensajeroNombre}`,
    // El nombre accesible de la TABLA no es el del control: la tabla se llama "Desglose por
    // cierre de X" desde la 44 y esta feature no le cambia el nombre a ninguna pantalla.
    tabla: `Desglose por cierre de ${RESUMEN_MENSAJERO.mensajeroNombre}`,
    montar: renderDesgloseMensajero,
    completo: listarPagosDeMensajeroCompletoMock,
    todos: PAGOS_TODOS,
    pagina: PAGOS_PAGINA,
  },
] as const;

/** Deja todos los dobles en su respuesta por defecto (página + dataset completo). */
function cebarDobles() {
  listarMovimientosMock.mockResolvedValue({
    status: "ok",
    data: { movimientos: CAJA_PAGINA, total: 80, page: 1 },
  });
  verBalanceMock.mockResolvedValue({ status: "ok", balance: BALANCE });
  listarMisMovimientosMock.mockResolvedValue({
    status: "ok",
    data: { movimientos: TIENDA_PAGINA, total: 60, page: 1, saldo: SALDO_TIENDA },
  });
  listarMisPagosMock.mockResolvedValue({
    status: "ok",
    data: { movimientos: PAGOS_PAGINA, total: 60, page: 1, cuenta: CUENTA },
  });
  listarPagosDeMensajeroMock.mockResolvedValue({
    status: "ok",
    data: { movimientos: PAGOS_PAGINA, total: 60, page: 1, pageSize: 20, cuenta: CUENTA },
  });
  listarMovimientosCompletoMock.mockResolvedValue({
    status: "ok",
    items: CAJA_TODOS,
    total: CAJA_TODOS.length,
  });
  listarMisMovimientosCompletoMock.mockResolvedValue({
    status: "ok",
    items: TIENDA_TODOS,
    total: TIENDA_TODOS.length,
  });
  listarMisPagosCompletoMock.mockResolvedValue({
    status: "ok",
    items: PAGOS_TODOS,
    total: PAGOS_TODOS.length,
  });
  listarPagosDeMensajeroCompletoMock.mockResolvedValue({
    status: "ok",
    items: PAGOS_TODOS,
    total: PAGOS_TODOS.length,
  });
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
}

beforeEach(() => {
  vi.clearAllMocks();
  cebarDobles();
});

afterEach(() => {
  cleanup();
});

describe("Ledgers de dinero · descarga", () => {
  it("cada ledger ofrece su control con nombre accesible", async () => {
    // R1/R13. El del desglose de UN mensajero lleva su nombre a propósito: la tabla de
    // cuentas por pagar admite varias filas expandidas a la vez, y tres controles llamados
    // igual no identificarían de quién es cada archivo.
    for (const ledger of LEDGERS) {
      ledger.montar();
      expect(
        await screen.findByRole("button", { name: `Descargar ${ledger.titulo}` }),
        `${ledger.titulo} sin control`,
      ).toBeInTheDocument();
      cleanup();
      vi.clearAllMocks();
      cebarDobles();
    }
  });

  it("el archivo trae el ledger ENTERO, no la página pintada", async () => {
    // R9. Y con el MIME y el nombre de archivo de producción (el despachador corre real).
    for (const ledger of LEDGERS) {
      const user = userEvent.setup();
      ledger.montar();

      const boton = await screen.findByRole("button", {
        name: `Descargar ${ledger.titulo}`,
      });
      const tabla = screen.getByRole("table", { name: ledger.tabla });
      await waitFor(() =>
        expect(within(tabla).getAllByRole("row")).toHaveLength(ledger.pagina.length + 1),
      );

      await user.click(boton);
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

      const [, filas] = buildXlsxRowsMock.mock.calls[0];
      expect(filas, `${ledger.titulo}: filas del archivo`).toHaveLength(ledger.todos.length);
      // Money-safe de punta a punta: el monto llega al archivo como el STRING del servidor,
      // con sus céntimos y sin el símbolo de colón (que rompería la celda como número).
      expect(filas[0].monto).toBe(ledger.todos[0].monto);
      expect(String(filas[0].monto)).not.toContain("₡");

      await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
      const [, mime] = descargarBlobMock.mock.calls[0];
      expect(mime).toBe(XLSX_MIME);

      cleanup();
      vi.clearAllMocks();
      cebarDobles();
    }
  });

  it("usa los filtros de fecha vigentes y no manda paginación", async () => {
    // R10/R18: se aplica un rango de fechas en el libro de caja y se descarga; el input del
    // modo completo lleva ESOS filtros y NINGÚN `page`/`pageSize` (su schema es `.strict()`).
    const user = userEvent.setup();
    renderCaja();

    await user.type(screen.getByLabelText("Desde"), "2026-07-01");
    await user.type(screen.getByLabelText("Hasta"), "2026-07-31");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(listarMovimientosMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Descargar Libro de movimientos" }));

    await waitFor(() => expect(listarMovimientosCompletoMock).toHaveBeenCalledTimes(1));
    expect(listarMovimientosCompletoMock.mock.calls[0][0]).toEqual({
      desde: "2026-07-01",
      hasta: "2026-07-31",
    });
  });

  it("los componentes de presentación no pasan a fetchear", () => {
    // R32. Se comprueba de forma ESTÁTICA, que es donde vive la propiedad: los tres módulos
    // de presentación reciben la función por props y no importan NINGUNA Server Action, así
    // que no hay ninguna que puedan llamar —ni al pintar, ni al descargar—. Un espía solo
    // cubriría el camino que el test recorra; esto cubre todos.
    const raiz = path.resolve(__dirname, "../../..");
    const presentacion = [
      "app/(app)/wallet/_components/WalletLedger.tsx",
      "app/(app)/mi-wallet/_components/DesgloseTiendaLedger.tsx",
      "app/(app)/mis-pagos/_components/DesglosePagos.tsx",
    ];

    for (const ruta of presentacion) {
      const fuente = readFileSync(path.join(raiz, ruta), "utf8");
      const importes = [...fuente.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      expect(importes.length, ruta).toBeGreaterThan(0);
      for (const especificador of importes) {
        // `wallet-egresos` es la MUTACIÓN de reversa que el libro ya tenía (feature 45): lo
        // que no puede aparecer es una lectura nueva del listado.
        if (especificador === "@/lib/actions/wallet-egresos") continue;
        expect(especificador, `${ruta} importa ${especificador}`).not.toMatch(
          /^@\/lib\/(actions|services|repositories)\b/,
        );
      }
      expect(fuente, ruta).not.toMatch(/\buseSWR\b/);
      expect(fuente, ruta).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it("los cuatro ledgers siguen comportándose igual mientras nadie descarga", async () => {
    // R3/R32: montar el control no añade ni una consulta. La acción del modo completo NO se
    // llama hasta que alguien pulsa el botón.
    for (const ledger of LEDGERS) {
      ledger.montar();
      await screen.findByRole("button", { name: `Descargar ${ledger.titulo}` });
      expect(ledger.completo, `${ledger.titulo}: leyó de más`).not.toHaveBeenCalled();
      cleanup();
      vi.clearAllMocks();
      cebarDobles();
    }

    // Y el listado paginado del libro de caja sigue pidiendo lo mismo que antes al paginar.
    const user = userEvent.setup();
    renderCaja();
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(listarMovimientosMock).toHaveBeenCalledTimes(1));
    expect(listarMovimientosMock.mock.calls[0][0]).toEqual({ page: 2, pageSize: 20 });
    expect(listarMovimientosCompletoMock).not.toHaveBeenCalled();
  });
});

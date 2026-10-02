// @vitest-environment jsdom
// Ficha 464 (T10) — los TRES listados de wallets ganan el selector de columnas de la descarga (R1), cada
// uno con su ámbito (R2), sin detalle por orden (R7); sin tocarlo bajan las columnas de siempre (R4) y
// desmarcar o reordenar se refleja en el archivo (R3). El archivo se relee con exceljs.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { SWRConfig } from "swr";
import ExcelJS from "exceljs";

import { claveDeAmbitoDescarga } from "@/lib/columnas/preferencia-columnas";
import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";
import type { SaldoSateliteDTO } from "@/lib/types/conciliacion-satelites";

const H = vi.hoisted(() => ({
  tiendasPagina: vi.fn(),
  tiendasCompleto: vi.fn(),
  cuentasPagina: vi.fn(),
  cuentasCompleto: vi.fn(),
  satelitesPagina: vi.fn(),
  satelitesCompleto: vi.fn(),
  blob: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarSaldosTiendasPaginadoAction: (...a: unknown[]) => H.tiendasPagina(...a),
  listarSaldosTiendasCompletoAction: (...a: unknown[]) => H.tiendasCompleto(...a),
}));
vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarCuentasPorPagarPaginadoAction: (...a: unknown[]) => H.cuentasPagina(...a),
  listarCuentasPorPagarCompletoAction: (...a: unknown[]) => H.cuentasCompleto(...a),
}));
vi.mock("@/lib/actions/conciliacion-satelites", () => ({
  listarSaldosSatelitesAction: (...a: unknown[]) => H.satelitesPagina(...a),
  listarSaldosSatelitesCompletoAction: (...a: unknown[]) => H.satelitesCompleto(...a),
}));
vi.mock("@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero", () => ({ DesglosePagosMensajero: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/wallet",
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), show: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: (...a: unknown[]) => H.blob(...a) }));

import { SaldosTiendasTable } from "@/app/(app)/wallet/tiendas/_components/SaldosTiendasTable";
import { CuentasPorPagarTable } from "@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable";
import { SaldosSatelitesTable } from "@/app/(app)/wallet/satelites/_components/SaldosSatelitesTable";

const TIENDAS: SaldoTiendaResumenDTO[] = [{ tiendaId: "t1", tiendaNombre: "Tienda Uno", saldo: "1000.10", signo: "positivo" }];
const CUENTAS: CuentaPorPagarResumenDTO[] = [
  { mensajeroId: "u1", mensajeroNombre: "Ana Mensajera", devengado: "5000.00", pagado: "3000.00", cuentaPorPagar: "2000.00", signo: "positivo" },
] as CuentaPorPagarResumenDTO[];
const SATELITES: SaldoSateliteDTO[] = [
  {
    zonaId: "z1",
    zonaNombre: "Bodega Norte",
    saldoSinConciliar: "100.00",
    totalEfectivo: "100.00",
    totalConsolidado: "150.00",
    totalRecibido: "0.00",
    consolidacionesSinConciliar: 1,
    diasDeLaMasAntigua: 2,
    fechaDeLaMasAntigua: "2026-09-20T15:00:00.000Z",
    ultimaRecibida: null,
  },
];

function envolver(nodo: ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{nodo}</SWRConfig>);
}

const LISTADOS = [
  {
    nombre: "tiendas",
    ambito: "wallet-tiendas-saldos",
    montar: () => envolver(<SaldosTiendasTable initialData={{ items: TIENDAS, total: 1, pageSize: 25 }} />),
    cabecera: ["Tienda", "Saldo a favor", "Estado"],
  },
  {
    nombre: "mensajeros",
    ambito: "wallet-mensajeros-cuentas",
    montar: () => envolver(<CuentasPorPagarTable initialData={{ items: CUENTAS, total: 1, pageSize: 25 }} />),
    cabecera: [
      "Mensajero",
      "Devengado (incluye la devolución de los pagos anulados)",
      "Pagado (incluye los pagos anulados)",
      "Cuenta por pagar",
      "Estado",
    ],
  },
  {
    nombre: "satélites",
    ambito: "wallet-satelites-saldos",
    montar: () =>
      envolver(<SaldosSatelitesTable initialData={{ items: SATELITES, total: 1, pageSize: 25 }} resumen={null} />),
    cabecera: [
      "Bodega",
      "Pendiente",
      "Efectivo consolidado",
      "Total consolidado",
      "Recibido",
      "Consolidaciones sin conciliar",
      "Más antigua sin conciliar",
      "Última recibida",
      "Monto de la última recibida",
    ],
  },
] as const;

async function cabeceraDelArchivo(): Promise<unknown[]> {
  await waitFor(() => expect(H.blob).toHaveBeenCalled());
  const [contenido] = H.blob.mock.calls.at(-1)!;
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(contenido as ArrayBuffer);
  expect(libro.worksheets).toHaveLength(1);
  return (libro.worksheets[0].getRow(1).values as unknown[]).slice(1);
}

const descargar = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /^Descargar / }));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  H.tiendasPagina.mockResolvedValue({ status: "ok", items: TIENDAS, total: 1, page: 1, pageSize: 25 });
  H.tiendasCompleto.mockResolvedValue({ status: "ok", items: TIENDAS, total: 1 });
  H.cuentasPagina.mockResolvedValue({ status: "ok", items: CUENTAS, total: 1, page: 1, pageSize: 25 });
  H.cuentasCompleto.mockResolvedValue({ status: "ok", items: CUENTAS, total: 1 });
  H.satelitesPagina.mockResolvedValue({ status: "ok", items: SATELITES, total: 1, page: 1, pageSize: 25 });
  H.satelitesCompleto.mockResolvedValue({ status: "ok", items: SATELITES, total: 1 });
});
afterEach(() => cleanup());

describe.each(LISTADOS)("464 T10 — listado de $nombre", ({ ambito, montar, cabecera }) => {
  it("R1/R7: ofrece el selector de columnas, sin detalle por orden; R4: sin tocarlo, las columnas de siempre", async () => {
    const user = userEvent.setup();
    montar();
    expect(screen.getByRole("button", { name: "Elegir columnas de la descarga" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Elegir qué se descarga y sus columnas" })).toBeNull();
    await descargar(user);
    expect(await cabeceraDelArchivo()).toEqual([...cabecera]);
  });

  it("R2/R3: desmarcar la primera y subir la última se guardan en SU ámbito y salen así en el archivo", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: "Elegir columnas de la descarga" }));
    await user.click(await screen.findByRole("checkbox", { name: cabecera[0] }));
    await user.click(screen.getByRole("button", { name: `Subir ${cabecera.at(-1)}` }));
    await user.keyboard("{Escape}");
    expect(window.localStorage.getItem(claveDeAmbitoDescarga(ambito))).not.toBeNull();

    await descargar(user);
    // La última sube un puesto (delante de la penúltima) y la primera no sale.
    const esperada = [...cabecera.slice(1, -2), cabecera.at(-1)!, cabecera.at(-2)!];
    expect(await cabeceraDelArchivo()).toEqual(esperada);
  });
});

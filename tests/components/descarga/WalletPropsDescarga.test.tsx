// @vitest-environment jsdom
// Feature 170 (Tanda D) — descarga de las tres tablas de dinero que recibían su dataset ENTERO
// por props: saldos de tiendas, cuentas por pagar a mensajeros y plantillas de gasto fijo.
// Cubre R1, R7, R10, R26, R30 y R32.
//
// Eran FAMILIA B pura. Feature 170 — FASE 2: las tres paginan ya en el servidor (T I.2 las dos
// primeras, T L.2 las cuentas por pagar), así que su archivo NO puede salir del array que la
// tabla pinta —sería «descargar lo que se ve»— y se RELEE del conjunto completo al pulsar el
// control (R52).
//
// Los riesgos que estos tests cierran: (a) que una descarga se quede en la página visible,
// (b) que el archivo deje de respetar el filtro vigente y entregue filas que el usuario no
// está viendo, y (c) que el tope de 5000 deje de aplicarse y se entregue un archivo gigante
// —o peor, uno truncado en silencio—.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import { descargaConfig } from "@/lib/config/descarga";
import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

// El desglose por cierre se stubbea: aquí se prueba la TABLA de cuentas por pagar, no la
// expansión (que tiene sus propios tests en `WalletDescarga.test.tsx`).
vi.mock("@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero", () => ({
  DesglosePagosMensajero: () => <div data-testid="desglose-stub" />,
}));

vi.mock("@/lib/actions/gasto-fijo-plantilla", () => ({
  setActivaPlantillaAction: vi.fn(),
  listarPlantillasAction: vi.fn(),
  listarPlantillasPaginadoAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarSaldosTiendasAction: vi.fn(),
  listarSaldosTiendasPaginadoAction: vi.fn(),
}));
// Feature 170 — FASE 2 (T L.2): cuentas por pagar pasa a leer su página —y su conjunto para el
// archivo— del servidor.
vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarCuentasPorPagarAction: vi.fn(),
  listarCuentasPorPagarPaginadoAction: vi.fn(),
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

const toastErrorMock = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: (...a: unknown[]) => toastErrorMock(...a),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import {
  listarSaldosTiendasAction,
  listarSaldosTiendasPaginadoAction,
} from "@/lib/actions/wallet-tienda";
import {
  listarPlantillasAction,
  listarPlantillasPaginadoAction,
} from "@/lib/actions/gasto-fijo-plantilla";
import {
  listarCuentasPorPagarAction,
  listarCuentasPorPagarPaginadoAction,
} from "@/lib/actions/wallet-mensajero";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import { SaldosTiendasTable } from "@/app/(app)/wallet/tiendas/_components/SaldosTiendasTable";
import { CuentasPorPagarTable } from "@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable";
import { GastosFijosPlantillasPanel } from "@/app/(app)/wallet/_components/GastosFijosPlantillasPanel";

// --- Datos ---------------------------------------------------------------

const TIENDAS: SaldoTiendaResumenDTO[] = [
  { tiendaId: "t1", tiendaNombre: "Tienda Uno", saldo: "1000.10", signo: "positivo" },
  { tiendaId: "t2", tiendaNombre: "Tienda Dos", saldo: "-250.00", signo: "negativo" },
  { tiendaId: "t3", tiendaNombre: "Tienda Tres", saldo: "0.00", signo: "cero" },
];

const MENSAJEROS: CuentaPorPagarResumenDTO[] = [
  {
    mensajeroId: "u1",
    mensajeroNombre: "Ana Mensajera",
    devengado: "5000.00",
    pagado: "3000.00",
    cuentaPorPagar: "2000.00",
    signo: "positivo",
  },
  {
    mensajeroId: "u2",
    mensajeroNombre: "Beto Repartidor",
    devengado: "4000.10",
    pagado: "4000.10",
    cuentaPorPagar: "0.00",
    signo: "cero",
  },
];

function plantillaGasto(i: number, activa = true): GastoFijoPlantillaDTO {
  return {
    id: `g-${i}`,
    concepto: `Alquiler ${i}`,
    monto: `${100 + i}.10`,
    activa,
    periodicidadUnidad: "meses",
    periodicidadCantidad: 1,
    fechaCobro: "2026-07-01",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
  } as GastoFijoPlantillaDTO;
}

const PLANTILLAS = [plantillaGasto(1), plantillaGasto(2, false)];

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/**
 * Quita comentarios de línea y de bloque antes de buscar patrones de CÓDIGO. Sin esto, la
 * guardia estática de más abajo se dispara con una frase de un comentario («no hace fetch
 * (los datos ya llegaron por props)»), que es justo lo contrario de lo que vigila.
 */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Feature 170 — FASE 2 (T I.2): monta la tabla de saldos con su PÁGINA y programa las dos
 * lecturas —la de la página y la del conjunto completo que alimenta la descarga—.
 */
function montarSaldos(
  visibles: SaldoTiendaResumenDTO[],
  completo: SaldoTiendaResumenDTO[] = visibles,
) {
  vi.mocked(listarSaldosTiendasPaginadoAction).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(visibles, { total: completo.length }),
  });
  vi.mocked(listarSaldosTiendasAction).mockResolvedValue({
    status: "ok",
    tiendas: completo,
  });
  return envolver(
    <SaldosTiendasTable
      initialData={paginaInicial(visibles, { total: completo.length })}
    />,
  );
}

/** Espejo del anterior para el panel de plantillas de gasto fijo. */
function montarPlantillas(
  visibles: GastoFijoPlantillaDTO[],
  completo: GastoFijoPlantillaDTO[] = visibles,
) {
  vi.mocked(listarPlantillasPaginadoAction).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(visibles, { total: completo.length }),
  });
  vi.mocked(listarPlantillasAction).mockResolvedValue({
    status: "ok",
    plantillas: completo,
  });
  return envolver(
    <GastosFijosPlantillasPanel
      initialData={paginaInicial(visibles, { total: completo.length })}
    />,
  );
}

/**
 * Feature 170 — FASE 2 (T L.2): espejo de los dos anteriores para las cuentas por pagar. La
 * búsqueda por nombre la resuelve el SERVIDOR, así que el doble de la página filtra de verdad
 * y el del conjunto entrega las N filas de las que sale el archivo.
 */
function montarCuentas(
  visibles: CuentaPorPagarResumenDTO[],
  completo: CuentaPorPagarResumenDTO[] = visibles,
) {
  vi.mocked(listarCuentasPorPagarPaginadoAction).mockImplementation(
    async (input: unknown) => {
      const q = ((input as { busqueda?: string })?.busqueda ?? "").trim().toLowerCase();
      const filtrados =
        q === ""
          ? visibles
          : completo.filter((m) => m.mensajeroNombre.toLowerCase().includes(q));
      return {
        status: "ok",
        page: 1,
        ...paginaInicial(filtrados, { total: q === "" ? completo.length : filtrados.length }),
      };
    },
  );
  vi.mocked(listarCuentasPorPagarAction).mockResolvedValue({
    status: "ok",
    mensajeros: completo,
  });
  return envolver(
    <CuentasPorPagarTable
      initialData={paginaInicial(visibles, { total: completo.length })}
    />,
  );
}

/** Las tres tablas: cómo se montan, cómo se llama su control y qué debe traer el archivo. */
const TABLAS = [
  {
    titulo: "Saldos de tiendas",
    montar: () => montarSaldos(TIENDAS),
    filas: TIENDAS.length,
    // Money-safe: el saldo llega TAL CUAL, con céntimos y sin el símbolo de colón.
    clave: "saldo",
    valor: TIENDAS[0].saldo,
  },
  {
    titulo: "Cuentas por pagar a mensajeros",
    montar: () => montarCuentas(MENSAJEROS),
    filas: MENSAJEROS.length,
    clave: "cuentaPorPagar",
    valor: MENSAJEROS[0].cuentaPorPagar,
  },
  {
    titulo: "Plantillas de gasto fijo",
    montar: () => montarPlantillas(PLANTILLAS),
    filas: PLANTILLAS.length,
    clave: "monto",
    valor: PLANTILLAS[0].monto,
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

describe("Dinero por props · descarga", () => {
  it("las tres ofrecen su control y el archivo trae lo que la tabla pinta", async () => {
    // R1: control con nombre accesible propio; el archivo, una fila por fila visible y en
    // el mismo orden. Sin paginación de por medio no hay diferencia posible entre lo que se
    // ve y lo que se descarga, y este test lo fija.
    for (const tabla of TABLAS) {
      const user = userEvent.setup();
      tabla.montar();

      const boton = screen.getByRole("button", { name: `Descargar ${tabla.titulo}` });
      expect(boton).toBeInTheDocument();

      await user.click(boton);
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

      const [, filas, titulo] = buildXlsxRowsMock.mock.calls[0];
      expect(filas, `${tabla.titulo}: filas del archivo`).toHaveLength(tabla.filas);
      expect(titulo).toBe(tabla.titulo);

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("los montos viajan TAL CUAL, sin recalcularlos ni adornarlos", async () => {
    // R7 money-safe. Un `Number` intermedio convertiría "1000.10" en "1000.1": los céntimos.
    // Y el símbolo de colón de `money` rompería la celda como número en la hoja.
    for (const tabla of TABLAS) {
      const user = userEvent.setup();
      tabla.montar();

      await user.click(screen.getByRole("button", { name: `Descargar ${tabla.titulo}` }));
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

      const [, filas] = buildXlsxRowsMock.mock.calls[0];
      expect(filas[0][tabla.clave], `${tabla.titulo}: ${tabla.clave}`).toBe(tabla.valor);
      expect(String(filas[0][tabla.clave])).not.toContain("₡");

      cleanup();
      vi.clearAllMocks();
      buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
    }
  });

  it("cuentas por pagar exporta solo lo que la búsqueda deja a la vista", async () => {
    // R10 + R52. El filtro de esta tabla era de CLIENTE y desde T L.2 lo resuelve el
    // SERVIDOR; lo que el archivo tiene que traer no cambia: exactamente el conjunto que la
    // búsqueda deja a la vista, ni una fila más. Descargar el conjunto SIN filtrar sería
    // entregar datos que el usuario no está viendo, y descargar la página sería entregar
    // menos de los que sí está viendo.
    const user = userEvent.setup();
    montarCuentas(MENSAJEROS);

    await user.type(screen.getByRole("searchbox"), "Beto");

    const tabla = screen.getByRole("table", { name: "Cuentas por pagar a mensajeros" });
    await waitFor(() => expect(within(tabla).getAllByRole("row")).toHaveLength(1 + 1));

    await user.click(
      screen.getByRole("button", { name: "Descargar Cuentas por pagar a mensajeros" }),
    );
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(1);
    expect(filas[0].mensajero).toBe("Beto Repartidor");
  });

  it("las tres paginan y NINGUNA proyecta la página: releen el conjunto completo", () => {
    // R52, de forma ESTÁTICA sobre los módulos, que es donde vive la propiedad. Donde la
    // FASE 1 exigía `filasLocales(loQueSePinta)` —correcto mientras el array de props ERA el
    // dataset—, ahora se PROHÍBE: esa misma llamada, con la tabla paginada, es literalmente
    // «descargar lo que se ve», y sale un archivo de 25 filas de 300 sin fallar en ninguna
    // parte. Se exige a cambio el adaptador que relee.
    //
    // Feature 170 — FASE 2 (T L.2): las cuentas por pagar entran aquí y desaparece el caso
    // «la que NO pagina no relee» —ya no queda ninguna de las tres sin paginar—. Las tablas
    // de Familia B pura que siguen sin paginar (ranking, gestiones del cierre) no son de
    // este archivo y conservan sus propios tests.
    const raiz = path.resolve(__dirname, "../../..");
    const modulos = [
      "app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx",
      "app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx",
      "app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx",
    ];

    for (const ruta of modulos) {
      const fuente = sinComentarios(readFileSync(path.join(raiz, ruta), "utf8"));
      expect(fuente, `${ruta}: la descarga debe releer el conjunto completo`).toMatch(
        /filasDelConjuntoCompleto\(/,
      );
      expect(fuente, `${ruta}: no puede proyectar el array visible`).not.toMatch(
        /filasLocales\(/,
      );
      // Y pagina de verdad: control de navegación + página pedida al servidor.
      expect(fuente, `${ruta}: sin control de paginación`).toMatch(/<Pagination[\s/>]/);
      expect(fuente, `${ruta}: sin lectura de la página`).toMatch(/\buseSWR\b/);
    }
  });

  it("por encima del tope rechaza con un error accionable y NO produce archivo", async () => {
    // R26/R28: el tope de 5000 rige igual en Familia B. Con un array por encima, la salida
    // es un mensaje con total y tope —y ningún xlsx—: un archivo al que le faltan filas sin
    // avisar es peor que no poder descargarlo.
    const user = userEvent.setup();
    const total = descargaConfig.MAX_FILAS + 1;
    const muchas: SaldoTiendaResumenDTO[] = Array.from({ length: total }, (_, i) => ({
      tiendaId: `t-${i}`,
      tiendaNombre: `Tienda ${i}`,
      saldo: "10.00",
      signo: "positivo",
    }));

    // La página visible es pequeña; el CONJUNTO que releerá la descarga es el que se pasa
    // del tope. Es el caso real: nadie ve 5001 filas, pero sí puede pedirlas en un archivo.
    montarSaldos(muchas.slice(0, 25), muchas);
    await user.click(screen.getByRole("button", { name: "Descargar Saldos de tiendas" }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    const mensaje = String(toastErrorMock.mock.calls[0][0]);
    expect(mensaje).toContain(String(total));
    expect(mensaje).toContain(String(descargaConfig.MAX_FILAS));
    expect(mensaje).toMatch(/acota los filtros/i);
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });
});

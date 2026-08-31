// @vitest-environment jsdom
// Feature 170 (T C.4) — descarga de los ledgers de dinero paginados: libro de caja, desglose de
// un mensajero (maestro/admin) y mi wallet (tienda). Cubre R1, R3, R9, R10, R13 y R32.
//
// Eran CUATRO. La ficha 336 (2026-08-30) retiró el de mis pagos (mensajero) al borrarse
// `/mis-pagos`; quedan TRES, y DOS de ellos son componentes de PRESENTACIÓN.
//
// Todos son de FAMILIA A y los de presentación reciben la página por props. Eso plantea el
// riesgo que estos tests cierran: para descargar el ledger entero hace falta la acción del modo
// completo CON los filtros vigentes, y la tentación es que la tabla se ponga a fetchear. No lo
// hace: el módulo padre —que es quien conoce los filtros— baja un callback (design §5). Aquí se
// comprueban las dos mitades: que el archivo trae el ledger entero con los filtros aplicados y
// que los componentes de presentación siguen sin importar una sola Server Action.
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
const verResumenCajaMock = vi.fn();
vi.mock("@/lib/actions/wallet", () => ({
  listarMovimientosAction: (...a: unknown[]) => listarMovimientosMock(...a),
  listarMovimientosCompletoAction: (...a: unknown[]) => listarMovimientosCompletoMock(...a),
  // Feature 173 (T G.3): la cabecera del libro de caja la sirve el borde de las DOS cifras.
  verResumenCajaAction: (...a: unknown[]) => verResumenCajaMock(...a),
  // FICHA 339 (B5): la tarjeta de la ganancia monta filas desplegables y el panel de cada una
  // importa el borde del detalle. Sin declararlo aqui, el import no resuelve y este archivo no
  // ejecuta ni un caso. Ninguna asercion de este archivo lo usa: la descarga es de OTRA tabla.
  listarMovimientosDeFilaAction: vi.fn(),
}));

const listarMisMovimientosMock = vi.fn();
const listarMisMovimientosCompletoMock = vi.fn();
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarMisMovimientosAction: (...a: unknown[]) => listarMisMovimientosMock(...a),
  listarMisMovimientosCompletoAction: (...a: unknown[]) =>
    listarMisMovimientosCompletoMock(...a),
}));

const listarPagosDeMensajeroMock = vi.fn();
const listarPagosDeMensajeroCompletoMock = vi.fn();
vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarPagosDeMensajeroAction: (...a: unknown[]) => listarPagosDeMensajeroMock(...a),
  listarPagosDeMensajeroCompletoAction: (...a: unknown[]) =>
    listarPagosDeMensajeroCompletoMock(...a),
}));

vi.mock("@/lib/actions/wallet-egresos", () => ({
  reversarEgresoAdministrativoAction: vi.fn(),
  // El `desglose` que devuelve la acción tiene los MISMOS cinco montos que la prop inicial
  // (feature 201, tanda B): un `{}` deja los importes en `undefined` y el render se cae.
  verDesgloseEgresosAction: vi.fn(async () => ({
    status: "ok",
    desglose: {
      gastoFijo: "1.00",
      gastoVariable: "0.00",
      sueldo: "0.00",
      indemnizacion: "0.00",
      total: "1.00",
    },
  })),
}));
vi.mock("@/lib/actions/gasto-fijo-plantilla", () => ({
  listarPlantillasAction: vi.fn(async () => ({ status: "ok", plantillas: [] })),
  setActivaPlantillaAction: vi.fn(),
  // Feature 170 - FASE 2 (T I.2): el panel de plantillas pide su pagina al servidor.
  listarPlantillasPaginadoAction: vi.fn(async () => ({
    status: "ok",
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  })),
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
import { DesglosePagosMensajero } from "@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero";
// Feature 173 (T G.2/T G.3, R61/R62) — el filtro y la descarga del libro de caja.
import {
  CATEGORIA_LABEL,
  CATEGORIA_OPTIONS,
  DUENO_LABEL,
} from "@/app/(app)/wallet/_components/wallet-labels";
import {
  COLUMNAS_DESCARGA_WALLET_CAJA,
  filaDescargaMovimientoCaja,
} from "@/app/(app)/wallet/_components/wallet-ledger-descarga-columnas";
import { WALLET_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet";

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
    dueno: "propio", // feature 231 (R31): el flete es dinero de Ordenex
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
    cierreId: `o-${i}`, // feature 205/R43: en un origen `cierre_dia`, el origen ES el cierre
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

// Feature 173 (T G.3): la cabecera del libro de caja pasa a las DOS cifras. Este archivo mide
// la DESCARGA y el FILTRO, no la cabecera; el dato se adapta para que el módulo monte.
const RESUMEN = {
  entradas: "1.00",
  salidas: "0.00",
  enCaja: "1.00",
  signoEnCaja: "positivo" as const,
  ingresosPropios: "1.00",
  egresosPropios: "0.00",
  ganancia: "1.00",
  signoGanancia: "positivo" as const,
  deTerceros: "0.00",
  periodoFiltrado: false,
  // Feature 231 (R9/R10): sin dinero de terceros la porcion de las tiendas es 0.
  porcentajeTiendas: "0.00",
  modoComposicion: "dos_bolsillos" as const,
};
// Feature 231 (T6.3): el módulo monta ahora la tarjeta de la ganancia, que recibe la
// composición hermana del resumen. Este archivo mide la DESCARGA y el FILTRO, no esa tarjeta;
// el dato se adapta para que el módulo monte, igual que `RESUMEN` aquí arriba.
const COMPOSICION = {
  ingresos: {
    ingreso_flete: "1.00",
    ingreso_flete_devolucion: "0.00",
    ingreso_comision_cod: "0.00",
    ingreso_iva_flete: "0.00",
    ingreso_iva_flete_devolucion: "0.00",
    ingreso_iva_comision_cod: "0.00",
    ingreso_ajuste: "0.00",
  },
  totalIngresos: "1.00",
  // Ficha 339 (T1.3): las dos cubetas nuevas y la bandera del servidor.
  egresos: {
    egreso_pago_mensajero: "0.00",
    egreso_ajuste: "0.00",
  },
  otrosEgresos: "0.00",
  hayOtrosEgresos: false,
  totalEgresos: "0.00",
};
// Feature 201 (tanda B): era `{} as never`, y ese `as never` tapaba que el objeto NO tenía
// ninguno de los cinco montos que `DesgloseEgresosDTO` declara obligatorios. Con el `money`
// viejo el hueco se pintaba como «₡undefined» y nadie se enteraba; con el compartido —que
// llama a `.trim()` sobre el STRING— el `undefined` revienta el render. Se rellena con montos
// de verdad, igual que `RESUMEN` y `DESGLOSE_TIENDA` aquí al lado: este archivo mide la
// DESCARGA, y el dato se adapta para que el módulo monte.
const DESGLOSE_EGRESOS = {
  gastoFijo: "1.00",
  gastoVariable: "0.00",
  sueldo: "0.00",
  indemnizacion: "0.00",
  total: "1.00",
};
const SALDO_TIENDA = {
  creditos: "500.25",
  debitos: "0.00",
  saldo: "500.25",
  signo: "positivo" as const,
};
// Feature 172 (T G.2, R55): la cabecera de `/mi-wallet` pasa a tres importes. Este archivo
// mide la DESCARGA, no la cabecera; el dato se anade para que el modulo monte.
const DESGLOSE_TIENDA = {
  aFavor: "500.25",
  cargos: "0.00",
  pagado: "0.00",
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

function renderCaja(movimientos: WalletMovimientoDTO[] = CAJA_PAGINA) {
  return envolver(
    <WalletModule
      movimientos={movimientos}
      total={80}
      page={1}
      pageSize={20}
      resumen={RESUMEN}
      desglose={DESGLOSE_EGRESOS}
      composicion={COMPOSICION}
      plantillas={{ items: [], total: 0, pageSize: 25 }}
      // Ficha 333 (G2, R38): la cola de cobros por aprobar, VACÍA. Este archivo mide las
      // DESCARGAS de la wallet y la sección nueva no ofrece ninguna (design §7: es una cola de
      // decisión efímera; lo que se aprueba aterriza en el libro, que sí descarga). Con `total`
      // en cero la sección ni se monta, que es exactamente el estado en el que este test la
      // quiere: si algún día ofreciera descarga, el censo de tablas lo diría antes que esto.
      cobrosPendientes={{ items: [], total: 0 }}
      // Ficha 337: la cola de cobros por rechazo de tienda, igual de vacia y por el MISMO motivo
      // -- tampoco ofrece descarga (cola de decision efimera; lo aprobado aterriza en los dos
      // libros, que si descargan) y con `total` en cero ni se monta.
      cobrosRechazoTienda={{ items: [], total: 0 }}
      puedeDecidirCobrosRechazo
      puedeDecidirCobros
      // Feature 85 (T F.4/T F.6, R23): el instante del «Próximo cobro» viaja por la cadena de
      // props y es REQUERIDO en los dos eslabones. Fijo, para no depender del día de la corrida.
      ahoraIso="2026-07-15T18:00:00.000Z"
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
      desglose={DESGLOSE_TIENDA}
      // Ficha 335: el catálogo de cierres del selector, REQUERIDO en los dos eslabones. Este
      // archivo mide la DESCARGA del libro, que no cambia con el filtro de cierre; se siembra
      // vacío y disponible, que es el estado de una tienda sin cierres todavía.
      cierres={{ opciones: [], hayMas: false, disponible: true }}
    />,
  );
}

function renderDesgloseMensajero() {
  return envolver(<DesglosePagosMensajero resumen={RESUMEN_MENSAJERO} />);
}

/**
 * Los ledgers: cómo se montan, cómo se llama su control y qué acción usan.
 *
 * Eran CUATRO. La ficha 336 (2026-08-30) retiró el de `/mis-pagos` —pantalla borrada por
 * decisión humana— con su `renderMisPagos`, sus dos mocks y su ruta de la lista de módulos de
 * presentación de más abajo (que se lee con `readFileSync`: dejarla habría reventado el archivo
 * ENTERO con ENOENT, no un caso). Quedan TRES.
 */
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
  // Feature 231: el borde de la caja devuelve resumen Y composición en la misma respuesta.
  verResumenCajaMock.mockResolvedValue({
    status: "ok",
    resumen: RESUMEN,
    composicion: COMPOSICION,
  });
  listarMisMovimientosMock.mockResolvedValue({
    status: "ok",
    data: { movimientos: TIENDA_PAGINA, total: 60, page: 1, saldo: SALDO_TIENDA },
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
      // El conteo solo no distingue la tabla asentada de la que está cargando: el `DataTable`
      // pinta en carga un `<tr>` con `role="status"` y filas skeleton `aria-hidden` que no
      // cuentan como `row`, así que el número puede cuadrar a media carga.
      await waitFor(() => {
        expect(within(tabla).getAllByRole("row")).toHaveLength(ledger.pagina.length + 1);
        expect(within(tabla).queryByRole("status")).not.toBeInTheDocument();
      });

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
    // R32. Se comprueba de forma ESTÁTICA, que es donde vive la propiedad: los módulos de
    // presentación reciben la función por props y no importan NINGUNA Server Action, así que no
    // hay ninguna que puedan llamar —ni al pintar, ni al descargar—. Un espía solo cubriría el
    // camino que el test recorra; esto cubre todos.
    //
    // Eran TRES; la ficha 336 se llevó `mis-pagos/_components/DesglosePagos.tsx` con la
    // pantalla. La ruta se quita porque este bloque hace `readFileSync`: una entrada que ya no
    // existe no falla con un diagnóstico, revienta con ENOENT y tumba el archivo entero.
    const raiz = path.resolve(__dirname, "../../..");
    const presentacion = [
      "app/(app)/wallet/_components/WalletLedger.tsx",
      "app/(app)/mi-wallet/_components/DesgloseTiendaLedger.tsx",
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

  it("todos los ledgers siguen comportándose igual mientras nadie descarga", async () => {
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
    // Feature 170 - FASE 2 (T I.2): la wallet monta ahora DOS controles de paginacion (el del
    // libro y el del panel de plantillas de gasto fijo), asi que el del libro se localiza por
    // el nombre accesible de SU navegacion. Que hagan falta dos nombres distintos es
    // exactamente lo que R43 pide.
    const user = userEvent.setup();
    renderCaja();
    const navLibro = screen.getByRole("navigation", { name: "Paginación del libro" });
    await user.click(within(navLibro).getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(listarMovimientosMock).toHaveBeenCalledTimes(1));
    expect(listarMovimientosMock.mock.calls[0][0]).toEqual({ page: 2, pageSize: 20 });
    expect(listarMovimientosCompletoMock).not.toHaveBeenCalled();
  });
});

// ─── Feature 173 · las categorías de tesorería en el libro (T G.2 / T G.3) ───

/** Los dos conceptos que la 173 mete en el libro de la caja. */
const CATEGORIAS_173 = ["ingreso_cod_recaudado", "ingreso_reverso_pago_tienda"] as const;

/** Un movimiento del libro con una de las categorías nuevas. */
function movimientoNuevo(
  categoria: (typeof CATEGORIAS_173)[number],
  i: number,
): WalletMovimientoDTO {
  return {
    id: `n-${i}`,
    tipo: "ingreso",
    categoria,
    monto: `${7000 + i}.10`,
    origenTipo: categoria === "ingreso_cod_recaudado" ? "cierre_dia" : "pago_tienda",
    origenId: `o-n-${i}`,
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: `2026-08-0${i}T14:00:00.000Z`,
    dueno: "terceros", // feature 231 (R31): los dos conceptos de la 173 son de las tiendas
  };
}

const CAJA_CON_NUEVOS = [
  movimientoCaja(1),
  movimientoNuevo("ingreso_cod_recaudado", 1),
  movimientoNuevo("ingreso_reverso_pago_tienda", 2),
];

describe("Feature 173 · el libro de caja con las categorías nuevas", () => {
  it("T G.2 (R61): el filtro se puebla del SEED, no de una lista escrita a mano", () => {
    // Esto es una VERIFICACIÓN, no una implementación: el `Select` de categoría ya se armaba
    // del SEED desde la 42, así que las dos categorías nuevas entraron solas al añadirlas al
    // catálogo. Lo que se afirma es justo eso —que sigue siendo así— porque el día que
    // alguien sustituya el `map` por una lista literal, el filtro se quedará mudo ante la
    // siguiente categoría y nadie se enterará hasta que falte una.
    const valores = CATEGORIA_OPTIONS.map((o) => o.value);
    expect(valores).toEqual(["", ...WALLET_MOVIMIENTO_CATEGORIA_SEED]);

    for (const categoria of CATEGORIAS_173) {
      const opcion = CATEGORIA_OPTIONS.find((o) => o.value === categoria);
      expect(opcion, `el filtro no ofrece ${categoria}`).toBeDefined();
      // Y con nombre de persona, no con el valor del enum (R61).
      expect(opcion?.label).toBe(CATEGORIA_LABEL[categoria]);
      expect(opcion?.label).not.toBe(categoria);
      expect(opcion?.label).not.toMatch(/_/);
    }

    // Ninguna categoría del catálogo se queda sin etiqueta legible: el barrido es sobre el
    // SEED en RUNTIME, no sobre las dos que esta feature añadió.
    for (const categoria of WALLET_MOVIMIENTO_CATEGORIA_SEED) {
      const opcion = CATEGORIA_OPTIONS.find((o) => o.value === categoria);
      expect(opcion?.label, `sin etiqueta: ${categoria}`).toBeTruthy();
      expect(opcion?.label).not.toBe(categoria);
    }
  });

  it("T G.2 (R61/R62): la descarga las recoge sola, con las MISMAS columnas", () => {
    // La descarga usa `CATEGORIA_LABEL` para esa columna, así que tampoco hubo que tocarla.
    // Se comprueban las dos mitades: que la etiqueta sale, y que la fila sigue teniendo
    // exactamente las cinco columnas declaradas — ni una de más por ser una categoría nueva.
    for (const categoria of CATEGORIAS_173) {
      const fila = filaDescargaMovimientoCaja(movimientoNuevo(categoria, 1));
      expect(fila.categoria).toBe(CATEGORIA_LABEL[categoria]);
      expect(fila.categoria).not.toBe(categoria);
      expect(Object.keys(fila).sort()).toEqual(
        COLUMNAS_DESCARGA_WALLET_CAJA.map((c) => c.clave).sort(),
      );
      // Money-safe: el monto sale como el STRING del servidor, con sus céntimos.
      expect(fila.monto).toBe("7001.10");
    }
  });

  it("R62: el listado los pinta como a los demás, sin cambiar las columnas", async () => {
    // ── D1, firmada por el humano el 2026-08-18 (feature 231, T5.1) ──
    //
    // Este caso fijaba con `toEqual` la secuencia EXACTA de los seis encabezados. Ese literal
    // NO es lo que el caso dice afirmar —se le coló por usar `toEqual` sobre el array—, y por
    // el camino acabó gobernando cuántas columnas puede tener el libro: bloqueó el reordenado
    // de la 200 y habría bloqueado la columna «Dueño» de la 231.
    //
    // Lo que el caso afirma, y lo que sigue afirmando ahora, es que las categorías NUEVAS de
    // la 173 no AÑADEN ni QUITAN columnas. Se mide comparando el juego de encabezados que
    // declara el componente CON y SIN esas categorías dentro: es más fuerte que el literal
    // —caza también la columna que apareciera solo para ellas— y deja de opinar sobre el
    // número total de columnas, que es asunto de quien diseña el libro.

    // ── Lo que mide, y hasta dónde llega (menor 6 de `progress/review_231.md`) ──
    //
    // Las columnas de `WalletLedger` se declaran en un `useMemo` que NO depende de los datos,
    // así que comparar dos renders con distintas filas sólo cae si alguien hace las columnas
    // dependientes del contenido. Es exactamente la regresión que este caso quiere impedir
    // —«esta categoría necesita una columna suya»—, pero es un blanco estrecho.
    //
    // Por eso se mide sobre CUATRO conjuntos y no dos, incluido el catálogo ENTERO en runtime:
    // así el caso deja de hablar sólo de las dos categorías de la 173 y afirma lo general —que
    // ninguna categoría del catálogo añade ni quita columnas—, que es lo que el título dice.
    //
    // La red de que las columnas son LAS QUE SON (las seis anteriores, en su orden, más
    // «Dueño» en su sitio) la aporta el caso «R35: los encabezados anteriores conservan su
    // orden y «Dueño» se añade», al final de este archivo. Si alguien borra aquél creyendo que
    // la protección vive aquí, el libro se queda sin ella.
    const unaPorCategoria: WalletMovimientoDTO[] = WALLET_MOVIMIENTO_CATEGORIA_SEED.map(
      (categoria, i) => ({
        ...movimientoCaja(i + 1),
        id: `cat-${i}`,
        categoria,
        tipo: categoria.startsWith("ingreso") ? ("ingreso" as const) : ("egreso" as const),
      }),
    );

    async function encabezados(filas: WalletMovimientoDTO[]): Promise<(string | null)[]> {
      renderCaja(filas);
      const tabla = await screen.findByRole("table", { name: "Libro de movimientos" });
      const leidos = within(tabla)
        .getAllByRole("columnheader")
        .map((c) => c.textContent);
      cleanup();
      return leidos;
    }

    const conjuntos = {
      vacio: await encabezados([]),
      sinLas173: await encabezados([movimientoCaja(1)]),
      conLas173: await encabezados(CAJA_CON_NUEVOS),
      catalogoEntero: await encabezados(unaPorCategoria),
    };

    // Control de no-vacuidad: cuatro listas vacías también serían «iguales».
    for (const [nombre, lista] of Object.entries(conjuntos)) {
      expect(lista.length, `el conjunto ${nombre} no pintó encabezados`).toBeGreaterThan(4);
    }
    // Y el barrido del catálogo mira TODAS las categorías, no dos.
    expect(unaPorCategoria.length).toBe(WALLET_MOVIMIENTO_CATEGORIA_SEED.length);
    expect(unaPorCategoria.length).toBeGreaterThan(15);

    // El juego de encabezados es el MISMO en todos: ni las categorías de la 173 ni
    // ninguna otra del catálogo añaden o quitan columna, y tampoco lo hace la tabla vacía.
    expect(conjuntos.sinLas173).toEqual(conjuntos.vacio);
    expect(conjuntos.conLas173).toEqual(conjuntos.sinLas173);
    expect(conjuntos.catalogoEntero).toEqual(conjuntos.conLas173);

    // Y las categorías de la 173, con su nombre legible (R61), no con el valor del enum.
    renderCaja(CAJA_CON_NUEVOS);

    const tabla = await screen.findByRole("table", { name: "Libro de movimientos" });
    await waitFor(() => {
      expect(within(tabla).getAllByRole("row")).toHaveLength(CAJA_CON_NUEVOS.length + 1);
      expect(within(tabla).queryByRole("status")).not.toBeInTheDocument();
    });

    for (const categoria of CATEGORIAS_173) {
      expect(within(tabla).getByText(CATEGORIA_LABEL[categoria])).toBeInTheDocument();
      expect(within(tabla).queryByText(categoria)).toBeNull();
    }
  }, 20000);

  it("R62: y el archivo también los trae, por el mismo camino que el resto", async () => {
    const user = userEvent.setup();
    listarMovimientosCompletoMock.mockResolvedValue({
      status: "ok",
      items: CAJA_CON_NUEVOS,
      total: CAJA_CON_NUEVOS.length,
    });
    renderCaja(CAJA_CON_NUEVOS);

    await user.click(screen.getByRole("button", { name: "Descargar Libro de movimientos" }));
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [columnas, filas] = buildXlsxRowsMock.mock.calls[0];
    // Las MISMAS columnas declaradas, en el mismo orden: la hoja no cambia de forma por
    // llevar dentro un contra-entrega o un pago anulado.
    expect(columnas.map((c) => c.key)).toEqual(
      COLUMNAS_DESCARGA_WALLET_CAJA.map((c) => c.clave),
    );
    expect(filas).toHaveLength(CAJA_CON_NUEVOS.length);
    expect(filas.map((f) => f.categoria)).toEqual([
      CATEGORIA_LABEL.ingreso_flete,
      CATEGORIA_LABEL.ingreso_cod_recaudado,
      CATEGORIA_LABEL.ingreso_reverso_pago_tienda,
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Feature 231 (T5.1/T5.3) — la columna «Dueño», en la tabla y en el archivo.
//
// Los dos casos de aquí abajo son los que D1 pedía AÑADIR al cambiar la aserción de la 173:
// el caso de arriba sigue protegiendo lo suyo —que las categorías de la 173 no tocan las
// columnas— y estos fijan lo de ESTA feature: que «Dueño» está, dónde está, y que el archivo
// dice exactamente la misma palabra que la pantalla.
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Los seis encabezados que el libro tenía ANTES de esta feature, en su orden. */
const ENCABEZADOS_ANTERIORES = [
  "Fecha",
  "Tipo",
  "Categoría",
  "Monto",
  "Origen",
  "Acciones",
] as const;

describe("Feature 231 · el libro dice de quién es cada movimiento", () => {
  it("R35: los encabezados anteriores conservan su orden y «Dueño» se añade", async () => {
    // Un movimiento de cada naturaleza, para que la tabla tenga las dos palabras dentro.
    renderCaja([movimientoCaja(1), movimientoNuevo("ingreso_cod_recaudado", 1)]);

    const tabla = await screen.findByRole("table", { name: "Libro de movimientos" });
    const encabezados = within(tabla)
      .getAllByRole("columnheader")
      .map((c) => c.textContent);

    // Ninguna de las seis se movió ni se fue: filtradas del juego actual, salen en su orden.
    expect(
      encabezados.filter((h) => ENCABEZADOS_ANTERIORES.includes(h as never)),
    ).toEqual([...ENCABEZADOS_ANTERIORES]);

    // Y «Dueño» entra: una sola columna más, la ÚLTIMA de los datos —justo antes del botón—.
    expect(encabezados).toHaveLength(ENCABEZADOS_ANTERIORES.length + 1);
    expect(encabezados).toContain("Dueño");
    expect(encabezados.indexOf("Dueño")).toBe(encabezados.indexOf("Acciones") - 1);
  });

  it("R34: la descarga trae «Dueño» con el mismo texto que muestra la tabla", async () => {
    const propio = movimientoCaja(1); // flete → dinero de Ordenex
    const terceros = movimientoNuevo("ingreso_cod_recaudado", 1); // contra-entrega → tienda
    renderCaja([propio, terceros]);

    const tabla = await screen.findByRole("table", { name: "Libro de movimientos" });
    const encabezados = within(tabla)
      .getAllByRole("columnheader")
      .map((c) => c.textContent);
    const columna = encabezados.indexOf("Dueño");
    expect(columna).toBeGreaterThan(-1);

    // Lo que se LEE en la celda de cada fila, en el orden en que llegaron.
    const filasTabla = within(tabla).getAllByRole("row").slice(1);
    const enPantalla = filasTabla.map(
      (fila) => within(fila).getAllByRole("cell")[columna].textContent,
    );
    expect(enPantalla).toEqual([DUENO_LABEL.propio, DUENO_LABEL.terceros]);
    // Las dos palabras son DISTINTAS: si «Ordenex» y «Tienda» fueran la misma, la columna
    // entera no diría nada y este caso pasaría igual.
    expect(DUENO_LABEL.propio).not.toBe(DUENO_LABEL.terceros);

    // Y el archivo dice exactamente eso, celda a celda.
    expect([propio, terceros].map((m) => filaDescargaMovimientoCaja(m).dueno)).toEqual(
      enPantalla,
    );
    // La columna está declarada en la hoja, con su encabezado.
    expect(COLUMNAS_DESCARGA_WALLET_CAJA.map((c) => c.clave)).toContain("dueno");
    expect(
      COLUMNAS_DESCARGA_WALLET_CAJA.find((c) => c.clave === "dueno")?.encabezado,
    ).toBe("Dueño");
  });
});

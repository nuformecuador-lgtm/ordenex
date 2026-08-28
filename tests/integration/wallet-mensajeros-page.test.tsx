// @vitest-environment jsdom
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Feature 57: el PageHeader del topbar monta el LogoutButton (client:
// useRouter/useToast). Se stubbea para aislar el pre-fetch/props de la página.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));
import {
  render,
  screen,
  cleanup,
  within,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RolValue } from "@prisma/client";

import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import { DesglosePagosMensajero } from "@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero";
import type { CuentasPorPagarTableProps } from "@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable";
import type {
  CuentaPorPagarResumenDTO,
  ListarPagosDeMensajeroResult,
} from "@/lib/types/wallet-mensajero";

// Feature 44 (T14, R18/R19/R21) — la pagina `/wallet/mensajeros` resuelve el rol SOLO
// server-side; rol != maestro (o sin sesion) → `notFound` (R19). La tabla cliente se stubbea
// para capturar sus props y verificar que los montos (devengado/pagado/cuentaPorPagar) cruzan
// como STRING (R21). El page.tsx (Server Component real) se importa sin mockear.

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

// Feature 293 (T5.3): la página monta el panel de PREMIOS DEL RANKING, que es un componente
// cliente y consume sus tres Server Actions. Se doblan por el mismo motivo que las de wallet:
// acá se prueba el montaje y el control de acceso de la PÁGINA, no la lectura del podio.
vi.mock("@/lib/actions/premio-ranking-devengo", () => ({
  listarPremiosDelDiaAction: vi.fn(),
  registrarPremioAction: vi.fn(),
  anularPremioAction: vi.fn(),
}));

vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarCuentasPorPagarAction: vi.fn(),
  // Feature 170 — FASE 2 (T L.2): la página pre-carga la PÁGINA 1, no el conjunto entero.
  listarCuentasPorPagarPaginadoAction: vi.fn(),
  verMiCuentaPorPagarAction: vi.fn(),
  listarMisPagosAction: vi.fn(),
  listarPagosDeMensajeroAction: vi.fn(),
  listarPagosDeMensajeroCompletoAction: vi.fn(),
}));

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// Stub de la tabla cliente: captura las props que le pasa el Server Component.
const tableCalls: CuentasPorPagarTableProps[] = [];
vi.mock("@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable", () => ({
  CuentasPorPagarTable: (props: CuentasPorPagarTableProps) => {
    tableCalls.push(props);
    return <div data-testid="cuentas-por-pagar-table-stub" />;
  },
}));

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarCuentasPorPagarPaginadoAction,
  listarPagosDeMensajeroAction,
} from "@/lib/actions/wallet-mensajero";
import { listarPremiosDelDiaAction } from "@/lib/actions/premio-ranking-devengo";
// `fechaObjetivo` solo se usa para el PAYLOAD que devuelve la Server Action doblada; las dos
// fechas que la página pinta se afirman contra su literal (ver el caso de R8 más abajo).
import { fechaObjetivo } from "@/lib/ranking/snapshot-dia";

const resolveActorMock = vi.mocked(resolveActorFromSession);
const listarMock = vi.mocked(listarCuentasPorPagarPaginadoAction);
const desgloseMock = vi.mocked(listarPagosDeMensajeroAction);
const premiosMock = vi.mocked(listarPremiosDelDiaAction);

// Feature 170 — FASE 2 (T L.2): la PÁGINA 1 del listado. El `total` es el del CONJUNTO —30
// mensajeros de los que la página trae dos—, para que un pre-fetch que bajara `items.length`
// como total no pudiera pasar por aquí.
const TOTAL_CONJUNTO = 30;
const CUENTAS_OK = {
  status: "ok" as const,
  page: 1,
  pageSize: 25,
  total: TOTAL_CONJUNTO,
  items: [
    {
      mensajeroId: "u1",
      mensajeroNombre: "Ana Mensajera",
      devengado: "5000.00",
      pagado: "3000.00",
      cuentaPorPagar: "2000.00",
      signo: "positivo" as const,
    },
    {
      mensajeroId: "u2",
      mensajeroNombre: "Beto Repartidor",
      devengado: "4000.00",
      pagado: "4000.00",
      cuentaPorPagar: "0.00",
      signo: "cero" as const,
    },
  ],
};

// Resumen agregado (saldo inicial antes de la primera carga del desglose).
const RESUMEN: CuentaPorPagarResumenDTO = {
  mensajeroId: "u1",
  mensajeroNombre: "Ana Mensajera",
  devengado: "5000.00",
  pagado: "3000.00",
  cuentaPorPagar: "2000.00",
  signo: "positivo",
};

// Desglose por cierre SIN filtros (carga inicial). Dos movimientos, mas reciente primero (el
// backend ya los devuelve ordenados desc; la UI preserva ese orden).
const DESGLOSE_DATA: ListarPagosDeMensajeroResult = {
  mensajeroId: "u1",
  mensajeroNombre: "Ana Mensajera",
  movimientos: [
    {
      id: "m2",
      mensajeroId: "u1",
      tipo: "pago",
      categoria: "pago_efectivo",
      monto: "3000.00",
      origenTipo: "cierre_dia",
      origenId: "c2",
      cierreId: "c2", // feature 205/R43: en un origen `cierre_dia`, el origen ES el cierre
      descripcion: null,
      fechaMovimiento: "2026-07-12T10:00:00.000Z",
    },
    {
      id: "m1",
      mensajeroId: "u1",
      tipo: "devengo",
      categoria: "pago_devengado",
      monto: "5000.00",
      origenTipo: "cierre_dia",
      origenId: "c1",
      cierreId: "c1",
      descripcion: null,
      fechaMovimiento: "2026-07-05T10:00:00.000Z",
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
  cuenta: {
    devengado: "5000.00",
    pagado: "3000.00",
    cuentaPorPagar: "2000.00",
    signo: "positivo",
  },
};

// Desglose CON filtros aplicados: subconjunto + saldo del conjunto filtrado (R22).
const DESGLOSE_FILTRADO: ListarPagosDeMensajeroResult = {
  mensajeroId: "u1",
  mensajeroNombre: "Ana Mensajera",
  movimientos: [
    {
      id: "m1",
      mensajeroId: "u1",
      tipo: "devengo",
      categoria: "pago_devengado",
      monto: "2500.00",
      origenTipo: "cierre_dia",
      origenId: "c1",
      cierreId: "c1",
      descripcion: null,
      fechaMovimiento: "2026-07-05T10:00:00.000Z",
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  cuenta: {
    devengado: "2500.00",
    pagado: "1000.00",
    cuentaPorPagar: "1500.00",
    signo: "positivo",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  tableCalls.length = 0;
  listarMock.mockResolvedValue(CUENTAS_OK);
  desgloseMock.mockResolvedValue({ status: "ok", data: DESGLOSE_DATA });
  // Feature 293 (T5.3): sin podio congelado. Acá se mide QUE EL PANEL ESTÁ, no lo que pinta
  // dentro (eso es `PremiosRankingPanel.test.tsx`).
  premiosMock.mockResolvedValue({
    status: "ok",
    fecha: fechaObjetivo(new Date()),
    hayPodio: false,
    filas: [],
  });
});

/**
 * Renderiza el Server Component ya resuelto con los proveedores que la app le pone encima
 * (`app/(app)/layout.tsx`): el de avisos —el panel de premios usa `useToast`— y una caché de
 * SWR aislada por test, para que un test no vea la lectura del anterior.
 */
async function renderPagina(pagina: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{pagina}</ToastProvider>
    </SWRConfig>,
  );
}

afterEach(() => {
  cleanup();
});

describe("WalletMensajerosPage — control de acceso por rol (R19)", () => {
  it("roles sin acceso total NO ven las cuentas por pagar (notFound), sin pre-fetch de datos", async () => {
    // Feature 94: `admin` YA no está aquí (ve las cuentas, test aparte). Siguen excluidos
    // mensajero, adminTienda y adminSatelite.
    const otros: RolValue[] = ["mensajero", "adminTienda", "adminSatelite"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      const { default: WalletMensajerosPage } = await import(
        "@/app/(app)/wallet/mensajeros/page"
      );
      await expect(WalletMensajerosPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // R19: no expone cuentas por pagar para rol no autorizado.
    expect(listarMock).not.toHaveBeenCalled();
    // Feature 293 (T5.3, R1/R2): tampoco el panel de premios. No es que se oculte el control:
    // es que la página entera no llega a montarse, así que no hay podio que pedir.
    expect(premiosMock).not.toHaveBeenCalled();
  });

  it("feature 94 (paridad adm↔maestro): el admin ve las cuentas por pagar igual que el maestro", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "a", rol: "admin" });
    const { default: WalletMensajerosPage } = await import(
      "@/app/(app)/wallet/mensajeros/page"
    );

    await renderPagina(await WalletMensajerosPage());

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Cuentas por pagar a mensajeros",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("cuentas-por-pagar-table-stub"),
    ).toBeInTheDocument();
    expect(listarMock).toHaveBeenCalledTimes(1);
  });

  it("sin sesion tampoco ve las cuentas por pagar (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    const { default: WalletMensajerosPage } = await import(
      "@/app/(app)/wallet/mensajeros/page"
    );
    await expect(WalletMensajerosPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listarMock).not.toHaveBeenCalled();
    expect(premiosMock).not.toHaveBeenCalled();
  });

  it("si la action responde forbidden, no renderiza la tabla (defensa en profundidad)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    listarMock.mockResolvedValue({ status: "forbidden" });
    const { default: WalletMensajerosPage } = await import(
      "@/app/(app)/wallet/mensajeros/page"
    );
    await expect(WalletMensajerosPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("WalletMensajerosPage — pre-fetch del maestro (R18/R21)", () => {
  it("renderiza la tabla y pasa las cuentas por pagar por props como STRING", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletMensajerosPage } = await import(
      "@/app/(app)/wallet/mensajeros/page"
    );

    await renderPagina(await WalletMensajerosPage());

    // R18: titulo de la pagina + tabla de cuentas por pagar montada.
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Cuentas por pagar a mensajeros",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("cuentas-por-pagar-table-stub"),
    ).toBeInTheDocument();

    // Pre-fetch server-side (todas las cuentas por pagar; maestro no acotado, R19).
    expect(listarMock).toHaveBeenCalledTimes(1);

    // R21: los datos sensibles cruzan como props ya serializados (STRING), sin Decimal.
    expect(tableCalls).toHaveLength(1);
    const props = tableCalls[0];
    expect(props.initialData.items).toHaveLength(2);
    expect(typeof props.initialData.items[0].devengado).toBe("string");
    expect(typeof props.initialData.items[0].pagado).toBe("string");
    expect(typeof props.initialData.items[0].cuentaPorPagar).toBe("string");
    expect(props.initialData.items[0].cuentaPorPagar).toBe("2000.00");
    expect(props.initialData.items[1].cuentaPorPagar).toBe("0.00");
    expect(props.initialData.items[1].signo).toBe("cero");
  });

  it("pre-carga la PÁGINA 1 con el total del conjunto, no el listado entero (R40/R41)", async () => {
    // Feature 170 — FASE 2 (T L.2). Dos cosas que el test de arriba no distingue:
    //  (a) el Server Component pide el listado PAGINADO (input vacío = página 1 con los
    //      defaults del dominio), no `listarCuentasPorPagarAction`, que traía las N filas;
    //  (b) el `total` que baja por props es el del CONJUNTO (30) y no el de la página (2).
    //      De él sale el «de Y» del contador (R42) y el número de páginas.
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletMensajerosPage } = await import(
      "@/app/(app)/wallet/mensajeros/page"
    );

    await renderPagina(await WalletMensajerosPage());

    expect(listarMock).toHaveBeenCalledTimes(1);
    expect(listarMock).toHaveBeenCalledWith({});

    const { initialData } = tableCalls[0];
    expect(initialData.total).toBe(TOTAL_CONJUNTO);
    expect(initialData.total).not.toBe(initialData.items.length);
    expect(initialData.pageSize).toBe(25);
  });
});

// =========================================================================
// Feature 293 (T5.3, R1) — EL PANEL DE PREMIOS DEL RANKING vive en ESTA página
// =========================================================================
//
// R1 dice «únicamente desde `Wallet > Mensajeros`». La mitad «únicamente» la vigila la guardia
// de alcance sobre el árbol; la mitad «desde acá» sólo se puede medir montando la página, y es
// la que impide que las tres Server Actions se queden sin superficie —el estado exacto en el
// que `rutearABodegaSatelite` pasó cinco días en producción—.

describe("WalletMensajerosPage — el panel de premios del ranking (R1)", () => {
  // 🪦 LÁPIDA — FICHA 298 (2026-08-27). Aquí vivía «el maestro lo ve, ENCIMA de la tabla de
  // cuentas por pagar», que afirmaba `panel.compareDocumentPosition(tabla) ===
  // DOCUMENT_POSITION_FOLLOWING`. Se retira porque el orden en el documento DEJÓ DE SER el
  // contrato: el humano pidió separar los dos bloques en pestañas justamente porque apilarlos
  // desordenaba la pantalla, y ahora ninguno está «encima» del otro.
  //
  // Lo que ese caso protegía de verdad —que el panel de premios ESTÁ en esta página y está
  // CABLEADO a su Server Action— no se pierde: lo afirma el caso de abajo, que además exige que
  // cada bloque viva en SU pestaña y que a los dos se llegue.
  it("cada bloque vive en SU pestaña, y a las dos se llega (298)", async () => {
    const user = userEvent.setup();
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletMensajerosPage } = await import(
      "@/app/(app)/wallet/mensajeros/page"
    );

    await renderPagina(await WalletMensajerosPage());

    // Las dos pestañas, en su orden: se entra a PAGAR, no a registrar premios.
    const lista = screen.getByRole("tablist", { name: "Secciones de mensajeros" });
    expect(
      within(lista)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["Cuentas por pagar", "Premios del ranking"]);

    // El panel VISIBLE al entrar es el de las cuentas: `getByRole("tabpanel")` sólo ve el
    // activo (el otro va `hidden`), así que este `getByRole` en singular ya es la afirmación de
    // que no hay dos paneles a la vista.
    const alEntrar = screen.getByRole("tabpanel");
    expect(
      within(alEntrar).getByTestId("cuentas-por-pagar-table-stub"),
    ).toBeInTheDocument();
    expect(
      within(alEntrar).queryByRole("region", { name: "Premios del ranking" }),
    ).toBeNull();

    // Y el de premios se alcanza con UNA pulsación, con su panel real dentro.
    await user.click(screen.getByRole("tab", { name: "Premios del ranking" }));
    const enPremios = await waitFor(() => {
      const activo = screen.getByRole("tabpanel");
      if (!within(activo).queryByRole("region", { name: "Premios del ranking" })) {
        throw new Error("el panel de premios no está visible");
      }
      return activo;
    });
    // El espejo exacto de la ausencia de arriba: acá NO está la tabla del vecino.
    expect(
      within(enPremios).queryByTestId("cuentas-por-pagar-table-stub"),
    ).toBeNull();

    // Y está CABLEADO: pide el podio del día por su Server Action.
    await waitFor(() => expect(premiosMock).toHaveBeenCalledTimes(1));
  });

  it("feature 94 (paridad adm↔maestro): el admin también lo ve", async () => {
    const user = userEvent.setup();
    resolveActorMock.mockResolvedValue({ usuarioId: "a", rol: "admin" });
    const { default: WalletMensajerosPage } = await import(
      "@/app/(app)/wallet/mensajeros/page"
    );

    await renderPagina(await WalletMensajerosPage());

    // 298: el panel vive detrás de su pestaña, así que la paridad se mide llegando a él.
    await user.click(screen.getByRole("tab", { name: "Premios del ranking" }));
    expect(
      await screen.findByRole("region", { name: "Premios del ranking" }),
    ).toBeInTheDocument();
  });

  it("abre en el día que el ranking congela y no deja elegir uno posterior a hoy (R8)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletMensajerosPage } = await import(
      "@/app/(app)/wallet/mensajeros/page"
    );

    // Los dos días los resuelve el SERVIDOR con los mismos helpers que el cron del ranking (el
    // reloj del navegador no es el de Costa Rica), así que aquí se CONGELA el reloj y se afirma
    // contra el LITERAL. Antes se comparaba contra `fechaObjetivo(ahora)` y
    // `fechaCalendarioCR(ahora)` —las mismas funciones que produce la página—: eso está verde
    // aunque devuelvan el día equivocado, y ese día decide qué premio se ofrece registrar.
    //
    // Los literales son un EJEMPLO del contrato fijado a un instante, no un contrato en sí. El
    // instante está elegido para que discrimine: las 02:00Z del 28 son las **20:00 del 27 en
    // Costa Rica**, o sea que la fecha UTC ya va un día por delante. Un atajo por
    // `toISOString().slice(0,10)` —el ⛔ que documenta `lib/ranking/snapshot-dia.ts`— daría
    // 2026-08-27 / 2026-08-28 y este caso lo vería.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T02:00:00.000Z"));
    let pagina: ReactElement;
    try {
      pagina = await WalletMensajerosPage();
    } finally {
      // El render y el `waitFor` van con el reloj REAL: lo que se congela es la resolución de
      // los dos días, que ocurre en el servidor y ya viajó como prop.
      vi.useRealTimers();
    }

    await renderPagina(pagina);

    // 298: el selector vive en la pestaña de premios. Se abre antes de mirarlo y se busca
    // DENTRO del panel activo: `screen.getByLabelText` lo encontraría igual dentro de un panel
    // oculto, y eso no probaría que el maestro puede usarlo.
    await userEvent.setup().click(
      screen.getByRole("tab", { name: "Premios del ranking" }),
    );

    const selector = await waitFor(() =>
      within(screen.getByRole("tabpanel")).getByLabelText("Día del podio"),
    );
    expect(selector).toHaveValue("2026-08-26"); // D−1 en CR: el último día que el cron congela
    expect(selector).toHaveAttribute("max", "2026-08-27"); // hoy en CR (R8)
    await waitFor(() =>
      expect(premiosMock).toHaveBeenCalledWith({ fecha: "2026-08-26" }),
    );
  });
});

// El desglose por cierre del maestro (R18/R22) se monta al EXPANDIR una fila. Aqui se prueba el
// componente real que aparece en esa expansion (`DesglosePagosMensajero`), envuelto en un
// `SWRConfig` con cache aislada (provider nuevo + sin dedup) para que cada test observe sus
// propias llamadas a la Server Action del maestro (mockeada).
//
// Feature 170 (T C.4): el desglose monta el control de descarga del `DataTable`, que usa
// `useToast`. En la app el proveedor está en `app/(app)/layout.tsx`, encima de esta pantalla;
// aquí se envuelve por la misma razón que ya hace `OrdenesDescarga.test.tsx` (151). Cambio
// del ARNÉS: ninguna aserción se toca.
function renderDesglose(resumen: CuentaPorPagarResumenDTO = RESUMEN) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <DesglosePagosMensajero resumen={resumen} id="desglose-u1" />
      </ToastProvider>
    </SWRConfig>,
  );
}

describe("DesglosePagosMensajero — desglose por cierre del maestro (R18)", () => {
  it("al expandir carga el desglose por cierre paginado, mas reciente primero", async () => {
    renderDesglose();

    // R18: carga client-side al montar (= al expandir), acotada al mensajeroId, pagina 1.
    await waitFor(() => expect(desgloseMock).toHaveBeenCalledTimes(1));
    expect(desgloseMock).toHaveBeenCalledWith({
      mensajeroId: "u1",
      page: 1,
      pageSize: 20,
    });

    const tabla = await screen.findByRole("table", {
      name: "Desglose por cierre de Ana Mensajera",
    });

    // Espera a que los movimientos se rendericen (sale del estado "Cargando…").
    await within(tabla).findByText("2026-07-12");

    // R18: los movimientos aparecen en el orden que devuelve el backend (mas reciente primero):
    // la fila del cierre del 2026-07-12 precede a la del 2026-07-05.
    const filas = within(tabla).getAllByRole("row");
    // filas[0] = cabecera; filas[1] = mas reciente; filas[2] = mas antiguo.
    expect(within(filas[1]).getByText("2026-07-12")).toBeInTheDocument();
    expect(within(filas[2]).getByText("2026-07-05")).toBeInTheDocument();

    // Money-safe (R21/R27): los montos salen del STRING del servidor, por el formateador
    // compartido y sin recalcular nada (feature 230: sin la cola de centimos).
    expect(within(tabla).getByText("₡3.000")).toBeInTheDocument();
    expect(within(tabla).getByText("₡5.000")).toBeInTheDocument();
  });
});

describe("DesglosePagosMensajero — filtros server-side fecha/cierre (R22)", () => {
  it("aplica los filtros invocando la action con cierreId/desde/hasta y vuelve a la pagina 1", async () => {
    renderDesglose();

    // Espera la carga inicial (sin filtros) y que el desglose ya este renderizado.
    await screen.findByText("2026-07-12");
    expect(desgloseMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Cierre"), {
      target: { value: "c1" },
    });
    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText("Hasta"), {
      target: { value: "2026-07-31" },
    });

    const form = screen.getByRole("form", {
      name: "Filtros del desglose de Ana Mensajera",
    });
    fireEvent.submit(form);

    // R22: la action se invoca con los filtros de fecha/cierre en el WHERE server-side.
    await waitFor(() => expect(desgloseMock).toHaveBeenCalledTimes(2));
    expect(desgloseMock).toHaveBeenLastCalledWith({
      mensajeroId: "u1",
      page: 1, // nuevos filtros -> vuelve a la primera pagina
      pageSize: 20,
      cierreId: "c1",
      desde: "2026-07-01",
      hasta: "2026-07-31",
    });
  });

  it("el saldo mostrado refleja el CONJUNTO FILTRADO (result.data.cuenta), no el agregado", async () => {
    renderDesglose();

    // Espera a que la carga inicial (sin filtros) resuelva y renderice sus movimientos.
    await screen.findByText("2026-07-12");
    const saldo = screen.getByRole("region", { name: "Desglose de Ana Mensajera" });
    // Carga inicial: el saldo muestra el agregado (cuentaPorPagar ₡2.000).
    expect(within(saldo).getByText("₡2.000")).toBeInTheDocument();

    // La siguiente carga (al filtrar) devuelve el saldo del conjunto filtrado.
    desgloseMock.mockResolvedValueOnce({ status: "ok", data: DESGLOSE_FILTRADO });

    fireEvent.change(screen.getByLabelText("Cierre"), {
      target: { value: "c1" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: "Filtros del desglose de Ana Mensajera" }),
    );

    // R22: el saldo se recalcula desde result.data.cuenta (cuentaPorPagar ₡1.500), y ya no
    // muestra el agregado (₡2.000).
    await waitFor(() =>
      expect(within(saldo).getByText("₡1.500")).toBeInTheDocument(),
    );
    expect(within(saldo).queryByText("₡2.000")).not.toBeInTheDocument();
  });
});

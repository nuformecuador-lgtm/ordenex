// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Feature 57: el PageHeader del topbar monta el LogoutButton (client:
// useRouter/useToast). Se stubbea para aislar el pre-fetch/props de la página.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));
import { render, screen, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import { ToastProvider } from "@/providers/ToastProvider";

import type { WalletModuleProps } from "@/app/(app)/wallet/_components/WalletModule";

// Feature 42 (T11, R18/R19/R21) — la página `/wallet` resuelve el rol SOLO server-side;
// rol ≠ maestro (o sin sesión) → `notFound` (R19). El módulo cliente se stubbea para
// capturar sus props y verificar que los montos cruzan como STRING (R21). El page.tsx
// (Server Component real) se importa sin mockear: se ejercita su lógica.
//
// Feature 173 (T G.3, R59/R62/R64/R65): el pre-fetch de la cabecera pasa a
// `verResumenCajaAction` —las DOS cifras— y la descripción de la página deja de rotular
// ninguna cifra con la palabra que mentía. El cambio de estas aserciones es DELIBERADO y
// está declarado en `design.md §11`.

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

// Ficha 334 (T E2): los mocks declaran TODAS las actions que importa el árbol de `WalletModule`,
// no solo las que pre-obtiene la página. El motivo es que los dos casos de R1/R2 montan el módulo
// REAL (ver el bloque del final), y vitest lanza al RESOLVER el import: una action que faltara en
// el mock no dejaría un caso rojo, dejaría el archivo entero sin ejecutar.
vi.mock("@/lib/actions/wallet", () => ({
  listarMovimientosAction: vi.fn(),
  listarMovimientosCompletoAction: vi.fn(),
  verResumenCajaAction: vi.fn(),
  registrarMovimientoManualAction: vi.fn(),
}));

// Feature 45: la página también pre-obtiene el desglose de egresos y las plantillas.
vi.mock("@/lib/actions/wallet-egresos", () => ({
  verDesgloseEgresosAction: vi.fn(),
  registrarEgresoAdministrativoAction: vi.fn(),
  reversarEgresoAdministrativoAction: vi.fn(),
}));
vi.mock("@/lib/actions/gasto-fijo-plantilla", () => ({
  // Feature 170 — FASE 2 (T I.2): la página pre-carga la PÁGINA 1 de las plantillas, no el
  // conjunto entero. El listado sin paginar sigue existiendo: lo usa la DESCARGA del panel.
  listarPlantillasPaginadoAction: vi.fn(),
  listarPlantillasCompletoAction: vi.fn(),
  crearPlantillaAction: vi.fn(),
  actualizarPlantillaAction: vi.fn(),
  eliminarPlantillaAction: vi.fn(),
  setActivaPlantillaAction: vi.fn(),
}));
// Ficha 333 (G3): la página pre-obtiene además la COLA de cobros de gasto fijo por aprobar, y el
// panel de plantillas cuenta los pendientes al abrir su confirmación de borrado. Las cuatro van
// declaradas por el mismo motivo que las de arriba: los casos de R1/R2 montan el módulo REAL, y
// una action que faltara en el mock no dejaría un caso rojo — dejaría el archivo sin ejecutar.
vi.mock("@/lib/actions/gasto-fijo-cobro", () => ({
  listarCobrosPendientesAction: vi.fn(),
  aprobarCobroGastoFijoAction: vi.fn(),
  rechazarCobroGastoFijoAction: vi.fn(),
  contarCobrosPendientesDePlantillaAction: vi.fn(),
}));
// FICHA 337 (segunda mitad): la pagina pre-obtiene TAMBIEN la cola de cobros por rechazo de
// tienda. Sin este doble la action real corre, abre Prisma y este archivo cae entero con un
// `INTERNAL` de conexion.
vi.mock("@/lib/actions/rechazo-tienda-cobro", () => ({
  listarCobrosRechazoTiendaAction: vi.fn(),
  aprobarCobroRechazoTiendaAction: vi.fn(),
  rechazarCobroRechazoTiendaAction: vi.fn(),
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

// Stub del módulo cliente: captura las props que le pasa el Server Component.
//
// Ficha 334 (T E2): el stub pasa a ser CONMUTABLE. Por defecto sigue siendo el `<div>` de siempre
// —el resto del archivo mide el pre-fetch y las props, no la pantalla— pero los dos casos de R1/R2
// lo ponen a `true` y entonces el stub delega en el módulo REAL, montado con las props que la
// página le pasa. No se usa `vi.importActual` a propósito: ahí las dependencias del módulo dejan de
// estar mockeadas y el panel de gastos fijos acaba abriendo una conexión de verdad contra Postgres.
const moduleCalls: WalletModuleProps[] = [];
let montarModuloReal = false;
vi.mock("@/app/(app)/wallet/_components/WalletModule", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/(app)/wallet/_components/WalletModule")>();
  return {
    WalletModule: (props: WalletModuleProps) => {
      moduleCalls.push(props);
      if (montarModuloReal) return <actual.WalletModule {...props} />;
      return <div data-testid="wallet-module-stub" />;
    },
  };
});

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarMovimientosAction, verResumenCajaAction } from "@/lib/actions/wallet";
import { verDesgloseEgresosAction } from "@/lib/actions/wallet-egresos";
import { listarPlantillasPaginadoAction } from "@/lib/actions/gasto-fijo-plantilla";
import { listarCobrosPendientesAction } from "@/lib/actions/gasto-fijo-cobro";
import { listarCobrosRechazoTiendaAction } from "@/lib/actions/rechazo-tienda-cobro";

const resolveActorMock = vi.mocked(resolveActorFromSession);
const listarMock = vi.mocked(listarMovimientosAction);
const resumenMock = vi.mocked(verResumenCajaAction);
const desgloseMock = vi.mocked(verDesgloseEgresosAction);
const plantillasMock = vi.mocked(listarPlantillasPaginadoAction);
const cobrosMock = vi.mocked(listarCobrosPendientesAction);
const cobrosRechazoMock = vi.mocked(listarCobrosRechazoTiendaAction);

const MOVIMIENTOS_OK = {
  status: "ok" as const,
  data: {
    movimientos: [
      {
        id: "m1",
        tipo: "ingreso" as const,
        categoria: "ingreso_flete" as const,
        monto: "1500.00",
        origenTipo: "cierre_dia" as const,
        origenId: "c1",
        descripcion: null,
        registradoPor: null,
        fechaMovimiento: "2026-07-12T10:00:00.000Z",
        dueno: "propio" as const, // feature 231 (R31): el flete es dinero de Ordenex
      },
      // Feature 173 (R62): un movimiento de una de las categorías NUEVAS viaja por el mismo
      // camino, con la misma forma y sin ningún campo de más.
      {
        id: "m2",
        tipo: "ingreso" as const,
        categoria: "ingreso_cod_recaudado" as const,
        monto: "10000.00",
        origenTipo: "cierre_dia" as const,
        origenId: "c1",
        descripcion: null,
        registradoPor: null,
        fechaMovimiento: "2026-07-12T10:00:00.000Z",
        dueno: "terceros" as const, // feature 231 (R31): el contra-entrega es de las tiendas
      },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
  },
};

/**
 * Feature 173 — las DOS cifras, con dinero de las dos naturalezas: `enCaja` (11 500) y
 * `ganancia` (1 500) son DISTINTAS a propósito, para que ninguna aserción de este archivo
 * pueda pasar por casualidad confundiendo una con la otra.
 */
const RESUMEN_OK = {
  status: "ok" as const,
  resumen: {
    entradas: "11500.00",
    salidas: "0.00",
    enCaja: "11500.00",
    signoEnCaja: "positivo" as const,
    ingresosPropios: "1500.00",
    egresosPropios: "0.00",
    ganancia: "1500.00",
    signoGanancia: "positivo" as const,
    deTerceros: "10000.00",
    periodoFiltrado: false,
    // Feature 231 (R9/R10): 10 000 / 11 500 x 100 = 86.9565… -> "86.96".
    porcentajeTiendas: "86.96",
    modoComposicion: "dos_bolsillos" as const,
  },
  // Feature 231 (design §2.4): la composición viaja HERMANA del resumen, no anidada dentro —
  // por eso el barrido de STRING sobre `props.resumen` sigue afirmando lo mismo que hoy.
  composicion: {
    ingresos: {
      ingreso_flete: "1500.00",
      ingreso_flete_devolucion: "0.00",
      ingreso_comision_cod: "0.00",
      ingreso_iva_flete: "0.00",
      ingreso_iva_flete_devolucion: "0.00",
      ingreso_iva_comision_cod: "0.00",
      ingreso_ajuste: "0.00",
    },
    totalIngresos: "1500.00",
    otrosEgresos: "0.00",
    totalEgresos: "0.00",
  },
};

const DESGLOSE_OK = {
  status: "ok" as const,
  desglose: {
    gastoFijo: "0.00",
    gastoVariable: "0.00",
    sueldo: "0.00",
    indemnizacion: "0.00", // feature 158/R32
    total: "0.00",
  },
};

const PLANTILLAS_OK = {
  status: "ok" as const,
  page: 1,
  pageSize: 25,
  total: 1,
  items: [
    {
      id: "p1",
      concepto: "Alquiler",
      monto: "300.00",
      activa: true,
      periodicidadUnidad: "meses" as const,
      periodicidadCantidad: 1,
      fechaCobro: "2026-07-01",
      requiereAprobacion: true, // ficha 333/R1
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
  ],
};

/**
 * Ficha 333 (G3, R38): la cola de cobros por aprobar, VACIA. Este archivo mide el pre-fetch y las
 * props de la pagina; el detalle de la seccion vive en sus propios archivos. Con `total` en cero
 * la seccion ni se monta, asi que los dos casos que pintan la wallet entera siguen midiendo lo
 * mismo que median. Los casos de la cola cargada estan en
 * `tests/unit/components/wallet-page-cobros-pendientes.test.tsx`.
 */
const COBROS_OK = { status: "ok" as const, items: [], total: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  montarModuloReal = false;
  moduleCalls.length = 0;
  listarMock.mockResolvedValue(MOVIMIENTOS_OK);
  resumenMock.mockResolvedValue(RESUMEN_OK);
  desgloseMock.mockResolvedValue(DESGLOSE_OK);
  plantillasMock.mockResolvedValue(PLANTILLAS_OK);
  cobrosMock.mockResolvedValue(COBROS_OK);
  // FICHA 337: cola vacia. Este archivo mide la pantalla de la caja, no esta cola; lo unico que
  // hace falta es que su lectura responda `ok` y no tumbe la pagina.
  cobrosRechazoMock.mockResolvedValue({ status: "ok", items: [], total: 0 });
});

afterEach(() => {
  cleanup();
});

describe("WalletPage — control de acceso por rol (R19 / feature 173 R65)", () => {
  it("roles sin acceso total NO ven la wallet (notFound), sin pre-fetch de datos", async () => {
    // Feature 94: `admin` YA no está aquí (ve la wallet, test aparte). Siguen excluidos
    // mensajero, adminTienda y adminSatelite.
    const otros: RolValue[] = ["mensajero", "adminTienda", "adminSatelite"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      const { default: WalletPage } = await import("@/app/(app)/wallet/page");
      await expect(WalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // R19 / R65: no expone movimientos ni NINGUNA de las dos cifras a un rol no autorizado.
    // Ni siquiera se piden: el guardia está antes del pre-fetch, no después.
    expect(listarMock).not.toHaveBeenCalled();
    expect(resumenMock).not.toHaveBeenCalled();
  });

  it("feature 94 (paridad adm↔maestro): el admin ve la wallet y pre-fetch de datos igual que el maestro", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "a", rol: "admin" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Wallet" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("wallet-module-stub")).toBeInTheDocument();
    expect(listarMock).toHaveBeenCalledTimes(1);
    expect(resumenMock).toHaveBeenCalledTimes(1);
  });

  it("sin sesión tampoco ve la wallet (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");
    await expect(WalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("si una action responde forbidden, no renderiza el módulo (defensa en profundidad)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    listarMock.mockResolvedValue({ status: "forbidden" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");
    await expect(WalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("R65: si el RESUMEN niega, tampoco se pinta el libro (ni media pantalla)", async () => {
    // La otra mitad de la defensa en profundidad, ahora que la cabecera es otra action: un
    // `forbidden` del resumen no puede dejar la página en pie mostrando el listado.
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    resumenMock.mockResolvedValue({ status: "forbidden" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");
    await expect(WalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(moduleCalls).toHaveLength(0);
  });
});

describe("WalletPage — pre-fetch del maestro (R18/R21)", () => {
  it("renderiza el libro + las dos cifras y pasa los datos por props como STRING", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    // R18: título de la página + módulo del libro/cifras montado.
    expect(
      screen.getByRole("heading", { level: 1, name: "Wallet" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("wallet-module-stub")).toBeInTheDocument();

    // Pre-fetch server-side con filtros por defecto (page 1).
    expect(listarMock).toHaveBeenCalledTimes(1);
    expect(resumenMock).toHaveBeenCalledTimes(1);
    // Feature 45: también pre-obtiene desglose de egresos y plantillas.
    expect(desgloseMock).toHaveBeenCalledTimes(1);
    expect(plantillasMock).toHaveBeenCalledTimes(1);

    // R21: los datos sensibles cruzan como props ya serializados (STRING), sin Decimal.
    expect(moduleCalls).toHaveLength(1);
    const props = moduleCalls[0];
    expect(props.movimientos).toHaveLength(2);
    expect(typeof props.movimientos[0].monto).toBe("string");
    expect(props.movimientos[0].monto).toBe("1500.00");
    expect(props.total).toBe(2);
    expect(props.page).toBe(1);
    expect(props.pageSize).toBe(20);

    // R64 (feature 173): el DTO de las DOS cifras cruza ENTERO y con todos sus importes como
    // STRING. Se barre el objeto completo, no tres campos elegidos a mano: cualquier importe
    // que alguien añada mañana como `number` cae aquí. `periodoFiltrado` es el único
    // no-STRING y no es dinero.
    for (const [clave, valor] of Object.entries(props.resumen)) {
      if (clave === "periodoFiltrado") {
        expect(typeof valor).toBe("boolean");
        continue;
      }
      expect(typeof valor, `resumen.${clave}`).toBe("string");
    }
    // Y son las DOS, distintas: la pantalla no recibe una cifra repetida dos veces.
    expect(props.resumen.enCaja).toBe("11500.00");
    expect(props.resumen.ganancia).toBe("1500.00");
    expect(props.resumen.enCaja).not.toBe(props.resumen.ganancia);

    // Feature 45 (R11/R12/R26): desglose y plantillas cruzan por props como STRING.
    expect(typeof props.desglose.total).toBe("string");
    expect(props.desglose.total).toBe("0.00");
    // Feature 170 — FASE 2 (T I.2): la prop es la PÁGINA (`items` + `total`), no el array.
    expect(props.plantillas.items).toHaveLength(1);
    expect(props.plantillas.total).toBe(1);
    expect(props.plantillas.items[0].concepto).toBe("Alquiler");
    expect(typeof props.plantillas.items[0].monto).toBe("string");
  });

  // ── Feature 231 (T4.5, R9/R12) ──
  it("R9: `composicion` y el resumen cruzan como STRING", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    const props = moduleCalls[0];

    // La composición viaja HERMANA del resumen, no anidada dentro: por eso el barrido de
    // STRING sobre `props.resumen` de aquí arriba sigue afirmando exactamente lo que afirmaba
    // antes de esta feature, sin ampliar ni una excepción.
    expect(props.composicion, "la composición no cruzó por props").toBeDefined();
    expect(props.resumen).not.toHaveProperty("composicion");
    expect(props.resumen).not.toHaveProperty("ingresos");

    // TODOS sus importes son STRING. Se barre el objeto entero, no tres campos elegidos a
    // mano: cualquier importe que alguien añada mañana como `number` cae aquí.
    const { ingresos, ...totales } = props.composicion;
    // Control de no-vacuidad: el desglose trae las siete categorías, no un objeto vacío.
    expect(Object.keys(ingresos)).toHaveLength(7);
    for (const [categoria, valor] of Object.entries(ingresos)) {
      expect(typeof valor, `composicion.ingresos.${categoria}`).toBe("string");
    }
    for (const [clave, valor] of Object.entries(totales)) {
      expect(typeof valor, `composicion.${clave}`).toBe("string");
    }

    // Y los dos campos nuevos del resumen también son STRING planos (D3).
    expect(typeof props.resumen.porcentajeTiendas).toBe("string");
    expect(props.resumen.porcentajeTiendas).toBe("86.96");
    expect(typeof props.resumen.modoComposicion).toBe("string");
    expect(props.resumen.modoComposicion).toBe("dos_bolsillos");

    // El desglose de ingresos cuadra con la cifra agregada del resumen: es la misma lectura.
    expect(props.composicion.totalIngresos).toBe(props.resumen.ingresosPropios);
    expect(props.composicion.totalEgresos).toBe(props.resumen.egresosPropios);
  });

  it("R62: los movimientos de las categorías NUEVAS llegan al listado como los demás", async () => {
    // Sin campo de más, sin forma distinta y sin filtrarse por el camino: el libro es uno.
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    const props = moduleCalls[0];
    const nuevo = props.movimientos.find((m) => m.categoria === "ingreso_cod_recaudado");
    expect(nuevo, "el contra-entrega no llegó al listado").toBeDefined();
    expect(Object.keys(nuevo ?? {}).sort()).toEqual(
      Object.keys(props.movimientos[0]).sort(),
    );
    expect(typeof nuevo?.monto).toBe("string");
  });
});

describe("WalletPage — la descripción de la página (R59)", () => {
  it("R59: la descripción ya no rotula ninguna cifra con la palabra que mentía", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    // El módulo va stubbeado, así que lo que queda en el documento es EXACTAMENTE lo que
    // pone la página: su título y su descripción. Es el sitio preciso donde medir R59.
    expect(document.body.textContent?.toLowerCase()).not.toContain("balance");
  });

  it("R59: y nombra las dos cifras con los mismos nombres que la tarjeta", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    const texto = (document.body.textContent ?? "").toLowerCase();
    expect(texto).toContain("dinero en caja");
    expect(texto).toContain("ganancia de ordenex");
  });
});

// =================================================================================================
// FICHA 334 (T E2, R1/R2) — LA BARRA DE ACCIONES TIENE UN SOLO BOTÓN
// =================================================================================================
//
// Estos dos casos montan el módulo REAL (`vi.importActual`), no el stub que usa el resto del
// archivo, y lo montan con las PROPS QUE LE PASA LA PÁGINA: así lo que se mide es la pantalla que
// una persona con acceso total ve de verdad, y no un montaje inventado para el test.
//
// Antes de esta ficha había DOS botones casi iguales —«Registrar movimiento» (ajuste ingreso/egreso)
// y «Registrar egreso» (gasto variable/sueldo)— con dos vocabularios que no se explicaban entre sí.
// Se fusionan en uno solo que deriva el tipo y la categoría del concepto elegido.
describe("WalletPage — un solo control para mover dinero a mano (R1/R2)", () => {
  async function pintarLaWalletEntera() {
    montarModuloReal = true;
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");
    render(<ToastProvider>{await WalletPage()}</ToastProvider>);

    expect(moduleCalls, "la página no llegó a montar el módulo").toHaveLength(1);
  }

  it("la wallet ofrece un solo botón para registrar dinero", async () => {
    await pintarLaWalletEntera();

    const botones = screen.getAllByRole("button", { name: "Registrar movimiento" });
    expect(botones).toHaveLength(1);
  });

  it("ya no hay un segundo botón de registro manual", async () => {
    await pintarLaWalletEntera();

    // El botón del diálogo retirado, por su nombre exacto: si alguien lo reintrodujera —o dejara
    // vivo el componente viejo montándolo otra vez— este caso lo dice.
    expect(
      screen.queryByRole("button", { name: "Registrar egreso" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Registrar egreso administrativo" }),
    ).not.toBeInTheDocument();

    // Y no por la puerta de atrás: en TODA la pantalla hay exactamente un control cuyo nombre
    // empieza por «Registrar». (El de la plantilla de gasto fijo se llama «Nueva plantilla», y
    // una plantilla no mueve dinero: lo emite el cron desde ella.)
    const registradores = screen
      .getAllByRole("button")
      .filter((b) => (b.textContent ?? "").trim().startsWith("Registrar"));
    expect(registradores.map((b) => (b.textContent ?? "").trim())).toEqual([
      "Registrar movimiento",
    ]);
  });
});

// @vitest-environment jsdom
// Feature 172 (T D.3) — PAGAR A UNA TIENDA desde su desglose. Cubre R4, R33, R34, R51, R53.
//
// Se monta `SaldosTiendasTable` de verdad, como hizo la 171, porque casi todo lo que esta
// task promete es una propiedad de la RELACIÓN entre la tabla, sus filas abiertas y el pago:
// que el botón viva en el hueco que la 171 dejó, que registrar refresque UNA tienda y no las
// demás, y que la cabecera de esa tienda cambie sola.
//
// La caché de SWR se aísla por render (`provider` nuevo + `dedupingInterval: 0`) para que
// cada test observe SUS propias llamadas a las Server Actions, que van dobladas.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  within,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import type { RolValue } from "@prisma/client";

import { ToastProvider } from "@/providers/ToastProvider";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import type {
  ListarMovimientosDeTiendaResult,
  SaldoTiendaResumenDTO,
  WalletTiendaMovimientoDTO,
} from "@/lib/types/wallet-tienda";
import type { PagoRegistradoDTO, RegistrarPagoResult } from "@/lib/types/liquidacion";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";

// --- Dobles de las Server Actions ---------------------------------------

const listarDesgloseMock = vi.fn();
const listarDesgloseCompletoMock = vi.fn();
const listarSaldosPaginaMock = vi.fn();
const listarSaldosCompletoMock = vi.fn();
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarMovimientosDeTiendaAction: (...a: unknown[]) => listarDesgloseMock(...a),
  listarMovimientosDeTiendaCompletoAction: (...a: unknown[]) =>
    listarDesgloseCompletoMock(...a),
  listarSaldosTiendasPaginadoAction: (...a: unknown[]) => listarSaldosPaginaMock(...a),
  listarSaldosTiendasAction: (...a: unknown[]) => listarSaldosCompletoMock(...a),
}));

const registrarPagoMock = vi.fn();
const listarPagosMock = vi.fn();
vi.mock("@/lib/actions/liquidacion", () => ({
  registrarPagoTiendaAction: (...a: unknown[]) => registrarPagoMock(...a),
  listarPagosDeTiendaAction: (...a: unknown[]) => listarPagosMock(...a),
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

vi.mock("@/lib/auth/resolve-actor", () => ({ resolveActorFromSession: vi.fn() }));

// Feature 57: el PageHeader del topbar monta el LogoutButton (client: useRouter/useToast).
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

import { SaldosTiendasTable } from "@/app/(app)/wallet/tiendas/_components/SaldosTiendasTable";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

const resolveActorMock = vi.mocked(resolveActorFromSession);

// --- Datos ---------------------------------------------------------------

const NORTE: SaldoTiendaResumenDTO = {
  tiendaId: "t1",
  tiendaNombre: "Tienda Norte",
  saldo: "9000.00",
  signo: "positivo",
};

const ESTE: SaldoTiendaResumenDTO = {
  tiendaId: "t2",
  tiendaNombre: "Tienda Este",
  saldo: "5000.00",
  signo: "positivo",
};

/** Tienda EN CONTRA: no hay nada que pagarle (R32). */
const SUR: SaldoTiendaResumenDTO = {
  tiendaId: "t3",
  tiendaNombre: "Tienda Sur",
  saldo: "-452.00",
  signo: "negativo",
};

function mov(over: Partial<WalletTiendaMovimientoDTO> = {}): WalletTiendaMovimientoDTO {
  return {
    id: "m1",
    tiendaId: "t1",
    tipo: "credito",
    categoria: "cod_recaudado",
    monto: "10000.00",
    origenTipo: "cierre_dia",
    origenId: "c1",
    descripcion: null,
    fechaMovimiento: "2026-07-12T10:00:00.000Z",
    ...over,
  };
}

/** Desglose de Tienda Norte ANTES del pago: 10000 − 1000 − 0 = 9000. */
const NORTE_ANTES: ListarMovimientosDeTiendaResult = {
  tiendaId: "t1",
  movimientos: [mov({ id: "m2" })],
  total: 1,
  page: 1,
  pageSize: 20,
  desglose: {
    aFavor: "10000.00",
    cargos: "1000.00",
    pagado: "0.00",
    saldo: "9000.00",
    signo: "positivo",
  },
};

/**
 * El MISMO desglose DESPUÉS de pagar ₡4000: aparece el movimiento del pago con su concepto
 * propio (R51), «pagado» sube a 4000 y el saldo baja a 5000 (R53). Las cifras las produce el
 * servidor; aquí solo se comprueba que la pantalla las refleja sin recargar la página.
 */
const NORTE_DESPUES: ListarMovimientosDeTiendaResult = {
  ...NORTE_ANTES,
  movimientos: [
    mov({
      id: "m3",
      tipo: "debito",
      categoria: "pago_tienda",
      monto: "4000.00",
      origenTipo: "pago_tienda",
      origenId: "p1",
      descripcion: "Efectivo",
      fechaMovimiento: "2026-07-30T00:00:00.000Z",
    }),
    mov({ id: "m2" }),
  ],
  total: 2,
  desglose: {
    aFavor: "10000.00",
    cargos: "1000.00",
    pagado: "4000.00",
    saldo: "5000.00",
    signo: "positivo",
  },
};

const ESTE_DESGLOSE: ListarMovimientosDeTiendaResult = {
  ...NORTE_ANTES,
  tiendaId: "t2",
  desglose: {
    aFavor: "5000.00",
    cargos: "0.00",
    pagado: "0.00",
    saldo: "5000.00",
    signo: "positivo",
  },
};

const SUR_DESGLOSE: ListarMovimientosDeTiendaResult = {
  ...NORTE_ANTES,
  tiendaId: "t3",
  desglose: {
    aFavor: "0.00",
    cargos: "452.00",
    pagado: "0.00",
    saldo: "-452.00",
    signo: "negativo",
  },
};

const COMPROBANTE: PagoRegistradoDTO = {
  id: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  monto: "4000.00",
  metodo: "efectivo",
  referencia: null,
  nota: null,
  fechaPago: "2026-07-30",
  registradoPorNombre: "Ana Maestra",
  registradoAt: "2026-08-02T15:04:05.000Z",
  anulacion: null,
};

const PAGO_OK: RegistrarPagoResult = {
  status: "ok",
  pago: COMPROBANTE,
  restante: "5000.00",
};

// --- Montaje -------------------------------------------------------------

function envolver(nodo: ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

function renderTabla(
  tiendas: SaldoTiendaResumenDTO[] = [NORTE],
  puedeRegistrarPago = true,
) {
  listarSaldosPaginaMock.mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(tiendas),
  });
  listarSaldosCompletoMock.mockResolvedValue({ status: "ok", tiendas });
  return envolver(
    <SaldosTiendasTable
      initialData={paginaInicial(tiendas)}
      puedeRegistrarPago={puedeRegistrarPago}
    />,
  );
}

async function desplegar(tiendaNombre: string) {
  fireEvent.click(screen.getByRole("button", { name: `Ver desglose de ${tiendaNombre}` }));
  return screen.findByRole("region", { name: `Desglose de ${tiendaNombre}` });
}

/** Cuántas veces se ha pedido el desglose de una tienda concreta. */
function lecturasDe(tiendaId: string): number {
  return listarDesgloseMock.mock.calls.filter(([i]) => i.tiendaId === tiendaId).length;
}

/** Abre el diálogo de pago de una tienda desplegada y lo devuelve. */
async function abrirDialogo(region: HTMLElement) {
  fireEvent.click(within(region).getByRole("button", { name: "Registrar pago" }));
  return screen.findByRole("dialog");
}

/** Pulsa «Registrar pago» dentro del diálogo (el del pie, no el que lo abrió). */
function confirmarPago(dialogo: HTMLElement) {
  fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar pago" }));
}

/** Los cuatro bloques de importe de la cabecera del desglose, en orden de pantalla. */
function importesDeCabecera(region: HTMLElement): HTMLElement[] {
  return Array.from(region.firstElementChild!.children) as HTMLElement[];
}

function cifraDe(bloque: HTMLElement): string {
  return (bloque.children[1] as HTMLElement).textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  listarDesgloseMock.mockImplementation(async (input: { tiendaId: string }) => {
    const porTienda: Record<string, ListarMovimientosDeTiendaResult> = {
      t1: NORTE_ANTES,
      t2: ESTE_DESGLOSE,
      t3: SUR_DESGLOSE,
    };
    const data = porTienda[input.tiendaId];
    if (!data) throw new Error(`sin doble para ${input.tiendaId}`);
    return { status: "ok", data };
  });
  listarDesgloseCompletoMock.mockResolvedValue({ status: "ok", items: [], total: 0 });
  listarPagosMock.mockResolvedValue({ status: "ok", pagos: [] });
  registrarPagoMock.mockResolvedValue(PAGO_OK);
});

afterEach(() => {
  cleanup();
});

// -------------------------------------------------------------------------

describe("R4 + R1 — permisos por partida doble", () => {
  it("sin permiso NO se renderiza el control de pagar ni la lista de comprobantes", async () => {
    renderTabla([NORTE], false);
    const region = await desplegar("Tienda Norte");
    await waitFor(() => expect(lecturasDe("t1")).toBe(1));

    expect(
      within(region).queryByRole("button", { name: "Registrar pago" }),
    ).not.toBeInTheDocument();
    expect(within(region).queryByText(/registrar pago/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("table", { name: /Pagos registrados/ }),
    ).not.toBeInTheDocument();
    // Y no se pide la lista de comprobantes: sin permiso ni siquiera se consulta.
    expect(listarPagosMock).not.toHaveBeenCalled();
  });

  it("el permiso FALLA CERRADO: sin declararlo, la tabla no ofrece pagar", async () => {
    // Es lo que mantiene verdes los tests de la 171 (R34) y, sobre todo, lo que impide que
    // un consumidor futuro se olvide de decidir el permiso y acabe ofreciendo el botón.
    listarSaldosPaginaMock.mockResolvedValue({
      status: "ok",
      page: 1,
      ...paginaInicial([NORTE]),
    });
    listarSaldosCompletoMock.mockResolvedValue({ status: "ok", tiendas: [NORTE] });
    envolver(<SaldosTiendasTable initialData={paginaInicial([NORTE])} />);

    const region = await desplegar("Tienda Norte");
    expect(
      within(region).queryByRole("button", { name: "Registrar pago" }),
    ).not.toBeInTheDocument();
  });

  it("la otra mitad: la acción responde `forbidden` y la pantalla lo dice", async () => {
    // Ocultar el botón NO es un control de acceso. Aquí el control está a la vista —como si
    // alguien hubiera forzado la prop— y el servidor sigue negando.
    registrarPagoMock.mockResolvedValue({ status: "forbidden" });
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");
    const dialogo = await abrirDialogo(region);

    confirmarPago(dialogo);

    await waitFor(() => expect(registrarPagoMock).toHaveBeenCalledTimes(1));
    expect(
      await within(dialogo).findByText("No tienes permiso para registrar pagos."),
    ).toBeInTheDocument();
    // Nada se refrescó: no hubo pago.
    expect(lecturasDe("t1")).toBe(1);
  });

  it("las dos mitades leen el MISMO predicado que el servicio (`esAccesoTotal`)", async () => {
    // La página resuelve `puedeRegistrarPago` con `esAccesoTotal` —el mismo que
    // `LiquidacionService` usa para responder `forbidden` (R1/R6)—, así que quien no ve el
    // botón es exactamente quien recibiría la negativa. Sin esto, las dos mitades podrían
    // divergir y nadie se enteraría.
    const sinPermiso: RolValue[] = ["mensajero", "adminTienda", "adminSatelite"];
    for (const rol of sinPermiso) {
      expect(esAccesoTotal(rol), `${rol} no puede pagar`).toBe(false);
    }
    for (const rol of ["maestro", "admin"] as RolValue[]) {
      expect(esAccesoTotal(rol), `${rol} sí puede pagar`).toBe(true);
    }

    // Y la página se lo pasa a la tabla derivado de ahí, no escrito a mano.
    const fuente = codigoSinComentarios("app/(app)/wallet/tiendas/page.tsx");
    expect(fuente).toMatch(/puedeRegistrarPago=\{esAccesoTotal\(actor\.rol\)\}/);
    expect(fuente).not.toMatch(/puedeRegistrarPago=\{true\}/);
  });

  it("un rol sin acceso total ni siquiera llega a la pantalla (defensa previa)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminSatelite" });
    const { default: WalletTiendasPage } = await import("@/app/(app)/wallet/tiendas/page");
    await expect(WalletTiendasPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("R33 — el refresco es DIRIGIDO a la tienda que se pagó", () => {
  it("con dos desgloses abiertos, pagar en uno NO vuelve a consultar el otro", async () => {
    // El criterio duro de la task. Un `mutate()` sin argumentos —o un `router.refresh()`—
    // pasaría cualquier test de una sola tienda y aquí cae: refrescaría también la otra.
    renderTabla([NORTE, ESTE]);
    const regionNorte = await desplegar("Tienda Norte");
    await desplegar("Tienda Este");
    await waitFor(() => expect(lecturasDe("t1")).toBe(1));
    await waitFor(() => expect(lecturasDe("t2")).toBe(1));

    const esteAntes = lecturasDe("t2");
    const dialogo = await abrirDialogo(regionNorte);
    confirmarPago(dialogo);

    await waitFor(() => expect(lecturasDe("t1")).toBe(2));
    // La otra tienda no se ha tocado.
    expect(lecturasDe("t2")).toBe(esteAntes);
  });

  it("tampoco vuelve a leer la lista de comprobantes de la otra tienda", async () => {
    renderTabla([NORTE, ESTE]);
    const regionNorte = await desplegar("Tienda Norte");
    await desplegar("Tienda Este");
    await waitFor(() => expect(listarPagosMock).toHaveBeenCalledTimes(2));

    const pagosEsteAntes = listarPagosMock.mock.calls.filter(
      ([i]) => i.tiendaId === "t2",
    ).length;

    const dialogo = await abrirDialogo(regionNorte);
    confirmarPago(dialogo);

    await waitFor(() =>
      expect(
        listarPagosMock.mock.calls.filter(([i]) => i.tiendaId === "t1").length,
      ).toBe(2),
    );
    expect(listarPagosMock.mock.calls.filter(([i]) => i.tiendaId === "t2").length).toBe(
      pagosEsteAntes,
    );
  });

  it("el pago se registra contra la tienda de SU fila, nunca contra otra", async () => {
    renderTabla([NORTE, ESTE]);
    const regionEste = await desplegar("Tienda Este");
    await desplegar("Tienda Norte");
    const dialogo = await abrirDialogo(regionEste);

    confirmarPago(dialogo);

    await waitFor(() => expect(registrarPagoMock).toHaveBeenCalledTimes(1));
    expect(registrarPagoMock.mock.calls[0][0]).toMatchObject({ tiendaId: "t2" });
  });

  it("no se recarga la página: la tabla de saldos no se vuelve a pedir por el pago", async () => {
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");
    await waitFor(() => expect(lecturasDe("t1")).toBe(1));
    const saldosAntes = listarSaldosPaginaMock.mock.calls.length;

    const dialogo = await abrirDialogo(region);
    confirmarPago(dialogo);
    await waitFor(() => expect(lecturasDe("t1")).toBe(2));

    expect(listarSaldosPaginaMock.mock.calls.length).toBe(saldosAntes);
  });
});

describe("R51/R53 — lo que se ve en el desglose después de pagar", () => {
  it("«pagado a la tienda» sube y el saldo baja en el MISMO monto, sin recargar", async () => {
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");
    await waitFor(() => expect(cifraDe(importesDeCabecera(region)[2])).toBe("₡0.00"));
    expect(cifraDe(importesDeCabecera(region)[3])).toBe("₡9000.00");

    // Tras el pago el servidor devuelve el desglose nuevo; la pantalla lo pinta tal cual.
    listarDesgloseMock.mockResolvedValue({ status: "ok", data: NORTE_DESPUES });
    const dialogo = await abrirDialogo(region);
    confirmarPago(dialogo);

    await waitFor(() => expect(cifraDe(importesDeCabecera(region)[2])).toBe("₡4000.00"));
    expect(cifraDe(importesDeCabecera(region)[3])).toBe("₡5000.00");
    // 9000 − 4000 = 5000: las dos cifras se mueven en el mismo importe, y las dos las
    // calculó el servidor (aquí no se resta nada).
    expect(cifraDe(importesDeCabecera(region)[0])).toBe("₡10000.00");
  });

  it("R51: el movimiento del pago aparece con su concepto propio, distinguible", async () => {
    listarDesgloseMock.mockResolvedValue({ status: "ok", data: NORTE_DESPUES });
    renderTabla([NORTE]);
    await desplegar("Tienda Norte");

    const tablaMovs = await screen.findByRole("table", {
      name: "Movimientos del desglose de Tienda Norte",
    });
    await within(tablaMovs).findByText("Pago a la tienda");
    const fila = within(tablaMovs).getAllByText("Pago a la tienda")[0].closest("tr")!;
    expect(within(fila).getByText("Débito")).toBeInTheDocument();
    expect(within(fila).getByText("₡4000.00")).toBeInTheDocument();
    // No se confunde con un cargo de Ordenex: son conceptos distintos del mismo libro.
    expect(within(fila).queryByText("COD recaudado")).not.toBeInTheDocument();
  });

  it("el diálogo propone el saldo a favor de ESA tienda como monto (R30)", async () => {
    renderTabla([NORTE, ESTE]);
    const regionEste = await desplegar("Tienda Este");
    const dialogo = await abrirDialogo(regionEste);

    expect((within(dialogo).getByLabelText(/^Monto/) as HTMLInputElement).value).toBe(
      "5000.00",
    );
    // Y el diálogo dice de QUIÉN es: con varias filas abiertas, un título genérico dejaría
    // al usuario pagando a ciegas.
    expect(screen.getByRole("dialog", { name: /Tienda Este/ })).toBeInTheDocument();
  });

  it("R32: una tienda EN CONTRA no ofrece pagar, y lo explica", async () => {
    renderTabla([SUR]);
    const region = await desplegar("Tienda Sur");

    expect(within(region).getByRole("button", { name: "Registrar pago" })).toBeDisabled();
    expect(
      within(region).getByText("Esta tienda no tiene saldo a favor: no hay nada que pagar."),
    ).toBeInTheDocument();
  });
});

describe("R50 — los comprobantes viven dentro del desglose de su tienda", () => {
  it("se listan al abrir la fila, pidiendo SOLO los de esa tienda", async () => {
    listarPagosMock.mockResolvedValue({ status: "ok", pagos: [COMPROBANTE] });
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");

    const tablaPagos = await within(region).findByRole("table", {
      name: "Pagos registrados de Tienda Norte",
    });
    await within(tablaPagos).findByText("₡4000.00");
    expect(within(tablaPagos).getByText("2026-07-30")).toBeInTheDocument();
    expect(within(tablaPagos).getByText("Ana Maestra")).toBeInTheDocument();

    expect(listarPagosMock).toHaveBeenCalledTimes(1);
    expect(listarPagosMock).toHaveBeenCalledWith({ tiendaId: "t1" });
  });

  it("listar tiendas NO cuesta ninguna lectura de comprobantes", async () => {
    // El `useSWR` de la lista vive dentro del desglose, igual que el de la 171: la pantalla
    // no paga por las tiendas que nadie abrió.
    renderTabla([NORTE, ESTE, SUR]);
    expect(await screen.findByText("Tienda Norte")).toBeInTheDocument();
    expect(listarPagosMock).not.toHaveBeenCalled();
  });

  it("tras registrar, la lista de ESA tienda se vuelve a pedir", async () => {
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");
    await waitFor(() => expect(listarPagosMock).toHaveBeenCalledTimes(1));

    listarPagosMock.mockResolvedValue({ status: "ok", pagos: [COMPROBANTE] });
    const dialogo = await abrirDialogo(region);
    confirmarPago(dialogo);

    await waitFor(() => expect(listarPagosMock).toHaveBeenCalledTimes(2));
    const tablaPagos = within(region).getByRole("table", {
      name: "Pagos registrados de Tienda Norte",
    });
    await within(tablaPagos).findByText("₡4000.00");
  });

  it("si la lista falla, el desglose sigue en pie y el fallo se cuenta ahí", async () => {
    listarPagosMock.mockResolvedValue({ status: "forbidden" });
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");

    await waitFor(() =>
      expect(
        within(region).getByText("No se pudieron cargar los pagos registrados."),
      ).toBeInTheDocument(),
    );
    // La cabecera del desglose sigue mostrando sus cifras.
    expect(cifraDe(importesDeCabecera(region)[3])).toBe("₡9000.00");
  });
});

describe("R34 — la 171 se conserva tal cual", () => {
  it("la tabla de saldos mantiene sus columnas, sus cifras y su descarga", async () => {
    renderTabla([NORTE, SUR]);
    const tablaSaldos = screen.getByRole("table", { name: "Saldos de tiendas" });
    expect(
      within(tablaSaldos)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Desglose", "Tienda", "Saldo a favor", "Estado"]);
    expect(within(tablaSaldos).getByText("₡9000.00")).toBeInTheDocument();
    expect(within(tablaSaldos).getByText("₡-452.00")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Descargar Saldos de tiendas" }),
    ).toBeInTheDocument();
  });

  it("el desglose mantiene su cabecera, sus filtros, su tabla y su paginación", async () => {
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");

    expect(
      screen.getByRole("form", { name: "Filtros del desglose de Tienda Norte" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Movimientos del desglose de Tienda Norte" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Paginación del desglose de Tienda Norte" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Descargar Desglose de Tienda Norte" }),
    ).toBeInTheDocument();
    expect(
      within(region)
        .getAllByText(/A favor de la tienda|Cargos de Ordenex|Pagado a la tienda|Saldo a favor/)
        .length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("la 172 NO edita `DesgloseMovimientosTienda`: entra por el hueco `acciones`", () => {
    // La forma más barata de garantizar R34 es no tocar el archivo. Si alguien lo edita para
    // meter el pago dentro, este test lo dice.
    const fuente = codigoSinComentarios(
      "app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda.tsx",
    );
    expect(fuente).not.toMatch(/liquidacion/i);
    expect(fuente).not.toMatch(/RegistrarPago|PagosRegistrados|PagoTienda/);
  });

  it("filtrar el desglose sigue funcionando con el pago montado encima", async () => {
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");
    await waitFor(() => expect(lecturasDe("t1")).toBe(1));

    fireEvent.change(within(region).getByLabelText("Cierre"), { target: { value: "c1" } });
    fireEvent.submit(
      screen.getByRole("form", { name: "Filtros del desglose de Tienda Norte" }),
    );

    await waitFor(() => expect(lecturasDe("t1")).toBe(2));
    expect(listarDesgloseMock).toHaveBeenLastCalledWith({
      tiendaId: "t1",
      page: 1,
      pageSize: 20,
      cierreId: "c1",
    });
  });
});

describe("R14 — money-safe en el cableado de la pantalla", () => {
  it("el archivo del cableado no convierte ni redondea ningún monto", () => {
    const codigo = codigoSinComentarios(
      "app/(app)/wallet/tiendas/_components/PagoTiendaAcciones.tsx",
    );
    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(codigo, `el cableado llama a ${prohibida}`).not.toMatch(prohibida);
    }
  });

  it("el monto que viaja a la acción es el STRING del servidor, sin tocar", async () => {
    renderTabla([NORTE]);
    const region = await desplegar("Tienda Norte");
    const dialogo = await abrirDialogo(region);
    confirmarPago(dialogo);

    await waitFor(() => expect(registrarPagoMock).toHaveBeenCalledTimes(1));
    const enviado = registrarPagoMock.mock.calls[0][0];
    expect(enviado.monto).toBe("9000.00");
    expect(typeof enviado.monto).toBe("string");
  });
});

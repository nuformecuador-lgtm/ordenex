// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { RolValue } from "@prisma/client";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
// Ficha 335 (D5): la lista de roles DENEGADOS se deriva de esta constante, la misma que lee el
// item de menu. Asi el dia que alguien la amplie, este archivo no se queda comprobando de mas.
import { ROLES_MI_WALLET } from "@/lib/auth/menu-visibility";
import type { EstadoCuentaDTO, FilaEstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import { FORMA_UUID, UUID_TIENDA, estado, fila } from "@/tests/fixtures/estado-cuenta";

// =================================================================================================
// `/mi-wallet` — la pagina de la TIENDA sobre su dinero con Ordenex.
//
// Feature 43 (T14, R18/R19/R21): el rol se resuelve SOLO server-side; rol != adminTienda (o sin
// sesion) → `notFound` sin pre-fetch (R19). El backend acota SIEMPRE a la tienda del actor; los
// montos cruzan como STRING (R21).
//
// FICHA 458-D (T D.5, R34–R36, R78): la pantalla ES el estado de cuenta de la propia tienda, en solo
// lectura (`verMiEstadoCuentaAction`, sin ninguna clave de cuenta), con su selector de cierre de la 335.
// Se monta la PAGINA REAL con el MODULO REAL: lo que se mide es lo que la tienda lee.
//
// Sustituciones (el libro de la 43/172/335 se retiro con la 458-D; cada caso conserva su R):
//  - 172 R55 (la tienda distingue el pago del cargo): la fila del pago es «Ordenex te pagó» en el chip
//    «Pagos», la del flete «Ordenex te cobró el flete» en «Cierres»; la cabecera vieja no vuelve.
//  - 172 N1 (la salvedad de los importes brutos): el estado de cuenta enseña cifras NETAS (D3), así
//    que la salvedad ya no tiene a qué referirse y NO se pinta.
//  - 335 R12–R15 (presentación): las tarjetas y el extracto son bloques hermanos; el extracto tiene
//    nombre visible y accesible; el selector va por encima de la tabla; la paginación conserva un
//    nombre propio.
// =================================================================================================

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: vi.fn(),
  verEstadoCuentaCompletoAction: vi.fn(),
  verMiEstadoCuentaAction: vi.fn(),
  verMiEstadoCuentaCompletoAction: vi.fn(),
  verOrdenesDeFilaAction: vi.fn(),
}));

// Ficha 335 (B4): `listarMisCierresAction` puebla el selector de cierres. FÁBRICA CERRADA: lo que no
// está aquí no existe para el módulo bajo prueba.
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarMisCierresAction: vi.fn(),
  verDetalleDeMiMovimientoAction: vi.fn(),
  verDetalleDeMiMovimientoCompletoAction: vi.fn(),
}));

vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));

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

// Feature 57: el PageHeader del topbar monta el LogoutButton (client: useToast). Se stubbea.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { verMiEstadoCuentaAction } from "@/lib/actions/estado-cuenta";
import { listarMisCierresAction } from "@/lib/actions/wallet-tienda";

const resolveActorMock = vi.mocked(resolveActorFromSession);
const estadoMock = vi.mocked(verMiEstadoCuentaAction);
const cierresMock = vi.mocked(listarMisCierresAction);

const TIENDA = { usuarioId: UUID_TIENDA, rol: "adminTienda" as const };

/** Ficha 335 — un cierre en el libro de la tienda: lo que puebla el selector del filtro. */
const CIERRES_OK = {
  status: "ok" as const,
  cierres: [{ cierreId: "4c0e1a2b-3d4e-4f50-8a61-7b8c9d0e1f23", fecha: "2026-07-12T10:00:00.000Z", movimientos: 2 }],
  hayMas: false,
};

/** Una fila del libro de la tienda VISTA DESDE LA TIENDA: sin nombres de Ordenex (R35/D2). */
function filaTienda(parcial: Partial<FilaEstadoCuentaDTO> & { n?: number }): FilaEstadoCuentaDTO {
  return fila({ registro: { nombre: null, automatico: null }, anulable: false, ...parcial });
}

const COD = filaTienda({ n: 1, abono: "50000.00", saldoCorrido: "50000.00" });
const FLETE = filaTienda({
  n: 2,
  categoria: "flete",
  abono: null,
  cargo: "1200.00",
  saldoCorrido: "48800.00",
});
/** El pago de Ordenex a la tienda (172): un CARGO de su libro, en el chip «Pagos». */
const PAGO = filaTienda({
  n: 3,
  fecha: "2026-08-01",
  categoria: "pago_tienda",
  origenTipo: "pago_tienda",
  origen: { texto: "Pago de Ordenex a una tienda · 2026-08-01 · Transferencia", enlace: null },
  pago: { metodo: "transferencia", referencia: "REF-991" },
  chip: "pagos",
  naceDeUnCierre: false,
  abono: null,
  cargo: "20000.00",
  saldoCorrido: "28800.00",
  tieneComprobante: true,
});

function estadoTienda(filas: FilaEstadoCuentaDTO[], parcial: Partial<EstadoCuentaDTO> = {}): EstadoCuentaDTO {
  const ultimo = filas[filas.length - 1]?.saldoCorrido ?? "0.00";
  return estado({
    filas,
    total: filas.length,
    saldoActual: ultimo,
    saldoFinal: ultimo,
    signo: ultimo.startsWith("-") ? "negativo" : ultimo === "0.00" ? "cero" : "positivo",
    sentido: ultimo.startsWith("-") ? "cuenta_debe" : ultimo === "0.00" ? "en_cero" : "ordenex_debe",
    ...parcial,
  });
}

function sembrar(e: EstadoCuentaDTO) {
  resolveActorMock.mockResolvedValue(TIENDA);
  estadoMock.mockResolvedValue({ status: "ok", estado: e });
}

/** Monta `/mi-wallet` de verdad: Server Component real → módulo REAL. */
async function verMiWallet() {
  const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");
  const pagina = await MiWalletPage();
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{pagina}</ToastProvider>
    </SWRConfig>,
  );
}

function tabla() {
  return screen.getByRole("table", { name: "Estado de cuenta de Tania Tienda" });
}

function tarjetas() {
  return screen.getByRole("region", { name: "Saldo de Tania Tienda" });
}

/** La fila del extracto que contiene el texto dado. */
function filaCon(texto: string | RegExp): HTMLElement {
  const celda = within(tabla()).getByText(texto);
  const tr = celda.closest("tr");
  if (!tr) throw new Error(`sin fila para ${String(texto)}`);
  return tr;
}

beforeEach(() => {
  vi.clearAllMocks();
  cierresMock.mockResolvedValue(CIERRES_OK);
  estadoMock.mockResolvedValue({ status: "ok", estado: estadoTienda([COD, FLETE]) });
});

afterEach(() => {
  cleanup();
});

describe("MiWalletPage — control de acceso por rol (R19)", () => {
  it("roles != adminTienda NO ven su wallet (notFound), sin pre-fetch de datos", async () => {
    const otros: RolValue[] = ["mensajero", "admin", "maestro", "adminSatelite"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");
      await expect(MiWalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(estadoMock).not.toHaveBeenCalled();
    expect(cierresMock).not.toHaveBeenCalled();
  });

  it("sin sesion tampoco ve su wallet (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");
    await expect(MiWalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(estadoMock).not.toHaveBeenCalled();
  });

  it("si la lectura responde forbidden, no renderiza el modulo (defensa en profundidad)", async () => {
    resolveActorMock.mockResolvedValue(TIENDA);
    estadoMock.mockResolvedValue({ status: "forbidden" });
    const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");
    await expect(MiWalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("MiWalletPage — pre-fetch del adminTienda (R18/R21, 458-D R34/R36)", () => {
  it("lee SU estado de cuenta SIN ninguna clave de cuenta y lo pinta con los STRING del servidor", async () => {
    sembrar(estadoTienda([COD, FLETE]));
    await verMiWallet();

    expect(screen.getByRole("heading", { level: 1, name: "Mi wallet" })).toBeInTheDocument();
    // R36: la entrada es un objeto VACÍO: ni `cuenta` ni `tiendaId` (la tienda es la de la sesión).
    expect(estadoMock).toHaveBeenCalledTimes(1);
    expect(estadoMock).toHaveBeenCalledWith({});
    // R21: el importe es el STRING del servidor, pintado con `money`.
    expect(within(tarjetas()).getAllByText("₡48.800").length).toBeGreaterThan(0);
    expect(within(tarjetas()).getByText("Ordenex te debe ₡48.800")).toBeInTheDocument();
  });

  it("el saldo puede ser NEGATIVO (la tienda le debe a Ordenex) y se lee con su signo y en palabras", async () => {
    sembrar(estadoTienda([filaTienda({ categoria: "cobro_manual", origenTipo: "manual", chip: "cobros", naceDeUnCierre: false, abono: null, cargo: "450.00", saldoCorrido: "-450.00" })]));
    await verMiWallet();
    expect(within(tarjetas()).getAllByText("-₡450").length).toBeGreaterThan(0);
    expect(within(tarjetas()).getByText("Le debés ₡450 a Ordenex")).toBeInTheDocument();
  });
});

describe("458-D R34 — el estado de cuenta de la tienda: saldo inicial arriba y saldo corrido", () => {
  it("la primera fila es el saldo inicial y el corrido de la ÚLTIMA fila es el saldo de la tarjeta", async () => {
    sembrar(estadoTienda([COD, FLETE, PAGO]));
    await verMiWallet();

    const filas = within(tabla()).getAllByRole("row").slice(1);
    expect(filas[0]).toHaveTextContent("Saldo inicial");
    const ultima = filas[filas.length - 1];
    expect(ultima).toHaveTextContent("₡28.800");
    expect(within(tarjetas()).getAllByText("₡28.800").length).toBeGreaterThan(0);
  });

  it("los chips de la tienda y el periodo; ningún nombre de la gente de Ordenex («Registró»)", async () => {
    sembrar(estadoTienda([COD, FLETE, PAGO]));
    await verMiWallet();
    for (const chip of ["Todo", "Cierres", "Pagos", "Cobros", "Correcciones"]) {
      expect(within(screen.getByRole("group", { name: "Filtrar el estado de cuenta de Tania Tienda" })).getByRole("button", { name: chip })).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Desde")).toHaveAttribute("type", "date");
    expect(tabla().textContent ?? "").not.toContain("Registró");
  });

  it("un anulado se ve tachado con el motivo y el día, sin decir quién de Ordenex lo anuló", async () => {
    sembrar(
      estadoTienda([
        COD,
        filaTienda({
          n: 4,
          categoria: "cobro_manual",
          origenTipo: "manual",
          chip: "cobros",
          naceDeUnCierre: false,
          abono: null,
          cargo: "500.00",
          saldoCorrido: "49500.00",
          anulacion: { motivo: "Cobro duplicado", por: null, fecha: "2026-09-20" },
        }),
      ]),
    );
    await verMiWallet();
    expect(filaCon("Anulado el 2026-09-20 · Cobro duplicado")).toBeInTheDocument();
  });
});

describe("458-D R35 — `/mi-wallet` solo lee", () => {
  it("ningún botón de registrar, cobrar, pagar, anular ni adjuntar; ni el «Ver» con «Anular…» de la oficina", async () => {
    sembrar(estadoTienda([COD, FLETE, PAGO]));
    await verMiWallet();
    for (const nombre of [/^Registrar/i, /^Ordenex le cobra/, /le paga a/, /^Anular/, /^Adjuntar/]) {
      expect(screen.queryAllByRole("button", { name: nombre })).toHaveLength(0);
    }
    expect(screen.queryAllByRole("button", { name: /^Ver (?!comprobante|las órdenes)/ })).toHaveLength(0);
    expect(document.body.textContent ?? "").not.toMatch(FORMA_UUID);
  });

  it("R78: «Ver comprobante» SOLO en las filas que pueden llevarlo (el pago sí; lo del cierre, no)", async () => {
    sembrar(estadoTienda([COD, FLETE, PAGO]));
    await verMiWallet();
    expect(within(filaCon("Ordenex te pagó")).getByRole("button", { name: /^Ver comprobante/ })).toBeInTheDocument();
    expect(within(filaCon("Ordenex te cobró el flete")).queryByRole("button", { name: /^Ver comprobante/ })).toBeNull();
  });

  it("R19: la fila del cierre despliega SUS órdenes; el pago, no", async () => {
    sembrar(estadoTienda([COD, PAGO]));
    await verMiWallet();
    expect(within(filaCon("Cobrado a tus clientes en contra-entrega")).getByRole("button", { name: /^Ver las órdenes/ })).toBeInTheDocument();
    expect(within(filaCon("Ordenex te pagó")).queryByRole("button", { name: /^Ver las órdenes/ })).toBeNull();
  });
});

describe("MiWalletPage — la tienda distingue el pago del cargo (172 R55) [P5]", () => {
  it("el pago se lee «Ordenex te pagó», con cómo se pagó; el flete, «Ordenex te cobró el flete»", async () => {
    sembrar(estadoTienda([COD, FLETE, PAGO]));
    await verMiWallet();
    const pago = filaCon("Ordenex te pagó");
    expect(within(pago).getByText("Cómo se pagó: Transferencia · referencia REF-991")).toBeInTheDocument();
    expect(within(pago).getByText("₡20.000")).toBeInTheDocument();
    expect(within(filaCon("Ordenex te cobró el flete")).getByText("₡1.200")).toBeInTheDocument();
  });

  it("la cabecera vieja ya NO existe: ni «Débitos» ni «Créditos (COD)»", async () => {
    sembrar(estadoTienda([COD, FLETE, PAGO]));
    await verMiWallet();
    expect(screen.queryByText("Débitos")).not.toBeInTheDocument();
    expect(screen.queryByText("Créditos (COD)")).not.toBeInTheDocument();
  });

  it("N1 (172): las cifras son NETAS (D3), así que la salvedad de los importes brutos no se pinta", async () => {
    sembrar(estadoTienda([COD, FLETE, PAGO]));
    await verMiWallet();
    expect(screen.queryAllByRole("note")).toHaveLength(0);
    expect(screen.queryByText(/sigue contando los pagos que se anularon/)).toBeNull();
  });
});

describe("MiWalletPage — la presentación (335 R12–R15 → 458-D)", () => {
  it("R12: las tarjetas del saldo y el extracto son bloques hermanos, ninguno dentro del otro", async () => {
    await verMiWallet();
    expect(tarjetas().contains(tabla())).toBe(false);
    expect(tabla().contains(tarjetas())).toBe(false);
  });

  it("R13: el extracto tiene nombre accesible propio y la página su título visible", async () => {
    await verMiWallet();
    expect(tabla()).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Mi wallet" })).toBeVisible();
  });

  it("R14: el selector de cierre va por encima de la tabla", async () => {
    await verMiWallet();
    const selector = screen.getByRole("combobox", { name: "Filtrar por cierre" });
    expect(selector.compareDocumentPosition(tabla()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("R15: la paginación conserva un nombre accesible propio", async () => {
    await verMiWallet();
    expect(screen.getByRole("navigation", { name: "Paginación del estado de cuenta de Tania Tienda" })).toBeInTheDocument();
  });
});

describe("MiWalletPage — el selector de cierre degrada sin esconder el dinero (R28–R30) [335]", () => {
  function laPantallaSigueEntera() {
    expect(within(tarjetas()).getByText("Ordenex te debe ₡48.800")).toBeInTheDocument();
    expect(tabla()).toBeInTheDocument();
  }

  it("R29: si la lectura de cierres no responde ok, el estado de cuenta sigue en pantalla y NO hay notFound", async () => {
    sembrar(estadoTienda([COD, FLETE]));
    cierresMock.mockResolvedValue({ status: "forbidden" });
    await verMiWallet();
    laPantallaSigueEntera();
    expect(screen.getByRole("combobox", { name: "Filtrar por cierre" })).toBeDisabled();
    expect(screen.getByText("No pudimos cargar tus cierres. Probá recargando la página.")).toBeInTheDocument();
  });

  it("R29: el estado `unauthenticated` de esa lectura tampoco tumba la pantalla", async () => {
    sembrar(estadoTienda([COD, FLETE]));
    cierresMock.mockResolvedValue({ status: "unauthenticated" });
    await verMiWallet();
    laPantallaSigueEntera();
    expect(screen.getByRole("combobox", { name: "Filtrar por cierre" })).toBeDisabled();
  });

  it("R28: sin cierres, el selector queda deshabilitado y la pantalla lo dice", async () => {
    sembrar(estadoTienda([COD, FLETE]));
    cierresMock.mockResolvedValue({ status: "ok", cierres: [], hayMas: false });
    await verMiWallet();
    expect(screen.getByRole("combobox", { name: "Filtrar por cierre" })).toBeDisabled();
    expect(screen.getByText("Todavía no hay cierres en tu wallet.")).toBeInTheDocument();
    expect(screen.queryByText("No pudimos cargar tus cierres. Probá recargando la página.")).not.toBeInTheDocument();
  });

  it("R28/R30: con cierres y sin tope alcanzado, no hay aviso ninguno (contraprueba)", async () => {
    sembrar(estadoTienda([COD, FLETE]));
    await verMiWallet();
    expect(screen.getByRole("combobox", { name: "Filtrar por cierre" })).not.toBeDisabled();
    expect(screen.queryByText("Todavía no hay cierres en tu wallet.")).not.toBeInTheDocument();
    expect(screen.queryByText("Mostramos los cierres más recientes.")).not.toBeInTheDocument();
  });

  it("R30: con `hayMas`, la pantalla avisa de que solo ofrece los más recientes", async () => {
    sembrar(estadoTienda([COD, FLETE]));
    cierresMock.mockResolvedValue({ ...CIERRES_OK, hayMas: true });
    await verMiWallet();
    const aviso = screen.getByText("Mostramos los cierres más recientes.");
    expect(aviso.getAttribute("role")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FICHA 335 — D5 (R34): el gate de la ruta, DERIVADO de la constante.
// ─────────────────────────────────────────────────────────────────────────────

const TODOS_LOS_ROLES: readonly RolValue[] = ["maestro", "admin", "mensajero", "adminTienda", "adminSatelite", "apiKey"];

const PERMITIDOS: readonly string[] = ROLES_MI_WALLET;
const DENEGADOS = TODOS_LOS_ROLES.filter((rol) => !PERMITIDOS.includes(rol));

describe("MiWalletPage — el gate lee la MISMA constante que el menú (R34) [335]", () => {
  it("CONTROL DE NO-VACUIDAD: hay roles denegados y `adminTienda` no está entre ellos", () => {
    expect(DENEGADOS.length).toBeGreaterThan(0);
    expect(DENEGADOS).not.toContain("adminTienda");
    expect(PERMITIDOS).toEqual(["adminTienda"]);
  });

  for (const rol of DENEGADOS) {
    it(`R34: ${rol} recibe notFound() y no dispara ningún pre-fetch`, async () => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");
      await expect(MiWalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(estadoMock).not.toHaveBeenCalled();
      expect(cierresMock).not.toHaveBeenCalled();
    });
  }

  it("R34: las dos lecturas se disparan para el rol permitido, y la de cierres va SIN argumentos", async () => {
    sembrar(estadoTienda([COD]));
    await verMiWallet();
    expect(estadoMock).toHaveBeenCalledTimes(1);
    expect(cierresMock).toHaveBeenCalledTimes(1);
    expect(cierresMock).toHaveBeenCalledWith();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⭑ FICHA 459 — el pago por cuenta en /mi-wallet (R44) y en las descargas (R100)
// ─────────────────────────────────────────────────────────────────────────────

const PAGO_POR_CUENTA_ID = "0b6c1f7e-7a44-4b43-9c1a-5e0f2d9a1c11";

const PAGO_POR_CUENTA = filaTienda({
  n: 5,
  fecha: "2026-08-02",
  categoria: "pago_por_cuenta",
  origenTipo: "pago_por_cuenta_tienda",
  origen: { texto: "Pago de un gasto de una tienda · A Facebook", enlace: null },
  descripcion: "A Facebook · Pauta de septiembre · SINPE · REF-77",
  chip: "pagos",
  naceDeUnCierre: false,
  abono: null,
  cargo: "10000.00",
  saldoCorrido: "40000.00",
});
const PAGO_POR_CUENTA_ANULADO = filaTienda({
  n: 6,
  fecha: "2026-08-03",
  categoria: "pago_por_cuenta_anulado",
  origenTipo: "pago_por_cuenta_tienda",
  origen: { texto: "Pago de un gasto de una tienda · A Facebook", enlace: null },
  descripcion: "Anulación · A Facebook · Pauta de septiembre · SINPE · REF-77",
  chip: "pagos",
  naceDeUnCierre: false,
  esContraAsiento: true,
  abono: "10000.00",
  saldoCorrido: "50000.00",
});
const COBRO_DE_UN_COSTO = filaTienda({
  n: 7,
  fecha: "2026-08-04",
  categoria: "cobro_manual",
  origenTipo: "manual",
  origen: { texto: "Registro a mano", enlace: null },
  descripcion: "Material de despacho",
  chip: "cobros",
  naceDeUnCierre: false,
  abono: null,
  cargo: "500.00",
  saldoCorrido: "49500.00",
});

describe("⭑ FICHA 459 — el pago por cuenta en /mi-wallet (R44)", () => {
  it("se lee «Ordenex pagó un gasto por ti», con su beneficiario y referencia, nunca «Ordenex te cobró»", async () => {
    sembrar(estadoTienda([COD, PAGO_POR_CUENTA, COBRO_DE_UN_COSTO]));
    await verMiWallet();

    const pago = filaCon("A Facebook · Pauta de septiembre · SINPE · REF-77");
    expect(within(pago).getByText("Ordenex pagó un gasto por ti")).toBeInTheDocument();
    expect(within(pago).queryByText("Ordenex te cobró")).toBeNull();
    expect(within(pago).getByText("Pago de un gasto de una tienda · A Facebook")).toBeInTheDocument();
    // El cobro de un costo sigue viéndose como hoy (R87): el contraste no es vacío.
    expect(within(filaCon("Material de despacho")).getByText("Ordenex te cobró")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain(PAGO_POR_CUENTA_ID);
  });

  it("su anulación se lee «Ordenex anuló un pago hecho por ti», como fila propia de anulación", async () => {
    sembrar(estadoTienda([COD, PAGO_POR_CUENTA, PAGO_POR_CUENTA_ANULADO]));
    await verMiWallet();
    const anulado = filaCon("Anulación · A Facebook · Pauta de septiembre · SINPE · REF-77");
    expect(within(anulado).getByText("Ordenex anuló un pago hecho por ti")).toBeInTheDocument();
  });
});

describe("⭑ FICHA 459 — la descarga de la tienda (R44/R100)", () => {
  it("/mi-wallet: concepto y origen legibles desde la tienda, sin ids", async () => {
    const { lineaDeFila } = await import("@/components/shared/estado-cuenta/estado-cuenta-lineas");
    const { ROTULOS_MI_WALLET } = await import("@/app/(app)/mi-wallet/_components/MiEstadoCuenta");
    const { COLUMNAS_DESCARGA_MI_ESTADO_CUENTA, filaDescargaEstadoCuenta } = await import(
      "@/components/shared/estado-cuenta/estado-cuenta-descarga-columnas"
    );
    const f = filaDescargaEstadoCuenta(lineaDeFila(PAGO_POR_CUENTA, ROTULOS_MI_WALLET));
    const valores = Object.values(f).join(" | ");
    expect(valores).toContain("Ordenex pagó un gasto por ti");
    expect(valores).toContain("Pago de un gasto de una tienda · A Facebook");
    expect(valores).not.toContain("Ordenex te cobró");
    expect(valores).not.toContain(PAGO_POR_CUENTA_ID);
    expect(valores).not.toMatch(/pago_por_cuenta/);
    // Las claves del archivo de la tienda son un subconjunto de las de la fila (sin «Registró»).
    for (const c of COLUMNAS_DESCARGA_MI_ESTADO_CUENTA) expect(Object.keys(f)).toContain(c.clave);
  });

  it("/wallet/tiendas/[tiendaId]: el mismo concepto y el motivo, sin ids (458-D: el estado de cuenta)", async () => {
    const { lineaDeFila } = await import("@/components/shared/estado-cuenta/estado-cuenta-lineas");
    const { ROTULOS_TIENDA } = await import("@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda");
    for (const m of [PAGO_POR_CUENTA, PAGO_POR_CUENTA_ANULADO]) {
      const valores = Object.values(lineaDeFila(m, ROTULOS_TIENDA)).join(" | ");
      expect(valores).toMatch(/Ordenex paga un gasto de la tienda|Pago de un gasto de la tienda anulado/);
      expect(valores).toContain("Pago de un gasto de una tienda");
      expect(valores).not.toContain(PAGO_POR_CUENTA_ID);
      expect(valores).not.toMatch(/pago_por_cuenta/);
    }
  });
});

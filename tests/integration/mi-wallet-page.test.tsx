// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import { ToastProvider } from "@/providers/ToastProvider";
// Feature 201 (tanda B): el caso que sigue a la DERIVACIÓN del servidor compara contra el dato
// derivado, no contra un literal. Antes lo componía con `₡${…}`, que copiaba el formato a mano;
// ahora usa el mismo formateador que pinta la cabecera. Lo que mide no cambia.
import { money } from "@/lib/config/moneda";
import {
  CUBETA_POR_CATEGORIA,
  derivarDesgloseTienda,
} from "@/lib/utils/desglose-tienda";
import type { DesgloseTiendaAgregadoRow } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";
import type { MiWalletModuleProps } from "@/app/(app)/mi-wallet/_components/MiWalletModule";
// Ficha 335 (D5): la lista de roles DENEGADOS se deriva de esta constante, la misma que lee el
// item de menu. Asi el dia que alguien la amplie, este archivo no se queda comprobando de mas.
import { ROLES_MI_WALLET } from "@/lib/auth/menu-visibility";

// Feature 43 (T14, R18/R19/R21) — la pagina `/mi-wallet` resuelve el rol SOLO server-side;
// rol != adminTienda (o sin sesion) → `notFound` (R19). El backend acota SIEMPRE a
// `actor.usuarioId` = tienda_id en el WHERE (R19): la tienda solo ve lo suyo. El modulo
// cliente se stubbea para capturar sus props y verificar que los montos/saldo cruzan como
// STRING (R21). El page.tsx (Server Component real) se importa sin mockear.

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

// Feature 172 (T G.2): `listarMisMovimientosCompletoAction` se anade al doble porque el bloque
// de R55 monta el MODULO REAL (`vi.importActual`), y ese modulo la importa para la descarga.
// Sin declararla, el import del modulo revienta. No la llama nadie en estos tests.
// Ficha 335 (B4): `listarMisCierresAction` se añade al doble porque `page.tsx` la importa para
// poblar el selector de cierres. Este `vi.mock` es una FÁBRICA CERRADA —lo que no está aquí no
// existe para el módulo bajo prueba—, así que sin esta clave el import de la página revienta
// antes de la primera aserción. Ya pasó con `listarMisMovimientosCompletoAction` (arriba).
vi.mock("@/lib/actions/wallet-tienda", () => ({
  verMiSaldoAction: vi.fn(),
  listarMisMovimientosAction: vi.fn(),
  listarMisMovimientosCompletoAction: vi.fn(),
  listarMisCierresAction: vi.fn(),
  listarSaldosTiendasAction: vi.fn(),
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

// Stub del modulo cliente: captura las props que le pasa el Server Component.
const moduleCalls: MiWalletModuleProps[] = [];
vi.mock("@/app/(app)/mi-wallet/_components/MiWalletModule", () => ({
  MiWalletModule: (props: MiWalletModuleProps) => {
    moduleCalls.push(props);
    return <div data-testid="mi-wallet-module-stub" />;
  },
}));

// Feature 57: el PageHeader del topbar monta el LogoutButton (client:
// useToast). Se stubbea para aislar el pre-fetch/props de la página.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarMisCierresAction,
  listarMisMovimientosAction,
  verMiSaldoAction,
} from "@/lib/actions/wallet-tienda";

const resolveActorMock = vi.mocked(resolveActorFromSession);
const saldoMock = vi.mocked(verMiSaldoAction);
const listarMock = vi.mocked(listarMisMovimientosAction);
const cierresMock = vi.mocked(listarMisCierresAction);

/** Ficha 335 — un cierre en el libro de la tienda: lo que puebla el selector del filtro. */
const CIERRES_OK = {
  status: "ok" as const,
  cierres: [{ cierreId: "c1", fecha: "2026-07-12T10:00:00.000Z", movimientos: 2 }],
  hayMas: false,
};

const SALDO_OK = {
  status: "ok" as const,
  saldo: {
    creditos: "5000.00",
    debitos: "1200.00",
    saldo: "3800.00",
    signo: "positivo" as const,
  },
};

const MOVIMIENTOS_OK = {
  status: "ok" as const,
  data: {
    movimientos: [
      {
        id: "m1",
        tiendaId: "t1",
        tipo: "credito" as const,
        categoria: "cod_recaudado" as const,
        monto: "5000.00",
        origenTipo: "cierre_dia",
        origenId: "c1",
        descripcion: null,
        fechaMovimiento: "2026-07-12T10:00:00.000Z",
      },
      {
        id: "m2",
        tiendaId: "t1",
        tipo: "debito" as const,
        categoria: "flete" as const,
        monto: "1000.00",
        origenTipo: "cierre_dia",
        origenId: "c1",
        descripcion: null,
        fechaMovimiento: "2026-07-12T10:00:00.000Z",
      },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
    saldo: {
      creditos: "5000.00",
      debitos: "1200.00",
      saldo: "3800.00",
      signo: "positivo" as const,
    },
    // Feature 172 (T G.2, R55): la respuesta trae ademas los TRES importes de la cabecera.
    // Anadido al fixture porque el contrato lo exige; ninguna asercion de la 43 cambia.
    desglose: {
      aFavor: "5000.00",
      cargos: "1200.00",
      pagado: "0.00",
      saldo: "3800.00",
      signo: "positivo" as const,
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  moduleCalls.length = 0;
  saldoMock.mockResolvedValue(SALDO_OK);
  listarMock.mockResolvedValue(MOVIMIENTOS_OK);
  cierresMock.mockResolvedValue(CIERRES_OK);
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
    // R19: no expone saldo ni movimientos para rol no autorizado.
    expect(saldoMock).not.toHaveBeenCalled();
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("sin sesion tampoco ve su wallet (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");
    await expect(MiWalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(saldoMock).not.toHaveBeenCalled();
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("si una action responde forbidden, no renderiza el modulo (defensa en profundidad)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "t1", rol: "adminTienda" });
    listarMock.mockResolvedValue({ status: "forbidden" });
    const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");
    await expect(MiWalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("MiWalletPage — pre-fetch del adminTienda (R18/R21)", () => {
  it("renderiza el desglose + saldo y pasa los datos por props como STRING", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "t1", rol: "adminTienda" });
    const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");

    render(await MiWalletPage());

    // R18: titulo de la pagina + modulo del desglose/saldo montado.
    expect(
      screen.getByRole("heading", { level: 1, name: "Mi wallet" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("mi-wallet-module-stub")).toBeInTheDocument();

    // Pre-fetch server-side (saldo total + desglose con filtros por defecto).
    expect(saldoMock).toHaveBeenCalledTimes(1);
    expect(listarMock).toHaveBeenCalledTimes(1);

    // R21: los datos sensibles cruzan como props ya serializados (STRING), sin Decimal.
    expect(moduleCalls).toHaveLength(1);
    const props = moduleCalls[0];
    expect(props.movimientos).toHaveLength(2);
    expect(typeof props.movimientos[0].monto).toBe("string");
    expect(props.movimientos[0].monto).toBe("5000.00");
    expect(typeof props.saldo.saldo).toBe("string");
    expect(typeof props.saldo.creditos).toBe("string");
    expect(typeof props.saldo.debitos).toBe("string");
    expect(props.saldo.saldo).toBe("3800.00");
    expect(props.total).toBe(2);
    expect(props.page).toBe(1);
    expect(props.pageSize).toBe(20);
  });

  it("el saldo puede ser NEGATIVO (la tienda debe a Ordenex) y cruza como STRING con signo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "t1", rol: "adminTienda" });
    saldoMock.mockResolvedValue({
      status: "ok",
      saldo: {
        creditos: "0.00",
        debitos: "450.00",
        saldo: "-450.00",
        signo: "negativo",
      },
    });
    const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");

    render(await MiWalletPage());

    const props = moduleCalls[0];
    expect(typeof props.saldo.saldo).toBe("string");
    expect(props.saldo.saldo).toBe("-450.00");
    expect(props.saldo.signo).toBe("negativo");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature 172 — T G.2 (R55) `[P5]`: la TIENDA distingue el pago que recibió del cargo.
//
// El agujero que esta task cierra: desde la 172 el libro de la tienda tiene movimientos
// `pago_tienda`, que son DÉBITOS igual que un flete. Con la cabecera vieja («Créditos» /
// «Débitos») el dinero que Ordenex le ENTREGÓ aparecía sumado dentro de «Débitos»,
// indistinguible de un cargo — la tienda leería «me cobraron 21 200» donde en realidad le
// cobraron 1 200 y le pagaron 20 000.
//
// Los tres importes NO se clasifican aquí: llegan derivados del servidor por
// `derivarDesgloseTienda` + `CUBETA_POR_CATEGORIA`, la MISMA función que alimenta la cabecera
// del maestro. Este archivo lo usa a propósito para construir el fixture (así el número que se
// espera en pantalla sale de la función real, no de una cuenta escrita a mano) y
// `tests/unit/services/mi-wallet-desglose.test.ts` lo comprueba POR IDENTIDAD.
//
// Money-safe: cero `Number(` y cero `parseFloat` en este archivo; todo es texto.
// ─────────────────────────────────────────────────────────────────────────────

const TIENDA = { usuarioId: "t1", rol: "adminTienda" as const };

/** Un movimiento del ledger de la tienda, con los defaults del feed del cierre. */
function movTienda(over: Partial<WalletTiendaMovimientoDTO>): WalletTiendaMovimientoDTO {
  return {
    id: "m0",
    tiendaId: "t1",
    tipo: "credito",
    categoria: "cod_recaudado",
    monto: "0.00",
    origenTipo: "cierre_dia",
    origenId: "c1",
    descripcion: null,
    fechaMovimiento: "2026-07-30T00:00:00.000Z",
    ...over,
  };
}

const COD = movTienda({ id: "m-cod", monto: "50000.00" });
const FLETE = movTienda({
  id: "m-flete",
  tipo: "debito",
  categoria: "flete",
  monto: "1200.00",
});
/** T B.3 — el movimiento que emite el pago a la tienda: `debito` / `pago_tienda`. */
const PAGO = movTienda({
  id: "m-pago",
  tipo: "debito",
  categoria: "pago_tienda",
  monto: "20000.00",
  origenTipo: "pago_tienda",
  origenId: "pago-1",
  descripcion: "Transferencia · REF-991",
  fechaMovimiento: "2026-08-01T00:00:00.000Z",
});

/**
 * Las filas agregadas que el repositorio devolvería para ese libro. El desglose se deriva de
 * ellas con la función REAL: si mañana `CUBETA_POR_CATEGORIA` cambiara de opinión sobre
 * `pago_tienda`, este fixture cambiaría con ella y la aserción de pantalla lo diría.
 */
function filasAgregadas(movs: WalletTiendaMovimientoDTO[]): DesgloseTiendaAgregadoRow[] {
  return movs.map((m) => ({ tipo: m.tipo, categoria: m.categoria, total: m.monto }));
}

/**
 * Siembra el pre-fetch de la página con un libro; el desglose sale de la función REAL.
 *
 * `debitos` viaja como dato explícito y no calculado: es la Σ por TIPO que devuelve la otra
 * derivación del mismo libro (`derivarSaldoTienda`, feature 43), y sumarla aquí sería hacer
 * aritmética de dinero en un test. Desde T G.2 ya no se pinta —la sustituyen los tres
 * importes—, pero el DTO la sigue llevando y el fixture la mantiene verdadera.
 */
function sembrarTienda(movs: WalletTiendaMovimientoDTO[], debitos: string) {
  const desglose = derivarDesgloseTienda(filasAgregadas(movs));
  const saldo = {
    creditos: desglose.aFavor,
    debitos,
    saldo: desglose.saldo,
    signo: desglose.signo,
  };
  resolveActorMock.mockResolvedValue(TIENDA);
  saldoMock.mockResolvedValue({ status: "ok", saldo });
  listarMock.mockResolvedValue({
    status: "ok",
    data: {
      movimientos: movs,
      total: movs.length,
      page: 1,
      pageSize: 20,
      saldo,
      desglose,
    },
  });
  return desglose;
}

/** Monta `/mi-wallet` de verdad: Server Component real → props → módulo REAL. */
async function verMiWallet() {
  const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");
  render(await MiWalletPage());
  const props = moduleCalls[moduleCalls.length - 1];
  cleanup();

  const { MiWalletModule } = await vi.importActual<
    typeof import("@/app/(app)/mi-wallet/_components/MiWalletModule")
  >("@/app/(app)/mi-wallet/_components/MiWalletModule");

  render(
    <ToastProvider>
      <MiWalletModule {...props} />
    </ToastProvider>,
  );
  return props;
}

// El `-?` de las dos expresiones es de la feature 201 (tanda B): el signo de un importe
// negativo va DELANTE del símbolo (`-₡450`), así que un `/^₡/` a secas dejaría de
// encontrar el importe justo en el caso en que la tienda debe dinero. Aquí todos los casos
// son positivos y por eso el cambio no altera qué elemento se elige; se escribe así para que
// el buscador siga significando «el elemento que es un importe» y no «el que empieza por ₡».

/** El importe de la cabecera cuyo rótulo es `rotulo`, tal como se pinta. */
function importeDe(rotulo: string): string {
  const etiqueta = screen.getByText(rotulo);
  const bloque = etiqueta.closest("div");
  if (!bloque) throw new Error(`sin bloque para el importe ${rotulo}`);
  return within(bloque).getByText(/^-?₡/).textContent ?? "";
}

/** La cifra grande: el saldo a favor de la tienda. */
function saldoEnPantalla(): string {
  const region = screen.getByRole("region", { name: "Saldo a favor" });
  return within(region).getByText(/^-?₡/).textContent ?? "";
}

describe("MiWalletPage — la tienda distingue el pago del cargo (R55) [P5]", () => {
  it("con un pago sembrado, «Ya pagado» lo muestra y «Cargos de Ordenex» NO lo incluye", async () => {
    sembrarTienda([COD, FLETE, PAGO], "21200.00");
    await verMiWallet();

    // Lo que le recaudaron, lo que le cobraron y lo que ya le entregaron: TRES cifras.
    expect(importeDe("A tu favor")).toBe("₡50.000");
    expect(importeDe("Ya pagado")).toBe("₡20.000");

    // EL PUNTO DE LA TASK: el pago no engorda los cargos. 1 200 son los fletes, y solo eso.
    expect(importeDe("Cargos de Ordenex")).toBe("₡1.200");
    // Contraprueba de la cabecera vieja: si el pago cayera en «cargos», la cifra sería 21 200.
    expect(importeDe("Cargos de Ordenex")).not.toBe("₡21.200");

    // Y el saldo sigue siendo la resta de los tres: 50 000 − 1 200 − 20 000.
    expect(saldoEnPantalla()).toBe("₡28.800");
  });

  it("la cabecera vieja ya NO existe: «Débitos» no es un rótulo de esta pantalla", async () => {
    sembrarTienda([COD, FLETE, PAGO], "21200.00");
    await verMiWallet();

    // Mientras existiera ese rótulo, el pago estaría contado dentro de él (R55).
    expect(screen.queryByText("Débitos")).not.toBeInTheDocument();
    expect(screen.queryByText("Créditos (COD)")).not.toBeInTheDocument();
  });

  it("sin pagos, «Ya pagado» sale en cero de verdad — no se esconde el importe", async () => {
    sembrarTienda([COD, FLETE], "1200.00");
    await verMiWallet();

    expect(importeDe("Ya pagado")).toBe("₡0");
    expect(importeDe("Cargos de Ordenex")).toBe("₡1.200");
    expect(saldoEnPantalla()).toBe("₡48.800");
  });

  it("los tres importes salen de la clasificación del servidor, no de una cuenta del cliente", async () => {
    // `ajuste_credito` va a «a tu favor» y `ajuste_debito` a «cargos»: es lo que dice
    // `CUBETA_POR_CATEGORIA`, y la pantalla lo obedece sin saber nada de categorías.
    expect(CUBETA_POR_CATEGORIA.pago_tienda).toBe("pagado");
    expect(CUBETA_POR_CATEGORIA.ajuste_credito).toBe("aFavor");
    expect(CUBETA_POR_CATEGORIA.ajuste_debito).toBe("cargos");

    const esperado = sembrarTienda(
      [
        COD,
        FLETE,
        PAGO,
        movTienda({
          id: "m-rev",
          tipo: "credito",
          categoria: "ajuste_credito",
          monto: "20000.00",
          origenTipo: "pago_tienda",
          origenId: "pago-1",
          descripcion: "Reverso de un pago anulado",
        }),
      ],
      "21200.00",
    );
    await verMiWallet();

    // Se pintan EXACTAMENTE los importes que devolvió la derivación, dígito a dígito: lo único
    // que la pantalla les añade es el símbolo y los separadores (feature 201), y por eso el
    // esperado se DERIVA del dato del servidor en vez de escribirse a mano. Si la cabecera
    // recontara por su cuenta, estos cuatro dejarían de coincidir.
    expect(importeDe("A tu favor")).toBe(money(esperado.aFavor));
    expect(importeDe("Cargos de Ordenex")).toBe(money(esperado.cargos));
    expect(importeDe("Ya pagado")).toBe(money(esperado.pagado));
    expect(saldoEnPantalla()).toBe(money(esperado.saldo));

    // El pago anulado y su devolución: el saldo vuelve al valor de antes del pago (R71).
    expect(saldoEnPantalla()).toBe("₡48.800");
  });

  it("declara que los importes brutos incluyen lo anulado, y cuál es el número correcto", async () => {
    // Mismo caso que arriba: un pago anulado infla «Ya pagado» y «A tu favor» a la vez.
    sembrarTienda(
      [
        COD,
        FLETE,
        PAGO,
        movTienda({
          id: "m-rev",
          tipo: "credito",
          categoria: "ajuste_credito",
          monto: "20000.00",
          origenTipo: "pago_tienda",
          origenId: "pago-1",
        }),
      ],
      "21200.00",
    );
    await verMiWallet();

    // Los dos importes quedan altos: 70 000 «a tu favor» y 20 000 «ya pagado» cuando de verdad
    // se recaudaron 50 000 y no se le entregó nada. El saldo, en cambio, sale exacto.
    expect(importeDe("A tu favor")).toBe("₡70.000");
    expect(importeDe("Ya pagado")).toBe("₡20.000");
    expect(saldoEnPantalla()).toBe("₡48.800");

    // Por eso el aviso: nombra las dos cifras infladas y la que hay que mirar.
    const aviso = screen.getByRole("note");
    expect(aviso).toHaveTextContent("«Ya pagado» sigue contando los pagos que se anularon");
    expect(aviso).toHaveTextContent("«A tu favor» suma la devolución de cada uno");
    expect(aviso).toHaveTextContent("«Saldo a favor» ya tiene todo eso descontado");
  });

  it("el aviso habla en lenguaje claro: ni jerga contable ni siglas", async () => {
    sembrarTienda([COD, FLETE, PAGO], "21200.00");
    await verMiWallet();

    const texto = screen.getByRole("note").textContent ?? "";
    for (const jerga of [
      "contraasiento",
      "neteo",
      "netear",
      "débito",
      "crédito",
      "SLA",
      "ajuste_credito",
      "pago_tienda",
    ]) {
      expect(texto.toLowerCase()).not.toContain(jerga.toLowerCase());
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FICHA 335 — B4: `/mi-wallet` adopta la presentación de `/wallet` (R12–R15) y el selector de
// cierre degrada sin esconder el dinero (R28–R30).
//
// Todo se mide sobre el MÓDULO REAL montado por la página real (`verMiWallet`), no sobre un
// stub: lo que esta ficha cambia es el árbol que se pinta, y un doble no lo pintaría.
// ─────────────────────────────────────────────────────────────────────────────

/** La `Card` que envuelve al elemento dado, o `null` si no vive dentro de ninguna. */
function cardDe(elemento: Element): HTMLElement | null {
  return elemento.closest<HTMLElement>('[data-slot="card"]');
}

/** La `Card` del libro: la que vive dentro de la sección del desglose. */
function cardDelLibro(): HTMLElement {
  const seccion = screen.getByRole("region", { name: "Desglose de movimientos" });
  const card = seccion.querySelector<HTMLElement>('[data-slot="card"]');
  if (!card) throw new Error("el libro no está dentro de ninguna tarjeta");
  return card;
}

describe("MiWalletPage — la presentación de `/wallet` (R12–R15) [335]", () => {
  it("R12: el saldo y el libro son dos tarjetas hermanas, ninguna dentro de la otra", async () => {
    sembrarTienda([COD, FLETE, PAGO], "21200.00");
    await verMiWallet();

    const cardSaldo = cardDe(screen.getByRole("region", { name: "Saldo a favor" }));
    const seccionLibro = screen.getByRole("region", { name: "Desglose de movimientos" });
    const cardLibro = cardDelLibro();

    expect(cardSaldo).not.toBeNull();
    expect(cardSaldo).not.toBe(cardLibro);

    // El punto de R12: ni anidadas ni una envolviendo a la otra. Antes de esta ficha el libro
    // no era una tarjeta siquiera; el modo de fallo que se vigila es el contrario, meter el
    // saldo DENTRO de la tarjeta del libro para "ahorrar un marco".
    expect(cardSaldo!.contains(cardLibro)).toBe(false);
    expect(cardLibro.contains(cardSaldo!)).toBe(false);

    // Y son hermanas de verdad: cuelgan del mismo contenedor, no de dos ramas cualesquiera.
    expect(cardSaldo!.parentElement).toBe(seccionLibro.parentElement);
  });

  it("R12: el saldo ya NO va encajonado en media pantalla", async () => {
    sembrarTienda([COD, FLETE], "1200.00");
    await verMiWallet();

    // El envoltorio `lg:max-w-md` dejaba la tarjeta del saldo a la mitad del ancho y la del
    // libro entera: dos anchos distintos para dos hermanas. Contraprueba de que se fue.
    const cardSaldo = cardDe(screen.getByRole("region", { name: "Saldo a favor" }))!;
    expect(cardSaldo.parentElement?.className ?? "").not.toContain("max-w-md");
  });

  it("R13: la tarjeta del libro lleva un título visible", async () => {
    sembrarTienda([COD, FLETE], "1200.00");
    await verMiWallet();

    const seccionLibro = screen.getByRole("region", { name: "Desglose de movimientos" });
    const titulo = seccionLibro.querySelector<HTMLElement>('[data-slot="card-title"]');

    expect(titulo).not.toBeNull();
    expect(titulo!.textContent).toBe("Desglose de movimientos");
    // VISIBLE, que es lo que pide R13: el `aria-label` de la sección ya nombraba el bloque para
    // los lectores de pantalla, y para nadie más. Un título `sr-only` no arreglaría nada.
    expect(titulo!.className).not.toContain("sr-only");
    expect(titulo).toBeVisible();

    // Y el nombre accesible de la sección sigue intacto: quien navega por regiones llega igual.
    expect(seccionLibro.getAttribute("aria-label")).toBe("Desglose de movimientos");
  });

  it("R14: los filtros se renderizan dentro de la tarjeta del libro y por encima de la tabla", async () => {
    sembrarTienda([COD, FLETE], "1200.00");
    await verMiWallet();

    const cardLibro = cardDelLibro();
    const filtros = screen.getByRole("form", { name: "Filtros del desglose" });
    const tabla = screen.getByRole("table");

    expect(cardLibro.contains(filtros)).toBe(true);
    expect(cardLibro.contains(tabla)).toBe(true);
    // Por ENCIMA de la tabla, no en cualquier sitio de la tarjeta: `DOCUMENT_POSITION_FOLLOWING`
    // dice que la tabla va después del formulario en el orden del documento.
    expect(
      filtros.compareDocumentPosition(tabla) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("R15: la paginación está en el pie de la tarjeta, en flujo normal, y conserva su nombre accesible", async () => {
    sembrarTienda([COD, FLETE], "1200.00");
    await verMiWallet();

    // El nombre accesible NO cambia: es por el que ya se la encuentra desde la feature 43.
    const paginacion = screen.getByRole("navigation", { name: "Paginación del desglose" });
    const pie = paginacion.closest<HTMLElement>('[data-slot="card-footer"]');

    expect(pie).not.toBeNull();
    expect(cardDelLibro().contains(pie!)).toBe(true);

    // `sticky={false}`: el pie tiene UN solo hijo. En modo pegajoso el control devuelve un
    // fragmento de DOS elementos (envoltorio + centinela de 1px) y el `display:flex` del pie
    // los colocaría como dos columnas, con el centinela `w-full` empujando la barra.
    expect(pie!.children).toHaveLength(1);
    expect(pie!.firstElementChild).toBe(paginacion);
    expect(paginacion.className).not.toContain("sticky");
  });
});

describe("MiWalletPage — el selector de cierre degrada sin esconder el dinero (R28–R30) [335]", () => {
  /** Los tres importes y el libro siguen en pantalla: es lo que R29 protege. */
  function laPantallaSigueEntera() {
    expect(importeDe("A tu favor")).toBe("₡50.000");
    expect(importeDe("Cargos de Ordenex")).toBe("₡1.200");
    expect(importeDe("Ya pagado")).toBe("₡0");
    expect(saldoEnPantalla()).toBe("₡48.800");
    expect(screen.getByRole("table")).toBeInTheDocument();
  }

  it("R29: si la lectura de cierres no responde ok, el saldo y el libro siguen en pantalla y NO hay notFound", async () => {
    sembrarTienda([COD, FLETE], "1200.00");
    cierresMock.mockResolvedValue({ status: "forbidden" });

    // Lo primero: la página NO se cae. Un tercer `notFound()` aquí dejaría a la tienda sin ver
    // su dinero porque se cayó una COMODIDAD.
    const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");
    await expect(MiWalletPage()).resolves.toBeTruthy();
    cleanup();

    await verMiWallet();
    laPantallaSigueEntera();

    // Lo único degradado es el selector: deshabilitado y diciendo por qué.
    expect(screen.getByRole("combobox", { name: "Filtrar por cierre" })).toBeDisabled();
    expect(
      screen.getByText("No pudimos cargar tus cierres. Probá recargando la página."),
    ).toBeInTheDocument();
  });

  it("R29: el estado `unauthenticated` de esa lectura tampoco tumba la pantalla", async () => {
    sembrarTienda([COD, FLETE], "1200.00");
    cierresMock.mockResolvedValue({ status: "unauthenticated" });

    await verMiWallet();
    laPantallaSigueEntera();
    expect(screen.getByRole("combobox", { name: "Filtrar por cierre" })).toBeDisabled();
  });

  it("R28: sin cierres, el selector queda deshabilitado y la pantalla lo dice", async () => {
    sembrarTienda([COD, FLETE], "1200.00");
    cierresMock.mockResolvedValue({ status: "ok", cierres: [], hayMas: false });

    await verMiWallet();

    expect(screen.getByRole("combobox", { name: "Filtrar por cierre" })).toBeDisabled();
    expect(screen.getByText("Todavía no hay cierres en tu wallet.")).toBeInTheDocument();
    // Y no se confunde con la caída: son dos mensajes distintos porque son dos situaciones
    // distintas — "no hay" no es "no pudimos".
    expect(
      screen.queryByText("No pudimos cargar tus cierres. Probá recargando la página."),
    ).not.toBeInTheDocument();
  });

  it("R28/R30: con cierres y sin tope alcanzado, no hay aviso ninguno (contraprueba)", async () => {
    sembrarTienda([COD, FLETE], "1200.00");
    await verMiWallet(); // `CIERRES_OK`: un cierre, `hayMas: false`

    expect(screen.getByRole("combobox", { name: "Filtrar por cierre" })).not.toBeDisabled();
    expect(screen.queryByText("Todavía no hay cierres en tu wallet.")).not.toBeInTheDocument();
    expect(screen.queryByText("Mostramos los cierres más recientes.")).not.toBeInTheDocument();
  });

  it("R30: con `hayMas`, la pantalla avisa de que solo ofrece los más recientes — y sin un segundo `role=note`", async () => {
    sembrarTienda([COD, FLETE], "1200.00");
    cierresMock.mockResolvedValue({ ...CIERRES_OK, hayMas: true });

    await verMiWallet();

    const aviso = screen.getByText("Mostramos los cierres más recientes.");
    expect(aviso).toBeInTheDocument();

    // El aviso NO lleva `role="note"`. La pantalla tiene EXACTAMENTE uno (el de la tarjeta del
    // saldo) y se la busca en singular: un segundo `note` rompería `getByRole("note")` en los
    // dos casos de la 172 sin hacer la pantalla más accesible.
    expect(aviso.getAttribute("role")).toBeNull();
    expect(screen.getAllByRole("note")).toHaveLength(1);
    expect(screen.getByRole("note")).not.toBe(aviso);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FICHA 335 — D5 (R34): el gate de la ruta, DERIVADO de la constante.
//
// El caso de la feature 43 que hay arriba enumera cuatro roles a mano y se le escapa `apiKey`.
// Este los deriva de `ROLES_MI_WALLET`, así que el día que alguien amplíe la constante, la lista
// de denegados se estrecha SOLA y no queda un rol nuevo sin comprobar — ni un rol quitado
// comprobado de más.
// ─────────────────────────────────────────────────────────────────────────────

const TODOS_LOS_ROLES: readonly RolValue[] = [
  "maestro",
  "admin",
  "mensajero",
  "adminTienda",
  "adminSatelite",
  "apiKey",
];

const PERMITIDOS: readonly string[] = ROLES_MI_WALLET;
const DENEGADOS = TODOS_LOS_ROLES.filter((rol) => !PERMITIDOS.includes(rol));

describe("MiWalletPage — el gate lee la MISMA constante que el menú (R34) [335]", () => {
  it("CONTROL DE NO-VACUIDAD: hay roles denegados y `adminTienda` no está entre ellos", () => {
    // Sin esto, una constante que por error contuviera todos los roles dejaría `DENEGADOS`
    // vacío y el bucle de abajo no ejecutaría ni una aserción: verde sin mirar nada.
    expect(DENEGADOS.length).toBeGreaterThan(0);
    expect(DENEGADOS).not.toContain("adminTienda");
    expect(PERMITIDOS).toEqual(["adminTienda"]);
  });

  for (const rol of DENEGADOS) {
    it(`R34: ${rol} recibe notFound() y no dispara ningún pre-fetch`, async () => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");

      await expect(MiWalletPage()).rejects.toThrow("NEXT_NOT_FOUND");

      // Las TRES lecturas quedan sin llamar: el gate va antes del `Promise.all`, así que un rol
      // ajeno no llega ni a abrir una consulta. `apiKey` incluida, que hoy no se afirma en
      // ningún otro caso de este archivo.
      expect(saldoMock).not.toHaveBeenCalled();
      expect(listarMock).not.toHaveBeenCalled();
      expect(cierresMock).not.toHaveBeenCalled();
    });
  }

  it("R34: el `adminTienda` SÍ pasa — contraprueba de que el gate no está negando a todos", () => {
    // El bucle de arriba solo mide negativas. Sin esta contraprueba, un `notFound()` sin
    // condición las pasaría todas.
    expect(PERMITIDOS).toContain("adminTienda");
  });

  it("R34: las tres lecturas se disparan para el rol permitido, y la de cierres va SIN argumentos", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "t1", rol: "adminTienda" });
    const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");

    render(await MiWalletPage());

    expect(saldoMock).toHaveBeenCalledTimes(1);
    expect(listarMock).toHaveBeenCalledTimes(1);
    expect(cierresMock).toHaveBeenCalledTimes(1);
    // R5: la lectura de cierres NO recibe entrada. No hay ninguna clave donde colar un alcance
    // ajeno porque no hay entrada: la barrera es la ausencia de superficie, no una validación.
    expect(cierresMock).toHaveBeenCalledWith();

    // Y las opciones cruzan al módulo por props, ya resueltas en el servidor.
    expect(moduleCalls[0].cierres).toEqual({
      opciones: CIERRES_OK.cierres,
      hayMas: false,
      disponible: true,
    });
  });
});

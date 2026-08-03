// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Feature 57: el PageHeader del topbar monta el LogoutButton (client:
// useRouter/useToast). Se stubbea para aislar el pre-fetch/props de la página.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));
import { render, screen, cleanup, within } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import { ToastProvider } from "@/providers/ToastProvider";
import type {
  CuentaPorPagarDTO,
  PagoMensajeroMovimientoDTO,
} from "@/lib/types/wallet-mensajero";
import type { MisPagosModuleProps } from "@/app/(app)/mis-pagos/_components/MisPagosModule";

// Feature 44 (T15, R20/R21) — la pagina `/mis-pagos` resuelve el rol SOLO server-side; rol
// != mensajero (o sin sesion) → `notFound` (R20). El backend acota SIEMPRE a `actor.usuarioId`
// = mensajero_id en el WHERE (R20): el mensajero solo ve lo suyo. El modulo cliente se stubbea
// para capturar sus props y verificar que los montos/cuenta cruzan como STRING (R21). El
// page.tsx (Server Component real) se importa sin mockear.

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

// Feature 172 (T G.1): `listarMisPagosCompletoAction` se anade al doble porque el bloque de
// R54 monta el MODULO REAL (`vi.importActual`), y ese modulo la importa para la descarga. Sin
// declararla, el import del modulo revienta. No la llama nadie en estos tests.
vi.mock("@/lib/actions/wallet-mensajero", () => ({
  verMiCuentaPorPagarAction: vi.fn(),
  listarMisPagosAction: vi.fn(),
  listarMisPagosCompletoAction: vi.fn(),
  listarCuentasPorPagarAction: vi.fn(),
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
const moduleCalls: MisPagosModuleProps[] = [];
vi.mock("@/app/(app)/mis-pagos/_components/MisPagosModule", () => ({
  MisPagosModule: (props: MisPagosModuleProps) => {
    moduleCalls.push(props);
    return <div data-testid="mis-pagos-module-stub" />;
  },
}));

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarMisPagosAction,
  verMiCuentaPorPagarAction,
} from "@/lib/actions/wallet-mensajero";

const resolveActorMock = vi.mocked(resolveActorFromSession);
const cuentaMock = vi.mocked(verMiCuentaPorPagarAction);
const pagosMock = vi.mocked(listarMisPagosAction);

const CUENTA_OK = {
  status: "ok" as const,
  cuenta: {
    devengado: "5000.00",
    pagado: "3000.00",
    cuentaPorPagar: "2000.00",
    signo: "positivo" as const,
  },
};

const PAGOS_OK = {
  status: "ok" as const,
  data: {
    movimientos: [
      {
        id: "p1",
        mensajeroId: "u1",
        tipo: "devengo" as const,
        categoria: "pago_devengado" as const,
        monto: "5000.00",
        origenTipo: "cierre_dia",
        origenId: "c1",
        descripcion: null,
        fechaMovimiento: "2026-07-12T10:00:00.000Z",
      },
      {
        id: "p2",
        mensajeroId: "u1",
        tipo: "pago" as const,
        categoria: "pago_efectivo" as const,
        monto: "3000.00",
        origenTipo: "cierre_dia",
        origenId: "c1",
        descripcion: null,
        fechaMovimiento: "2026-07-12T10:00:00.000Z",
      },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
    cuenta: {
      devengado: "5000.00",
      pagado: "3000.00",
      cuentaPorPagar: "2000.00",
      signo: "positivo" as const,
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  moduleCalls.length = 0;
  cuentaMock.mockResolvedValue(CUENTA_OK);
  pagosMock.mockResolvedValue(PAGOS_OK);
});

afterEach(() => {
  cleanup();
});

describe("MisPagosPage — control de acceso por rol (R20)", () => {
  it("roles != mensajero NO ven sus pagos (notFound), sin pre-fetch de datos", async () => {
    const otros: RolValue[] = ["maestro", "admin", "adminTienda", "adminSatelite"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      const { default: MisPagosPage } = await import("@/app/(app)/mis-pagos/page");
      await expect(MisPagosPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // R20: no expone cuenta ni pagos para rol no autorizado.
    expect(cuentaMock).not.toHaveBeenCalled();
    expect(pagosMock).not.toHaveBeenCalled();
  });

  it("sin sesion tampoco ve sus pagos (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    const { default: MisPagosPage } = await import("@/app/(app)/mis-pagos/page");
    await expect(MisPagosPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(cuentaMock).not.toHaveBeenCalled();
    expect(pagosMock).not.toHaveBeenCalled();
  });

  it("si una action responde forbidden, no renderiza el modulo (defensa en profundidad)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    pagosMock.mockResolvedValue({ status: "forbidden" });
    const { default: MisPagosPage } = await import("@/app/(app)/mis-pagos/page");
    await expect(MisPagosPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("MisPagosPage — pre-fetch del mensajero (R20/R21)", () => {
  it("renderiza el desglose + cuenta y pasa los datos por props como STRING", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    const { default: MisPagosPage } = await import("@/app/(app)/mis-pagos/page");

    render(await MisPagosPage());

    // R20: titulo de la pagina + modulo del desglose/cuenta montado.
    expect(
      screen.getByRole("heading", { level: 1, name: "Mis pagos" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("mis-pagos-module-stub")).toBeInTheDocument();

    // Pre-fetch server-side (cuenta total + desglose con filtros por defecto). El backend
    // acota al mensajero del actor; la pagina no pasa mensajero_id (R20).
    expect(cuentaMock).toHaveBeenCalledTimes(1);
    expect(pagosMock).toHaveBeenCalledTimes(1);

    // R21: los datos sensibles cruzan como props ya serializados (STRING), sin Decimal.
    expect(moduleCalls).toHaveLength(1);
    const props = moduleCalls[0];
    expect(props.movimientos).toHaveLength(2);
    expect(typeof props.movimientos[0].monto).toBe("string");
    expect(props.movimientos[0].monto).toBe("5000.00");
    expect(typeof props.cuenta.cuentaPorPagar).toBe("string");
    expect(typeof props.cuenta.devengado).toBe("string");
    expect(typeof props.cuenta.pagado).toBe("string");
    expect(props.cuenta.cuentaPorPagar).toBe("2000.00");
    expect(props.total).toBe(2);
    expect(props.page).toBe(1);
    expect(props.pageSize).toBe(20);
  });

  it("la cuenta por pagar puede ser CERO (mensajero al dia) y cruza como STRING con signo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    cuentaMock.mockResolvedValue({
      status: "ok",
      cuenta: {
        devengado: "4000.00",
        pagado: "4000.00",
        cuentaPorPagar: "0.00",
        signo: "cero",
      },
    });
    const { default: MisPagosPage } = await import("@/app/(app)/mis-pagos/page");

    render(await MisPagosPage());

    const props = moduleCalls[0];
    expect(typeof props.cuenta.cuentaPorPagar).toBe("string");
    expect(props.cuenta.cuentaPorPagar).toBe("0.00");
    expect(props.cuenta.signo).toBe("cero");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature 172 — T G.1 (R54): el MENSAJERO ve el pago que recibió, y su reverso.
//
// Es una VERIFICACIÓN, no una construcción: `design.md §10.3` declara que `/mis-pagos` no se
// toca porque su libro ya se lista entero y la etiqueta de `liquidacion` ya existe
// (`mis-pagos-labels.ts:27`). Este bloque existe para DEMOSTRARLO en vez de afirmarlo, y para
// que el día que alguien reordene ese libro se entere aquí.
//
// Por qué se monta el módulo REAL y no basta con leer las props: lo que R54 promete es que el
// mensajero VE el pago, y eso es una propiedad de lo pintado —la etiqueta del concepto y la
// cifra de la cuenta—, no del objeto que cruza la frontera. El módulo va por `vi.importActual`
// porque el doble de arriba lo sustituye para el resto del archivo; las props con las que se
// monta son EXACTAMENTE las que devolvió el Server Component real.
//
// Money-safe: todos los montos son STRING del servidor y se comparan como texto. Cero
// `Number(` y cero `parseFloat` en este archivo.
// ─────────────────────────────────────────────────────────────────────────────

const MENSAJERO = { usuarioId: "u1", rol: "mensajero" as const };

/** Un movimiento del libro del mensajero, con los defaults del cierre del día. */
function mov(over: Partial<PagoMensajeroMovimientoDTO>): PagoMensajeroMovimientoDTO {
  return {
    id: "m0",
    mensajeroId: "u1",
    tipo: "devengo",
    categoria: "pago_devengado",
    monto: "0.00",
    origenTipo: "cierre_dia",
    origenId: "c1",
    descripcion: null,
    fechaMovimiento: "2026-07-30T00:00:00.000Z",
    ...over,
  };
}

/** Lo devengado por el cierre del día: 50 000, sin nada pagado todavía. */
const DEVENGO = mov({ id: "m-devengo", monto: "50000.00" });

/** T B.5 — el movimiento que emite el pago al mensajero: `pago` / `liquidacion`. */
const LIQUIDACION = mov({
  id: "m-liquidacion",
  tipo: "pago",
  categoria: "liquidacion",
  monto: "20000.00",
  origenTipo: "pago_mensajero",
  origenId: "pago-1",
  descripcion: "Transferencia · REF-991",
  fechaMovimiento: "2026-08-01T00:00:00.000Z",
});

/** T F.2 — el contraasiento de la anulación: `devengo` / `ajuste_devengo`, mismo monto. */
const REVERSO = mov({
  id: "m-reverso",
  tipo: "devengo",
  categoria: "ajuste_devengo",
  monto: "20000.00",
  origenTipo: "pago_mensajero",
  origenId: "pago-1",
  descripcion: "Reverso de un pago anulado",
  fechaMovimiento: "2026-08-02T00:00:00.000Z",
});

/** Siembra el pre-fetch de la página con un libro y su cuenta ya derivada por el servidor. */
function sembrar(movimientos: PagoMensajeroMovimientoDTO[], cuenta: CuentaPorPagarDTO) {
  resolveActorMock.mockResolvedValue(MENSAJERO);
  cuentaMock.mockResolvedValue({ status: "ok", cuenta });
  pagosMock.mockResolvedValue({
    status: "ok",
    data: { movimientos, total: movimientos.length, page: 1, pageSize: 20, cuenta },
  });
}

/**
 * Monta `/mis-pagos` de verdad: el Server Component real produce las props y el módulo REAL
 * las pinta. Sin `vi.importActual` se estaría midiendo el doble de arriba, que no pinta nada.
 */
async function verMisPagos() {
  const { default: MisPagosPage } = await import("@/app/(app)/mis-pagos/page");
  render(await MisPagosPage());
  const props = moduleCalls[moduleCalls.length - 1];
  cleanup();

  const { MisPagosModule } = await vi.importActual<
    typeof import("@/app/(app)/mis-pagos/_components/MisPagosModule")
  >("@/app/(app)/mis-pagos/_components/MisPagosModule");

  render(
    <ToastProvider>
      <MisPagosModule {...props} />
    </ToastProvider>,
  );
  return props;
}

/** La cifra grande de la tarjeta: lo que Ordenex le debe hoy al mensajero. */
function cuentaPorPagarEnPantalla(): string {
  const tarjeta = screen.getByRole("region", { name: "Cuenta por pagar" });
  // El importe es el único nodo con el símbolo de moneda dentro de la región.
  return within(tarjeta).getByText(/^₡/).textContent ?? "";
}

/** El importe agregado de la tarjeta cuyo rótulo es `rotulo` («Devengado» / «Pagado»). */
function importeDeLaTarjeta(rotulo: string): string {
  const etiqueta = screen.getByText(rotulo);
  const bloque = etiqueta.closest("div");
  if (!bloque) throw new Error(`sin bloque para el importe ${rotulo}`);
  return within(bloque).getByText(/^₡/).textContent ?? "";
}

/** La fila del desglose cuyo concepto es exactamente `concepto`. */
function filaDeConcepto(concepto: string): HTMLElement {
  const tabla = screen.getByRole("table", { name: "Desglose de pagos" });
  const celda = within(tabla).getByRole("cell", { name: concepto });
  const fila = celda.closest("tr");
  if (!fila) throw new Error(`sin fila para el concepto ${concepto}`);
  return fila;
}

describe("MisPagosPage — el mensajero ve su liquidación (R54)", () => {
  it("con un movimiento `liquidacion` sembrado lo muestra CON SU ETIQUETA y su cuenta por pagar BAJA", async () => {
    // Sin el pago, Ordenex le debe los 50 000 que devengó.
    sembrar([DEVENGO], {
      devengado: "50000.00",
      pagado: "0.00",
      cuentaPorPagar: "50000.00",
      signo: "positivo",
    });
    await verMisPagos();
    expect(cuentaPorPagarEnPantalla()).toBe("₡50000.00");
    cleanup();
    moduleCalls.length = 0;

    // Con el pago registrado (T B.5): el libro trae `pago`/`liquidacion` por 20 000.
    sembrar([LIQUIDACION, DEVENGO], {
      devengado: "50000.00",
      pagado: "20000.00",
      cuentaPorPagar: "30000.00",
      signo: "positivo",
    });
    await verMisPagos();

    // R54, primera mitad: el pago se VE, con la etiqueta que ya existía para su concepto.
    const fila = filaDeConcepto("Liquidación");
    expect(within(fila).getByText("₡20000.00")).toBeInTheDocument();
    expect(within(fila).getByText("Pago")).toBeInTheDocument();
    // El origen lo identifica como una liquidación y arrastra la descripción del comprobante.
    expect(
      within(fila).getByText("Liquidación · Transferencia · REF-991"),
    ).toBeInTheDocument();

    // R54, segunda mitad: su cuenta por pagar BAJA exactamente lo que se le pagó.
    expect(cuentaPorPagarEnPantalla()).toBe("₡30000.00");
    expect(screen.getByText("₡20000.00", { selector: "span" })).toBeInTheDocument();
  });

  it("con el CONTRAASIENTO sembrado, la cuenta por pagar vuelve a SUBIR y el reverso también se ve", async () => {
    // Pago vigente: debe 30 000.
    sembrar([LIQUIDACION, DEVENGO], {
      devengado: "50000.00",
      pagado: "20000.00",
      cuentaPorPagar: "30000.00",
      signo: "positivo",
    });
    await verMisPagos();
    expect(cuentaPorPagarEnPantalla()).toBe("₡30000.00");
    cleanup();
    moduleCalls.length = 0;

    // Anulado (T F.2): el contraasiento `devengo`/`ajuste_devengo` devuelve la deuda.
    sembrar([REVERSO, LIQUIDACION, DEVENGO], {
      devengado: "70000.00",
      pagado: "20000.00",
      cuentaPorPagar: "50000.00",
      signo: "positivo",
    });
    await verMisPagos();

    // Vuelve EXACTAMENTE al valor previo al pago: no se recorta ni se redondea nada.
    expect(cuentaPorPagarEnPantalla()).toBe("₡50000.00");

    // El pago sigue a la vista —anular no borra— y el reverso aparece a su lado.
    expect(filaDeConcepto("Liquidación")).toBeInTheDocument();
    const reverso = filaDeConcepto("Ajuste (devengo)");
    expect(within(reverso).getByText("₡20000.00")).toBeInTheDocument();
    expect(within(reverso).getByText("Devengo")).toBeInTheDocument();
  });

  it("los dos movimientos del pago se distinguen por su CONCEPTO, no por una etiqueta fija", async () => {
    sembrar([REVERSO, LIQUIDACION, DEVENGO], {
      devengado: "70000.00",
      pagado: "20000.00",
      cuentaPorPagar: "50000.00",
      signo: "positivo",
    });
    await verMisPagos();

    const tabla = screen.getByRole("table", { name: "Desglose de pagos" });
    const conceptos = within(tabla)
      .getAllByRole("row")
      .slice(1) // la cabecera
      .map((fila) => within(fila).getAllByRole("cell")[2].textContent);

    // Tres conceptos DISTINTOS: si la tabla pintara una etiqueta fija, aquí saldrían iguales.
    expect(conceptos).toEqual(["Ajuste (devengo)", "Liquidación", "Pago devengado"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature 172 — T G.2 (la mitad de N1 que toca al MENSAJERO).
//
// La regla que decide dónde hace falta el aviso de los importes brutos: **donde se muestre un
// importe AGREGADO que siga contando lo anulado**. En `/mis-pagos` hay dos —«Devengado» y
// «Pagado» en la tarjeta— y por eso el aviso va ahí. En la TABLA no hace falta: allí el pago
// y su reverso se ven los dos, uno al lado del otro, y se explican solos.
//
// El caso que lo demuestra es el mismo de arriba: 50 000 devengados y un pago de 20 000
// anulado dejan la tarjeta en «Devengado 70 000 / Pagado 20 000» cuando de verdad se
// devengaron 50 000 y no se cobró nada. La cuenta por pagar, en cambio, sale exacta.
// ─────────────────────────────────────────────────────────────────────────────

describe("MisPagosPage — los importes brutos incluyen lo anulado, y se declara", () => {
  it("nombra las dos cifras infladas y dice cuál es la correcta", async () => {
    sembrar([REVERSO, LIQUIDACION, DEVENGO], {
      devengado: "70000.00",
      pagado: "20000.00",
      cuentaPorPagar: "50000.00",
      signo: "positivo",
    });
    await verMisPagos();

    // Las dos cifras están, efectivamente, altas: se devengaron 50 000 y no se cobró nada.
    expect(importeDeLaTarjeta("Devengado")).toBe("₡70000.00");
    expect(importeDeLaTarjeta("Pagado")).toBe("₡20000.00");
    // La resta, en cambio, sale exacta.
    expect(cuentaPorPagarEnPantalla()).toBe("₡50000.00");

    const aviso = screen.getByRole("note");
    expect(aviso).toHaveTextContent("«Pagado» sigue contando los pagos que se anularon");
    expect(aviso).toHaveTextContent("«Devengado» suma la devolución de cada uno");
    expect(aviso).toHaveTextContent("«Cuenta por pagar» ya tiene todo eso descontado");
  });

  it("el aviso habla en lenguaje claro: ni jerga contable ni siglas", async () => {
    sembrar([LIQUIDACION, DEVENGO], {
      devengado: "50000.00",
      pagado: "20000.00",
      cuentaPorPagar: "30000.00",
      signo: "positivo",
    });
    await verMisPagos();

    const texto = screen.getByRole("note").textContent ?? "";
    for (const jerga of [
      "contraasiento",
      "neteo",
      "netear",
      "SLA",
      "ajuste_devengo",
      "liquidacion",
      "movimiento",
    ]) {
      expect(texto.toLowerCase()).not.toContain(jerga.toLowerCase());
    }
  });

  it("hay UN solo aviso, y está junto a los importes agregados — no dentro de la tabla", async () => {
    sembrar([REVERSO, LIQUIDACION, DEVENGO], {
      devengado: "70000.00",
      pagado: "20000.00",
      cuentaPorPagar: "50000.00",
      signo: "positivo",
    });
    await verMisPagos();

    // Uno: repetirlo por fila sería ruido sobre una lista que ya se explica sola.
    expect(screen.getAllByRole("note")).toHaveLength(1);
    const tabla = screen.getByRole("table", { name: "Desglose de pagos" });
    expect(tabla.contains(screen.getByRole("note"))).toBe(false);
  });
});

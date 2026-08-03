import { describe, it, expect, vi, beforeEach } from "vitest";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";
import { derivarCuentaPorPagar } from "@/lib/utils/cuenta-por-pagar";
import { derivarBalance } from "@/lib/utils/wallet-balance";
import { armarServicio, consultaDe } from "./_dobles-analitica-financiera";

// Feature 127 / T D.2 — DERIVACION MONEY-SAFE POR REUSO: R20, R27, R37.
//
// El bug caro de esta feature no es una consulta lenta: son DOS CIFRAS DEL MISMO DINERO. Si el
// servicio escribiera `creditos.sub(debitos)` por su cuenta, nacería una segunda definicion de
// "saldo" al lado de la que `/mi-wallet` le enseña a la tienda, y las dos podrian divergir sin
// que nada fallara. No da un error: da una discusion.
//
// Comparar el resultado del servicio contra la funcion compartida NO ALCANZA para detectarlo: una
// resta escrita a mano da el mismo numero y el test seguiria verde. Por eso las tres funciones se
// ESPIAN (conservando su implementacion real): la afirmacion es «el servicio las LLAMO, con estos
// argumentos», que es lo unico que una reimplementacion no puede fingir. Los valores se comparan
// ademas, y el caso principal es un saldo NEGATIVO, con su `signo`.

vi.mock("@/lib/utils/saldo-tienda", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/utils/saldo-tienda")>();
  return { ...real, derivarSaldoTienda: vi.fn(real.derivarSaldoTienda) };
});

vi.mock("@/lib/utils/cuenta-por-pagar", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/utils/cuenta-por-pagar")>();
  return { ...real, derivarCuentaPorPagar: vi.fn(real.derivarCuentaPorPagar) };
});

vi.mock("@/lib/utils/wallet-balance", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/utils/wallet-balance")>();
  return { ...real, derivarBalance: vi.fn(real.derivarBalance) };
});

const espiaSaldo = vi.mocked(derivarSaldoTienda);
const espiaCuenta = vi.mocked(derivarCuentaPorPagar);
const espiaBalance = vi.mocked(derivarBalance);

beforeEach(() => {
  espiaSaldo.mockClear();
  espiaCuenta.mockClear();
  espiaBalance.mockClear();
});

/** Los argumentos con los que se llamo al espia, como STRING escala 2. */
function argumentosDe(espia: { mock: { calls: unknown[][] } }): string[][] {
  return espia.mock.calls.map((c) => c.map((a) => String(a)));
}

/* -------------------------------------------------------------------------- */
/* R20 / R37 — la cuenta por pagar a tiendas, con un saldo NEGATIVO            */
/* -------------------------------------------------------------------------- */

describe("R20 · el saldo de una tienda lo produce derivarSaldoTienda, no el servicio", () => {
  // `t-deudora` debe dinero: solo tiene devoluciones. Su saldo es NEGATIVO, que es el caso que
  // R20 nombra y el unico donde el `signo` distingue una resta bien hecha de una invertida.
  const SALDOS = [
    { tiendaId: "t-a-favor", tipo: "credito" as const, suma: "800.00" },
    { tiendaId: "t-a-favor", tipo: "debito" as const, suma: "300.00" },
    { tiendaId: "t-deudora", tipo: "credito" as const, suma: "100.00" },
    { tiendaId: "t-deudora", tipo: "debito" as const, suma: "350.00" },
  ];

  it("la tienda deudora llega con el MISMO neto que la funcion compartida, y es negativo", async () => {
    const esperado = derivarSaldoTienda("100.00", "350.00");
    expect(esperado.signo).toBe("negativo");
    expect(esperado.saldo).toBe("-250.00");
    espiaSaldo.mockClear();

    const { servicio } = armarServicio({ saldoTiendas: SALDOS });
    const r = await servicio.consultar(consultaDe("cuenta_por_pagar_tienda"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    const deudora = r.datos.vistas[0].filas.find((f) => f.cubo === "t-deudora");
    expect(deudora?.importe.neto).toBe(esperado.saldo);
    // ⟨D1(c)⟩ / R37: el `bruto` es la Σ SIN signo, y no es el mismo numero que el neto.
    expect(deudora?.importe.bruto).toBe("450.00");
    expect(deudora?.importe.neto).not.toBe(deudora?.importe.bruto);
  });

  it("y el servicio la LLAMO: la resta no esta reescrita aqui", async () => {
    const { servicio } = armarServicio({ saldoTiendas: SALDOS });
    await servicio.consultar(consultaDe("cuenta_por_pagar_tienda"));

    // Dos tiendas + el total = tres llamadas, con los creditos y debitos de cada cubo.
    expect(argumentosDe(espiaSaldo)).toEqual([
      ["800", "300"],
      ["100", "350"],
      ["900", "650"],
    ]);
  });

  it("el total de la vista tambien sale de la funcion, no de sumar los netos ya derivados", async () => {
    const { servicio } = armarServicio({ saldoTiendas: SALDOS });
    const r = await servicio.consultar(consultaDe("cuenta_por_pagar_tienda"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    expect(r.datos.vistas[0].total.neto).toBe(derivarSaldoTienda("900.00", "650.00").saldo);
    expect(r.datos.vistas[0].total.neto).toBe("250.00");
    expect(r.datos.vistas[0].total.bruto).toBe("1550.00");
  });

  it("es un SALDO AL CORTE: el DTO lo declara con esAcumulado", async () => {
    const { servicio } = armarServicio({ saldoTiendas: SALDOS });
    const r = await servicio.consultar(consultaDe("cuenta_por_pagar_tienda"));
    if (r.status !== "ok") throw new Error("no ok");
    expect(r.datos.esAcumulado).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* R20 — la cuenta por pagar a mensajeros                                      */
/* -------------------------------------------------------------------------- */

describe("R20 · la cuenta de mensajeros la produce derivarCuentaPorPagar", () => {
  const CUENTA = [
    { tipo: "devengo" as const, suma: "5000.00" },
    { tipo: "pago" as const, suma: "2000.00" },
  ];

  it("el neto es el que la funcion compartida devuelve, y la funcion se llamo", async () => {
    const esperado = derivarCuentaPorPagar("5000.00", "2000.00");
    espiaCuenta.mockClear();

    const { servicio } = armarServicio({ cuentaMensajeros: CUENTA });
    const r = await servicio.consultar(consultaDe("cuenta_por_pagar_mensajero"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    expect(r.datos.vistas[0].total.neto).toBe(esperado.cuentaPorPagar);
    expect(r.datos.vistas[0].total.neto).toBe("3000.00");
    expect(r.datos.vistas[0].total.bruto).toBe("7000.00");
    expect(esperado.signo).toBe("positivo");
    expect(argumentosDe(espiaCuenta)).toEqual([["5000", "2000"]]);
  });

  it("R14 — y no hay ni un cubo: la vista no tiene filas donde meter un mensajero", async () => {
    const { servicio } = armarServicio({ cuentaMensajeros: CUENTA });
    const r = await servicio.consultar(consultaDe("cuenta_por_pagar_mensajero"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    expect(r.datos.vistas[0].filas).toEqual([]);
    expect(r.datos.vistas[0].grano).toBe("fecha");
  });
});

/* -------------------------------------------------------------------------- */
/* R20 / R37 — la caja principal y el par pago + contraasiento                 */
/* -------------------------------------------------------------------------- */

describe("R20/R37 · el balance de la caja lo produce derivarBalance, con bruto y neto", () => {
  it("un rango con mas egresos que ingresos da un neto NEGATIVO, el de la funcion", async () => {
    const esperado = derivarBalance("1000.00", "1500.00");
    expect(esperado.signo).toBe("negativo");
    espiaBalance.mockClear();

    const { servicio } = armarServicio({
      caja: [
        { categoria: "ingreso_flete", tipo: "ingreso", suma: "1000.00" },
        { categoria: "egreso_ajuste", tipo: "egreso", suma: "1500.00" },
      ],
    });
    const r = await servicio.consultar(consultaDe("ingreso_flete"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    expect(r.datos.vistas[0].total.neto).toBe(esperado.balance);
    expect(r.datos.vistas[0].total.neto).toBe("-500.00");
    expect(argumentosDe(espiaBalance)).toEqual([["1000", "1500"]]);
  });

  it("⟨D1⟩ el par pago + contraasiento se CANCELA en el neto y se VE en el bruto", async () => {
    // Un flete de 1000 y su ajuste de anulacion por el mismo importe, en el mismo rango. El
    // ledger no tiene puntero del ajuste al original: el neto sale por SIGNO agregado, y por eso
    // el bruto sigue mostrando que hubo dos movimientos de 1000.
    const { servicio } = armarServicio({
      caja: [
        { categoria: "ingreso_flete", tipo: "ingreso", suma: "1000.00" },
        { categoria: "ingreso_flete", tipo: "egreso", suma: "1000.00" },
      ],
    });
    const r = await servicio.consultar(consultaDe("ingreso_flete"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    expect(r.datos.vistas[0].total.neto).toBe("0.00");
    expect(r.datos.vistas[0].total.bruto).toBe("2000.00");
    // Copiar el bruto en el neto —la mutacion que R37 nombra— daria 2000.00 aqui.
    expect(r.datos.vistas[0].total.neto).not.toBe(r.datos.vistas[0].total.bruto);
  });
});

/* -------------------------------------------------------------------------- */
/* R27 — ni un `number` en ninguna frontera                                    */
/* -------------------------------------------------------------------------- */

describe("R27 · todo importe es STRING escala 2, con aritmetica Decimal", () => {
  it("0.10 + 0.20 da exactamente 0.30, no 0.30000000000000004", async () => {
    const { servicio } = armarServicio({
      caja: [
        { categoria: "ingreso_flete", tipo: "ingreso", suma: "0.10" },
        { categoria: "ingreso_flete_devolucion", tipo: "ingreso", suma: "0.20" },
      ],
    });
    const r = await servicio.consultar(consultaDe("ingreso_flete"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    expect(r.datos.vistas[0].total.bruto).toBe("0.30");
    expect(r.datos.vistas[0].total.neto).toBe("0.30");
  });

  it("un total de siete digitos no pierde centimos", async () => {
    const { servicio } = armarServicio({
      caja: [
        { categoria: "ingreso_flete", tipo: "ingreso", suma: "9007199254740.99" },
        { categoria: "ingreso_flete", tipo: "ingreso", suma: "0.02" },
      ],
    });
    const r = await servicio.consultar(consultaDe("ingreso_flete"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    expect(r.datos.vistas[0].total.bruto).toBe("9007199254741.01");
  });

  it("ningun importe del DTO es un number, en ninguna de las ocho metricas", async () => {
    const { servicio } = armarServicio({
      caja: [{ categoria: "ingreso_flete", tipo: "ingreso", suma: "1.00" }],
      porMetodo: [{ metodo: "efectivo", suma: "1.00" }],
      porTienda: [{ tiendaId: "t-1", tipo: "credito", suma: "1.00" }],
      saldoTiendas: [{ tiendaId: "t-1", tipo: "credito", suma: "1.00" }],
      cuentaMensajeros: [{ tipo: "devengo", suma: "1.00" }],
      snapshots: [{ cierreId: "c1", totalGeneral: "1.00" }],
      ledger: [
        {
          ledger: "wallet_tienda_movimiento",
          cierreId: "c1",
          tipo: "credito",
          suma: "1.00",
        },
      ],
    });

    let comprobados = 0;
    for (const id of [
      "cod_recaudado",
      "ingreso_flete",
      "ingreso_comision_cod",
      "ingreso_iva",
      "egresos",
      "cuenta_por_pagar_tienda",
      "cuenta_por_pagar_mensajero",
      "conciliacion_cierres",
    ]) {
      const r = await servicio.consultar(consultaDe(id));
      if (r.status !== "ok") throw new Error(`${id} no devolvio ok`);
      if (r.datos.tipo === "vistas") {
        for (const vista of r.datos.vistas) {
          for (const imp of [vista.total, ...vista.filas.map((f) => f.importe)]) {
            expect(typeof imp.bruto, id).toBe("string");
            expect(typeof imp.neto, id).toBe("string");
            expect(imp.bruto, id).toMatch(/^-?\d+\.\d{2}$/);
            comprobados += 1;
          }
        }
      } else {
        const cuadre = r.datos.conciliacion.cuadre;
        for (const v of [cuadre.totalSnapshot, cuadre.totalLedger, cuadre.diferencia]) {
          expect(typeof v).toBe("string");
          expect(v).toMatch(/^-?\d+\.\d{2}$/);
          comprobados += 1;
        }
      }
    }
    expect(comprobados).toBeGreaterThan(10);
  });
});

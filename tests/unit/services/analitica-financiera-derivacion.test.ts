import { describe, it, expect, vi, beforeEach } from "vitest";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";
import { derivarCuentaPorPagar } from "@/lib/utils/cuenta-por-pagar";
import { derivarBalance } from "@/lib/utils/wallet-balance";
import { armarServicio, conNeto, consultaDe, soloBruto } from "./_dobles-analitica-financiera";

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

    const fila = r.datos.vistas[0].filas.find((f) => f.cubo === "t-deudora");
    if (fila === undefined) throw new Error("no llego la fila de t-deudora");
    // R14/183 — `cuenta_por_pagar_tienda` NO pierde el neto: su ledger tiene dos direcciones.
    const deudora = conNeto(fila.importe, "cuenta_por_pagar_tienda / t-deudora");
    expect(deudora.neto).toBe(esperado.saldo);
    // ⟨D1(c)⟩ / R37: el `bruto` es la Σ SIN signo, y no es el mismo numero que el neto.
    expect(deudora.bruto).toBe("450.00");
    expect(deudora.neto).not.toBe(deudora.bruto);
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

    const total = conNeto(r.datos.vistas[0].total, "cuenta_por_pagar_tienda / total");
    expect(total.neto).toBe(derivarSaldoTienda("900.00", "650.00").saldo);
    expect(total.neto).toBe("250.00");
    expect(total.bruto).toBe("1550.00");
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

  /**
   * FEATURE 180 — el mismo libro, visto por los otros dos metodos: 4000/1500 de ARRASTRE
   * (anterior al rango) y 1000/500 DENTRO del unico cubo del rango `dia`. La identidad que ⟨D5⟩
   * sostiene se cumple a proposito: arrastre + Σ cubos = el saldo al corte de `CUENTA`.
   */
  const ARRASTRE = [
    { tipo: "devengo" as const, suma: "4000.00" },
    { tipo: "pago" as const, suma: "1500.00" },
  ];
  const POR_CUBO = [
    { indiceCubo: 0, tipo: "devengo" as const, suma: "1000.00" },
    { indiceCubo: 0, tipo: "pago" as const, suma: "500.00" },
  ];

  it("el neto es el que la funcion compartida devuelve, y la funcion se llamo", async () => {
    const esperado = derivarCuentaPorPagar("5000.00", "2000.00");
    espiaCuenta.mockClear();

    const { servicio } = armarServicio({
      cuentaMensajeros: CUENTA,
      cuentaMensajerosAntes: ARRASTRE,
      cuentaMensajerosPorCubo: POR_CUBO,
    });
    const r = await servicio.consultar(consultaDe("cuenta_por_pagar_mensajero"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    const total = conNeto(r.datos.vistas[0].total, "cuenta_por_pagar_mensajero / total");
    expect(total.neto).toBe(esperado.cuentaPorPagar);
    expect(total.neto).toBe("3000.00");
    expect(total.bruto).toBe("7000.00");
    expect(esperado.signo).toBe("positivo");
    // DOS llamadas desde la 180: una por CUBO (el saldo acumulado al cierre de ese cubo, ⟨D5⟩) y
    // la del total. Las dos con los mismos componentes aqui, porque el rango tiene un solo cubo y
    // arrastre + movimiento = saldo al corte. Una resta escrita a mano dejaria esto vacio.
    expect(argumentosDe(espiaCuenta)).toEqual([
      ["5000", "2000"],
      ["5000", "2000"],
    ]);
  });

  it("R14 — el cubo de cada fila es una FECHA: no hay donde meter un mensajero", async () => {
    const { servicio } = armarServicio({
      cuentaMensajeros: CUENTA,
      cuentaMensajerosAntes: ARRASTRE,
      cuentaMensajerosPorCubo: POR_CUBO,
    });
    const r = await servicio.consultar(consultaDe("cuenta_por_pagar_mensajero"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    const vista = r.datos.vistas[0];
    expect(vista.grano).toBe("fecha");
    // Feature 180: la vista YA trae serie —una fila por cubo del rango `dia`, o sea una— y su
    // clave es una fecha calendario CR, nunca un id de persona.
    expect(vista.filas).toHaveLength(1);
    expect(vista.filas[0].cubo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(vista.filas[0])).toEqual(["cubo", "importe"]);
    // Y el saldo acumulado al cierre del unico cubo ES el total (R13).
    expect(vista.filas[0].importe).toEqual(vista.total);
  });
});

/* -------------------------------------------------------------------------- */
/* R20 / R37 — la caja principal y el par pago + contraasiento                 */
/* -------------------------------------------------------------------------- */

// ⚠️ LOS DOS CASOS DE ESTE BLOQUE SE REESCRIBIERON EN LA FEATURE 183 (R24), y no por gusto:
// afirmaban con filas que la BASE RECHAZA desde el CHECK categoria↔tipo de la 173. El primero
// sembraba un `egreso_ajuste` de tipo `egreso` dentro de `ingreso_flete` —que esa metrica ni
// declara—, y el segundo un `ingreso_flete` de tipo `egreso`, que es 23514 en Postgres. Un test
// que mide un estado imposible es un test verde que no mide nada.
//
// El par de verdad existe y lo emite `WalletEgresoService` al anular un egreso: una fila
// `egreso_*` de tipo `egreso` y su reverso `ingreso_ajuste` de tipo `ingreso`. Desde ⟨D12⟩
// (2026-08-04) `egresos` declara las nueve categorias que hacen falta para verlo, asi que los
// dos casos se trasladan ahi — que es ademas donde el neto sigue existiendo.
describe("R20/R37 · el balance de la caja lo produce derivarBalance, con bruto y neto", () => {
  it("un rango con mas egresos que ingresos da un neto NEGATIVO, el de la funcion", async () => {
    const esperado = derivarBalance("1000.00", "1500.00");
    expect(esperado.signo).toBe("negativo");
    espiaBalance.mockClear();

    const { servicio } = armarServicio({
      caja: [
        // Las dos filas son legales para el CHECK y las dos las declara `egresos`.
        { categoria: "ingreso_ajuste", tipo: "ingreso", suma: "1000.00" },
        { categoria: "egreso_gasto", tipo: "egreso", suma: "1500.00" },
      ],
      // Feature 180 — el mismo dinero visto por cubo: el rango `dia` tiene UN cubo, asi que el
      // desglose es el mismo libro con `indiceCubo: 0`.
      cajaPorCubo: [
        { indiceCubo: 0, categoria: "ingreso_ajuste", tipo: "ingreso", suma: "1000.00" },
        { indiceCubo: 0, categoria: "egreso_gasto", tipo: "egreso", suma: "1500.00" },
      ],
    });
    const r = await servicio.consultar(consultaDe("egresos"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    const total = conNeto(r.datos.vistas[0].total, "egresos / total");
    expect(total.neto).toBe(esperado.balance);
    // R8 — EL SIGNO SE CONSERVA: una salida neta de caja se publica NEGATIVA. Publicar el valor
    // absoluto (la mutacion 2 de R8) daria "500.00" aqui.
    expect(total.neto).toBe("-500.00");
    // R8 mutacion 1 — la resta NO esta reescrita en el servicio: la funcion se LLAMO, y con
    // estos argumentos. Un `ingresos.sub(egresos)` a mano daria el mismo numero y dejaria este
    // espia a cero. DOS llamadas desde la 180 (R17): una por CUBO y la del total; el rango `dia`
    // tiene un solo cubo y ahi vive todo el libro del fixture.
    expect(argumentosDe(espiaBalance)).toEqual([
      ["1000", "1500"],
      ["1000", "1500"],
    ]);
  });

  it("R7/183 · el par REAL egreso + su anulacion: neto 0.00 y bruto 2 × monto", async () => {
    // Un gasto de 400 y su anulacion en el mismo rango, escritos como la aplicacion los emite:
    // `egreso_gasto`/`egreso` y `ingreso_ajuste`/`ingreso` (`WalletEgresoService`). El ledger no
    // tiene puntero del reverso al original: el neto sale por SIGNO agregado, y por eso el bruto
    // sigue mostrando que hubo DOS movimientos de 400 (⟨D1(c)⟩, P1 de la 183: volumen movido).
    const { servicio } = armarServicio({
      caja: [
        { categoria: "egreso_gasto", tipo: "egreso", suma: "400.00" },
        { categoria: "ingreso_ajuste", tipo: "ingreso", suma: "400.00" },
      ],
    });
    const r = await servicio.consultar(consultaDe("egresos"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    const total = conNeto(r.datos.vistas[0].total, "egresos / total");
    // Con la definicion de OCHO categorias —la mutacion que R7 nombra— el reverso no entraria y
    // esto seria neto "-400.00" / bruto "400.00": anular un egreso no lo descontaria nunca.
    expect(total.neto).toBe("0.00");
    expect(total.bruto).toBe("800.00");
    // Copiar el bruto en el neto —la mutacion que R37 nombra— daria 800.00 aqui.
    expect(total.neto).not.toBe(total.bruto);
  });
});

/* -------------------------------------------------------------------------- */
/* R1 / R8 (183) — las tres de Q1 publican SOLO bruto, y no llaman a derivarBalance */
/* -------------------------------------------------------------------------- */

describe("R1 · las tres metricas homogeneas de prefijo no publican neto ⟨D12⟩", () => {
  const CAJA = [
    { categoria: "ingreso_flete" as const, tipo: "ingreso" as const, suma: "1000.00" },
    { categoria: "ingreso_flete_devolucion" as const, tipo: "ingreso" as const, suma: "5.00" },
  ];

  /** Feature 180 — el mismo libro por cubo; el rango `dia` tiene uno solo. */
  const CAJA_POR_CUBO = CAJA.map((f) => ({ ...f, indiceCubo: 0 }));

  for (const id of ["ingreso_flete", "ingreso_comision_cod", "ingreso_iva"]) {
    it(`el DTO SERIALIZADO de \`${id}\` no lleva la clave \`neto\`, ni vacia ni en null`, async () => {
      const { servicio } = armarServicio({ caja: CAJA, cajaPorCubo: CAJA_POR_CUBO });
      const r = await servicio.consultar(consultaDe(id));
      if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

      // Sobre el OBJETO SERIALIZADO, no solo por tipos: publicar el neto con el valor del bruto
      // —la mutacion que R1 nombra— compila igual de bien y solo se ve aqui.
      const total = r.datos.vistas[0].total;
      expect(Object.keys(JSON.parse(JSON.stringify(total)))).toEqual(["forma", "bruto", "moneda"]);
      expect(JSON.stringify(r.datos)).not.toContain('"neto"');

      // Y lo que SI publica es el volumen sin signo, con la forma declarada.
      expect(soloBruto(total, id).bruto).toBe("1005.00");
      expect(total.forma).toBe("solo_bruto");
    });
  }

  it("R8 · a `derivarBalance` no se le pide una resta contra cero: no se la llama", async () => {
    espiaBalance.mockClear();
    const { servicio } = armarServicio({ caja: CAJA, cajaPorCubo: CAJA_POR_CUBO });
    await servicio.consultar(consultaDe("ingreso_flete"));
    // NI UNA llamada, y desde la 180 eso dice mas que antes: la vista publica ademas una fila
    // por cubo, asi que un desglose que construyera sus filas con el otro constructor —el que
    // lleva neto— aparecería aqui como una llamada de mas (⟨D7⟩ / R27).
    expect(argumentosDe(espiaBalance)).toEqual([]);

    // Y en `egresos`, que si tiene resta que hacer, se la sigue llamando: el caso de arriba no
    // pasa por «el espia nunca se llama en este archivo». Dos veces: el cubo y el total.
    await servicio.consultar(consultaDe("egresos"));
    expect(argumentosDe(espiaBalance)).toEqual([
      ["1005", "0"],
      ["1005", "0"],
    ]);
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

    // Desde ⟨D12⟩ `ingreso_flete` publica solo el bruto; la aritmetica Decimal es la misma.
    expect(soloBruto(r.datos.vistas[0].total, "ingreso_flete").bruto).toBe("0.30");
  });

  it("y en `egresos`, que si publica neto, tampoco hay coma flotante", async () => {
    const { servicio } = armarServicio({
      caja: [
        { categoria: "egreso_gasto", tipo: "egreso", suma: "0.10" },
        { categoria: "egreso_sueldo", tipo: "egreso", suma: "0.20" },
      ],
    });
    const r = await servicio.consultar(consultaDe("egresos"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    const total = conNeto(r.datos.vistas[0].total, "egresos / total");
    expect(total.bruto).toBe("0.30");
    expect(total.neto).toBe("-0.30");
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
            expect(imp.bruto, id).toMatch(/^-?\d+\.\d{2}$/);
            // El neto se juzga DONDE EXISTE. Ramificar por `forma` y no por id es lo que R22 de
            // la 132 exige tambien del frontend: la forma la dice el DTO.
            if (imp.forma === "bruto_y_neto") {
              expect(typeof imp.neto, id).toBe("string");
              expect(imp.neto, id).toMatch(/^-?\d+\.\d{2}$/);
            }
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

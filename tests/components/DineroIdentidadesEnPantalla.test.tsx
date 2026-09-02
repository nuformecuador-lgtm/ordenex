// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { SWRConfig } from "swr";

import { CajaResumenCard } from "@/app/(app)/wallet/_components/CajaResumenCard";
import { CAJA_RESUMEN_LABEL } from "@/app/(app)/wallet/_components/wallet-labels";
import { PanelConciliacion } from "@/app/(app)/analitica/_components/financiero/PanelConciliacion";
import { REPARTO_PREVISUALIZACION } from "@/app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels";
import { MONTO_EXCEDE } from "@/app/(app)/incidentes/_components/IncidentesAdminModule";
import { montoValido } from "@/components/shared/monto-cliente";
import { getMetrica } from "@/lib/analytics/metrics";
import {
  ESCALA_PRESENTACION,
  formatMonto,
  monedaConfig,
  money,
  moneyTope,
  montoExacto,
} from "@/lib/config/moneda";
import { INDEMNIZACION_MONTO_MAX } from "@/lib/types/cierres-admin";
import type { ResultadoFinancieroConciliacion } from "@/lib/types/analitica-financiera";
import type { CajaResumenDTO } from "@/lib/types/wallet";
import type { PrevisualizacionRepartoDTO } from "@/lib/types/liquidacion-reparto";

/**
 * FICHA 359 — LAS IDENTIDADES CIERRAN CON LO QUE SE PINTA.
 *
 * ═══ EL DEFECTO QUE MATA ESTE ARCHIVO ═══════════════════════════════════════
 *
 * La feature 230 hizo que todo importe se pintara cuadrado al colón. Cada cifra
 * por separado era correcta. Pero muchas pantallas enseñan A, B y C donde
 * C = A ± B, y esa identidad la calculó el servidor con `Prisma.Decimal` sobre
 * los céntimos: al cuadrar cada operando por su cuenta, LA RESTA QUE EL USUARIO
 * VE DEJABA DE DAR, por hasta ±1 colón. Se censaron 13 contradicciones. Las
 * peores: un panel que encendía «no cuadran» y debajo pintaba «Diferencia ₡0»;
 * un reparto que anunciaba un máximo que el servidor rechazaba; el mismo monto
 * de una orden pintado `₡11.899` y `₡11.898,81` en el mismo panel.
 *
 * ═══ POR QUE ESTE ARCHIVO Y NO OTRA COSA ════════════════════════════════════
 *
 * La guardia hermana (`tests/unit/guards/dinero-centimos-cuando-existen`) vigila
 * el FORMATEADOR: que todos los caminos den la misma cadena y que la cola salga
 * si y solo si existe. Eso no basta para afirmar que el defecto está muerto: un
 * formateador impecable puede seguir alimentando una pantalla cuya resta no da.
 *
 * Aquí se afirma lo otro, y se afirma como lo vive el usuario: se PARSEA lo que
 * se pinta y se comprueba que `A ± B = C` sobre las CADENAS, no sobre los
 * `Decimal` de origen. Comprobarlo sobre los `Decimal` sería una aserción contra
 * su propia fuente —siempre verde— y dejaría el arreglo en cosmético.
 *
 * ═══ COMO ════════════════════════════════════════════════════════════════════
 *
 *   Parte A — EL TEOREMA. `parsear ∘ pintar` es la identidad sobre la escala del
 *             dato. De ahí sale, POR CONSTRUCCION, que toda identidad de escala
 *             2 cierre en pantalla. Es lo que hace que esto no haya que
 *             arreglarlo pantalla por pantalla — que es como la feature 300
 *             arregló una y dejó doce.
 *   Parte B — LAS PANTALLAS RENDERIZADAS. Tres pantallas se montan de verdad y
 *             se leen del DOM. Es el ancla contra el teorema: si una pantalla
 *             usara otro formateador, el teorema seguiría siendo cierto y la
 *             pantalla seguiría mintiendo.
 *   Parte C — LAS IDENTIDADES POR ETIQUETA. El resto del censo, a través de la
 *             MISMA función que llama cada pantalla.
 *   Parte D — EL CENSO. Las trece pantallas existen y su dinero pasa por el
 *             formateador compartido. Sin esto, B y C podrían estar probando
 *             funciones que ya nadie llama.
 *
 * TODOS los importes de este archivo llevan céntimos a propósito. Con cifras
 * redondas —el 100% de lo que se TOCA en producción— estas identidades cerraban
 * también ANTES de la ficha, así que un caso redondo no probaría nada.
 */

const RAIZ = path.resolve(__dirname, "../..");

// ═══════════════════════════════════════════════════════════════════════════
// EL PARSEADOR. Lee una cadena PINTADA y devuelve céntimos enteros.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Los céntimos que una persona leería en la cadena pintada.
 *
 * En `bigint` y no en `number`, y con la razón medida y no supuesta: los céntimos
 * de un `DECIMAL(12,2)` llegan como mucho a 10^14, que TODAVÍA cabe exacto en un
 * `double` (el techo son ~9·10^15). O sea que hoy un `number` bastaría. Se usa
 * `bigint` porque este archivo afirma igualdades AL CÉNTIMO y no quiere que su
 * validez dependa del tamaño del importe: es el mismo criterio por el que el
 * formateador tiene prohibido `Number(`, y ahí la razón es idéntica.
 *
 * Deshace exactamente lo que hace el formateador y NADA MAS —quita el símbolo,
 * los separadores de miles y el signo, y completa la cola a la escala—, así que
 * una cadena mal formada (`₡1.234,5`) da un valor distinto del esperado en vez
 * de "arreglarse" por el camino.
 */
function centimosPintados(pintado: string): bigint {
  const negativo = pintado.trimStart().startsWith("-");
  const sinSigno = negativo ? pintado.trimStart().slice(1) : pintado.trim();
  expect(sinSigno.startsWith(monedaConfig.simbolo), `«${pintado}» no es un importe`).toBe(true);
  const cuerpo = sinSigno.slice(monedaConfig.simbolo.length);

  const corte = cuerpo.indexOf(monedaConfig.separadorDecimal);
  const enteros = corte === -1 ? cuerpo : cuerpo.slice(0, corte);
  const cola = corte === -1 ? "" : cuerpo.slice(corte + monedaConfig.separadorDecimal.length);

  const digitos = enteros.split(monedaConfig.separadorMiles).join("");
  const colaCompleta = `${cola}${"0".repeat(ESCALA_PRESENTACION)}`.slice(0, ESCALA_PRESENTACION);
  const valor = BigInt(digitos) * BigInt(100) + BigInt(colaCompleta);
  return negativo ? -valor : valor;
}

/** Los céntimos que el SERVIDOR calculó, según el oráculo `Prisma.Decimal`. */
function centimosDelServidor(importe: string): bigint {
  return BigInt(new Prisma.Decimal(importe).mul(100).toFixed(0));
}

/**
 * La afirmación central, en una función: la cuenta cierra CON LAS CADENAS.
 *
 * Recibe los sumandos y el total tal y como se PINTAN, los parsea y compara. El
 * mensaje de fallo lleva las cadenas, que es lo que hay que poder pegar en un
 * informe: «₡4.500 + ₡416 ≠ ₡4.917» dice mucho más que «450000 + 41600».
 */
function laCuentaCierra(sumandos: readonly string[], total: string, quien: string): void {
  const suma = sumandos.reduce((acc, s) => acc + centimosPintados(s), BigInt(0));
  expect(
    suma,
    `${quien}: en pantalla se lee ${sumandos.join(" + ")} = ${total}, y no da`,
  ).toBe(centimosPintados(total));
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTE A — EL TEOREMA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * El corpus de la parte A. Los cuatro bordes OBLIGATORIOS de la ficha están
 * nombrados uno a uno para que no se diluyan en un generador: el céntimo `.50`,
 * el `.00` explícito, el negativo y el cero. Y el acarreo (`999.50`), que es el
 * borde que la regla anterior movía de sitio.
 */
const BORDES: readonly { importe: string; porque: string }[] = [
  { importe: "999.50", porque: "acarreo: la 230 lo convertía en ₡1.000" },
  { importe: "0.50", porque: "el céntimo .50, el que la 230 redondeaba hacia arriba" },
  { importe: "1234.00", porque: "el .00 explícito: existe en el dato y NO se pinta" },
  { importe: "-416.47", porque: "negativo con cola" },
  { importe: "-0.49", porque: "negativo que la 230 pintaba ₡0 y perdía el signo" },
  { importe: "0.00", porque: "el cero" },
  { importe: "-0.00", porque: "el menos cero: se pinta sin signo" },
  { importe: "11898.81", porque: "el monto de la captura de la feature 300" },
  { importe: "416.47", porque: "una comisión COD del 3,5% de 11.899" },
  { importe: "13331832.72", porque: "el importe de la tabla de contrato de la 230" },
  { importe: "999999999999.99", porque: "doce dígitos: no cabe exacto en un number" },
];

/** Un corpus ancho de escala 2, generado, para que el teorema no dependa de 11 casos. */
const ESCALA_2: readonly string[] = (() => {
  const casos = new Set<string>(BORDES.map((b) => b.importe));
  for (const signo of ["", "-"]) {
    for (const enteros of ["0", "7", "999", "1000", "99999", "1234567", "999999999999"]) {
      for (const cola of ["00", "01", "05", "49", "50", "51", "99"]) {
        casos.add(`${signo}${enteros}.${cola}`);
      }
    }
  }
  return [...casos];
})();

describe("ficha 359 · A — el teorema: lo pintado se puede volver a leer", () => {
  it("el corpus mira algo, y nombra los cuatro bordes obligatorios", () => {
    expect(ESCALA_2.length).toBeGreaterThan(90);
    for (const { importe, porque } of BORDES) {
      expect(ESCALA_2).toContain(importe);
      expect(porque.length, `${importe} está en el corpus sin motivo escrito`).toBeGreaterThan(5);
    }
  });

  it("parsear lo pintado devuelve EXACTAMENTE los céntimos del servidor", () => {
    // El teorema. Si esto vale, formatear ya no pierde información y ninguna
    // identidad de escala 2 puede descuadrarse por el camino de la presentación.
    const perdidas: string[] = [];
    for (const importe of ESCALA_2) {
      const pintado = money(importe);
      if (centimosPintados(pintado) !== centimosDelServidor(importe)) {
        perdidas.push(`${importe} -> ${pintado} -> ${centimosPintados(pintado)}`);
      }
    }
    expect(perdidas, "el formateador perdió céntimos por el camino").toEqual([]);
  });

  it("y por tanto CUALQUIER identidad A ± B = C cierra en pantalla", () => {
    // La consecuencia, comprobada y no razonada: se recorren pares del corpus, se
    // deja que `Prisma.Decimal` calcule la suma y la resta como lo haría el
    // servidor, y se exige que las CADENAS cuadren.
    let comprobadas = 0;
    for (const a of ESCALA_2) {
      for (const b of BORDES) {
        const izquierda = new Prisma.Decimal(a);
        const derecha = new Prisma.Decimal(b.importe);
        laCuentaCierra(
          [money(a), money(b.importe)],
          money(izquierda.add(derecha).toFixed(ESCALA_PRESENTACION)),
          `suma ${a} + ${b.importe}`,
        );
        laCuentaCierra(
          [money(izquierda.sub(derecha).toFixed(ESCALA_PRESENTACION)), money(b.importe)],
          money(a),
          `resta ${a} - ${b.importe}`,
        );
        comprobadas += 2;
      }
    }
    expect(comprobadas).toBeGreaterThan(1000);
  });

  it("los bordes, uno a uno y con la cadena literal esperada", () => {
    const c = monedaConfig.separadorDecimal;
    const s = monedaConfig.simbolo;
    const m = monedaConfig.separadorMiles;

    // El acarreo que la regla anterior provocaba y esta no: `999,50` se queda.
    expect(money("999.50")).toBe(`${s}999${c}50`);
    expect(money("999.50")).not.toBe(`${s}1${m}000`);
    // El `.00` explícito NO se pinta: es lo que la 230 quitó y sigue quitado.
    expect(money("1234.00")).toBe(`${s}1${m}234`);
    expect(money("1234.00")).toBe(money("1234"));
    // El negativo conserva su cola y su signo, delante del símbolo.
    expect(money("-416.47")).toBe(`-${s}416${c}47`);
    // El menos cero se pinta sin signo: «menos cero» no es una cantidad.
    expect(money("-0.00")).toBe(`${s}0`);
    expect(money("0.00")).toBe(`${s}0`);
    // Y el céntimo suelto ya no se redondea a cero: se ve.
    expect(money("-0.49")).toBe(`-${s}0${c}49`);
  });

  it("CONTRAPRUEBA: con la regla de la 230 estas identidades NO cerraban", () => {
    // Sin esto, todo lo de arriba podría estar verde por casualidad. Se reconstruye
    // el formateador anterior —cuadrar al colón y tirar la cola— y se cuenta
    // cuántas de las identidades de esta suite se rompen con él.
    const comoLa230 = (v: string): string => {
      const entero = new Prisma.Decimal(v).toDecimalPlaces(0).toFixed(0);
      return money(entero);
    };
    const rotas: string[] = [];
    for (const a of ESCALA_2) {
      for (const b of BORDES) {
        const total = new Prisma.Decimal(a).add(new Prisma.Decimal(b.importe));
        const suma =
          centimosPintados(comoLa230(a)) + centimosPintados(comoLa230(b.importe));
        if (suma !== centimosPintados(comoLa230(total.toFixed(ESCALA_PRESENTACION)))) {
          rotas.push(`${a} + ${b.importe}`);
        }
      }
    }
    expect(rotas.length, "la regla vieja debería romper cientos de identidades").toBeGreaterThan(
      200,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PARTE B — LAS PANTALLAS, RENDERIZADAS Y LEIDAS DEL DOM
// ═══════════════════════════════════════════════════════════════════════════

afterEach(cleanup);

/**
 * La tarjeta «Dinero en caja»: SIETE importes con TRES identidades entre ellos, y
 * la peor de las trece por densidad. Las cifras llevan céntimos a propósito y se
 * derivan con `Prisma.Decimal`, igual que el servicio.
 *
 *   entradas − salidas = enCaja
 *   deTerceros + ganancia = enCaja
 *   ingresosPropios − egresosPropios = ganancia
 */
const CAJA_CON_CENTIMOS: CajaResumenDTO = {
  entradas: "15416.47",
  salidas: "3000.55",
  enCaja: "12415.92",
  signoEnCaja: "positivo",
  ingresosPropios: "5416.47",
  egresosPropios: "3000.55",
  ganancia: "2415.92",
  signoGanancia: "positivo",
  deTerceros: "10000.00",
  periodoFiltrado: false,
  porcentajeTiendas: "80.54",
  modoComposicion: "dos_bolsillos",
};

describe("ficha 359 · B1 — «Dinero en caja»: las tres identidades de la tarjeta", () => {
  it("el conjunto de prueba es coherente ANTES de pintarlo (según el servidor)", () => {
    // Si el doble no cuadrara, la pantalla podría estar rota y este test verde.
    const c = (k: keyof CajaResumenDTO) => new Prisma.Decimal(CAJA_CON_CENTIMOS[k] as string);
    expect(c("entradas").sub(c("salidas")).toFixed(2)).toBe(CAJA_CON_CENTIMOS.enCaja);
    expect(c("deTerceros").add(c("ganancia")).toFixed(2)).toBe(CAJA_CON_CENTIMOS.enCaja);
    expect(c("ingresosPropios").sub(c("egresosPropios")).toFixed(2)).toBe(
      CAJA_CON_CENTIMOS.ganancia,
    );
    // Y llevan céntimos: con cifras redondas esto no probaría nada.
    expect(CAJA_CON_CENTIMOS.enCaja).toMatch(/\.\d[1-9]|\.[1-9]\d/);
  });

  it("las tres cuentas cierran con las CADENAS que se leen en la tarjeta", () => {
    render(<CajaResumenCard resumen={CAJA_CON_CENTIMOS} />);

    const enCaja = leerImporte(
      screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.enCaja }),
    );
    const ganancia = leerImporte(
      screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.ganancia }),
    );
    const texto = document.body.textContent ?? "";

    const entradas = importeJuntoA(texto, CAJA_RESUMEN_LABEL.entradas);
    const salidas = importeJuntoA(texto, CAJA_RESUMEN_LABEL.salidas);
    const ingresos = importeJuntoA(texto, CAJA_RESUMEN_LABEL.ingresosPropios);
    const egresos = importeJuntoA(texto, CAJA_RESUMEN_LABEL.egresosPropios);
    // El bolsillo de las tiendas es su propia región: se lee de ahí y no del
    // texto corrido, donde el rótulo va DESPUES de su cifra y el barrido hacia
    // atrás recogería la del bolsillo de al lado.
    const terceros = leerImporte(
      screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.deTerceros }),
    );

    // Identidad 1 — entradas − salidas = en caja.
    laCuentaCierra([enCaja, salidas], entradas, "caja: entradas − salidas");
    // Identidad 2 — los dos bolsillos suman la caja.
    laCuentaCierra([terceros, ganancia], enCaja, "caja: terceros + ganancia");
    // Identidad 3 — el bolsillo de Ordenex, por dentro.
    laCuentaCierra([ganancia, egresos], ingresos, "caja: ingresos − egresos");
  });

  it("y las cifras que se leen son las del servidor, no una versión redondeada", () => {
    render(<CajaResumenCard resumen={CAJA_CON_CENTIMOS} />);
    const enCaja = leerImporte(screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.enCaja }));
    expect(centimosPintados(enCaja)).toBe(centimosDelServidor(CAJA_CON_CENTIMOS.enCaja));
    // El síntoma concreto: la tarjeta ya no pinta `₡12.416` por `12415.92`.
    expect(enCaja).not.toBe(money("12416"));
  });
});

/** El primer importe con símbolo de moneda que aparece dentro de un nodo. */
function leerImporte(nodo: HTMLElement): string {
  const encontrado = (nodo.textContent ?? "").match(PATRON_IMPORTE);
  expect(encontrado, `no hay ningún importe dentro de «${nodo.getAttribute("aria-label")}»`)
    .not.toBeNull();
  return encontrado![0];
}

/** El importe que sigue —o precede— a un rótulo dentro de un texto corrido. */
function importeJuntoA(texto: string, rotulo: string): string {
  const desde = texto.indexOf(rotulo);
  expect(desde, `el rótulo «${rotulo}» no está en pantalla`).toBeGreaterThanOrEqual(0);
  // El importe puede ir antes o después del rótulo según la tarjeta; se busca el
  // más cercano hacia adelante y, si no lo hay, hacia atrás.
  const adelante = texto.slice(desde + rotulo.length).match(PATRON_IMPORTE);
  if (adelante) return adelante[0];
  const atras = [...texto.slice(0, desde).matchAll(new RegExp(PATRON_IMPORTE, "g"))];
  expect(atras.length, `no hay importe junto a «${rotulo}»`).toBeGreaterThan(0);
  return atras[atras.length - 1][0];
}

const PATRON_IMPORTE = new RegExp(
  `-?${monedaConfig.simbolo}\\d[\\d${monedaConfig.separadorMiles}]*(?:${monedaConfig.separadorDecimal}\\d\\d)?`,
);

// ---------------------------------------------------------------------------

const METRICA = getMetrica("conciliacion_cierres");
if (METRICA === undefined) throw new Error("catalogo sin `conciliacion_cierres`");

/**
 * El panel de conciliación, con el descuadre de ₡60,50 que la 230 pintaba «₡61»
 * mientras la alerta decía que no cuadra — y con una fila cuyos cuatro importes
 * por método tienen la MISMA identidad que la factura del cierre
 * (`efectivo + SINPE + transferencia = general`).
 */
function conciliacionCon(cuadra: boolean): ResultadoFinancieroConciliacion {
  return {
    tipo: "conciliacion",
    metricaId: "conciliacion_cierres",
    etiqueta: "Conciliación de cierres",
    unidad: METRICA!.unidad,
    rango: { desdeFecha: "2026-07-05", hastaFecha: "2026-08-03" },
    esAcumulado: false,
    conciliacion: {
      porEstado: [
        {
          nivel: "cierre_dia",
          estado: "aprobado",
          cantidad: 7,
          totales: {
            efectivo: "1000.25",
            simpe: "250.50",
            transferencia: "310.75",
            general: "1561.50",
          },
          fechadoPor: "resuelto_at",
        },
      ],
      cuadre: {
        cuadra,
        totalSnapshot: "1560.50",
        totalLedger: "1500.00",
        diferencia: "60.50",
        cierresDescuadrados: cuadra ? [] : ["c1"],
      },
    },
  };
}

describe("ficha 359 · B2 — conciliación: la alerta y la cifra dicen lo mismo", () => {
  it("snapshot − ledger = diferencia, leído del panel", () => {
    render(<PanelConciliacion datos={conciliacionCon(false)} />);
    const seccion = screen.getByRole("region", { name: "Conciliación de cierres" });
    const texto = seccion.textContent ?? "";

    const pintados = [...texto.matchAll(new RegExp(PATRON_IMPORTE, "g"))].map((m) => m[0]);
    const snapshot = pintados.find((p) => centimosPintados(p) === BigInt(156050));
    const ledger = pintados.find((p) => centimosPintados(p) === BigInt(150000));
    const diferencia = pintados.find((p) => centimosPintados(p) === BigInt(6050));

    expect(snapshot, "el total del snapshot no está en pantalla").toBeDefined();
    expect(ledger, "el total del ledger no está en pantalla").toBeDefined();
    expect(diferencia, "la diferencia no está en pantalla").toBeDefined();
    laCuentaCierra([ledger!, diferencia!], snapshot!, "conciliación: snapshot − ledger");
  });

  it("LA CONTRADICCION, muerta: con la alerta encendida la diferencia NO se lee como cero", () => {
    // El defecto nº1 del censo. `cuadra` lo decide el servidor con
    // `diferencia.isZero()` EXACTO (`AnaliticaFinancieraService`), y el panel
    // pintaba «₡61» —o «₡0» con un descuadre de céntimos— justo debajo.
    render(<PanelConciliacion datos={conciliacionCon(false)} />);
    const seccion = screen.getByRole("region", { name: "Conciliación de cierres" });

    expect(within(seccion).getByRole("alert")).toBeInTheDocument();
    const texto = seccion.textContent ?? "";
    const pintados = [...texto.matchAll(new RegExp(PATRON_IMPORTE, "g"))].map((m) => m[0]);
    const cero = money("0");
    // Ninguna de las tres cifras del cuadre puede leerse como cero mientras la
    // alerta está encendida: es exactamente la frase «Diferencia ₡0».
    expect(pintados.filter((p) => p === cero && centimosPintados(p) === BigInt(0))).toEqual([]);
    // Y la que se lee es la de verdad, con su cola.
    expect(pintados.some((p) => centimosPintados(p) === BigInt(6050))).toBe(true);
  });

  it("y en la misma pantalla: efectivo + SINPE + transferencia = general (identidad de la factura)", () => {
    render(<PanelConciliacion datos={conciliacionCon(true)} />);
    const seccion = screen.getByRole("region", { name: "Conciliación de cierres" });
    const texto = seccion.textContent ?? "";
    const pintados = [...texto.matchAll(new RegExp(PATRON_IMPORTE, "g"))].map((m) => m[0]);

    const porCentimos = (c: bigint) => {
      const hallado = pintados.find((p) => centimosPintados(p) === c);
      expect(hallado, `no se pinta el importe de ${c} céntimos`).toBeDefined();
      return hallado!;
    };
    laCuentaCierra(
      [porCentimos(BigInt(100025)), porCentimos(BigInt(25050)), porCentimos(BigInt(31075))],
      porCentimos(BigInt(156150)),
      "factura de cierre: efectivo + SINPE + transferencia",
    );
  });
});

// ---------------------------------------------------------------------------

const { previsualizarMock } = vi.hoisted(() => ({ previsualizarMock: vi.fn() }));
vi.mock("@/lib/actions/liquidacion", () => ({
  previsualizarRepartoMensajeroAction: (...args: unknown[]) => previsualizarMock(...args),
  registrarRepartoMensajeroAction: vi.fn(),
}));
// eslint-disable-next-line import/first
import { RepartoPrevisualizacion } from "@/app/(app)/wallet/mensajeros/_components/RepartoPrevisualizacion";

/**
 * El reparto que EXCEDE: se teclean 9.000 y el imputable real es 4.500,35. El
 * servidor devuelve `sobrante = 4.499,65`, así que en pantalla tiene que leerse
 * `imputable + sobrante = lo tecleado`.
 *
 * Es el defecto nº2 del censo: `money` cuadraba al vecino más cercano, así que el
 * «como máximo se pueden aplicar ₡4.500» anunciaba MENOS de lo aplicable, y con
 * un imputable de `4500.60` habría anunciado `₡4.501`, o sea MAS de lo que el
 * servidor acepta al céntimo.
 */
function repartoQueExcede(): PrevisualizacionRepartoDTO {
  return {
    mensajeroNombre: "Ana Mensajera",
    imputable: "4500.35",
    imputableTotal: "4500.35",
    cuentaPorPagar: "4500.35",
    deudaNoImputable: { hay: false, monto: "0.00" },
    recorte: { aplicado: false, tope: 3, enVentana: 1, fuera: 0, montoFuera: "0.00" },
    imputaciones: [
      {
        cierreId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        solicitadoAt: "2026-07-28T06:00:00.000Z",
        pendienteActual: "4500.35",
        monto: "1200.15",
        pendienteDespues: "3300.20",
        parcial: true,
      },
    ],
    sobrante: "4499.65",
    excede: true,
    excluidos: [],
  };
}

describe("ficha 359 · B3 — reparto al mensajero: el máximo que se anuncia es el real", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previsualizarMock.mockResolvedValue({ status: "ok", previsualizacion: repartoQueExcede() });
  });

  it("imputable + sobrante = lo tecleado, leído del aviso", async () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <RepartoPrevisualizacion
          mensajeroId="1e2d3c4b-5a69-4788-9900-aabbccddeeff"
          monto="9000.00"
          esperaMs={0}
        />
      </SWRConfig>,
    );

    const aviso = await screen.findByText(/Como máximo se pueden aplicar/);
    const pintados = [...(aviso.textContent ?? "").matchAll(new RegExp(PATRON_IMPORTE, "g"))].map(
      (m) => m[0],
    );
    expect(pintados.length, "el aviso tiene que nombrar las DOS cifras").toBe(2);
    const [sobrante, imputable] = pintados;

    laCuentaCierra([imputable, sobrante], money("9000.00"), "reparto: imputable + sobrante");
    // Y el máximo anunciado NO supera lo que el servidor acepta al céntimo.
    expect(centimosPintados(imputable)).toBeLessThanOrEqual(centimosDelServidor("4500.35"));
    expect(centimosPintados(imputable)).toBe(centimosDelServidor("4500.35"));
  });

  it("y la imputación cierra: pendiente hoy − lo que se aplica = queda pendiente", async () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <RepartoPrevisualizacion
          mensajeroId="1e2d3c4b-5a69-4788-9900-aabbccddeeff"
          monto="9000.00"
          esperaMs={0}
        />
      </SWRConfig>,
    );

    await screen.findByText(/Como máximo se pueden aplicar/);
    const texto = document.body.textContent ?? "";
    const tras = (rotulo: string) => {
      const desde = texto.indexOf(rotulo);
      expect(desde, `«${rotulo}» no está en pantalla`).toBeGreaterThanOrEqual(0);
      const hallado = texto.slice(desde).match(PATRON_IMPORTE);
      expect(hallado).not.toBeNull();
      return hallado![0];
    };

    laCuentaCierra(
      [tras("Queda pendiente"), tras("Se aplica")],
      tras("Pendiente hoy"),
      "reparto: pendiente − aplicado",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PARTE C — LAS IDENTIDADES POR ETIQUETA (la misma función que llama la pantalla)
// ═══════════════════════════════════════════════════════════════════════════

describe("ficha 359 · C — el resto del censo, por su propia etiqueta", () => {
  it("cierre-detalle-shared: los SEIS sumandos del ingreso dan el total", () => {
    // La fila donde SIEMPRE hay céntimos en producción: la comisión COD es el
    // 3,5% del monto a cobrar y sale con cola en 577 de 577 filas medidas. Los
    // seis sumandos y el total los deriva el servidor con `Prisma.Decimal`.
    const montoCobrar = new Prisma.Decimal("11899.00");
    const flete = new Prisma.Decimal("2500.00");
    const ivaFlete = flete.mul("0.13");
    const fleteDevolucion = new Prisma.Decimal("0.00");
    const ivaFleteDevolucion = fleteDevolucion.mul("0.13");
    const comisionCod = montoCobrar.mul("0.035"); // 416.465 -> 416.47 a escala 2
    const ivaComisionCod = comisionCod.toDecimalPlaces(2).mul("0.13");

    const sumandos = [
      flete,
      ivaFlete,
      fleteDevolucion,
      ivaFleteDevolucion,
      comisionCod,
      ivaComisionCod,
    ].map((d) => d.toDecimalPlaces(2));
    const total = sumandos.reduce((a, b) => a.add(b), new Prisma.Decimal(0));

    // La comisión REALMENTE tiene cola: si no, el caso no probaría nada.
    expect(money(comisionCod.toFixed(2))).toMatch(
      new RegExp(`${monedaConfig.separadorDecimal}\\d\\d`),
    );
    laCuentaCierra(
      sumandos.map((d) => money(d.toFixed(2))),
      money(total.toFixed(2)),
      "detalle de cierre: los seis sumandos del ingreso",
    );
  });

  it("cuentas por pagar: devengado − pagado = cuenta por pagar", () => {
    const devengado = new Prisma.Decimal("18850.47");
    const pagado = new Prisma.Decimal("6450.15");
    const cuenta = devengado.sub(pagado);
    laCuentaCierra(
      [money(cuenta.toFixed(2)), money(pagado.toFixed(2))],
      money(devengado.toFixed(2)),
      "cuentas por pagar",
    );
  });

  it("desglose de movimientos de tienda: las líneas suman el total", () => {
    const lineas = ["1200.15", "-300.55", "416.47", "0.50"].map((v) => new Prisma.Decimal(v));
    const total = lineas.reduce((a, b) => a.add(b), new Prisma.Decimal(0));
    laCuentaCierra(
      lineas.map((d) => money(d.toFixed(2))),
      money(total.toFixed(2)),
      "movimientos de tienda",
    );
  });

  it("dinero por producto: recaudado = liquidado a Ordenex + liquidado a la tienda + pendiente", () => {
    const ordenex = new Prisma.Decimal("416.47");
    const tienda = new Prisma.Decimal("11482.53");
    const pendiente = new Prisma.Decimal("0.50");
    const recaudado = ordenex.add(tienda).add(pendiente);
    laCuentaCierra(
      [money(ordenex.toFixed(2)), money(tienda.toFixed(2)), money(pendiente.toFixed(2))],
      money(recaudado.toFixed(2)),
      "dinero por producto",
    );
  });

  it("desglose del cobro (feature 300): a cobrar − capturado = diferencia, y el panel es UNO", () => {
    // El defecto nº4 del censo: el mismo monto se pintaba `₡11.899` en el detalle
    // de la asignación (`formatMonto`) y `₡11.898,81` en el editor de pago
    // (`montoExacto`), en el MISMO panel. Ahora los dos caminos dan la misma
    // cadena, que es lo que hace que la resta de abajo sea legible.
    const aCobrar = 11898.81;
    const capturado = 11898;
    expect(formatMonto(aCobrar, "—")).toBe(montoExacto(aCobrar));
    laCuentaCierra(
      [montoExacto(capturado), montoExacto(aCobrar - capturado)],
      montoExacto(aCobrar),
      "desglose del cobro",
    );
    // Y la diferencia ya no se lee como cero cuando NO es cero.
    expect(centimosPintados(montoExacto(aCobrar - capturado))).toBe(BigInt(81));
  });

  it("reparto: la etiqueta `excede` usa `moneyTope` y sigue cerrando la cuenta", () => {
    // `moneyTope` está aquí por lo que GARANTIZA (nunca al alza), no por lo que
    // cambia: para todo lo que emite el servidor —escala 2— da la misma cadena
    // que `money`, así que la identidad no se rompe al ponerlo.
    const aviso = REPARTO_PREVISUALIZACION.excede("4499.65", "4500.35");
    const pintados = [...aviso.matchAll(new RegExp(PATRON_IMPORTE, "g"))].map((m) => m[0]);
    expect(pintados.length).toBe(2);
    laCuentaCierra(pintados, money("9000.00"), "etiqueta `excede`");
    expect(pintados[1]).toBe(money("4500.35"));
    expect(moneyTope("4500.35")).toBe(money("4500.35"));
  });

  it("topes de indemnización: el mensaje anuncia EXACTAMENTE lo que el validador acepta", () => {
    // El otro sitio donde `moneyTope` manda. Antes anunciaba `₡9.999.999.999`
    // —99 céntimos POR DEBAJO del límite y en contradicción con el «(10 dígitos y
    // 2 decimales)» de su propia frase—; ahora anuncia el límite.
    const anunciado = MONTO_EXCEDE.match(PATRON_IMPORTE);
    expect(anunciado, "el mensaje del tope dejó de nombrar la cifra").not.toBeNull();
    expect(centimosPintados(anunciado![0])).toBe(centimosDelServidor(INDEMNIZACION_MONTO_MAX));

    // Y la afirmación que de verdad importa: lo anunciado lo ACEPTA el validador.
    // Se recompone el money-safe DESDE LO PINTADO, deshaciendo el formato y nada más.
    const comoSeTeclearia = anunciado![0]
      .replace(monedaConfig.simbolo, "")
      .split(monedaConfig.separadorMiles)
      .join("")
      .replace(monedaConfig.separadorDecimal, ".");
    expect(comoSeTeclearia).toBe(INDEMNIZACION_MONTO_MAX);
    expect(montoValido(comoSeTeclearia, INDEMNIZACION_MONTO_MAX)).toBe(true);
  });

  it("CONTRAPRUEBA: si un tope se anunciara al alza, el validador lo rechazaría", () => {
    // La razón de ser de `moneyTope`, medida y no razonada.
    const alAlza = money("9999999999.99"); // el formateador normal, exacto a escala 2
    expect(moneyTope("9999999999.99")).toBe(alAlza); // hoy coinciden
    // Pero con un dato fuera de la escala se separan, y solo uno es seguro.
    expect(moneyTope("9999999999.999")).toBe(alAlza);
    expect(money("9999999999.999")).not.toBe(alAlza);
    expect(montoValido("10000000000.00", INDEMNIZACION_MONTO_MAX)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PARTE D — EL CENSO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Las TRECE pantallas del censo de la ficha 359, cada una con la identidad que
 * enseña. Si un archivo se mueve o se borra, este test cae en vez de dejar de
 * mirar en silencio; y si alguna dejara de pasar por el formateador compartido,
 * las partes B y C estarían probando una función que ya nadie llama.
 */
const CENSO: readonly { ruta: string; identidad: string }[] = [
  {
    ruta: "app/(app)/analitica/_components/financiero/PanelConciliacion.tsx",
    identidad: "snapshot − ledger = diferencia (y la alerta de descuadre)",
  },
  {
    ruta: "app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts",
    identidad: "imputable + sobrante = lo tecleado",
  },
  {
    ruta: "app/(app)/wallet/mensajeros/_components/RepartoPrevisualizacion.tsx",
    identidad: "pendiente hoy − se aplica = queda pendiente",
  },
  {
    ruta: "app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx",
    identidad: "devengado − pagado = cuenta por pagar",
  },
  { ruta: "app/(app)/wallet/_components/CajaResumenCard.tsx", identidad: "siete importes, tres identidades" },
  {
    ruta: "app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda.tsx",
    identidad: "las líneas suman el total",
  },
  {
    ruta: "app/(app)/mis-asignaciones/_components/AsignacionDetalle.tsx",
    identidad: "el monto a cobrar, el mismo que enseña el editor de pago",
  },
  {
    ruta: "components/shared/DesglosePagoField.tsx",
    identidad: "a cobrar − capturado = diferencia",
  },
  {
    ruta: "app/(app)/analitica/_components/entregas/DineroProductoDetalle.tsx",
    identidad: "recaudado = liquidado + pendiente",
  },
  {
    ruta: "app/(app)/cierres-admin/_components/cierre-factura.tsx",
    identidad: "efectivo + SINPE + transferencia = general",
  },
  {
    ruta: "app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx",
    identidad: "los seis sumandos del ingreso dan el total",
  },
  {
    ruta: "app/(app)/incidentes/_components/IncidentesAdminModule.tsx",
    identidad: "el tope anunciado es el que el validador acepta",
  },
  {
    ruta: "app/(app)/ordenes/_components/OrdenesConMontoAjustadoTabla.tsx",
    identidad: "el monto original y el aplicado, con su diferencia visible",
  },
];

/** Un uso del formateador compartido, por cualquiera de sus nombres. */
const USA_EL_FORMATEADOR =
  /\b(money|moneyTope|montoExacto|formatMonto|formatMontoString|formatearValor|PriceLabel|KpiValorAnimado)\b/;

/**
 * Los modulos que un fuente importa, resueltos a ruta de disco. UN SOLO SALTO, y
 * es suficiente a proposito: el patron de este repo es que la pantalla llame a su
 * archivo de etiquetas hermano y que sea ESE el que importa el formateador
 * (`RepartoPrevisualizacion` -> `wallet-mensajeros-labels`). Encadenar mas saltos
 * convertiria el censo en un resolvedor de modulos, que es codigo que se rompe
 * solo; un salto cubre el patron real y falla ruidosamente si aparece otro.
 */
function importadosPor(rutaRelativa: string): string[] {
  const fuente = readFileSync(path.join(RAIZ, rutaRelativa), "utf8");
  const carpeta = path.dirname(path.join(RAIZ, rutaRelativa));
  const destinos: string[] = [];
  for (const casa of fuente.matchAll(/from\s+["'](\.{1,2}\/[^"']+|@\/[^"']+)["']/g)) {
    const especificador = casa[1];
    const base = especificador.startsWith("@/")
      ? path.join(RAIZ, especificador.slice(2))
      : path.resolve(carpeta, especificador);
    for (const extension of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      if (existsSync(`${base}${extension}`)) {
        destinos.push(`${base}${extension}`);
        break;
      }
    }
  }
  return destinos;
}

describe("ficha 359 · D — el censo de las trece pantallas", () => {
  it("las trece existen, no se repiten y cada una declara su identidad", () => {
    expect(CENSO.length).toBe(13);
    expect(new Set(CENSO.map((c) => c.ruta)).size).toBe(13);
    for (const { ruta, identidad } of CENSO) {
      expect(existsSync(path.join(RAIZ, ruta)), `${ruta} no existe`).toBe(true);
      expect(identidad.length, `${ruta} está censada sin identidad`).toBeGreaterThan(15);
    }
  });

  it("las trece pintan su dinero con el formateador compartido, no con uno propio", () => {
    const sinFormateador: string[] = [];
    for (const { ruta } of CENSO) {
      const propio = USA_EL_FORMATEADOR.test(readFileSync(path.join(RAIZ, ruta), "utf8"));
      // Una pantalla puede delegar el texto en su archivo de etiquetas hermano:
      // ahi el formateador vive un salto mas alla, y eso es correcto.
      const prestado = importadosPor(ruta).some((destino) =>
        USA_EL_FORMATEADOR.test(readFileSync(destino, "utf8")),
      );
      if (!propio && !prestado) sinFormateador.push(ruta);
    }
    expect(
      sinFormateador,
      "una pantalla del censo dejó de pasar por `@/lib/config/moneda`",
    ).toEqual([]);
  });

  it("CONTRAPRUEBA: el detector no da por bueno a cualquiera", () => {
    // Sin esto, `USA_EL_FORMATEADOR` podria estar casando con cualquier fuente y
    // el barrido de arriba seria decorativo.
    expect(USA_EL_FORMATEADOR.test('const x = row.monto.toFixed(2);')).toBe(false);
    expect(USA_EL_FORMATEADOR.test('const x = money(row.monto);')).toBe(true);
    // Y un fuente REAL del repo que trabaja con dinero pero NO lo pinta tampoco
    // cuela: `pagos-recaudo` hace la aritmética en céntimos enteros y no formatea.
    const ajeno = "lib/utils/pagos-recaudo.ts";
    expect(existsSync(path.join(RAIZ, ajeno))).toBe(true);
    expect(USA_EL_FORMATEADOR.test(readFileSync(path.join(RAIZ, ajeno), "utf8"))).toBe(false);
  });

  it("y ninguna declara un formateador PROPIO: el sexto ya se retiró", () => {
    // La feature 300 escribió `montoExacto` dentro de `DesglosePagoField` porque
    // el formateador de entonces no servía para esa pantalla. Eso es exactamente
    // como se llega a trece contradicciones: una pantalla se arregla sola. Desde
    // la 359 el cuerpo vive en `lib/config/moneda.ts` y aquí solo se re-exporta.
    const desglose = readFileSync(
      path.join(RAIZ, "components/shared/DesglosePagoField.tsx"),
      "utf8",
    );
    expect(desglose).toContain("export { montoExacto }");
    expect(
      /function\s+montoExacto\s*\(/.test(desglose),
      "`montoExacto` volvió a tener cuerpo propio fuera del módulo de moneda",
    ).toBe(false);
  });
});

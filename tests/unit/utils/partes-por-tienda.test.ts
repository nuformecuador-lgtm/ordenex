import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import type { GestionResultado, MetodoPagoValue } from "@prisma/client";

import {
  partesPorTienda,
  pagoTiendaOrdenex,
  ganaLaTienda,
  totalesIngresoOrdenex,
  type GestionDeTienda,
} from "@/lib/utils/ingreso-ordenex";
import { computeTotales } from "@/lib/utils/cierre-totales";
import type { IngresoOrdenexDTO } from "@/lib/interfaces/services/ICierreDiaService";

/**
 * 💰 FICHA 396 (B2) — `partesPorTienda`: de quién es cada parte del «Pago a tienda».
 *
 * ⚠️ ESTO NO ES UN DEFECTO DE DINERO. `wallet_tienda_movimiento` lleva los movimientos separados
 * por tienda desde siempre, con sus propias cifras: a nadie se le paga mal. Lo que faltaba era
 * DECIR de quién es cada parte del total agregado que la pantalla enseñaba en singular.
 *
 * ─── CÓMO ESTÁN ESCRITOS ESTOS TESTS, Y POR QUÉ IMPORTA ───────────────────────────────────
 *
 * **Todos los importes esperados son LITERALES escritos a mano.** Ninguno sale de llamar a la
 * función que se está probando, ni de re-derivarlo con las mismas funciones que usa la
 * implementación. En este repo ya se midió que una aserción contra su propia fuente está
 * siempre verde y deja pasar el fallo entero.
 *
 * Y donde se comprueba una IDENTIDAD (la suma de las partes contra el agregado), **los dos
 * lados se anclan al MISMO literal**: se afirma que la suma de las partes vale `X`, y por
 * separado que el agregado —derivado con las funciones de producción sobre TODAS las
 * gestiones— también vale `X`. Así ninguno de los dos lados se compara consigo mismo, y si
 * cualquiera de los dos se mueve, el test se entera.
 *
 * Las sumas de los importes de los tests van con `Prisma.Decimal`, nunca con `Number`.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures — todo literal, ni una cifra derivada                              */
/* -------------------------------------------------------------------------- */

/** Suma money-safe de los importes de un test. Nunca `Number(` sobre dinero, tampoco aquí. */
function suma(montos: readonly string[]): string {
  return montos
    .reduce((acc, m) => acc.plus(new Prisma.Decimal(m)), new Prisma.Decimal(0))
    .toFixed(2);
}

/** Resta money-safe, para la CUARTA identidad. */
function resta(a: string, b: string): string {
  return new Prisma.Decimal(a).minus(b).toFixed(2);
}

/**
 * El desglose congelado de UNA gestión, con TODOS sus campos escritos a mano —incluidos los
 * agrupados `fleteConIva`/`comisionConIva`/`fleteDevolucionConIva` y el `total`—.
 *
 * Se escriben y no se calculan a propósito: es exactamente lo que hace el repositorio real
 * (`CierresAdminRepository.toIngresoOrdenex` los compone al leer el snapshot), y así el test
 * afirma contra el CONTRATO y no contra la aritmética de nadie.
 */
function ingreso(campos: {
  flete?: string;
  ivaFlete?: string;
  fleteConIva?: string;
  comisionCod?: string;
  ivaComisionCod?: string;
  comisionConIva?: string;
  fleteDevolucion?: string;
  ivaFleteDevolucion?: string;
  fleteDevolucionConIva?: string;
  total: string;
}): IngresoOrdenexDTO {
  return {
    montoCobrar: null,
    cobraComision: true,
    esCentral: false,
    esZonaEspecial: false,
    fleteOrigen: "normal",
    fleteDevolucionOrigen: "normal",
    flete: campos.flete ?? null,
    ivaFlete: campos.ivaFlete ?? null,
    fleteDevolucion: campos.fleteDevolucion ?? null,
    ivaFleteDevolucion: campos.ivaFleteDevolucion ?? null,
    comisionCod: campos.comisionCod ?? null,
    ivaComisionCod: campos.ivaComisionCod ?? null,
    fleteConIva: campos.fleteConIva ?? null,
    fleteDevolucionConIva: campos.fleteDevolucionConIva ?? null,
    comisionConIva: campos.comisionConIva ?? null,
    total: campos.total,
    tarifa: null,
  };
}

function gestion(
  tiendaId: string,
  tiendaNombre: string,
  resultado: GestionResultado,
  pagos: { metodo: MetodoPagoValue; monto: string }[],
  ingresoOrdenex: IngresoOrdenexDTO | null,
): GestionDeTienda {
  return { tiendaId, tiendaNombre, resultado, pagos, ingresoOrdenex };
}

/* -------------------------------------------------------------------------- */
/* EL CIERRE DE DOS TIENDAS — el caso que da nombre a la ficha                 */
/* -------------------------------------------------------------------------- */

/**
 * Un cierre de UN mensajero con órdenes de DOS tiendas. Está construido a propósito para que
 * **una tenga rechazos y la otra no**: si las dos tuvieran flete por rechazo cero, la CUARTA
 * identidad daría `0.00 === 0.00` en las dos y el test pasaría sin comprobar nada.
 *
 *  · Tienda Norte — una entrega de 100.000,00 y UN RECHAZO (flete de devolución 1.500 + IVA 195)
 *  · Tienda Sur   — una entrega de  40.000,00 y NINGÚN rechazo
 */
const NORTE_ENTREGA = gestion(
  "t-norte",
  "Tienda Norte",
  "entregada",
  [{ metodo: "efectivo", monto: "100000.00" }],
  ingreso({
    flete: "2500.00",
    ivaFlete: "325.00",
    fleteConIva: "2825.00",
    comisionCod: "3000.00",
    ivaComisionCod: "390.00",
    comisionConIva: "3390.00",
    total: "6215.00",
  }),
);

const NORTE_RECHAZO = gestion(
  "t-norte",
  "Tienda Norte",
  "rechazada",
  [],
  ingreso({
    fleteDevolucion: "1500.00",
    ivaFleteDevolucion: "195.00",
    fleteDevolucionConIva: "1695.00",
    total: "1695.00",
  }),
);

const SUR_ENTREGA = gestion(
  "t-sur",
  "Tienda Sur",
  "entregada",
  [{ metodo: "SINPE", monto: "40000.00" }],
  ingreso({
    flete: "2000.00",
    ivaFlete: "260.00",
    fleteConIva: "2260.00",
    comisionCod: "1200.00",
    ivaComisionCod: "156.00",
    comisionConIva: "1356.00",
    total: "3616.00",
  }),
);

const CIERRE_DOS_TIENDAS = [NORTE_ENTREGA, NORTE_RECHAZO, SUR_ENTREGA];

/**
 * Las SEIS cifras del cierre de arriba, escritas a mano una a una. Este bloque ES EL CONTRATO:
 * si alguien lo sustituyera por la salida de `partesPorTienda`, todos los tests de abajo
 * quedarían siempre verdes y no comprobarían nada.
 *
 *   Norte · recaudado 100.000,00
 *           pagoTienda    100.000,00 − 2.825,00 − 3.390,00 = 93.785,00
 *           ganaLaTienda  100.000,00 − (6.215,00 + 1.695,00) = 92.090,00
 *   Sur   · recaudado  40.000,00
 *           pagoTienda     40.000,00 − 2.260,00 − 1.356,00 = 36.384,00
 *           ganaLaTienda   40.000,00 − 3.616,00 = 36.384,00
 */
const NORTE_RECAUDADO = "100000.00";
const NORTE_PAGO = "93785.00";
const NORTE_GANA = "92090.00";
const NORTE_FLETE_RECHAZO_CON_IVA = "1695.00";

const SUR_RECAUDADO = "40000.00";
const SUR_PAGO = "36384.00";
const SUR_GANA = "36384.00";
const SUR_FLETE_RECHAZO_CON_IVA = "0.00";

/** Y los agregados del MISMO cierre, también a mano. */
const AGREGADO_RECAUDADO = "140000.00"; // 100.000,00 + 40.000,00
const AGREGADO_PAGO = "130169.00"; // 140.000,00 − 5.085,00 − 4.746,00
const AGREGADO_GANA = "128474.00"; // 140.000,00 − 11.526,00

/* -------------------------------------------------------------------------- */

describe("396/R4 — dos tiendas, sus TRES cifras cada una", () => {
  it("emite una parte por tienda con recaudado, pagoTienda y ganaLaTienda", () => {
    const partes = partesPorTienda(CIERRE_DOS_TIENDAS);

    expect(partes).toHaveLength(2);
    expect(partes).toEqual([
      {
        tiendaId: "t-norte",
        tiendaNombre: "Tienda Norte",
        recaudado: NORTE_RECAUDADO,
        pagoTienda: NORTE_PAGO,
        ganaLaTienda: NORTE_GANA,
      },
      {
        tiendaId: "t-sur",
        tiendaNombre: "Tienda Sur",
        recaudado: SUR_RECAUDADO,
        pagoTienda: SUR_PAGO,
        ganaLaTienda: SUR_GANA,
      },
    ]);
  });

  it("R7: la CLAVE es el id y el nombre sólo se muestra — dos tiendas HOMÓNIMAS no se funden", () => {
    // Es el escenario que hace inaceptable agrupar por nombre: dos tiendas distintas que se
    // llaman igual. Con agrupamiento por nombre saldría UNA fila de 140.000,00 y el dinero de
    // una estaría atribuido a la otra en pantalla.
    const homonimas = [
      { ...NORTE_ENTREGA, tiendaNombre: "Distribuidora Central" },
      { ...NORTE_RECHAZO, tiendaNombre: "Distribuidora Central" },
      { ...SUR_ENTREGA, tiendaNombre: "Distribuidora Central" },
    ];
    const partes = partesPorTienda(homonimas);

    expect(partes).toHaveLength(2);
    expect(partes.map((p) => p.tiendaId)).toEqual(["t-norte", "t-sur"]);
    expect(partes.map((p) => p.recaudado)).toEqual([NORTE_RECAUDADO, SUR_RECAUDADO]);
  });

  it("con UNA sola tienda hay UNA parte, y sus tres cifras son las agregadas", () => {
    // El campo se emite SIEMPRE, también aquí: el umbral de «sólo con dos o más» es de
    // PRESENTACIÓN y vive en la pantalla, no en el contrato.
    const partes = partesPorTienda([SUR_ENTREGA]);

    expect(partes).toHaveLength(1);
    expect(partes[0]).toEqual({
      tiendaId: "t-sur",
      tiendaNombre: "Tienda Sur",
      recaudado: SUR_RECAUDADO,
      pagoTienda: SUR_PAGO,
      ganaLaTienda: SUR_GANA,
    });
  });
});

describe("396/R10 — la suma de lo que se paga a cada tienda ES el agregado", () => {
  it("Σ pagoTienda === el «Pago a tienda» del cierre entero, al céntimo", () => {
    const partes = partesPorTienda(CIERRE_DOS_TIENDAS);

    // (1) La suma de las partes, contra el literal.
    expect(suma(partes.map((p) => p.pagoTienda))).toBe(AGREGADO_PAGO);

    // (2) Y el AGREGADO —derivado como lo deriva el servicio, sobre TODAS las gestiones—
    //     contra el MISMO literal. Los dos lados anclados a la misma cifra escrita a mano: si
    //     cualquiera de los dos se mueve, esto se entera.
    const todas = totalesIngresoOrdenex(CIERRE_DOS_TIENDAS);
    const agregado = pagoTiendaOrdenex(
      computeTotales(CIERRE_DOS_TIENDAS).general,
      todas.fleteConIva,
      todas.comisionConIva,
    );
    expect(agregado).toBe(AGREGADO_PAGO);
  });
});

describe("396/R11 — la suma de lo que gana cada tienda ES el agregado", () => {
  it("Σ ganaLaTienda === «lo que gana la tienda» del cierre entero, al céntimo", () => {
    const partes = partesPorTienda(CIERRE_DOS_TIENDAS);

    expect(suma(partes.map((p) => p.ganaLaTienda))).toBe(AGREGADO_GANA);

    const todas = totalesIngresoOrdenex(CIERRE_DOS_TIENDAS);
    const agregado = ganaLaTienda(computeTotales(CIERRE_DOS_TIENDAS).general, todas.total);
    expect(agregado).toBe(AGREGADO_GANA);
  });
});

describe("396/R12 — la suma de lo recaudado por tienda ES el total general", () => {
  it("Σ recaudado === total general del cierre, al céntimo", () => {
    const partes = partesPorTienda(CIERRE_DOS_TIENDAS);

    expect(suma(partes.map((p) => p.recaudado))).toBe(AGREGADO_RECAUDADO);
    expect(computeTotales(CIERRE_DOS_TIENDAS).general).toBe(AGREGADO_RECAUDADO);
  });
});

describe("396 — LA CUARTA IDENTIDAD, por tienda: pagoTienda − ganaLaTienda === su flete por rechazo", () => {
  /**
   * ⚠️ ES LA QUE MÁS PROTEGE. Hace imposible derivar una de las dos cifras de pago con el
   * subconjunto equivocado sin que se note: si `ganaLaTienda` de una tienda saliera del `total`
   * AGREGADO en vez del suyo, esta resta dejaría de dar su flete por rechazo.
   *
   * Y necesita **una tienda con rechazos y otra sin ellos**: si las dos dieran cero, el test
   * pasaría sin comprobar nada. Por eso el fixture es el que es.
   */
  it("Norte, que SÍ tuvo un rechazo, difiere en exactamente 1.695,00", () => {
    const partes = partesPorTienda(CIERRE_DOS_TIENDAS);
    const norte = partes.find((p) => p.tiendaId === "t-norte");

    expect(norte).toBeDefined();
    expect(resta(norte!.pagoTienda, norte!.ganaLaTienda)).toBe(NORTE_FLETE_RECHAZO_CON_IVA);
    // Y no es cero: el control que impide que este test pase por vacío.
    expect(NORTE_FLETE_RECHAZO_CON_IVA).not.toBe("0.00");
  });

  it("Sur, que NO tuvo rechazos, no difiere: las dos cifras coinciden", () => {
    const partes = partesPorTienda(CIERRE_DOS_TIENDAS);
    const sur = partes.find((p) => p.tiendaId === "t-sur");

    expect(sur).toBeDefined();
    expect(resta(sur!.pagoTienda, sur!.ganaLaTienda)).toBe(SUR_FLETE_RECHAZO_CON_IVA);
    expect(sur!.pagoTienda).toBe(sur!.ganaLaTienda);
  });
});

describe("396/R13 — lo recaudado por tienda usa EL MISMO criterio que el total general", () => {
  it("una gestión NO entregada con líneas de pago no aporta al recaudado de su tienda", () => {
    // Una reprogramada con un abono de 5.000,00: recaudo que existe como hecho de la gestión,
    // pero que NO entra en el `total_general` del cierre (`computeTotales` sólo suma las
    // `entregada`). Si el desglose lo contara, R12 dejaría de dar.
    const abonoEnReprogramada = gestion(
      "t-sur",
      "Tienda Sur",
      "reprogramada",
      [{ metodo: "efectivo", monto: "5000.00" }],
      null,
    );
    const partes = partesPorTienda([SUR_ENTREGA, abonoEnReprogramada]);

    expect(partes).toHaveLength(1);
    expect(partes[0].recaudado).toBe(SUR_RECAUDADO); // 40.000,00, no 45.000,00
    expect(partes[0].pagoTienda).toBe(SUR_PAGO);
    expect(computeTotales([SUR_ENTREGA, abonoEnReprogramada]).general).toBe(SUR_RECAUDADO);
  });
});

describe("396/R9 — la tienda que sólo trajo RECHAZOS entra igual, y cuenta", () => {
  /**
   * No recaudó nada y aun así se le factura el flete por rechazo. Es justo el caso donde el
   * desglose informa de algo que el agregado tapaba.
   */
  const ESTE_SOLO_RECHAZO = gestion(
    "t-este",
    "Tienda Este",
    "rechazada",
    [],
    ingreso({
      fleteDevolucion: "1000.00",
      ivaFleteDevolucion: "130.00",
      fleteDevolucionConIva: "1130.00",
      total: "1130.00",
    }),
  );

  it("aparece con recaudado 0,00, pagoTienda 0,00 y ganaLaTienda NEGATIVO con su signo", () => {
    const partes = partesPorTienda([SUR_ENTREGA, ESTE_SOLO_RECHAZO]);
    const este = partes.find((p) => p.tiendaId === "t-este");

    expect(este).toEqual({
      tiendaId: "t-este",
      tiendaNombre: "Tienda Este",
      recaudado: "0.00",
      pagoTienda: "0.00",
      ganaLaTienda: "-1130.00",
    });
  });

  it("CUENTA para el cardinal de tiendas del cierre (es lo que dispara el umbral en pantalla)", () => {
    const partes = partesPorTienda([SUR_ENTREGA, ESTE_SOLO_RECHAZO]);
    expect(partes).toHaveLength(2);
  });

  it("y su CUARTA identidad se ve a simple vista: 0,00 − (−1.130,00) = 1.130,00", () => {
    const partes = partesPorTienda([SUR_ENTREGA, ESTE_SOLO_RECHAZO]);
    const este = partes.find((p) => p.tiendaId === "t-este")!;
    expect(resta(este.pagoTienda, este.ganaLaTienda)).toBe("1130.00");
  });
});

describe("396/R8 — el orden lo fija el servidor: pagoTienda DESCENDENTE", () => {
  /**
   * Sin desglose congelado (`ingresoOrdenex: null`) el flete y la comisión son cero, así que
   * `pagoTienda` es exactamente lo recaudado. Eso deja el orden a la vista, sin aritmética que
   * distraiga.
   */
  function soloRecaudo(tiendaId: string, tiendaNombre: string, monto: string): GestionDeTienda {
    return gestion(tiendaId, tiendaNombre, "entregada", [{ metodo: "efectivo", monto }], null);
  }

  it("100 / 300 / 200 salen 300, 200, 100", () => {
    const partes = partesPorTienda([
      soloRecaudo("t-a", "Alfa", "100.00"),
      soloRecaudo("t-b", "Beta", "300.00"),
      soloRecaudo("t-c", "Gama", "200.00"),
    ]);

    expect(partes.map((p) => p.pagoTienda)).toEqual(["300.00", "200.00", "100.00"]);
    expect(partes.map((p) => p.tiendaId)).toEqual(["t-b", "t-c", "t-a"]);
  });

  it("a igual importe manda el NOMBRE ascendente (desempate declarado)", () => {
    const partes = partesPorTienda([
      soloRecaudo("t-z", "Zeta", "500.00"),
      soloRecaudo("t-a", "Alfa", "500.00"),
    ]);
    expect(partes.map((p) => p.tiendaNombre)).toEqual(["Alfa", "Zeta"]);
  });

  it("a igual importe Y mismo nombre manda el ID ascendente, que cierra el orden total", () => {
    const partes = partesPorTienda([
      soloRecaudo("t-9", "Repetida", "500.00"),
      soloRecaudo("t-1", "Repetida", "500.00"),
    ]);
    expect(partes.map((p) => p.tiendaId)).toEqual(["t-1", "t-9"]);
  });

  it("el orden es el mismo aunque las gestiones lleguen al revés (no depende de la entrada)", () => {
    const alDerecho = partesPorTienda([
      soloRecaudo("t-a", "Alfa", "100.00"),
      soloRecaudo("t-b", "Beta", "300.00"),
    ]);
    const alReves = partesPorTienda([
      soloRecaudo("t-b", "Beta", "300.00"),
      soloRecaudo("t-a", "Alfa", "100.00"),
    ]);
    expect(alDerecho).toEqual(alReves);
  });
});

describe("396/R5 y R16 — TRES cifras por tienda, y ni una más", () => {
  it("cada parte tiene EXACTAMENTE cinco claves", () => {
    const partes = partesPorTienda(CIERRE_DOS_TIENDAS);
    for (const parte of partes) {
      expect(Object.keys(parte).sort()).toEqual([
        "ganaLaTienda",
        "pagoTienda",
        "recaudado",
        "tiendaId",
        "tiendaNombre",
      ]);
    }
  });

  it("no se filtran `fleteConIva` ni `comisionConIva`, que se calculan dentro pero no se emiten", () => {
    for (const parte of partesPorTienda(CIERRE_DOS_TIENDAS)) {
      expect(parte).not.toHaveProperty("fleteConIva");
      expect(parte).not.toHaveProperty("comisionConIva");
      expect(parte).not.toHaveProperty("fleteDevolucionConIva");
      expect(parte).not.toHaveProperty("total");
    }
  });

  it("R16: no reparte el pago al mensajero ni el ingreso de bodega — no tiene esas claves", () => {
    for (const parte of partesPorTienda(CIERRE_DOS_TIENDAS)) {
      expect(parte).not.toHaveProperty("pagoMensajero");
      expect(parte).not.toHaveProperty("ingresoBodegaRechazo");
    }
  });
});

describe("396/R14 — money-safe: todo STRING de escala 2, con su signo", () => {
  it("las tres cifras de cada parte son cadenas con exactamente dos decimales", () => {
    const partes = partesPorTienda([...CIERRE_DOS_TIENDAS]);
    for (const parte of partes) {
      for (const cifra of [parte.recaudado, parte.pagoTienda, parte.ganaLaTienda]) {
        expect(typeof cifra).toBe("string");
        expect(cifra).toMatch(/^-?\d+\.\d{2}$/);
      }
    }
  });
});

describe("396 — la gestión SIN tarifa congelada (gap conocido de la feature 69) no rompe", () => {
  it("su tienda aparece con los conceptos en cero, no ausente", () => {
    const sinTarifa = gestion(
      "t-hueco",
      "Tienda Sin Tarifa",
      "entregada",
      [{ metodo: "transferencia", monto: "7000.00" }],
      null, // `ingresoOrdenex: null` = no había tarifa vigente al solicitar
    );
    const partes = partesPorTienda([SUR_ENTREGA, sinTarifa]);
    const hueco = partes.find((p) => p.tiendaId === "t-hueco");

    expect(hueco).toEqual({
      tiendaId: "t-hueco",
      tiendaNombre: "Tienda Sin Tarifa",
      recaudado: "7000.00",
      // Sin conceptos derivados no hay nada que descontar: se le paga todo lo recaudado, y las
      // dos cifras coinciden porque tampoco hay flete por rechazo.
      pagoTienda: "7000.00",
      ganaLaTienda: "7000.00",
    });
  });
});

describe("396 — un cierre sin gestiones no inventa filas", () => {
  it("devuelve la lista vacía", () => {
    expect(partesPorTienda([])).toEqual([]);
  });
});

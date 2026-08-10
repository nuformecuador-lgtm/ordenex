import { describe, expect, it } from "vitest";

import { monedaConfig } from "@/lib/config/moneda";
import {
  IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA,
  IDS_FINANCIERAS_SERVIDAS,
  VISTA_COD_RECAUDADO_POR_METODO,
  VISTA_COD_RECAUDADO_POR_TIENDA,
  type FilaFinanciera,
  type GranularidadVista,
  type ResultadoFinanciero,
  type VistaFinanciera,
} from "@/lib/types/analitica-financiera";
import { armarServicio, consultaDe } from "../services/_dobles-analitica-financiera";

// Feature 180 (T3.1) — EL CONTRATO DE LA GRANULARIDAD Y LA REGRESION QUE LO PROTEGE.
//
// Este archivo cubre R4 (toda vista declara su grano TEMPORAL, y el campo es OBLIGATORIO),
// R5 (la vista por fecha no gana ninguna dimension) y R3 (las metricas que quedan FUERA del
// conjunto con desglose publican hoy exactamente el DTO que la 127 publica, salvo el campo
// nuevo).
//
// QUE **NO** SE PRUEBA AQUI, y no es un olvido: las filas por fecha. En esta tanda las tres
// vistas de grano `fecha` siguen publicando `filas: []` — lo que se esta fijando es el
// CONTRATO y la red que impide que la tanda siguiente lo rompa por el camino. Los R1/R6-R15
// (la serie de verdad) llegan con ella.
//
// LOS ESPERADOS SE ESCRIBEN A MANO — mismo patron que `FORMA_ESPERADA` en
// `financiera-forma-importe.guardia.test.ts` y que el mapa de R43 en
// `financiera-contratos.test.ts`. Derivar el esperado de lo que se juzga (por ejemplo, sacar la
// granularidad esperada de `granularidadDe(consulta.rango)`, que es la funcion que el servicio
// llama) convertiria cada caso en una tautologia: cambiar el umbral, o llamar a la funcion en
// una vista que no es temporal, seguiria pareciendo correcto.
//
// LO UNICO QUE NO SE ESCRIBE A MANO es la MONEDA: sale de `lib/config/moneda.ts` (S2/R29 de la
// 127), y escribir "CRC" aqui abriria un segundo sitio donde el codigo ISO vive.

const MONEDA = monedaConfig.currency;

/* -------------------------------------------------------------------------- */
/* 1. El juego de datos FIJO                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Un libro pequeno y COMPLETO: las cinco fuentes traen material, asi que ninguna vista sale
 * vacia por accidente y el censo de claves de R5 mira filas de verdad.
 *
 * Las filas de caja son COHERENTES con el CHECK `categoria ↔ tipo` de la 173 a proposito
 * (`design.md` §7 de la 180 avisa de los dos dobles heredados que las cruzan): copiar aquel
 * cruce aqui seria copiar el problema.
 */
const DATOS = {
  caja: [
    { categoria: "ingreso_flete" as const, tipo: "ingreso" as const, suma: "1000.00" },
    { categoria: "egreso_gasto" as const, tipo: "egreso" as const, suma: "400.00" },
  ],
  porMetodo: [
    { metodo: "efectivo" as const, suma: "300.00" },
    { metodo: "simpe" as const, suma: "100.00" },
  ],
  porTienda: [
    { tiendaId: "t-1", tipo: "credito" as const, suma: "300.00" },
    { tiendaId: "t-1", tipo: "debito" as const, suma: "40.00" },
    { tiendaId: "t-2", tipo: "credito" as const, suma: "100.00" },
  ],
  saldoTiendas: [
    { tiendaId: "t-1", tipo: "credito" as const, suma: "800.00" },
    { tiendaId: "t-1", tipo: "debito" as const, suma: "300.00" },
    { tiendaId: "t-2", tipo: "credito" as const, suma: "100.00" },
  ],
  cuentaMensajeros: [
    { tipo: "devengo" as const, suma: "5000.00" },
    { tipo: "pago" as const, suma: "2000.00" },
  ],
  porEstado: [
    {
      nivel: "cierre_dia" as const,
      estado: "aprobado" as const,
      cantidad: 2,
      totales: {
        efectivo: "300.00",
        simpe: "100.00",
        transferencia: "0.00",
        general: "400.00",
      },
      fechadoPor: "resuelto_at" as const,
    },
    {
      nivel: "cierre_bodega" as const,
      estado: "solicitado" as const,
      cantidad: 1,
      totales: {
        efectivo: "0.00",
        simpe: "0.00",
        transferencia: "50.00",
        general: "50.00",
      },
      fechadoPor: "solicitado_at" as const,
    },
  ],
  snapshots: [{ cierreId: "c-1", totalGeneral: "400.00" }],
  ledger: [
    {
      ledger: "wallet_tienda_movimiento" as const,
      cierreId: "c-1",
      tipo: "credito" as const,
      suma: "400.00",
    },
  ],
};

/** Un rango CORTO (preset `dia`, un solo dia CR): cabe de sobra bajo el tope de puntos. */
const RANGO_CORTO = { rango: "dia" };

/**
 * Un rango LARGO: 181 dias calendario, muy por encima del tope de puntos del servidor. Se
 * escribe como fechas fijas y no como «hoy menos N» para que el caso no dependa del reloj
 * (R26): el doble ya fija `AHORA`, pero un rango relativo ataria el numero de dias al preset.
 */
const RANGO_LARGO = { rango: "personalizado", desde: "2026-01-01", hasta: "2026-06-30" };

async function resultadoDe(metricaId: string, raw: unknown): Promise<ResultadoFinanciero> {
  const { servicio } = armarServicio(DATOS);
  const r = await servicio.consultar(consultaDe(metricaId, raw));
  if (r.status !== "ok") throw new Error(`${metricaId} no devolvio ok: ${r.status}`);
  return r.datos;
}

async function vistasDe(metricaId: string, raw: unknown): Promise<readonly VistaFinanciera[]> {
  const datos = await resultadoDe(metricaId, raw);
  return datos.tipo === "vistas" ? datos.vistas : [];
}

/** Todas las vistas que las DIEZ metricas servidas emiten, en el orden en que las emiten. */
async function todasLasVistas(raw: unknown): Promise<readonly VistaFinanciera[]> {
  const vistas: VistaFinanciera[] = [];
  for (const id of IDS_FINANCIERAS_SERVIDAS) {
    vistas.push(...(await vistasDe(id, raw)));
  }
  return vistas;
}

/* -------------------------------------------------------------------------- */
/* 2. R4 — el mapa `vistaId → granularidad`, escrito                            */
/* -------------------------------------------------------------------------- */

/**
 * LA GRANULARIDAD QUE CADA VISTA SERVIDA TIENE QUE DECLARAR con un rango CORTO.
 *
 * Son ONCE vistas y no diez: `cod_recaudado` publica DOS ⟨D6⟩ R38. `conciliacion_cierres` no
 * aparece porque no publica vistas (conteos + cuadre, `tipo: "conciliacion"`), y se marca
 * aparte en el caso de cobertura en vez de inventarle una entrada.
 *
 * `no_temporal` es EXPLICITO y no una omision: el cubo de esas tres vistas es la tienda o el
 * metodo de pago. Es la respuesta honesta «esta vista no se mide en el tiempo», que no es lo
 * mismo que «no se sabe» (⟨D2⟩).
 */
const GRANULARIDAD_ESPERADA_RANGO_CORTO: Readonly<Record<string, GranularidadVista>> = {
  // Las SEIS de caja: grano `fecha`, y con un rango de un dia el servidor sirve grano diario.
  ingreso_flete: "dia",
  ingreso_comision_cod: "dia",
  ingreso_iva: "dia",
  egresos: "dia",
  dinero_en_caja: "dia",
  ganancia_ordenex: "dia",
  // La septima del conjunto con desglose.
  cuenta_por_pagar_mensajero: "dia",
  // Las tres que NO se miden en el tiempo (Q1 = (a) las deja fuera del conjunto).
  [VISTA_COD_RECAUDADO_POR_METODO]: "no_temporal",
  [VISTA_COD_RECAUDADO_POR_TIENDA]: "no_temporal",
  cuenta_por_pagar_tienda: "no_temporal",
};

/**
 * Lo mismo con un rango LARGO (181 dias). Solo cambian las temporales, que pasan a `semana`
 * (R18): las `no_temporal` NO se mueven con el rango, y esa es justamente la mitad del caso
 * que se perderia derivando el esperado de `granularidadDe(rango)`.
 */
const GRANULARIDAD_ESPERADA_RANGO_LARGO: Readonly<Record<string, GranularidadVista>> = {
  ingreso_flete: "semana",
  ingreso_comision_cod: "semana",
  ingreso_iva: "semana",
  egresos: "semana",
  dinero_en_caja: "semana",
  ganancia_ordenex: "semana",
  cuenta_por_pagar_mensajero: "semana",
  [VISTA_COD_RECAUDADO_POR_METODO]: "no_temporal",
  [VISTA_COD_RECAUDADO_POR_TIENDA]: "no_temporal",
  cuenta_por_pagar_tienda: "no_temporal",
};

/** El dominio cerrado del campo, escrito: un valor nuevo tiene que pasar por aqui. */
const GRANULARIDADES: readonly GranularidadVista[] = ["dia", "semana", "no_temporal"];

describe("R4 · toda vista declara su granularidad temporal, y es la escrita", () => {
  it("R4 · el mapa esperado cubre las ONCE vistas servidas, sin sobrar ni faltar ninguna", async () => {
    // Sin este caso, borrar una entrada del mapa dejaria una vista sin vigilar y los dos casos
    // de abajo pasarian por no haberla mirado.
    const ids = (await todasLasVistas(RANGO_CORTO)).map((v) => v.id);
    expect([...ids].sort()).toEqual(Object.keys(GRANULARIDAD_ESPERADA_RANGO_CORTO).sort());
    expect(Object.keys(GRANULARIDAD_ESPERADA_RANGO_LARGO).sort()).toEqual([...ids].sort());
    expect(ids).toHaveLength(10);
    // Y la unica servida que no aporta vistas es la conciliacion, no otra.
    const sinVistas: string[] = [];
    for (const id of IDS_FINANCIERAS_SERVIDAS) {
      if ((await vistasDe(id, RANGO_CORTO)).length === 0) sinVistas.push(id);
    }
    expect(sinVistas).toEqual(["conciliacion_cierres"]);
  });

  it("R4 · con un rango corto, cada vista declara EXACTAMENTE la granularidad escrita", async () => {
    const obtenido: Record<string, GranularidadVista> = {};
    for (const vista of await todasLasVistas(RANGO_CORTO)) obtenido[vista.id] = vista.granularidad;
    expect(obtenido).toEqual(GRANULARIDAD_ESPERADA_RANGO_CORTO);
  });

  it("R4 · con un rango largo, solo las TEMPORALES pasan a semana", async () => {
    const obtenido: Record<string, GranularidadVista> = {};
    for (const vista of await todasLasVistas(RANGO_LARGO)) obtenido[vista.id] = vista.granularidad;
    expect(obtenido).toEqual(GRANULARIDAD_ESPERADA_RANGO_LARGO);
  });

  it("R4 · el campo esta PRESENTE y con valor del dominio en todas: ni ausente ni undefined", async () => {
    // El caso de arriba compara por `toEqual`, que ignora la diferencia entre «la clave no
    // esta» y «la clave vale undefined» cuando el esperado tampoco la tiene. Este no: mira la
    // clave propia y el valor, para que borrar el campo de un productor muera aqui con nombre.
    for (const raw of [RANGO_CORTO, RANGO_LARGO]) {
      for (const vista of await todasLasVistas(raw)) {
        expect(
          Object.prototype.hasOwnProperty.call(vista, "granularidad"),
          `${vista.id} no declara granularidad`,
        ).toBe(true);
        expect(vista.granularidad, `${vista.id} declara granularidad undefined`).not.toBeUndefined();
        expect(GRANULARIDADES, `${vista.id} declara una granularidad fuera del dominio`).toContain(
          vista.granularidad,
        );
      }
    }
  });

  it("R4 · las vistas del conjunto CON desglose declaran una granularidad temporal, nunca no_temporal", async () => {
    // La otra direccion del mapa: una vista de una metrica con desglose que declarase
    // `no_temporal` publicaria una serie sin decir con que grano esta agregada.
    for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
      for (const vista of await vistasDe(id, RANGO_CORTO)) {
        expect(vista.grano, `${id} dejo de declarar grano fecha`).toBe("fecha");
        expect(vista.granularidad, `${id} publica serie sin declarar su grano temporal`).not.toBe(
          "no_temporal",
        );
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 3. R4 a nivel de TIPO: el campo es REQUERIDO, no opcional                   */
/* -------------------------------------------------------------------------- */

describe("R4 · `granularidad` es requerido en el TIPO, no opcional", () => {
  it("R4 · una VistaFinanciera sin granularidad NO compila", () => {
    // ESTE CASO SE JUZGA EN `pnpm run typecheck`, no en tiempo de ejecucion. Si alguien
    // declarase `granularidad?: GranularidadVista`, el literal de abajo pasaria a ser valido,
    // el `@ts-expect-error` se quedaria SIN error que suprimir y **el typecheck fallaria**
    // (TS2578: "Unused '@ts-expect-error' directive"). Es la unica forma de convertir «alguien
    // hizo el campo opcional» en un rojo, porque en runtime un campo opcional omitido es
    // indistinguible de uno olvidado.
    //
    // El literal es valido en TODO lo demas a proposito: si le faltara tambien `fuente`, el
    // `@ts-expect-error` seguiria teniendo algo que suprimir aunque el campo fuera opcional, y
    // el caso quedaria muerto sin avisar.
    // @ts-expect-error — R4: falta `granularidad`, que es OBLIGATORIO.
    const sinGranularidad: VistaFinanciera = {
      id: "sintetica",
      grano: "fecha",
      fuente: "wallet_movimiento",
      sumableCon: [],
      filas: [],
      total: { forma: "solo_bruto", bruto: "0.00", moneda: MONEDA },
    };

    // Contrapeso: el MISMO literal CON el campo si compila, sin supresion ninguna. Sin esto,
    // un error de tipo cualquiera (un campo renombrado, un grano invalido) mantendria vivo el
    // `@ts-expect-error` de arriba por la razon equivocada.
    const conGranularidad: VistaFinanciera = {
      id: "sintetica",
      grano: "fecha",
      fuente: "wallet_movimiento",
      sumableCon: [],
      filas: [],
      granularidad: "dia",
      total: { forma: "solo_bruto", bruto: "0.00", moneda: MONEDA },
    };

    expect(sinGranularidad.id).toBe("sintetica");
    expect(conGranularidad.granularidad).toBe("dia");
  });
});

/* -------------------------------------------------------------------------- */
/* 4. R5 — la vista por fecha no gana NINGUNA dimension                        */
/* -------------------------------------------------------------------------- */

/** Las UNICAS dos claves que una fila del cubo publica. Escritas. */
const CLAVES_DE_FILA: readonly string[] = ["cubo", "importe"];

/** Censo de claves propias de una fila, ordenado para comparar sin depender del orden. */
function clavesDe(fila: FilaFinanciera): string[] {
  return Object.keys(fila).sort();
}

describe("R5 · cada fila corresponde a un cubo y a ninguna otra coordenada", () => {
  it("R5 · toda fila emitida tiene EXACTAMENTE las claves cubo e importe", async () => {
    let filasVistas = 0;
    for (const raw of [RANGO_CORTO, RANGO_LARGO]) {
      for (const vista of await todasLasVistas(raw)) {
        for (const fila of vista.filas) {
          filasVistas += 1;
          expect(
            clavesDe(fila),
            `${vista.id}: la fila del cubo "${fila.cubo}" trae una coordenada de mas`,
          ).toEqual(CLAVES_DE_FILA);
        }
      }
    }
    // SANIDAD: el fixture produce filas de verdad. Sin esto el caso pasaria por vacio, que es
    // exactamente lo que le pasaria hoy si solo mirase las vistas de grano `fecha`.
    expect(filasVistas, "ninguna vista trajo filas: el censo de claves no miro nada").toBeGreaterThan(
      3,
    );
  });

  it("R5 · ninguna vista de grano temporal emite una clave extra ni una clave que no sea de fecha", async () => {
    // HOY las vistas de grano `fecha` publican `filas: []` y este caso pasa por vacio; queda
    // escrito para la tanda que las rellene: en cuanto emitan filas, cada una tendra que traer
    // las dos claves y un cubo `YYYY-MM-DD`, y ni un `tiendaId` ni un `metodo` al lado (R28).
    for (const raw of [RANGO_CORTO, RANGO_LARGO]) {
      for (const vista of await todasLasVistas(raw)) {
        if (vista.granularidad === "no_temporal") continue;
        for (const fila of vista.filas) {
          expect(clavesDe(fila), `${vista.id}: dimension adicional en la vista temporal`).toEqual(
            CLAVES_DE_FILA,
          );
          expect(fila.cubo, `${vista.id}: la clave del cubo no es una fecha CR`).toMatch(
            /^\d{4}-\d{2}-\d{2}$/,
          );
        }
      }
    }
  });

  it("autocomprobacion: el censo de claves detecta una coordenada de mas", () => {
    // Sin esto, los dos casos de arriba serian decorativos si `clavesDe` dejara de mirar.
    const conDimensionExtra = {
      cubo: "2026-08-02",
      importe: { forma: "solo_bruto", bruto: "1.00", moneda: MONEDA },
      tiendaId: "t-1",
    } as unknown as FilaFinanciera;
    expect(clavesDe(conDimensionExtra)).not.toEqual(CLAVES_DE_FILA);
    expect(clavesDe(conDimensionExtra)).toEqual(["cubo", "importe", "tiendaId"]);

    const legitima = {
      cubo: "2026-08-02",
      importe: { forma: "solo_bruto", bruto: "1.00", moneda: MONEDA },
    } as unknown as FilaFinanciera;
    expect(clavesDe(legitima)).toEqual(CLAVES_DE_FILA);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. R3 — regresion: las que quedan FUERA publican lo mismo que la 127        */
/* -------------------------------------------------------------------------- */

/**
 * EL ESPERADO DE LA REGRESION, ESCRITO A MANO PARA `DATOS`.
 *
 * ESTE BLOQUE TIENE QUE SOBREVIVIR A LA TANDA SIGUIENTE, que rellena las filas de las SIETE
 * del conjunto con desglose. Si por el camino alguien mete filas por fecha en `cod_recaudado`
 * o en `cuenta_por_pagar_tienda` —o les cambia el grano, la fuente, el `sumableCon` o el
 * total—, estos casos MUEREN. Es su unica razon de ser: R3 dice que mientras una metrica NO
 * pertenezca al conjunto con desglose, su DTO se mantiene identico al de la 127, y el unico
 * campo que esta feature le anade es `granularidad`.
 *
 * Los importes se escriben calculados a mano sobre `DATOS`, no leidos del servicio:
 *   - `bruto` = Σ de las sumas del grupo, SIN signo ⟨D1(c)⟩;
 *   - `neto`  = lo que `derivarSaldoTienda(Σcredito, Σdebito)` produce, es decir credito−debito.
 */
const VISTAS_ESPERADAS_COD_RECAUDADO: readonly VistaFinanciera[] = [
  {
    id: VISTA_COD_RECAUDADO_POR_METODO,
    grano: "metodo_pago",
    fuente: "cierre_dia",
    sumableCon: [],
    granularidad: "no_temporal",
    filas: [
      { cubo: "efectivo", importe: { forma: "bruto_y_neto", bruto: "300.00", neto: "300.00", moneda: MONEDA } },
      { cubo: "simpe", importe: { forma: "bruto_y_neto", bruto: "100.00", neto: "100.00", moneda: MONEDA } },
    ],
    total: { forma: "bruto_y_neto", bruto: "400.00", neto: "400.00", moneda: MONEDA },
  },
  {
    id: VISTA_COD_RECAUDADO_POR_TIENDA,
    grano: "tienda",
    fuente: "wallet_tienda_movimiento",
    sumableCon: [],
    granularidad: "no_temporal",
    filas: [
      // t-1: bruto 300 + 40; neto 300 − 40.
      { cubo: "t-1", importe: { forma: "bruto_y_neto", bruto: "340.00", neto: "260.00", moneda: MONEDA } },
      { cubo: "t-2", importe: { forma: "bruto_y_neto", bruto: "100.00", neto: "100.00", moneda: MONEDA } },
    ],
    // total: bruto 300 + 40 + 100; neto (300 + 100) − 40.
    total: { forma: "bruto_y_neto", bruto: "440.00", neto: "360.00", moneda: MONEDA },
  },
];

const VISTAS_ESPERADAS_CUENTA_POR_PAGAR_TIENDA: readonly VistaFinanciera[] = [
  {
    id: "cuenta_por_pagar_tienda",
    grano: "tienda",
    fuente: "wallet_tienda_movimiento",
    sumableCon: [],
    granularidad: "no_temporal",
    filas: [
      // t-1: bruto 800 + 300; neto 800 − 300.
      { cubo: "t-1", importe: { forma: "bruto_y_neto", bruto: "1100.00", neto: "500.00", moneda: MONEDA } },
      { cubo: "t-2", importe: { forma: "bruto_y_neto", bruto: "100.00", neto: "100.00", moneda: MONEDA } },
    ],
    // total: bruto 800 + 300 + 100; neto (800 + 100) − 300.
    total: { forma: "bruto_y_neto", bruto: "1200.00", neto: "600.00", moneda: MONEDA },
  },
];

describe("R3 · las metricas FUERA del conjunto con desglose publican el DTO de la 127 + granularidad", () => {
  it("R3 · el sujeto de la regresion son EXACTAMENTE las tres que quedan fuera", () => {
    const fuera = IDS_FINANCIERAS_SERVIDAS.filter(
      (id) => !(IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA as readonly string[]).includes(id),
    );
    // Escrito, no derivado: si manana el conjunto con desglose se ampliara, este caso avisa
    // ANTES de que los tres bloques de abajo pasen a juzgar otra cosa.
    expect([...fuera].sort()).toEqual(
      ["cod_recaudado", "conciliacion_cierres", "cuenta_por_pagar_tienda"].sort(),
    );
  });

  it("R3 · cod_recaudado publica sus DOS vistas exactamente como la 127", async () => {
    const vistas = await vistasDe("cod_recaudado", RANGO_CORTO);
    expect(vistas).toEqual(VISTAS_ESPERADAS_COD_RECAUDADO);
  });

  it("R3 · cod_recaudado no cambia con el rango: sus cubos no son fechas", async () => {
    // Si alguien enchufara el troceo temporal «a todas las vistas», esta metrica cambiaria de
    // filas al alargar el rango. Aqui no puede: el mismo esperado, palabra por palabra.
    const vistas = await vistasDe("cod_recaudado", RANGO_LARGO);
    expect(vistas).toEqual(VISTAS_ESPERADAS_COD_RECAUDADO);
  });

  it("R3 · cuenta_por_pagar_tienda publica su vista por tienda exactamente como la 127", async () => {
    expect(await vistasDe("cuenta_por_pagar_tienda", RANGO_CORTO)).toEqual(
      VISTAS_ESPERADAS_CUENTA_POR_PAGAR_TIENDA,
    );
    expect(await vistasDe("cuenta_por_pagar_tienda", RANGO_LARGO)).toEqual(
      VISTAS_ESPERADAS_CUENTA_POR_PAGAR_TIENDA,
    );
  });

  it("R3 · conciliacion_cierres sigue sin vistas: conteos por estado y cuadre, escritos", async () => {
    const datos = await resultadoDe("conciliacion_cierres", RANGO_CORTO);
    if (datos.tipo !== "conciliacion") {
      throw new Error(`conciliacion_cierres cambio de tipo: "${datos.tipo}"`);
    }
    expect(datos.conciliacion).toEqual({
      porEstado: [
        {
          nivel: "cierre_dia",
          estado: "aprobado",
          cantidad: 2,
          totales: {
            efectivo: "300.00",
            simpe: "100.00",
            transferencia: "0.00",
            general: "400.00",
          },
          fechadoPor: "resuelto_at",
        },
        {
          nivel: "cierre_bodega",
          estado: "solicitado",
          cantidad: 1,
          totales: {
            efectivo: "0.00",
            simpe: "0.00",
            transferencia: "50.00",
            general: "50.00",
          },
          fechadoPor: "solicitado_at",
        },
      ],
      cuadre: {
        cuadra: true,
        totalSnapshot: "400.00",
        totalLedger: "400.00",
        diferencia: "0.00",
        cierresDescuadrados: [],
      },
    });
    // Y no le ha crecido una vista por la espalda: no tiene donde poner filas por fecha.
    expect(Object.prototype.hasOwnProperty.call(datos, "vistas")).toBe(false);
  });

  it("R3 · las tres de fuera declaran `no_temporal` en TODAS sus vistas, con cualquier rango", async () => {
    for (const raw of [RANGO_CORTO, RANGO_LARGO]) {
      for (const id of ["cod_recaudado", "cuenta_por_pagar_tienda", "conciliacion_cierres"]) {
        for (const vista of await vistasDe(id, raw)) {
          expect(vista.granularidad, `${id} / ${vista.id}`).toBe("no_temporal");
        }
      }
    }
  });
});

import { describe, expect, it } from "vitest";

import { trocear } from "@/lib/analytics/cubo-temporal";
import {
  IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA,
  IDS_FINANCIERAS_SERVIDAS,
  type ResultadoFinanciero,
  type ResultadoFinancieroConciliacion,
  type ResultadoFinancieroVistas,
  type VistaFinanciera,
} from "@/lib/types/analitica-financiera";
import { importeConNeto } from "@/tests/fixtures/importe-analitico";
import {
  dtoConciliacionServido,
  dtoNoTemporalServido,
  dtoTemporalServido,
  IDENTIDAD_NO_TEMPORAL,
  rangoResuelto,
  RANGO_TABLERO,
  UNIDAD_SERVIDA,
  type IdentidadDeVista,
  type MetricaNoTemporalServida,
  type MetricaTemporalServida,
} from "@/tests/fixtures/dto-financiero-servido";

import { armarServicio, consultaDe, type DatosFinancieros } from "../services/_dobles-analitica-financiera";

// GUARDIA DE ARNES (2026-08-07, sin ficha) — EL DOBLE DEL TABLERO CONTRA LA SALIDA REAL.
//
// ┌─ QUE INCIDENTE PAGA ESTA GUARDIA ──────────────────────────────────────────────────────┐
// │ 2026-08-06. El tablero financiero estuvo SIETE HORAS en produccion pintando una tabla   │
// │ de treinta fechas donde el maestro esperaba «Dinero en caja», «Ganancia de Ordenex» y   │
// │ las otras cinco. Causa inmediata: la señal de forma «KPI vs tabla» era                  │
// │ `filas.length === 0`, y la feature 180 la invalido al hacer que el servicio emitiera    │
// │ una serie DENSA (una fila por cubo del rango) para esas siete metricas. Reparado por    │
// │ hotfix (PR #305): la señal paso a `granularidad !== "no_temporal"`.                     │
// └─────────────────────────────────────────────────────────────────────────────────────────┘
//
// POR QUE NINGUN TEST LO VIO, que es lo unico que esta guardia existe para cerrar: el doble del
// tablero se llamaba `vistaSinFilas`, declaraba `grano: "fecha"` y `filas: []` A MANO, y la
// propia feature 180 PASO POR DELANTE DE EL, LO EDITO para añadirle `granularidad` y dejo
// escrito al lado «el tablero NO la lee». Ni vio que su propio cambio invalidaba la premisa que
// ese doble fijaba. El componente y su prueba compartian una premisa que el servicio ya no
// cumplia, y dos piezas que se equivocan igual no se contradicen NUNCA.
//
// LO QUE ESTA GUARDIA HACE, Y EN QUE SE DIFERENCIA DE LAS DOS QUE YA EXISTEN. Las dos guardias
// del tablero —`tablero-financiero.guardia.test.ts` y `tablero-lineas-trazabilidad.guardia.test.ts`—
// son CENSOS DE TEXTO sobre archivos: leen fuentes con `readFileSync` y buscan patrones. Son
// utiles y no se tocan, pero ESTRUCTURALMENTE no pueden ver esta divergencia: no ejecutan el
// servicio, asi que no saben que forma produce. Esta EJECUTA el servicio real (con los dobles de
// repositorio de la 127, sin base de datos) y compara la forma que sale con la que el doble del
// tablero declara. Es la unica de las tres que puede fallar por un cambio en
// `AnaliticaFinancieraService.ts`.
//
// DONDE ESTA LA ATADURA, que es la decision de diseno que hace que esto no vuelva a pasar. No
// basta con afirmar aqui «el servicio emite treinta filas»: eso comprobaria el servicio contra
// una constante escrita al lado —el espejo consigo mismo— y seguiria verde con el doble
// mintiendo, que es exactamente lo que paso. La forma del doble se saco del `.test.tsx` a
// `tests/fixtures/dto-financiero-servido.ts` (a) DERIVADA de las mismas funciones puras que el
// servicio usa y (b) comparada AQUI, ejecutando las dos partes. El test de componente importa
// ESE constructor. Consecuencia: editar la forma del doble para que describa un DTO que el
// servicio ya no produce pone ROJA esta guardia, aunque los 93 casos de componente sigan verdes.
//
// El estilo de la comparacion es el de `analitica-financiera-serie-frontera.test.ts` §6
// (`CLAVES_DE_VISTA` contra la salida real): se afirma sobre `Object.keys(...).sort()` y sobre
// listas comparables, nunca sobre una serializacion entera cuyo diff no se pueda leer.

/** El filtro que resuelve EXACTAMENTE la ventana con la que el tablero se prueba. */
const FILTRO_TABLERO = {
  rango: "personalizado",
  desde: RANGO_TABLERO.desdeFecha,
  hasta: RANGO_TABLERO.hastaFecha,
} as const;

/** Los cubos que el troceo produce para esa ventana. Treinta dias, y se afirma abajo. */
const CUBOS = trocear(rangoResuelto(RANGO_TABLERO)).map((cubo) => cubo.clave);

/**
 * Material de repositorio NO VACIO.
 *
 * Se corre la comparacion con y sin datos A PROPOSITO: la cardinalidad de una serie temporal la
 * decide el RANGO y no lo que haya en la base (`serieDensa` reparte sobre `cubos.map(() => [])`),
 * y esa es justo la propiedad que hace atable esta forma. Si la comparacion solo se hiciera con
 * el repositorio vacio, un servicio que emitiera filas solo cuando hay movimiento pasaria.
 */
const CON_MOVIMIENTO: Partial<DatosFinancieros> = {
  caja: [{ categoria: "ingreso_flete", tipo: "ingreso", suma: "100.00" }],
  cajaPorCubo: [
    { indiceCubo: 0, categoria: "ingreso_flete", tipo: "ingreso", suma: "100.00" },
    { indiceCubo: 3, categoria: "egreso_gasto", tipo: "egreso", suma: "40.00" },
  ],
  cuentaMensajeros: [{ tipo: "devengo", suma: "500.00" }],
  cuentaMensajerosAntes: [{ tipo: "devengo", suma: "10.00" }],
  cuentaMensajerosPorCubo: [{ indiceCubo: 0, tipo: "devengo", suma: "70.00" }],
};

/* -------------------------------------------------------------------------- */
/* La FORMA de un DTO: lo que se compara, y lo que a proposito no              */
/* -------------------------------------------------------------------------- */

/**
 * La forma de una vista: todo lo estructural, ninguna cifra.
 *
 * QUE ENTRA: el juego de claves (una clave nueva en el DTO que el doble no conozca deja al
 * tablero recibiendo algo que ninguna prueba ejercita), el id de la vista, el grano, la fuente,
 * `sumableCon`, la granularidad, las CLAVES DE CUBO de la serie —no solo cuantas: cuales y en
 * que orden— y el juego de nombres de campo de cada fila.
 *
 * QUE NO ENTRA, y por que no es un olvido:
 *   - las CIFRAS (`bruto`, `neto`) y la `forma` del importe. Las cifras del doble son
 *     deliberadamente ajenas a los totales del test de componente para que un panel que pintara
 *     una fila donde va el titular no pueda acertar por azar; atarlas destruiria esa propiedad.
 *     La `forma` por metrica la vigila `tests/unit/analytics/financiera-forma-importe.guardia.test.ts`
 *     DEL LADO DEL SERVICIO (ver la bitacora: del lado del doble sigue sin atar, y esta dicho).
 *   - la `moneda`, que `tests/fixtures/importe-analitico.ts` rellena con un marcador visible a
 *     proposito, por la misma razon.
 */
function formaDeVista(vista: VistaFinanciera) {
  return {
    claves: Object.keys(vista).sort(),
    id: vista.id,
    grano: vista.grano,
    fuente: vista.fuente,
    sumableCon: [...vista.sumableCon],
    granularidad: vista.granularidad,
    cubos: vista.filas.map((fila) => fila.cubo),
    clavesDeFila: [...new Set(vista.filas.map((fila) => Object.keys(fila).sort().join("+")))],
  };
}

/**
 * La forma del DTO entero: cabecera + vistas.
 *
 * La `etiqueta` queda fuera: el servicio la saca del catalogo y el doble la escribe a mano, y el
 * tablero pinta la que el DTO traiga, sea cual sea. Una divergencia ahi no puede producir el
 * defecto de forma que costo las siete horas. Todo lo demas de la cabecera SI entra: `unidad`
 * decide el formato de la cifra y `esAcumulado` decide si se pinta «saldo al corte» y si la
 * linea se sustituye por el motivo escrito (R3 de la 186).
 */
function formaDeDto(dto: ResultadoFinancieroVistas) {
  return {
    tipo: dto.tipo,
    metricaId: dto.metricaId,
    unidad: dto.unidad,
    rango: { ...dto.rango },
    esAcumulado: dto.esAcumulado,
    vistas: dto.vistas.map(formaDeVista),
  };
}

/**
 * La IDENTIDAD de una vista: lo que el servicio fija POR CODIGO.
 *
 * Es `formaDeVista` menos todo lo que depende de los datos. Existe para las vistas NO temporales
 * (tanda 2), donde la cardinalidad y el orden de las filas los decide el repositorio y por tanto
 * no hay nada que atar; la identidad, en cambio, esta escrita en el manejador y sí.
 */
function identidadDeVista(vista: VistaFinanciera): IdentidadDeVista {
  return {
    id: vista.id,
    grano: vista.grano,
    fuente: vista.fuente,
    sumableCon: [...vista.sumableCon],
    granularidad: vista.granularidad,
  };
}

/** La cabecera del DTO, sin `etiqueta` (mismo criterio y mismo motivo que `formaDeDto`). */
function cabeceraDe(dto: ResultadoFinanciero) {
  return {
    tipo: dto.tipo,
    metricaId: dto.metricaId,
    unidad: dto.unidad,
    rango: { ...dto.rango },
    esAcumulado: dto.esAcumulado,
  };
}

/** El DTO que el SERVICIO produce, sin estrechar: `conciliacion_cierres` no es de vistas. */
async function delServicioCrudo(
  metricaId: string,
  datos: Partial<DatosFinancieros> = {},
): Promise<ResultadoFinanciero> {
  const { servicio } = armarServicio(datos);
  const r = await servicio.consultar(consultaDe(metricaId, FILTRO_TABLERO));
  if (r.status !== "ok") throw new Error(`${metricaId}: el servicio devolvio ${r.status}`);
  return r.datos;
}

/** El DTO que el SERVICIO produce hoy para esa metrica y esa ventana. */
async function delServicio(
  metricaId: string,
  datos: Partial<DatosFinancieros> = {},
): Promise<ResultadoFinancieroVistas> {
  const datosDto = await delServicioCrudo(metricaId, datos);
  if (datosDto.tipo !== "vistas") throw new Error(`${metricaId}: el DTO no es de vistas`);
  return datosDto;
}

/**
 * El DTO que el DOBLE del tablero declara para esa metrica.
 *
 * Es el MISMO constructor que `tests/components/TableroFinanciero.test.tsx` usa para sus siete
 * paneles: se importa, no se reconstruye. Reescribirlo aqui volveria a comparar dos
 * declaraciones libres, que es el agujero que esta guardia cierra.
 *
 * La etiqueta y las cifras se rellenan con valores de relleno porque `formaDeDto` no los mira.
 */
function delDoble(metricaId: MetricaTemporalServida): ResultadoFinancieroVistas {
  return dtoTemporalServido(
    metricaId,
    "etiqueta que esta guardia no compara",
    (indice) => importeConNeto(`${indice}.13`, `-${indice}.17`),
    importeConNeto("1.00", "-1.00"),
    RANGO_TABLERO,
  );
}

/* -------------------------------------------------------------------------- */
/* 1. La atadura: la forma del doble ES la que el servicio produce             */
/* -------------------------------------------------------------------------- */

describe("el doble temporal del tablero declara la forma que el servicio produce de verdad", () => {
  it("las SIETE metricas temporales coinciden campo a campo, con el repositorio vacio", async () => {
    let comparadas = 0;
    for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
      const real = await delServicio(id);
      expect(formaDeDto(delDoble(id)), `${id}: el doble describe un DTO que el servicio no produce`).toEqual(
        formaDeDto(real),
      );
      comparadas += 1;
    }
    // Contrapeso: si el conjunto se vaciara, el bucle pasaria sin mirar nada.
    expect(comparadas, "el censo no comparo ninguna metrica").toBe(7);
  });

  it("y tambien con movimiento en el libro: la forma no depende de los datos", async () => {
    for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
      const real = await delServicio(id, CON_MOVIMIENTO);
      expect(formaDeDto(delDoble(id)), `${id} (con movimiento)`).toEqual(formaDeDto(real));
    }
  });

  it("el material CON_MOVIMIENTO llega de verdad al DTO: el caso de arriba no pasa por vacio", async () => {
    // Sin esto, unos dobles de repositorio que devolvieran siempre lo mismo harian del caso
    // anterior una copia del primero. Se afirma sobre la CIFRA, que es lo unico que el material
    // puede mover (la forma, por definicion, no).
    const vacio = await delServicio("ingreso_flete");
    const conDatos = await delServicio("ingreso_flete", CON_MOVIMIENTO);
    expect(vacio.vistas[0]!.total.bruto).toBe("0.00");
    expect(conDatos.vistas[0]!.total.bruto).toBe("100.00");
    expect(conDatos.vistas[0]!.filas[0]!.importe.bruto).toBe("100.00");
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Las tres afirmaciones del incidente, dichas por su nombre                */
/* -------------------------------------------------------------------------- */

describe("la vista temporal que el servicio produce hoy, medida sobre la salida real", () => {
  it("trae granularidad TEMPORAL, no `no_temporal`, y grano `fecha`", async () => {
    // Es la señal con la que el tablero separa el KPI de la tabla desde el hotfix del
    // 2026-08-06. Si el servicio dejara de publicarla temporal, las siete metricas volverian a
    // caer en `PanelTabla` — el defecto exacto, otra vez.
    for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
      const vista = (await delServicio(id)).vistas[0]!;
      expect(vista.granularidad, `${id}: la vista dejo de declararse temporal`).not.toBe("no_temporal");
      expect(vista.granularidad, `${id}: 30 dias caben en el tope, toca grano diario`).toBe("dia");
      expect(vista.grano, id).toBe("fecha");
    }
  });

  it("trae la serie DENSA: ni una vista vacia, y UNA fila por cubo del rango", async () => {
    // La premisa que la 180 rompio y que el doble siguio afirmando. `CUBOS` sale de `trocear`,
    // no de un numero escrito: si alguien mueve el rango, la afirmacion lo sigue.
    expect(CUBOS, "el rango del tablero ya no son treinta cubos").toHaveLength(30);
    for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
      const vista = (await delServicio(id)).vistas[0]!;
      expect(vista.filas.length, `${id}: la vista llego SIN filas`).toBeGreaterThan(0);
      expect(vista.filas.map((f) => f.cubo), `${id}: los cubos no son los del troceo`).toEqual(CUBOS);
    }
  });

  it("cada fila declara EXACTAMENTE las dos claves que el doble usa", async () => {
    let filas = 0;
    for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
      for (const fila of (await delServicio(id, CON_MOVIMIENTO)).vistas[0]!.filas) {
        expect(Object.keys(fila).sort(), id).toEqual(["cubo", "importe"]);
        filas += 1;
      }
    }
    expect(filas, "el barrido no miro ninguna fila").toBe(7 * CUBOS.length);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. `cuenta_por_pagar_mensajero`: medida antes de afirmar nada de ella       */
/* -------------------------------------------------------------------------- */

describe("la metrica de SALDO AL CORTE, medida y no supuesta", () => {
  const ACUMULADA: MetricaTemporalServida = "cuenta_por_pagar_mensajero";
  const DE_FLUJO: MetricaTemporalServida = "egresos";

  it("su FORMA no difiere de la de las seis de flujo: mismo grano, misma granularidad, mismos cubos", async () => {
    // MEDIDO antes de escribirlo (2026-08-07): sale de otro manejador
    // (`deCuentaDeMensajeros`) y de otra tabla, pero su vista declara el mismo `grano: "fecha"`,
    // la misma `granularidad` y las mismas treinta claves de cubo. La simetria NO se fuerza: se
    // comprueba, y lo unico que se excluye de la comparacion es lo que de verdad difiere.
    const acumulada = formaDeVista((await delServicio(ACUMULADA)).vistas[0]!);
    const flujo = formaDeVista((await delServicio(DE_FLUJO)).vistas[0]!);

    expect(acumulada.grano).toBe(flujo.grano);
    expect(acumulada.granularidad).toBe(flujo.granularidad);
    expect(acumulada.cubos).toEqual(flujo.cubos);
    expect(acumulada.claves).toEqual(flujo.claves);
    expect(acumulada.clavesDeFila).toEqual(flujo.clavesDeFila);
    // Y lo que SI difiere, dicho en vez de escondido: el id, la tabla de origen y —fuera de la
    // vista, en la cabecera— `esAcumulado`.
    expect(acumulada.id).not.toBe(flujo.id);
    expect(acumulada.fuente).not.toBe(flujo.fuente);
  });

  it("`esAcumulado` es `true` SOLO en ella entre las siete, y el doble lo deriva igual", async () => {
    const acumuladas: string[] = [];
    for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
      const real = await delServicio(id);
      expect(delDoble(id).esAcumulado, `${id}: el doble contradice al servicio`).toBe(real.esAcumulado);
      if (real.esAcumulado) acumuladas.push(id);
    }
    expect(acumuladas).toEqual([ACUMULADA]);
  });

  it("su serie es un ACUMULADO CORRIDO y la de flujo no: la diferencia esta en los VALORES", async () => {
    // La otra mitad de «midelo antes de afirmar nada». Con movimiento SOLO en el primer cubo:
    //   - la metrica de flujo vuelve a cero en los 29 cubos siguientes (no hubo movimiento);
    //   - la acumulada REPITE el saldo, porque cada fila es el saldo al cierre de su cubo sobre
    //     todo el libro anterior (R9 de la 180).
    // Es una diferencia de CIFRA, no de forma, y por eso la guardia de forma no la ve: queda
    // afirmada aqui para que nadie deduzca de la simetria de arriba que las dos series
    // significan lo mismo.
    const flujo = (await delServicio(DE_FLUJO, CON_MOVIMIENTO)).vistas[0]!;
    const acumulada = (await delServicio(ACUMULADA, CON_MOVIMIENTO)).vistas[0]!;

    expect(flujo.filas[0]!.importe.bruto).toBe("100.00");
    expect(flujo.filas[1]!.importe.bruto).toBe("0.00");
    expect(flujo.filas.at(-1)!.importe.bruto).toBe("0.00");

    // 10.00 de arrastre + 70.00 del primer cubo, y de ahi en adelante sin movimiento.
    expect(acumulada.filas[0]!.importe.bruto).toBe("80.00");
    expect(acumulada.filas[1]!.importe.bruto).toBe("80.00");
    expect(acumulada.filas.at(-1)!.importe.bruto).toBe("80.00");
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Autocomprobacion: el detector ve las DOS regresiones del incidente        */
/* -------------------------------------------------------------------------- */

describe("autocomprobacion · el comparador detecta lo que dice detectar", () => {
  /** El doble con una clave de su vista alterada, como lo dejaria una edicion descuidada. */
  function dobleMutado(cambio: Partial<VistaFinanciera>): ResultadoFinanciero {
    const base = delDoble("egresos");
    return { ...base, vistas: [{ ...base.vistas[0]!, ...cambio }] };
  }

  it("(a) un doble que declarara `granularidad: no_temporal` NO coincide con el servicio", async () => {
    // Es la mutacion de control (a) de la bitacora, ejercida aqui ademas sobre texto propio para
    // que quede permanentemente comprobada y no solo anotada. La 180 escribio al lado de este
    // campo «el tablero NO la lee»: hoy es la señal con la que se decide KPI vs tabla.
    const real = formaDeDto(await delServicio("egresos"));
    const mutado = formaDeDto(dobleMutado({ granularidad: "no_temporal" }) as ResultadoFinancieroVistas);
    expect(mutado).not.toEqual(real);
    expect(mutado.vistas[0]!.granularidad).toBe("no_temporal");
  });

  it("(b) un doble SIN filas —el `vistaSinFilas` original— NO coincide con el servicio", async () => {
    // Es la mutacion de control (b): el estado exacto en el que la fixture entro en la 180 y
    // salio de ella. Con esta guardia puesta, ese doble ya no puede volver en verde.
    const real = formaDeDto(await delServicio("egresos"));
    const mutado = formaDeDto(dobleMutado({ filas: [] }) as ResultadoFinancieroVistas);
    expect(mutado).not.toEqual(real);
    expect(mutado.vistas[0]!.cubos).toEqual([]);
    expect(real.vistas[0]!.cubos).toHaveLength(30);
  });

  it("(c) y las otras cuatro señales tambien discriminan, una a una", async () => {
    // Sin esto, un comparador que solo mirara `granularidad` y `filas` pasaria los dos casos de
    // arriba y dejaria sin vigilar los campos que el doble mentia HASTA HOY (`fuente`, el id de
    // la vista). Cada mutacion se comprueba por separado: un `toEqual` global que fallara por
    // cualquier motivo no diria cual.
    const real = formaDeVista((await delServicio("egresos")).vistas[0]!);
    const mutaciones: readonly [string, Partial<VistaFinanciera>][] = [
      ["id de la vista", { id: "egresos__vista" }],
      ["grano", { grano: "tienda" }],
      ["fuente", { fuente: "wallet_tienda_movimiento" }],
      ["sumableCon", { sumableCon: ["otra_vista"] }],
    ];
    for (const [nombre, cambio] of mutaciones) {
      const mutado = formaDeVista({ ...(dobleMutado(cambio) as ResultadoFinancieroVistas).vistas[0]! });
      expect(mutado, `el comparador no ve una mutacion de ${nombre}`).not.toEqual(real);
    }
  });

  it("(d) el doble SIN mutar SI coincide: los casos de arriba no fallan por cualquier cosa", async () => {
    // El contrapeso de los tres anteriores. Si `formaDeVista` produjera algo distinto en cada
    // llamada —una fecha, un orden inestable—, las cuatro mutaciones «se detectarian» siempre y
    // no medirian nada.
    const real = formaDeDto(await delServicio("egresos"));
    expect(formaDeDto(dobleMutado({}) as ResultadoFinancieroVistas)).toEqual(real);
  });

  it("(e) el conjunto vigilado no esta vacio ni es de una sola metrica", async () => {
    expect(IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA.length).toBe(7);
    expect(IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA.every((id) => id.length > 0)).toBe(true);
    // Y el doble produce material de verdad para todas: una vista y treinta filas cada una.
    for (const id of IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA) {
      const doble = delDoble(id);
      expect(doble.vistas, id).toHaveLength(1);
      expect(doble.vistas[0]!.filas, id).toHaveLength(30);
    }
  });
});

/* ========================================================================== */
/* TANDA 2 (2026-08-07) — LAS TRES METRICAS NO TEMPORALES                     */
/* ========================================================================== */
//
// La §6.5 de `progress/impl_guardia-servicio-dobles.md` dejaba esto abierto por escrito: las
// fixtures de `cod_recaudado` (dos vistas), `cuenta_por_pagar_tienda` y `conciliacion_cierres`
// seguian siendo declaraciones libres, con una divergencia YA MEDIDA
// (`id: "cuenta_por_pagar_tienda__vista"` frente al `"cuenta_por_pagar_tienda"` que el servicio
// publica). Se ata primero y se corrige despues, en ese orden.
//
// LA FRONTERA DE LO ATABLE, que es lo unico que hay que entender de este bloque. En una vista
// TEMPORAL la cardinalidad de las filas la decide el RANGO (`serieDensa` reparte sobre
// `cubos.map(() => [])`), asi que es una propiedad del codigo y se puede atar. En un desglose por
// tienda o por metodo de pago la deciden los DATOS: `porCubo` agrupa lo que el repositorio
// devolvio y conserva su orden de llegada. Medido abajo: con el repositorio vacio las tres
// publican CERO filas y con material publican las que haya, en el orden en que llegaron. Ahi no
// hay nada que atar sin inventarselo, y forzarlo convertiria la guardia en una fixture disfrazada.
//
// Lo que SI esta escrito en el manejador y por tanto se ata: el id de la vista, su grano, su
// fuente, `sumableCon`, la granularidad, el NUMERO de vistas, EL ORDEN en que se publican y la
// cabecera entera menos la etiqueta.

/** Los datos de una vista no temporal del doble: relleno, porque la identidad no los mira. */
const RELLENO = {
  filas: [{ cubo: "cubo-de-relleno", importe: importeConNeto("1.00", "1.00") }],
  total: importeConNeto("1.00", "1.00"),
};

/** El doble de una metrica no temporal, con tantas vistas como el modulo declara. */
function dobleNoTemporal(metricaId: MetricaNoTemporalServida): ResultadoFinancieroVistas {
  return dtoNoTemporalServido(
    metricaId,
    "etiqueta que esta guardia no compara",
    IDENTIDAD_NO_TEMPORAL[metricaId].map(() => RELLENO),
  );
}

/** El doble de `conciliacion_cierres`, la unica servida cuyo `tipo` no es de vistas. */
function dobleConciliacion(): ResultadoFinancieroConciliacion {
  return dtoConciliacionServido("etiqueta que esta guardia no compara", {
    porEstado: [],
    cuadre: {
      cuadra: true,
      totalSnapshot: "0.00",
      totalLedger: "0.00",
      diferencia: "0.00",
      cierresDescuadrados: [],
    },
  });
}

/** Material que hace que las no temporales publiquen filas de verdad. */
const CON_DESGLOSE: Partial<DatosFinancieros> = {
  porMetodo: [
    { metodo: "transferencia", suma: "3.00" },
    { metodo: "efectivo", suma: "1.00" },
  ],
  porTienda: [
    { tiendaId: "t-zzz", tipo: "credito", suma: "10.00" },
    { tiendaId: "t-aaa", tipo: "credito", suma: "20.00" },
  ],
  saldoTiendas: [
    { tiendaId: "t-mmm", tipo: "credito", suma: "70.00" },
    { tiendaId: "t-bbb", tipo: "debito", suma: "30.00" },
  ],
};

/** Las dos que publican vistas. `conciliacion_cierres` va aparte: no publica ninguna. */
const CON_VISTAS_NO_TEMPORALES: readonly MetricaNoTemporalServida[] = [
  "cod_recaudado",
  "cuenta_por_pagar_tienda",
];

describe("el doble NO temporal declara la identidad de vista que el servicio publica", () => {
  it("identidad y ORDEN de cada vista, con el repositorio vacio y con desglose", async () => {
    let vistas = 0;
    for (const escenario of [{}, CON_DESGLOSE]) {
      for (const id of CON_VISTAS_NO_TEMPORALES) {
        const real = await delServicio(id, escenario);
        // Se compara el ARRAY entero, no un conjunto: el orden es parte de lo que se ata.
        expect(
          IDENTIDAD_NO_TEMPORAL[id],
          `${id}: el doble describe vistas que el servicio no publica`,
        ).toEqual(real.vistas.map(identidadDeVista));
        vistas += real.vistas.length;
      }
    }
    // 2 escenarios x (2 vistas de cod_recaudado + 1 de cuenta_por_pagar_tienda).
    expect(vistas, "el censo no llego a ninguna vista no temporal").toBe(6);
  });

  it("`conciliacion_cierres` no publica NINGUNA vista, y el doble declara cero", async () => {
    // Se afirma por los dos lados: el modulo declara la lista vacia Y el servicio devuelve un DTO
    // de otro `tipo`, sin clave `vistas`. Si algun dia esa metrica pasara a servir vistas, esto se
    // pone rojo en vez de dejar la lista vacia pasando por «no hay nada que mirar».
    expect(IDENTIDAD_NO_TEMPORAL.conciliacion_cierres).toEqual([]);
    const real = await delServicioCrudo("conciliacion_cierres", CON_DESGLOSE);
    expect(real.tipo).toBe("conciliacion");
    expect(Object.keys(real)).not.toContain("vistas");
    expect(Object.keys(real).sort()).toEqual([
      "conciliacion",
      "esAcumulado",
      "etiqueta",
      "metricaId",
      "rango",
      "tipo",
      "unidad",
    ]);
  });

  it("la cabecera de las tres coincide campo a campo con la del servicio", async () => {
    for (const id of CON_VISTAS_NO_TEMPORALES) {
      expect(cabeceraDe(dobleNoTemporal(id)), id).toEqual(cabeceraDe(await delServicioCrudo(id)));
    }
    expect(cabeceraDe(dobleConciliacion())).toEqual(
      cabeceraDe(await delServicioCrudo("conciliacion_cierres")),
    );
  });
});

describe("la UNIDAD de las diez servidas, atada por ejecucion", () => {
  it("`UNIDAD_SERVIDA` es la que el servicio publica, y NO son todas `moneda`", async () => {
    // EL HALLAZGO CARO DE LA TANDA 2. `conciliacion_cierres` publica `conteo` —lo declara el
    // catalogo— y los dos dobles del repo decian `moneda`. No era cosmetico: `PanelConciliacion`
    // formateaba con `datos.unidad` las TRES cifras de dinero del cuadre, asi que con la unidad de
    // verdad se pintaban REDONDEADAS y sin moneda, como salio en produccion.
    //
    // Esta guardia nunca arreglo la pantalla —solo impidio que el doble lo siguiera tapando—, y
    // esa mitad se cerro el 2026-08-07 (`progress/impl_fix-conciliacion-unidad.md`): el panel
    // declara la unidad por cifra. Lo que sigue vivo, y es el trabajo de este caso, es que el
    // doble no pueda volver a inventarse la unidad.
    const obtenido: Record<string, string> = {};
    for (const id of IDS_FINANCIERAS_SERVIDAS) {
      obtenido[id] = (await delServicioCrudo(id)).unidad;
    }
    expect(obtenido).toEqual(UNIDAD_SERVIDA);
    // El contrapeso que impide que el caso pase por uniformidad: hay MAS DE UNA unidad.
    expect(new Set(Object.values(obtenido)).size).toBeGreaterThan(1);
    expect(obtenido.conciliacion_cierres).toBe("conteo");
  });
});

describe("lo que NO se ata de una vista no temporal, y la medicion que lo justifica", () => {
  it("sus filas las deciden los DATOS: cero con el repositorio vacio, N con material", async () => {
    // Si esto dejara de ser cierto —si la cardinalidad pasara a depender del rango, como en una
    // serie temporal—, la exclusion de `filas` de esta mitad de la guardia dejaria de estar
    // justificada y habria que atarlas tambien. Por eso se mide en vez de suponerse.
    const vacio = await delServicio("cod_recaudado");
    expect(vacio.vistas.map((v) => v.filas.length)).toEqual([0, 0]);

    const conDatos = await delServicio("cod_recaudado", CON_DESGLOSE);
    expect(conDatos.vistas.map((v) => v.filas.length)).toEqual([2, 2]);
    // Y el ORDEN de las filas es el de llegada del repositorio, no uno propio: `transferencia`
    // llega antes que `efectivo` en `CON_DESGLOSE` y sale igual.
    expect(conDatos.vistas[0]!.filas.map((f) => f.cubo)).toEqual(["transferencia", "efectivo"]);
    expect(conDatos.vistas[1]!.filas.map((f) => f.cubo)).toEqual(["t-zzz", "t-aaa"]);
  });

  it("el orden de las DOS vistas de `cod_recaudado` si es estable entre corridas", async () => {
    // La otra cara: las filas varian con los datos, las VISTAS no. `deRecaudo` devuelve
    // `[vistaMetodo, vistaTienda]`, un literal. Se comprueba porque ni `specs/127-*` ni
    // `specs/132-*` lo declaran en ninguna parte y hay dos consumidores que dependen de el (el
    // tablero pinta en orden de DTO; el test de componente indexa `[0]` donut y `[1]` barras).
    const ordenes = new Set<string>();
    for (let corrida = 0; corrida < 5; corrida += 1) {
      const real = await delServicio("cod_recaudado", corrida % 2 === 0 ? {} : CON_DESGLOSE);
      ordenes.add(real.vistas.map((v) => v.id).join(" | "));
    }
    expect([...ordenes]).toHaveLength(1);
    // Y las dos vistas NO son intercambiables: tienen grano y fuente distintos, asi que el orden
    // decide que panel se pinta con cual.
    const real = await delServicio("cod_recaudado");
    expect(real.vistas[0]!.grano).toBe("metodo_pago");
    expect(real.vistas[1]!.grano).toBe("tienda");
    expect(real.vistas[0]!.fuente).not.toBe(real.vistas[1]!.fuente);
  });
});

describe("autocomprobacion tanda 2 · el comparador de identidad detecta lo que dice detectar", () => {
  /** La identidad declarada, con una vista alterada. */
  function identidadMutada(
    metricaId: MetricaNoTemporalServida,
    indice: number,
    cambio: Partial<IdentidadDeVista>,
  ): readonly IdentidadDeVista[] {
    return IDENTIDAD_NO_TEMPORAL[metricaId].map((identidad, i) =>
      i === indice ? { ...identidad, ...cambio } : identidad,
    );
  }

  it("(f) el sufijo `__vista` que el doble llevaba hasta hoy NO coincide con el servicio", async () => {
    // Es la divergencia que la §6.5 dejo abierta, ejercida como mutacion permanente: si alguien se
    // la devuelve al doble, esto se pone rojo. Hasta la tanda 2 ninguna prueba del repo la veia —
    // `cuenta_por_pagar_tienda` trae UNA sola vista, asi que su id no llega al nombre accesible y
    // ningun caso de componente lo mira.
    const real = (await delServicio("cuenta_por_pagar_tienda")).vistas.map(identidadDeVista);
    const mutada = identidadMutada("cuenta_por_pagar_tienda", 0, {
      id: "cuenta_por_pagar_tienda__vista",
    });
    expect(mutada).not.toEqual(real);
    expect(IDENTIDAD_NO_TEMPORAL.cuenta_por_pagar_tienda).toEqual(real);
  });

  it("(g) las dos vistas de `cod_recaudado` INTERCAMBIADAS no coinciden con el servicio", async () => {
    // La mutacion que mide que el ORDEN se ata de verdad. Con un comparador de conjuntos —o con un
    // `sort()` de mas— esto pasaria en verde y el donut podria acabar donde van las barras.
    const real = (await delServicio("cod_recaudado")).vistas.map(identidadDeVista);
    const intercambiadas = [...IDENTIDAD_NO_TEMPORAL.cod_recaudado].reverse();
    expect(intercambiadas).not.toEqual(real);
    expect(IDENTIDAD_NO_TEMPORAL.cod_recaudado).toEqual(real);
  });

  it("(h) cada campo de la identidad discrimina por separado", async () => {
    const real = (await delServicio("cod_recaudado")).vistas.map(identidadDeVista);
    const mutaciones: readonly [string, Partial<IdentidadDeVista>][] = [
      ["id", { id: "cod_recaudado" }],
      ["grano", { grano: "fecha" }],
      ["fuente", { fuente: "wallet_movimiento" }],
      ["sumableCon", { sumableCon: ["otra_vista"] }],
      ["granularidad", { granularidad: "dia" }],
    ];
    for (const [nombre, cambio] of mutaciones) {
      expect(
        identidadMutada("cod_recaudado", 0, cambio),
        `el comparador no ve una mutacion de ${nombre}`,
      ).not.toEqual(real);
    }
  });

  it("(i) una unidad equivocada en el doble NO coincide con la del servicio", async () => {
    // La mutacion que corresponde al hallazgo: devolverle `moneda` a `conciliacion_cierres`.
    const real = await delServicioCrudo("conciliacion_cierres");
    const cabeceraMutada = { ...cabeceraDe(dobleConciliacion()), unidad: "moneda" as const };
    expect(cabeceraMutada).not.toEqual(cabeceraDe(real));
    expect(cabeceraDe(dobleConciliacion())).toEqual(cabeceraDe(real));
  });

  it("(j) el conjunto no temporal no esta vacio y cubre las tres metricas", () => {
    const declaradas = Object.keys(IDENTIDAD_NO_TEMPORAL).sort();
    expect(declaradas).toEqual([
      "cod_recaudado",
      "conciliacion_cierres",
      "cuenta_por_pagar_tienda",
    ]);
    // Las siete temporales mas estas tres son las diez del contrato: ninguna queda sin familia.
    expect(declaradas.length + IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA.length).toBe(
      IDS_FINANCIERAS_SERVIDAS.length,
    );
    // Y hay vistas de verdad que mirar: dos metricas con vista, una con ninguna.
    expect(IDENTIDAD_NO_TEMPORAL.cod_recaudado).toHaveLength(2);
    expect(IDENTIDAD_NO_TEMPORAL.cuenta_por_pagar_tienda).toHaveLength(1);
  });
});

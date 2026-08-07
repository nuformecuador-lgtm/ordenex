import { describe, expect, it } from "vitest";

import { trocear } from "@/lib/analytics/cubo-temporal";
import {
  IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA,
  type ResultadoFinanciero,
  type ResultadoFinancieroVistas,
  type VistaFinanciera,
} from "@/lib/types/analitica-financiera";
import { importeConNeto } from "@/tests/fixtures/importe-analitico";
import {
  dtoTemporalServido,
  rangoResuelto,
  RANGO_TABLERO,
  type MetricaTemporalServida,
} from "@/tests/fixtures/dto-financiero-temporal";

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
// `tests/fixtures/dto-financiero-temporal.ts` (a) DERIVADA de las mismas funciones puras que el
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

/** El DTO que el SERVICIO produce hoy para esa metrica y esa ventana. */
async function delServicio(
  metricaId: string,
  datos: Partial<DatosFinancieros> = {},
): Promise<ResultadoFinancieroVistas> {
  const { servicio } = armarServicio(datos);
  const r = await servicio.consultar(consultaDe(metricaId, FILTRO_TABLERO));
  if (r.status !== "ok") throw new Error(`${metricaId}: el servicio devolvio ${r.status}`);
  if (r.datos.tipo !== "vistas") throw new Error(`${metricaId}: el DTO no es de vistas`);
  return r.datos;
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

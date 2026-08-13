import { readFileSync } from "node:fs";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { listarMetricas } from "@/lib/analytics/metrics";
import type { MetricaUnidad } from "@/lib/analytics/types";

import { armarServicio, consultaDe } from "../services/_dobles-analitica-financiera";

// GUARDIA DEL RIESGO LATENTE QUE DEJO EL FIX DEL 2026-08-07
// (`progress/impl_fix-conciliacion-unidad.md`).
//
// EL DEFECTO QUE YA PASO. `PanelConciliacion` formateaba las tres cifras del cuadre
// —dinero— con `datos.unidad`, la unidad de la CABECERA del DTO. Para
// `conciliacion_cierres` esa unidad es `conteo` (la metrica cuenta cierres), asi que
// `formatearValor` redondeaba a entero y quitaba el simbolo: ₡1 560,50 se pintaba «1 561»
// y un descuadre de ₡60,50 se anunciaba como «61». En produccion.
//
// EL MISMO SITIO SIGUE EXISTIENDO EN EL VECINO. `TableroFinanciero.tsx` pasa
// `unidad={datos.unidad}` a los KPI, a las tres graficas y al total del DTO. Hoy eso es
// correcto, pero POR COINCIDENCIA: las nueve metricas financieras que llegan por ese
// camino declaran `unidad: "moneda"`, y la unica que no —`conciliacion_cierres`— se desvia
// antes a su panel propio porque publica otra forma de DTO. El dia que el catalogo gane
// una metrica financiera de vistas con unidad no monetaria, ese mismo `formatearValor`
// pinta dinero mal y NADA se pone rojo. Es el defecto que se acaba de arreglar, esperando
// turno.
//
// QUE AFIRMA ESTE GUARDIA, y de donde saca cada mitad:
//
//   - QUE metricas llegan por el camino de `vistas`: se le pregunta AL PRODUCTOR. Se arma
//     el servicio con los dobles de la 127 y se consulta cada metrica financiera del
//     catalogo, leyendo el discriminante del DTO que devuelve de verdad. No hay ninguna
//     lista de ids escrita aqui: una metrica nueva entra en el censo sola, y si alguien
//     cambia la forma de DTO de una existente, el censo lo ve el mismo dia.
//   - QUE unidad declara cada una: del CATALOGO (`listarMetricas`), que es la misma fuente
//     que `AnaliticaFinancieraService.cabecera()` copia al DTO.
//
// Y NO PUEDE PASAR POR VACIO (leccion de la tanda H de la 184): si el censo se queda sin
// metricas —porque el dominio se renombro, porque el servicio dejo de responder `ok`, o
// porque alguien rompio el doble— este archivo se pone ROJO en vez de seguir en verde
// censando la nada. Una guardia que no encuentra nada es un adorno permanente.

/* -------------------------------------------------------------------------- */
/* El vocabulario que este guardia juzga                                       */
/* -------------------------------------------------------------------------- */

/** La forma de DTO que desemboca en `unidad={datos.unidad}` (`TableroFinanciero.tsx`). */
const TIPO_VISTAS = "vistas";

/** La forma de DTO que el tablero DESVIA a su panel propio antes de llegar alli. */
const TIPO_CONCILIACION = "conciliacion";

/**
 * La unica unidad con la que se puede pintar un importe sin mentir.
 *
 * `formatearValor` (`components/private/analytics/formato.ts`) solo pone decimales y
 * simbolo de moneda en esta rama; `conteo` redondea a entero, `porcentaje` multiplica por
 * 100 y `segundos` reescribe la cifra como duracion. Cualquiera de las otras tres sobre un
 * importe produce un numero plausible y falso.
 */
const UNIDAD_DEL_DINERO: MetricaUnidad = "moneda";

const RAIZ = process.cwd();
const TABLERO = "app/(app)/analitica/_components/financiero/TableroFinanciero.tsx";

/* -------------------------------------------------------------------------- */
/* El censo: catalogo (unidad) x productor (forma del DTO)                     */
/* -------------------------------------------------------------------------- */

interface MetricaCensada {
  readonly id: string;
  /** Del CATALOGO: la que la cabecera del DTO copia y el tablero pasa a `formatearValor`. */
  readonly unidad: MetricaUnidad;
  /** Del PRODUCTOR: el discriminante del DTO que el servicio devuelve de verdad. */
  readonly tipo: string;
}

const censo: MetricaCensada[] = [];

/** Las que el servicio NO sirvio. Se registran para que no desaparezcan del censo calladas. */
const noServidas: string[] = [];

beforeAll(async () => {
  const { servicio } = armarServicio();
  for (const metrica of listarMetricas({ dominio: "financiera" })) {
    const respuesta = await servicio.consultar(consultaDe(metrica.id));
    if (respuesta.status !== "ok") {
      noServidas.push(`${metrica.id}: el servicio respondio "${respuesta.status}"`);
      continue;
    }
    censo.push({ id: metrica.id, unidad: metrica.unidad, tipo: respuesta.datos.tipo });
  }
});

/* -------------------------------------------------------------------------- */
/* Los detectores, PUROS, para poder autocomprobarlos                          */
/* -------------------------------------------------------------------------- */

/**
 * Las metricas que llegarian a `unidad={datos.unidad}` declarando una unidad que no es
 * dinero. El mensaje nombra a la infractora y el motivo, no solo el hecho.
 */
export function pintarianDineroConUnidadAjena(censadas: readonly MetricaCensada[]): string[] {
  return censadas
    .filter((m) => m.tipo === TIPO_VISTAS && m.unidad !== UNIDAD_DEL_DINERO)
    .map(
      (m) =>
        `${m.id}: publica un DTO "${TIPO_VISTAS}" —que el tablero formatea con la unidad de la CABECERA— y declara unidad "${m.unidad}"; sus importes se pintarian redondeados y sin moneda, como le paso al cuadre de conciliacion en produccion`,
    );
}

/** El codigo sin comentarios: la prosa que explica una prohibicion no la infringe. */
function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

/**
 * El DESVIO: el tablero manda el DTO de conciliacion a su panel propio ANTES de la rama
 * que formatea con la unidad de cabecera.
 *
 * Es la premisa que hace suficiente la regla de arriba. Si el desvio desapareciera, un DTO
 * de unidad `conteo` volveria a caer en `unidad={datos.unidad}` y «toda metrica de vistas
 * es moneda» ya no protegeria nada: seguiria siendo cierta y seria insuficiente.
 */
export function desviaElDtoDeConciliacion(codigo: string): boolean {
  const limpio = soloCodigo(codigo);
  const compara = new RegExp(`\\.tipo\\s*===\\s*["'\`]${TIPO_CONCILIACION}["'\`]`).test(limpio);
  return compara && /<\s*PanelConciliacion\b/.test(limpio);
}

/** El sitio protegido: la unidad de la cabecera viajando como prop de formato. */
export function pasaLaUnidadDeCabecera(codigo: string): boolean {
  return /unidad\s*=\s*\{\s*datos\.unidad\s*\}/.test(soloCodigo(codigo));
}

const CODIGO_TABLERO = readFileSync(path.join(RAIZ, TABLERO), "utf8");

/* -------------------------------------------------------------------------- */
/* La regla                                                                    */
/* -------------------------------------------------------------------------- */

describe("unidad de las metricas financieras que el tablero formatea con la cabecera", () => {
  it("ninguna metrica que llegue por el camino de `vistas` declara una unidad que no sea dinero", () => {
    expect(
      pintarianDineroConUnidadAjena(censo),
      "el tablero formatea sus importes con `datos.unidad`: una metrica de vistas que no sea `moneda` repite el defecto del cuadre de conciliacion (2026-08-07). O declara `moneda`, o necesita panel propio como `conciliacion_cierres`",
    ).toEqual([]);
  });

  it("y la que NO es de dinero se desvia antes: publica otra forma de DTO", () => {
    // La otra mitad de la premisa, medida en el mismo censo. Sin esto, la regla de arriba
    // pasaria igual el dia que `conciliacion_cierres` empezara a publicar `vistas` — y ese
    // dia el defecto volveria por la puerta grande.
    const noMonetarias = censo.filter((m) => m.unidad !== UNIDAD_DEL_DINERO);
    for (const metrica of noMonetarias) {
      expect(
        metrica.tipo,
        `${metrica.id} declara unidad "${metrica.unidad}" y tiene que llegar a la pantalla por un panel propio, no por el camino que formatea con la cabecera`,
      ).not.toBe(TIPO_VISTAS);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Contrapeso: el censo mira algo, y la premisa del tablero sigue viva          */
/* -------------------------------------------------------------------------- */

describe("cobertura · el censo no puede pasar por vacio", () => {
  it("el dominio financiero del catalogo no esta vacio", () => {
    // Si el dominio se renombrara, `listarMetricas` devolveria [] y las dos reglas de
    // arriba pasarian sobre un conjunto vacio para siempre. Es la leccion de la tanda H de
    // la 184: una guardia que no encuentra nada pasa verde y se vuelve adorno.
    expect(
      listarMetricas({ dominio: "financiera" }).length,
      "el catalogo no declara ninguna metrica financiera: este guardia estaria censando la nada",
    ).toBeGreaterThan(0);
  });

  it("todas las financieras del catalogo respondieron: ninguna se cayo del censo en silencio", () => {
    expect(noServidas, "el servicio no sirvio estas metricas y quedaron fuera del censo").toEqual(
      [],
    );
    expect(censo.length).toBe(listarMetricas({ dominio: "financiera" }).length);
  });

  it("el censo contiene metricas de las DOS formas de DTO", () => {
    // Con cero de `vistas` la regla principal seria vacua; con cero de `conciliacion` lo
    // seria la del desvio. No se fija el numero de cada una —una metrica nueva no debe
    // poner rojo un guardia por existir—, solo que ninguna de las dos familias esta vacia.
    const deVistas = censo.filter((m) => m.tipo === TIPO_VISTAS);
    const deConciliacion = censo.filter((m) => m.tipo === TIPO_CONCILIACION);

    expect(deVistas.length, "nadie llega por el camino de vistas: la regla seria vacua").toBeGreaterThan(
      0,
    );
    expect(
      deConciliacion.length,
      "ninguna metrica se desvia a panel propio: la regla del desvio seria vacua",
    ).toBeGreaterThan(0);
  });

  it("el tablero SIGUE desviando el DTO de conciliacion antes de formatear con la cabecera", () => {
    expect(
      desviaElDtoDeConciliacion(CODIGO_TABLERO),
      `${TABLERO} dejo de desviar el DTO "${TIPO_CONCILIACION}" a su panel propio: sin ese desvio, una metrica de unidad no monetaria vuelve a caer en el formateo por cabecera y la regla de este guardia deja de bastar`,
    ).toBe(true);
  });

  it("y el sitio que este guardia protege sigue ahi", () => {
    // Contrapeso incomodo a proposito. Si alguien retira `unidad={datos.unidad}` —por
    // ejemplo declarando la unidad POR CIFRA, como se hizo en `PanelConciliacion`—, este
    // caso se pone rojo. No es un error suyo: es la señal de que el motivo de este guardia
    // cambio y hay que releerlo antes de darlo por bueno o retirarlo.
    expect(
      pasaLaUnidadDeCabecera(CODIGO_TABLERO),
      `${TABLERO} ya no formatea con la unidad de la cabecera: revise si este guardia sigue haciendo falta antes de tocarlo`,
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Autocomprobacion: los detectores detectan lo que dicen detectar             */
/* -------------------------------------------------------------------------- */

describe("autocomprobacion · los detectores discriminan", () => {
  const VISTAS_MONEDA: MetricaCensada = { id: "m_ok", unidad: "moneda", tipo: TIPO_VISTAS };
  const VISTAS_CONTEO: MetricaCensada = { id: "m_mala", unidad: "conteo", tipo: TIPO_VISTAS };
  const CONCILIACION_CONTEO: MetricaCensada = {
    id: "m_desviada",
    unidad: "conteo",
    tipo: TIPO_CONCILIACION,
  };

  it("marca la metrica de vistas cuya unidad no es dinero, y la nombra", () => {
    const marcadas = pintarianDineroConUnidadAjena([VISTAS_MONEDA, VISTAS_CONTEO]);
    expect(marcadas).toHaveLength(1);
    expect(marcadas[0]).toContain("m_mala");
    // El mensaje dice POR QUE importa, no solo que pasa: un guardia que solo grita se
    // silencia.
    expect(marcadas[0]).toContain("sin moneda");
  });

  it("marca las otras dos unidades no monetarias, no solo `conteo`", () => {
    const porcentaje: MetricaCensada = { id: "m_pct", unidad: "porcentaje", tipo: TIPO_VISTAS };
    const segundos: MetricaCensada = { id: "m_seg", unidad: "segundos", tipo: TIPO_VISTAS };
    expect(pintarianDineroConUnidadAjena([porcentaje, segundos])).toHaveLength(2);
  });

  it("NO marca la que se desvia a panel propio aunque su unidad no sea dinero", () => {
    // Es exactamente `conciliacion_cierres` hoy: unidad `conteo` y ninguna cifra formateada
    // con la cabecera. Si esto se marcara, el guardia estaria pidiendo que el catalogo
    // mintiera sobre lo que la metrica mide.
    expect(pintarianDineroConUnidadAjena([CONCILIACION_CONTEO])).toEqual([]);
  });

  it("con un censo vacio no marca nada: por eso hace falta el contrapeso de cobertura", () => {
    // Se afirma la limitacion en vez de insinuarla: el detector NO puede distinguir «todo
    // en orden» de «no mire nada», y quien lo distingue son los casos de cobertura.
    expect(pintarianDineroConUnidadAjena([])).toEqual([]);
  });

  it("el detector del desvio pide la comparacion Y el panel, y no se conforma con la prosa", () => {
    expect(
      desviaElDtoDeConciliacion(
        `if (datos.tipo === "${TIPO_CONCILIACION}") return <PanelConciliacion datos={datos} />;`,
      ),
    ).toBe(true);
    expect(
      desviaElDtoDeConciliacion(
        `if (datos.tipo === '${TIPO_CONCILIACION}') { return <PanelConciliacion key={panel.id} datos={datos} />; }`,
      ),
    ).toBe(true);
    // Sin el desvio: la comparacion sola (que podria estar decidiendo otra cosa) no basta.
    expect(
      desviaElDtoDeConciliacion(`if (datos.tipo === "${TIPO_CONCILIACION}") return null;`),
    ).toBe(false);
    expect(desviaElDtoDeConciliacion("return <PanelConciliacion datos={datos} />;")).toBe(false);
    // Y una mencion en un comentario no es un desvio.
    expect(
      desviaElDtoDeConciliacion(
        `// se desvia con datos.tipo === "${TIPO_CONCILIACION}" a <PanelConciliacion />`,
      ),
    ).toBe(false);
  });

  it("el detector del sitio protegido ve la prop y no su mencion escrita", () => {
    expect(pasaLaUnidadDeCabecera("<ContenidoDeVista unidad={datos.unidad} />")).toBe(true);
    expect(pasaLaUnidadDeCabecera("<ContenidoDeVista unidad={ datos.unidad } />")).toBe(true);
    expect(pasaLaUnidadDeCabecera("<PanelKpi unidad={UNIDAD.importe} />")).toBe(false);
    expect(pasaLaUnidadDeCabecera("// nunca formatee un importe con datos.unidad")).toBe(false);
  });
});

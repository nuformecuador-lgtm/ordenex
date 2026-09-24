// FICHA 441 — LO QUE LA TARJETA HEROE ESCRIBE, incluido lo que escribe CUANDO NO HAY CIFRA.
//
// Modulo PURO: recibe la madurez ya evaluada (`lib/analytics/madurez-cohorte.ts`) y devuelve
// cadenas. Sin React, sin SWR y sin reloj, que es lo que permite comprobar aqui —sin renderizar
// nada— la mitad del encargo que de verdad puede equivocarse: los DOS estados en que un
// porcentaje no se puede afirmar.
//
// ─── LA REGLA, EN UNA LINEA ─────────────────────────────────────────────────────────────
//
// **Si no hay porcentaje, hay una frase.** Nunca un guion, nunca un «0 %», nunca un hueco.
//
// Los dos estados y por que cada uno dice lo que dice:
//
//  1. **CERO CERRADAS** (`sin_cerradas`). Medido en produccion: la zona Puntarenas tiene 0 de 27.
//     Un «0,0 %» ahi le dice al encargado que lo hace todo mal, cuando lo que pasa es que no se
//     ha movido nada. Se escribe «0 de 27» —las ordenes, que es el dato que SI existe— y se dice
//     que la cifra aparecera en cuanto cierre la primera.
//  2. **BASE DEMASIADO CHICA** (`base_insuficiente`). Con menos de veinte, cada orden vale mas de
//     cinco puntos y el numero salta solo. Se escriben las dos cantidades —entregadas y base— y
//     se dice cuanto movería una sola orden. **El umbral y la tolerancia se IMPORTAN**
//     (`MINIMO_BASE_PORCENTAJE`, `efectividadCohorteConfig`): escribir «20» o «5 %» a mano aqui
//     dejaria dos numeros que se separan el dia que alguien ajuste la tolerancia, y el texto
//     mentiria sin que nada se pusiera rojo.
//
// ─── POR QUE EL HEROE NO DICE «CERRADAS» ────────────────────────────────────────────────
//
// Su denominador son las ordenes CON DESENLACE DE GESTION, que no es lo que cuentan
// `CicloVidaKpi` ni `CohorteCargaTabla` —los dos cuentan estados terminales— y sus cifras no
// coinciden. Las tres lecturas se conservan (son tres preguntas distintas) pero no comparten
// sustantivo: el reparto esta escrito en `base-del-kpi.ts` y lo vigila
// `tests/components/FilaKpisVocabulario.test.tsx`.

import { formatearValor } from "@/components/private/analytics/formato";
import {
  MINIMO_BASE_PORCENTAJE,
  type MadurezDeCohorte,
  type PorcentajeDeEntrega,
} from "@/lib/analytics/madurez-cohorte";
import { efectividadCohorteConfig } from "@/lib/config/efectividad-cohorte";

import {
  contarOrdenes,
  ORDENES,
  ORDENES_CARGADAS,
  ORDENES_CON_DESENLACE,
} from "./base-del-kpi";

/** La cifra y la frase que ocupan el hueco grande de la tarjeta. Solo una de las dos. */
export interface TitularDelHeroe {
  /** La FRACCION a pintar en la cifra de 68 px, o `null` si no se puede afirmar. */
  readonly porcentaje: number | null;
  /** Lo que va debajo de la cifra, o EN SU LUGAR cuando `porcentaje` es `null`. Nunca vacio. */
  readonly titular: string;
  /** La segunda linea: el porque. `null` solo cuando el titular se basta solo. */
  readonly detalle: string | null;
}

/** Los rotulos fijos. Props y no literales incrustados en el JSX: listos para i18n. */
export const TEXTO_HEROE = {
  rotulo: "Efectividad de entrega",
  /**
   * «de 790 órdenes cargadas» — sobre cuantas se calcula la cifra, pegado al rotulo
   * (ficha 360).
   *
   * ⚠ NO SE LLAMA `universo`, y no es capricho: ese nombre es un campo del catalogo de
   * metricas (`DefinicionMetrica.universo`) y `catalogo-produccion.guardia` censa en todo
   * `app/` quien lo LEE, porque ninguna cifra de produccion puede depender de el. Una clave
   * homonima da rojo en ese censo — con razon, porque el detector no puede distinguirlas. Es
   * el mismo cuidado que ya se tomo `CohorteCargaTabla` con su `cargadasDelPeriodo`.
   */
  baseCargadas: (cargadas: number) => `de ${contarOrdenes(cargadas, ORDENES_CARGADAS)}`,
  leyenda: {
    entregadas: "Entregadas",
    otroDesenlace: "Otro desenlace",
    vivas: "Todavía en proceso",
  },
} as const;

/** «5 %» y «20», escritos desde su unica fuente. Ver la cabecera. */
const TOLERANCIA = formatearValor(efectividadCohorteConfig.MAXIMO_SALTO_POR_ORDEN, "porcentaje");
const SUELO = formatearValor(MINIMO_BASE_PORCENTAJE, "conteo");

/** «424 entregadas», concordando en singular. La cifra pasa por el formateador de la analitica. */
function contarEntregadas(n: number): string {
  return `${formatearValor(n, "conteo")} ${n === 1 ? "entregado" : "entregadas"}`;
}

/**
 * El hueco grande: el porcentaje sobre las CARGADAS, o la frase que lo sustituye.
 *
 * ⚠ EL ORDEN DE LOS CASOS IMPORTA. «No entro ninguna orden» se mira ANTES que el motivo,
 * porque con `cargadas === 0` la regla devuelve `sin_cerradas` —es cierto, no hay cerradas— y
 * «0 de 0 tienen desenlace» no le dice nada a nadie: lo que pasa es que el recorte esta vacio.
 */
export function titularDelHeroe(madurez: MadurezDeCohorte): TitularDelHeroe {
  const { cargadas, entregadas, cerradas, sobreCargadas } = madurez;

  if (cargadas === 0) {
    return {
      porcentaje: null,
      titular: "No entró ninguna orden",
      detalle: "En el período elegido no se cargó ninguna orden con los filtros puestos.",
    };
  }

  if (sobreCargadas.valor !== null) {
    return {
      porcentaje: sobreCargadas.valor,
      titular: contarEntregadas(entregadas),
      detalle: `de las ${contarOrdenes(cargadas, ORDENES)} que entraron`,
    };
  }

  if (sobreCargadas.motivo === "sin_cerradas") {
    return {
      porcentaje: null,
      titular: "Ninguna ha terminado todavía",
      detalle:
        `${cerradas} de ${contarOrdenes(cargadas, ORDENES)} tienen desenlace. ` +
        "El porcentaje aparece en cuanto se cierre la primera.",
    };
  }

  // `base_insuficiente`: se ensenan las ordenes, que es el dato que si existe.
  return {
    porcentaje: null,
    titular: `${contarEntregadas(entregadas)} de ${contarOrdenes(cargadas, ORDENES)}`,
    detalle:
      `Son muy pocas para un porcentaje: con menos de ${SUELO}, ` +
      `una sola orden movería la cifra más de ${TOLERANCIA}.`,
  };
}

/**
 * La linea de abajo: el porcentaje sobre las que YA TIENEN DESENLACE — la cifra que dice si se
 * esta entregando bien HOY, porque no castiga a la cohorte por ser joven.
 *
 * `null` significa NO PINTAR LA LINEA, y pasa en un solo caso: con cero desenlaces, donde el
 * titular de arriba ya dice «0 de 27» y repetirlo con otras palabras es ruido, no informacion.
 * En el otro estado —base chica— SI se escribe, porque ahi el titular habla de las cargadas y
 * esta linea habla de otra base distinta.
 */
export function fraseSobreCerradas(
  sobreCerradas: PorcentajeDeEntrega,
  cargadas: number,
): string | null {
  if (sobreCerradas.valor !== null) {
    return (
      `${formatearValor(sobreCerradas.valor, "porcentaje")} de las ` +
      `${contarOrdenes(sobreCerradas.base, ORDENES_CON_DESENLACE)} terminaron entregadas`
    );
  }

  if (sobreCerradas.motivo === "sin_cerradas") return null;

  // ⚠ CON LA COHORTE YA CERRADA NO SE ESCRIBE «de N», y no es cosmetica: medido en la app el
  // 2026-09-17 con el recorte de un mensajero, la frase salia «Sólo 8 de 8 órdenes tienen
  // desenlace», que se lee como un descuido — «8 de 8» es todas. Lo que falta ahi no es que
  // hayan cerrado pocas de las cargadas: es que la cohorte entera es chica.
  if (sobreCerradas.base === cargadas) {
    return (
      `Las ${contarOrdenes(cargadas, ORDENES)} tienen desenlace, pero hacen falta ${SUELO} ` +
      "para que este porcentaje no baile solo."
    );
  }

  return (
    `Sólo ${sobreCerradas.base} de ${contarOrdenes(cargadas, ORDENES)} tienen desenlace: ` +
    `hacen falta ${SUELO} para que este porcentaje no baile solo.`
  );
}

/**
 * EL AVISO DE COHORTE JOVEN. `null` = no se pinta, y es el caso normal de un período cerrado.
 *
 * Es lo que distingue «va mal» de «es joven», y el motivo por el que esta ficha no se podia
 * resolver cambiando solo la ventana de la consulta: con la ventana puesta sobre la carga, una
 * cohorte de ayer lee 14,7 % —medido— y sin este aviso el tablero parece decir que el negocio
 * se hundio de un dia para otro.
 */
export function avisoPeriodoEnCurso(madurez: MadurezDeCohorte): string | null {
  if (!madurez.enCurso) return null;
  return (
    `Este período todavía se está cerrando. ${madurez.vivas} de sus ` +
    `${contarOrdenes(madurez.cargadas, ORDENES)} siguen vivas, así que la efectividad va a subir.`
  );
}

/** El titulo corto del aviso, en negrita delante de la frase. */
export const TITULO_AVISO_EN_CURSO = "Período abierto";

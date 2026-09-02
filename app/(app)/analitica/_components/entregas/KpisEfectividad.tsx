"use client";

// Los KPIs de EFECTIVIDAD DE ENTREGA, encima de las gráficas de la sección.
//
// ─── NO PIDE DATOS PROPIOS: SE ENGANCHA A LOS DEL DESGLOSE ──────────────────────────────
//
// La clave de SWR es LA MISMA que la de `ConteoPorStatusDona`
// (`[CLAVE_TABLERO, "conteo-por-status", filtro]`), y eso no es un parecido: SWR deduplica por
// clave, así que las dos piezas comparten UNA petición y UNA respuesta. Consecuencias, las dos
// buscadas:
//
//   1. estas cifras y los segmentos de al lado salen de las mismas filas, así que no pueden
//      discrepar. Con una consulta propia —aunque preguntara lo mismo— bastaría una gestión
//      registrada entre las dos para pintar un «85 %» que no cuadra con el gráfico de debajo;
//   2. añadir estos KPIs no añade tráfico ni carga a la base.
//
// Si algún día alguien cambia la clave en uno de los dos archivos, se rompe el enganche y
// vuelven dos consultas: la clave es contrato compartido, no un detalle local.
//
// El reparto lo hace `calcularEfectividad`, que es puro y vive aparte; aquí solo se resuelven
// los estados (cargando, error, sin datos) y se pintan tres tarjetas.
//
// ─── FICHA 360: LOS DOS PORCENTAJES DICEN SOBRE CUÁNTAS ÓRDENES SE CALCULAN ─────────────
//
// El defecto reportado (humano, 2026-08-29) sobre la fila de «Detalle · Movimiento de las
// órdenes»: «Efectividad de entrega 29,5 %» y «Efectividad de la gestión 38,7 %» no decían de
// cuántas órdenes salían. Un 29,5 % sobre 877 y un 29,5 % sobre 17 no son la misma afirmación,
// y la cifra sola no las distingue — el mismo argumento que ya obligó a `CicloVidaKpi` a
// escribir su `n`.
//
// LA SOLUCIÓN NO ES NUEVA: ES LA DE `CicloVidaKpi`, la quinta tarjeta de esta misma fila. El
// denominador va DENTRO del rótulo, en `text-sm` (la etiqueta ya es la letra pequeña de la
// tarjeta; la cifra es `text-2xl`), y con sus dos cuidados:
//
//   - mientras la consulta está EN VUELO o hay ERROR no se escribe ninguna base: un
//     «(0 órdenes)» ahí es una afirmación de negocio que nadie ha hecho;
//   - con `n = 0` SÍ se escribe, porque es justo lo que explica el guion de la cifra.
//
// Una segunda manera de escribir la base en esta misma fila —una línea suelta debajo, un
// `<span>` con otro tamaño, otro paréntesis con otra forma— sería el defecto que la 348 ya
// pagó en la tabla de productos: dos convenciones para el mismo hecho.
//
// ⚠ Y LA BASE SALE DE `calcularEfectividad`, DE LA MISMA LLAMADA QUE EL PORCENTAJE. No de
// `datos.total`, que viaja HECHO en el DTO y hoy vale lo mismo. Hoy: el DTO promete que su
// `total` es la suma de los `conteo`, pero es una promesa de OTRO módulo, y el día que el
// servidor decida excluir algo del `total` sin tocar `porStatus` esta tarjeta pintaría un
// porcentaje calculado sobre un universo y una base tomada de otro. Que es exactamente el
// problema que la ficha viene a mitigar, reintroducido por la puerta de al lado.
// Lo fija `tests/components/KpisEfectividad.test.tsx` › «la base sale de la misma cuenta…»,
// que mete a propósito un DTO donde las dos fuentes discrepan.

import useSWR from "swr";

import { serializarFiltroEntregas } from "@/app/(app)/_components/entregas-filtro-analitica";
import { useFiltroEntregas } from "@/app/(app)/_components/filtro-entregas";
import { KpiCard } from "@/components/private/analytics/KpiCard";
import { consultarConteoPorStatus } from "@/lib/actions/conteo-por-status";
import type { ResultadoConteoPorStatus } from "@/lib/types/conteo-por-status";

import {
  TEXTO_ERROR_PANEL,
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  TITULO_FILTRO_INVALIDO,
} from "../operativo/textos";
import { CLAVE_TABLERO } from "../operativo/PanelOperativo";

import { contarOrdenes, ORDENES, rotuloConBase } from "./base-del-kpi";
import { calcularEfectividad } from "./efectividad";

const ETIQUETA = {
  efectividad: "Efectividad de entrega",
  efectividadGestion: "Efectividad de la gestión",
  entregadas: "Entregadas",
  enProceso: "En proceso",
} as const;

/**
 * FICHA 360 — «Efectividad de entrega (877 órdenes)».
 *
 * Aquí la base basta sola: el numerador de esta tarjeta son las entregadas, y «efectividad de
 * entrega» ya lo dice. Además la tarjeta «Entregadas» está en la misma fila con esa cifra
 * exacta, así que el 29,5 % de 877 se puede comprobar de un vistazo.
 */
function rotuloEfectividad(total: number): string {
  return rotuloConBase(ETIQUETA.efectividad, contarOrdenes(total, ORDENES));
}

/**
 * FICHA 360 — «Efectividad de la gestión (entregadas y rechazadas de 877 órdenes)».
 *
 * ⚠ AQUÍ LA BASE SOLA NO BASTA, Y ESE ES EL MOTIVO DE LA FRASE LARGA. Esta cifra es
 * `(entregadas + rechazadas) / total`: comparte denominador con su vecina —a propósito, para
 * que su diferencia sea exactamente el peso de los rechazos— pero NO comparte numerador. Con la
 * base a la vista y sin decir el numerador, la mejora se vuelve una trampa: cualquiera puede
 * multiplicar 38,7 % × 877 = 339 y concluir «339 entregadas», que contradice el 259 de la
 * tarjeta de al lado. Nombrar los dos sumandos cierra esa lectura.
 *
 * NO se escribe la fórmula («(entregadas + rechazadas) / 877»): el rótulo de un KPI se lee de
 * un vistazo, no se resuelve. Lo que hace falta es que nadie deduzca un numerador equivocado, y
 * para eso alcanza con nombrarlo.
 */
function rotuloEfectividadGestion(total: number): string {
  return rotuloConBase(
    ETIQUETA.efectividadGestion,
    `entregadas y rechazadas de ${contarOrdenes(total, ORDENES)}`,
  );
}

async function consultar(filtroSerializado: string): Promise<ResultadoConteoPorStatus> {
  return consultarConteoPorStatus(JSON.parse(filtroSerializado) as unknown);
}

/** El mensaje de error que corresponde a cada estado que no es `ok`. `null` = no hay error. */
function mensajeDe(resultado: ResultadoConteoPorStatus | undefined, fallo: boolean): string | null {
  if (fallo) return TEXTO_ERROR_PANEL;
  if (!resultado) return null;
  switch (resultado.status) {
    case "unauthenticated":
      return TEXTO_SESION_NO_VALIDA;
    case "forbidden":
      return TEXTO_PROHIBIDO;
    case "validation_error":
      return TITULO_FILTRO_INVALIDO;
    default:
      return null;
  }
}

export function KpisEfectividad() {
  const { filtro } = useFiltroEntregas();
  const filtroSerializado = serializarFiltroEntregas(filtro);

  // ⚠ MISMA CLAVE que `ConteoPorStatusDona`. Ver la cabecera: de aquí sale que las dos piezas
  // compartan petición y, sobre todo, que compartan RESPUESTA.
  const { data, error, isLoading } = useSWR(
    [CLAVE_TABLERO, "conteo-por-status", filtroSerializado],
    () => consultar(filtroSerializado),
    { keepPreviousData: false, revalidateOnFocus: false },
  );

  const mensaje = mensajeDe(data, error !== undefined);
  const datos = data?.status === "ok" ? data.datos : null;
  const { entregadas, enProceso, efectividad, efectividadGestion, total } = calcularEfectividad(
    datos?.porStatus ?? [],
  );

  // Sin universo no se pintan ceros: `KpiCard` con `null` escribe el marcador de dato ausente.
  // Un «0 %» donde no hubo órdenes afirma que se falló cada entrega, que es otra cosa.
  const hayDato = datos !== null && total > 0;
  const cifra = (valor: number) => (hayDato ? valor : null);

  // FICHA 360 — ¿SE CONOCE LA BASE? Mismo trato que en `CicloVidaKpi`, y por el mismo motivo:
  // con la consulta EN VUELO (`datos === null`, porque `keepPreviousData: false`) o con un
  // aviso en pantalla no hay `n` que escribir, y un «(0 órdenes)» ahí sería una afirmación de
  // negocio que nadie ha hecho.
  //
  // ⚠ NO es `hayDato`: esa otra condición pide `total > 0` porque decide si se pinta la CIFRA.
  // La base sí se escribe con `total === 0` —«(0 órdenes)»— porque es justo lo que explica el
  // guion que aparece en el valor: no es que falte el dato, es que no entró ninguna orden.
  const seConoceLaBase = datos !== null && mensaje === null;

  // ⚠ DEVUELVE UN FRAGMENTO, NO UNA REJILLA, y es deliberado: estas tres tarjetas comparten
  // fila con el KPI de ciclo de vida, que es otro componente. Si cada uno trajera su propia
  // rejilla serian dos filas pegadas —con dos `gap` y dos anchos de columna— en vez de una fila
  // de cuatro tarjetas iguales. La rejilla la pone quien compone la fila (`page.tsx`), que es
  // el unico que sabe cuantas tarjetas hay en ella.
  return (
    <>
      <KpiCard
        // FICHA 360 — el rótulo lleva DENTRO la base sobre la que se calcula el porcentaje, y
        // esa base sale de `total`, que es el MISMO `calcularEfectividad` de arriba que produjo
        // `efectividad`. Ver la cabecera: leerla de `datos.total` —que hoy vale lo mismo— es la
        // mutación que el test de procedencia pone en rojo.
        etiqueta={seConoceLaBase ? rotuloEfectividad(total) : ETIQUETA.efectividad}
        // Fracción, no puntos: `formatearValor(_, "porcentaje")` multiplica por 100 y pone el
        // símbolo en el locale configurado.
        valor={hayDato ? efectividad : null}
        unidad="porcentaje"
        cargando={isLoading}
        error={mensaje}
      />
      <KpiCard
        // Entregadas + rechazadas sobre las mismas órdenes creadas: mide el trabajo del
        // mensajero, no el resultado comercial. Va junto a la anterior porque comparten
        // denominador y su diferencia es justamente el peso de los rechazos.
        //
        // FICHA 360 — y por eso su rótulo dice DOS cosas y no una: la misma base que su vecina
        // (mismo `total`, misma cuenta) y además cuál es su numerador. Ver
        // `rotuloEfectividadGestion`.
        etiqueta={
          seConoceLaBase ? rotuloEfectividadGestion(total) : ETIQUETA.efectividadGestion
        }
        valor={hayDato ? efectividadGestion : null}
        unidad="porcentaje"
        cargando={isLoading}
        error={mensaje}
      />
      <KpiCard
        etiqueta={ETIQUETA.entregadas}
        valor={cifra(entregadas)}
        unidad="conteo"
        cargando={isLoading}
        error={mensaje}
      />
      <KpiCard
        // «En proceso» es EXACTAMENTE el cubo «Otros» del anillo de desenlaces: lo que todavía
        // no tiene desenlace. Se nombra en positivo porque como KPI describe trabajo vivo, no
        // un resto sobrante.
        etiqueta={ETIQUETA.enProceso}
        valor={cifra(enProceso)}
        unidad="conteo"
        cargando={isLoading}
        error={mensaje}
      />
    </>
  );
}

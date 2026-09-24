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
// los estados (cargando, error, sin datos) y se pinta la fila.
//
// ─── FICHA 441: LA FILA DEJA DE SER CINCO TARJETAS IGUALES ──────────────────────────────
//
// Medido a 1440 px el 2026-09-17: las cinco tarjetas pesaban lo mismo, así que «17,4 % de
// efectividad» se leía igual que «En proceso 37». Desde esta ficha la efectividad es un HÉROE
// —`EfectividadHeroe`, con la madurez de la cohorte dentro— y las tres tarjetas de aquí bajan
// de rango con `jerarquia="apoyo"`, igual que el ciclo de vida que comparte fila. «Bajar de
// rango» es elegir un valor de una unión cerrada del contrato de `KpiCard`, no colarle clases
// más pequeñas por `className`: ver `components/private/analytics/jerarquia.ts`.
//
// ─── FICHA 360: LOS DOS PORCENTAJES DICEN SOBRE CUÁNTAS ÓRDENES SE CALCULAN ─────────────
//
// El defecto reportado (humano, 2026-08-29) sobre la fila de «Detalle · Movimiento de las
// órdenes»: «Efectividad de entrega 29,5 %» y «Efectividad de la gestión 38,7 %» no decían de
// cuántas órdenes salían. Un 29,5 % sobre 877 y un 29,5 % sobre 17 no son la misma afirmación,
// y la cifra sola no las distingue — el mismo argumento que ya obligó a `CicloVidaKpi` a
// escribir su `n`.
//
// LA SOLUCIÓN NO ES NUEVA: ES LA DE `CicloVidaKpi`, la última tarjeta de esta misma fila. El
// denominador va DENTRO del rótulo, que es la letra pequeña de la tarjeta frente a su cifra
// (ver `jerarquia.ts`: el rótulo y la cifra bajan juntos al pasar a `apoyo`), y con sus dos
// cuidados:
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
import { evaluarMadurezDeCohorte } from "@/lib/analytics/madurez-cohorte";
import type { ResultadoConteoPorStatus } from "@/lib/types/conteo-por-status";
import { NOMBRE_ESTADO } from "@/lib/types/order-status";

import {
  TEXTO_ERROR_PANEL,
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  TITULO_FILTRO_INVALIDO,
} from "../operativo/textos";
import { CLAVE_TABLERO } from "../operativo/PanelOperativo";

import { contarOrdenes, ORDENES, rotuloConBase } from "./base-del-kpi";
import { EfectividadHeroe } from "./EfectividadHeroe";
import { calcularEfectividad } from "./efectividad";
import { ETIQUETA_EN_PROCESO } from "./desenlaces-de-fila";

// FICHA 455 (2026-09-24, R5/R6): la tarjeta que cuenta UN desenlace lleva su nombre exacto
// («Entregado»); la de las órdenes sin desenlace es un GRUPO y lleva el rótulo propio de la tabla
// y del archivo (`ETIQUETA_EN_PROCESO`, antes «En proceso», un nombre retirado).
const ETIQUETA = {
  efectividadGestion: "Efectividad de la gestión",
  entregadas: NOMBRE_ESTADO.entregado,
  enProceso: ETIQUETA_EN_PROCESO,
} as const;

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
    // FICHA 455 (2026-09-24): los dos sumandos por su nombre vigente (antes «entregadas y rechazadas»).
    `${NOMBRE_ESTADO.entregado} y ${NOMBRE_ESTADO.devolucion_a_origen_por_rechazo} de ` +
      `${contarOrdenes(total, ORDENES)}`,
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
  const reparto = calcularEfectividad(datos?.porStatus ?? []);
  const { entregadas, enProceso, efectividadGestion, total } = reparto;

  // FICHA 441 — LA MADUREZ DE LA COHORTE, derivada del MISMO reparto que ya alimentaba estas
  // tarjetas. No se recuenta nada: `evaluarMadurezDeCohorte` recibe la partición hecha (por eso
  // sus nombres son los de `calcularEfectividad`) y sólo deriva cerradas, vivas y los dos
  // porcentajes con su motivo. Una segunda partición de la misma población es exactamente el
  // defecto que la ficha 346 pagó.
  const madurez = evaluarMadurezDeCohorte(reparto);

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

  // ⚠ DEVUELVE UN FRAGMENTO, NO UNA REJILLA, y es deliberado: el heroe y estas tres tarjetas
  // comparten fila con el KPI de ciclo de vida, que es otro componente. Si cada uno trajera su
  // propia rejilla serian dos filas pegadas —con dos `gap` y dos anchos de columna— en vez de
  // una fila. La rejilla la pone quien compone la fila (`page.tsx`), que es el unico que sabe
  // cuantas tarjetas hay en ella y cuantas columnas ocupa el heroe.
  return (
    <>
      {/* FICHA 441 — EL HÉROE. Ocupa el hueco de dos tarjetas (lo decide la rejilla de
          `page.tsx`, no él) y se lleva dentro la efectividad, la madurez de la cohorte y el
          porcentaje sobre las que ya tienen desenlace.

          ⚠ LA MADUREZ SÓLO VIAJA CUANDO SE CONOCE: con la consulta en vuelo o con un aviso en
          pantalla se pasa `null` y la tarjeta enseña su esqueleto. Pasarle el reparto vacío
          pintaría «No entró ninguna orden» mientras carga, que es una afirmación de negocio que
          nadie ha hecho — el mismo cuidado que la base de la ficha 360. */}
      <EfectividadHeroe
        madurez={seConoceLaBase ? madurez : null}
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
        // ⚠ FICHA 441 — COMPARTE EL VETO DEL HÉROE, y no es una precaución de más: esta cifra
        // tiene el MISMO universo y el MISMO denominador que la de arriba, así que cuando aquélla
        // no se puede afirmar, ésta tampoco. Sin el veto, la zona Puntarenas (0 de 27, medido)
        // enseñaría el héroe diciendo «ninguna ha terminado todavía» y, tres centímetros más
        // allá, un «0,0 %» afirmando que se falló cada gestión. Aquí sí es un guion —esta
        // tarjeta no tiene sitio para una frase— pero su rótulo lleva la base, que es lo que
        // explica el guion (ficha 360).
        valor={hayDato && madurez.sobreCargadas.valor !== null ? efectividadGestion : null}
        unidad="porcentaje"
        cargando={isLoading}
        error={mensaje}
        jerarquia="apoyo"
      />
      <KpiCard
        etiqueta={ETIQUETA.entregadas}
        valor={cifra(entregadas)}
        unidad="conteo"
        cargando={isLoading}
        error={mensaje}
        jerarquia="apoyo"
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
        jerarquia="apoyo"
      />
    </>
  );
}

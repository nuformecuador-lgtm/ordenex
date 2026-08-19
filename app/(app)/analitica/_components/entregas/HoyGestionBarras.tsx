"use client";

// El contador de HOY, en dos barras: de las ordenes que entraron hoy, cuantas ha tocado ya
// alguien y cuantas siguen sin tocar.
//
// ⚠ ESTA GRAFICA NO OBEDECE AL SELECTOR DE FECHAS, y la pantalla esta obligada a decirlo. Su
// ventana es SIEMPRE el dia calendario de Costa Rica en curso, resuelto por el reloj del
// SERVIDOR — un contador «de hoy» que obedeciera al selector dejaria de ser el contador de hoy
// sin cambiar de rotulo. Tampoco aplica el filtro de mensajero: una orden no la carga un
// mensajero. Lo que SI aplica son el alcance y las cinco facetas de recorte (zona, provincia,
// canton, distrito, tienda).
//
// Por eso el titulo lleva la fecha que devolvio el servidor y no un «Hoy» a secas: `hoy` en el
// navegador y `hoy` en Costa Rica no son el mismo dia para todo el mundo, y una pestana abierta
// desde ayer seguiria diciendo «hoy» sobre un contador de ayer. Con la fecha delante, eso se ve.
//
// Reglas de la casa que se conservan, y por reuso y no por copia:
//
//  - La cifra sale de UNA Server Action (`consultarConteoHoyGestion`) y de ninguna otra puerta.
//  - «Prohibido», «sesion no valida», «filtro invalido» y «se rompio» NO se degradan al vacio
//    de la grafica: un problema de permisos pintado como cero afirma que hoy no entro nada.
//  - El filtro sale del proveedor de entregas, no de la URL.

import useSWR from "swr";

import { serializarFiltroEntregas } from "@/app/(app)/_components/entregas-filtro-analitica";
import { useFiltroEntregas } from "@/app/(app)/_components/filtro-entregas";
import { GraficaReparto } from "@/components/private/analytics/GraficaReparto";
import { consultarConteoHoyGestion } from "@/lib/actions/conteo-hoy-gestion";
import type { ResultadoConteoHoyGestion } from "@/lib/types/conteo-hoy-gestion";

import {
  TEXTO_ERROR_PANEL,
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  TITULO_FILTRO_INVALIDO,
  VACIO_PANEL,
} from "../operativo/textos";
import { CLAVE_TABLERO } from "../operativo/PanelOperativo";

const TITULO_BASE = "Cargadas hoy";

/** Las DOS barras, en orden: primero lo que falta por hacer. */
const ETIQUETA_SIN_GESTION = "Sin gestionar";
const ETIQUETA_CON_GESTION = "Gestionadas";

/** La unidad del formateador: son ordenes contadas, no dinero ni porcentaje. */
const UNIDAD = "conteo";

async function consultar(filtroSerializado: string): Promise<ResultadoConteoHoyGestion> {
  return consultarConteoHoyGestion(JSON.parse(filtroSerializado) as unknown);
}

/** El mensaje de error que corresponde a cada estado que no es `ok`. `null` = no hay error. */
function mensajeDe(
  resultado: ResultadoConteoHoyGestion | undefined,
  fallo: boolean,
): string | null {
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

/**
 * El titulo con la fecha del servidor detras: «Cargadas hoy (2026-08-18)».
 *
 * La fecha viene del DTO y NO se calcula aqui con `new Date()`: el dia lo decide el servidor en
 * hora de Costa Rica, y un navegador en otro huso dibujaria otro. Sin datos todavia, el titulo
 * va desnudo — inventar una fecha mientras carga seria escribir un dia que nadie ha medido.
 */
export function tituloConFecha(fecha: string | null): string {
  return fecha === null ? TITULO_BASE : `${TITULO_BASE} (${fecha})`;
}

export function HoyGestionBarras() {
  // El filtro lo publica la barra de entregas, la MISMA que mueve las otras tres graficas —
  // aunque de el, esta lectura solo use el alcance y las facetas de recorte.
  const { filtro } = useFiltroEntregas();
  const filtroSerializado = serializarFiltroEntregas(filtro);

  const { data, error, isLoading } = useSWR(
    [CLAVE_TABLERO, "conteo-hoy-gestion", filtroSerializado],
    () => consultar(filtroSerializado),
    { keepPreviousData: false, revalidateOnFocus: false },
  );

  const mensaje = mensajeDe(data, error !== undefined);
  const datos = data?.status === "ok" ? data.datos : null;

  // Sin ninguna orden cargada hoy no hay grafica: dos barras de altura cero con sus ejes
  // dibujados se leen como una pantalla a medio cargar, no como «hoy no ha entrado nada». Eso
  // lo dice mejor el estado vacio del marco.
  const hayDato = datos !== null && datos.total > 0;

  const series = hayDato
    ? [
        {
          id: "hoy_gestion",
          etiqueta: TITULO_BASE,
          // Las dos barras salen SIEMPRE juntas, tambien cuando una vale cero: si el bucket en
          // cero desapareciera, «todo gestionado» y «todo pendiente» dibujarian la misma
          // grafica de una sola barra y solo la etiqueta las distinguiria.
          puntos: [
            { categoria: ETIQUETA_SIN_GESTION, valor: datos.sinGestion },
            { categoria: ETIQUETA_CON_GESTION, valor: datos.conGestion },
          ],
        },
      ]
    : [];

  return (
    // ⚠ UNA BARRA DIVIDIDA, NO DOS BARRAS (decisión del 2026-08-18, opción A). La pregunta es
    // qué PROPORCIÓN del día queda pendiente, y eso se lee en una barra partida en dos; dos
    // barras sueltas obligan a compararlas de altura y a hacer la división mentalmente.
    <GraficaReparto
      titulo={tituloConFecha(datos?.fecha ?? null)}
      series={series}
      unidad={UNIDAD}
      vacio={VACIO_PANEL}
      cargando={isLoading}
      error={mensaje}
      // El mismo alto rebajado que la serie de al lado: van en la misma fila de la rejilla y
      // dos lienzos de proporcion distinta dejarian la fila descuadrada.
      proporcion="bajo"
    />
  );
}

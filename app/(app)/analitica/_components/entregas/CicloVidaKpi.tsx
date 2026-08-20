"use client";

// El KPI del CICLO DE VIDA: cuanto tarda de media una orden desde que se crea hasta que llega
// a un estado terminal.
//
// ⚠ QUE MIDE Y QUE DEJA FUERA, porque una cifra sola no lo puede decir:
//   - el reloj arranca en `orden.created_at` y para en la ULTIMA transicion a
//     `entregada` / `devuelta_a_tienda` / `incidente`;
//   - SOLO cuentan las ordenes CERRADAS. Una que lleva tres semanas abierta no tiene fin de
//     reloj y no entra, asi que el promedio habla de las que se cerraron y no de todas — sesga
//     hacia abajo mientras haya cola sin cerrar;
//   - la ventana del filtro cae sobre el CIERRE, no sobre la creacion: una orden creada en
//     enero y cerrada en agosto cuenta en agosto.
//
// Por eso la etiqueta dice «cerradas» y no «ordenes» a secas, y por eso el DENOMINADOR va
// dentro de esa misma etiqueta: un promedio de 4 h sobre 3 ordenes y sobre 3.000 no son la
// misma afirmacion, y sin el `n` no hay forma de distinguirlas.
//
// El `n` vivia en una linea aparte DEBAJO de la tarjeta (pedido humano 2026-08-19: se retira).
// Iba fuera de la tarjeta —no cabe dentro de `KpiCard`— y eso lo dejaba flotando entre dos
// KPIs, sin decir de cual de los dos hablaba; ademas descuadraba el alto de la fila. Metido en
// el rotulo, el denominador viaja PEGADO a la cifra que califica y la tarjeta vuelve a ser una
// sola pieza.
//
// Reglas de la casa que se conservan, y por reuso y no por copia:
//
//  - La cifra sale de UNA Server Action (`consultarCicloVida`) y de ninguna otra puerta.
//  - «Prohibido», «sesion no valida», «filtro invalido» y «se rompio» NO se degradan a un cero
//    ni a un guion: usan el estado de error del propio `KpiCard`, con los MISMOS textos que el
//    resto de la seccion.
//  - El filtro sale del proveedor de entregas, no de la URL.

import useSWR from "swr";

import { serializarFiltroEntregas } from "@/app/(app)/_components/entregas-filtro-analitica";
import { useFiltroEntregas } from "@/app/(app)/_components/filtro-entregas";
import { KpiCard } from "@/components/private/analytics/KpiCard";
import { consultarCicloVida } from "@/lib/actions/ciclo-vida";
import type { ResultadoCicloVida } from "@/lib/types/conteo-ciclo-vida";

import {
  TEXTO_ERROR_PANEL,
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  TITULO_FILTRO_INVALIDO,
} from "../operativo/textos";
import { CLAVE_TABLERO } from "../operativo/PanelOperativo";

/** Rotulo sin denominador: mientras carga o cuando hay error, el `n` no se conoce. */
const ETIQUETA = "Ciclo de vida promedio (órdenes cerradas)";

/**
 * El mismo rotulo CON el denominador dentro. Concuerda en singular («1 orden cerrada»):
 * el KPI de una tarjeta se lee entero como una frase, y «1 órdenes» delata que nadie la leyo.
 */
function etiquetaCon(n: number): string {
  return `Ciclo de vida promedio (${n} ${n === 1 ? "orden cerrada" : "órdenes cerradas"})`;
}

/** La unidad del formateador: el valor son SEGUNDOS y `formato.ts` los pone legibles. */
const UNIDAD = "segundos";

async function consultar(filtroSerializado: string): Promise<ResultadoCicloVida> {
  return consultarCicloVida(JSON.parse(filtroSerializado) as unknown);
}

/** El mensaje de error que corresponde a cada estado que no es `ok`. `null` = no hay error. */
function mensajeDe(resultado: ResultadoCicloVida | undefined, fallo: boolean): string | null {
  if (fallo) return TEXTO_ERROR_PANEL;
  if (!resultado) return null;
  switch (resultado.status) {
    case "unauthenticated":
      // Texto DISTINTO al de prohibido: «no puedes» y «no sabemos quien eres» piden cosas
      // distintas del usuario.
      return TEXTO_SESION_NO_VALIDA;
    case "forbidden":
      return TEXTO_PROHIBIDO;
    case "validation_error":
      return TITULO_FILTRO_INVALIDO;
    default:
      return null;
  }
}

export function CicloVidaKpi() {
  // El filtro lo publica la barra de entregas, la MISMA que mueve las cuatro graficas.
  const { filtro } = useFiltroEntregas();
  const filtroSerializado = serializarFiltroEntregas(filtro);

  const { data, error, isLoading } = useSWR(
    [CLAVE_TABLERO, "ciclo-vida", filtroSerializado],
    () => consultar(filtroSerializado),
    { keepPreviousData: false, revalidateOnFocus: false },
  );

  const mensaje = mensajeDe(data, error !== undefined);
  const datos = data?.status === "ok" ? data.datos : null;

  return (
    <KpiCard
      // El denominador va DENTRO del rotulo, y solo cuando se conoce: con la consulta en
      // vuelo o en error no hay `n` que escribir, y un «(0 órdenes cerradas)» mientras carga
      // seria una afirmacion de negocio que nadie ha hecho todavia.
      //
      // Con `n = 0` SI se escribe —«(0 órdenes cerradas)»— porque es lo que explica el guion
      // de la cifra: no es que falte el dato, es que no hubo ninguna que cerrar.
      etiqueta={datos !== null && mensaje === null ? etiquetaCon(datos.n) : ETIQUETA}
      // `promedioSegundos` es `null` cuando no cerro ninguna orden, y `KpiCard` lo pinta como
      // guion: cero segundos de ciclo seria una afirmacion —«se cerraron al instante»— y lo
      // que paso es que no hubo ninguna que cerrar.
      valor={datos?.promedioSegundos ?? null}
      unidad={UNIDAD}
      cargando={isLoading}
      error={mensaje}
    />
  );
}

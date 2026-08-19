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
// Por eso la etiqueta dice «cerradas» y no «ordenes» a secas, y por eso el denominador va
// debajo: un promedio de 4 h sobre 3 ordenes y sobre 3.000 no son la misma afirmacion, y sin
// el `n` no hay forma de distinguirlas.
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

const ETIQUETA = "Ciclo de vida promedio (órdenes cerradas)";

/** La unidad del formateador: el valor son SEGUNDOS y `formato.ts` los pone legibles. */
const UNIDAD = "segundos";

/** Lo que se escribe debajo de la cifra. `%s` lo rellena el denominador. */
const SUFIJO_DENOMINADOR = "órdenes cerradas en el periodo";

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
    // `h-full` tambien AQUI: `KpiCard` se estira al alto de su padre, y su padre es este
    // envoltorio —que existe para colgarle debajo el denominador—. Sin el, el envoltorio mide
    // lo que su contenido y la tarjeta no tendria contra que estirarse.
    <div className="flex h-full w-full flex-col gap-1">
      <KpiCard
        etiqueta={ETIQUETA}
        // `promedioSegundos` es `null` cuando no cerro ninguna orden, y `KpiCard` lo pinta como
        // guion: cero segundos de ciclo seria una afirmacion —«se cerraron al instante»— y lo
        // que paso es que no hubo ninguna que cerrar.
        valor={datos?.promedioSegundos ?? null}
        unidad={UNIDAD}
        cargando={isLoading}
        error={mensaje}
      />
      {/* EL DENOMINADOR, debajo y siempre que haya respuesta. No es un detalle: un promedio de
          cuatro horas sobre 3 ordenes y sobre 3.000 no son la misma afirmacion, y la cifra sola
          no las distingue. Con `n = 0` tambien se escribe —«0 ordenes cerradas»— porque es lo
          que explica el guion de arriba. */}
      {datos !== null && mensaje === null ? (
        <p className="text-xs text-muted-foreground">{`${datos.n} ${SUFIJO_DENOMINADOR}`}</p>
      ) : null}
    </div>
  );
}

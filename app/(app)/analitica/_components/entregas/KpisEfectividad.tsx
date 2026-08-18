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

import { calcularEfectividad } from "./efectividad";

const ETIQUETA = {
  efectividad: "Efectividad de entrega",
  efectividadGestion: "Efectividad de la gestión",
  entregadas: "Entregadas",
  enProceso: "En proceso",
} as const;

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

  // ⚠ DEVUELVE UN FRAGMENTO, NO UNA REJILLA, y es deliberado: estas tres tarjetas comparten
  // fila con el KPI de ciclo de vida, que es otro componente. Si cada uno trajera su propia
  // rejilla serian dos filas pegadas —con dos `gap` y dos anchos de columna— en vez de una fila
  // de cuatro tarjetas iguales. La rejilla la pone quien compone la fila (`page.tsx`), que es
  // el unico que sabe cuantas tarjetas hay en ella.
  return (
    <>
      <KpiCard
        etiqueta={ETIQUETA.efectividad}
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
        etiqueta={ETIQUETA.efectividadGestion}
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

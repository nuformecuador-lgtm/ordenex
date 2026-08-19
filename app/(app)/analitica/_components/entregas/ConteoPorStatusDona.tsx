"use client";

// La dona de ORDENES POR STATUS: un segmento por status con al menos una orden.
//
// Es la hermana del anillo de conteo y comparte con el TODO lo que se puede compartir: el
// mismo filtro (`FiltroEntregasProvider`), los mismos textos de error, el mismo marco y el
// mismo sello de frescura. Lo que cambia es la pregunta: aquel parte el universo en dos
// (entregadas / el resto) y esta lo reparte entero por status.
//
// ⚠ QUE SIGNIFICA CADA SEGMENTO, porque no es obvio y la pantalla no puede callarlo: el status
// de una orden es el `resultado` de su ULTIMA gestion vigente y, si nunca se gestiono, el
// estatus propio de la orden (decision humana del 2026-08-18). Es «que paso con la orden», no
// «donde esta ahora»: una orden gestionada como `devuelta` cae en `devuelta` aunque su estatus
// de hoy sea `devolviendo_a_tienda`. Por eso hay una nota debajo — sin ella, alguien compara
// este desglose con el listado de ordenes filtrado por estatus y no le cuadra.
//
// Reglas de la casa que se conservan, y por reuso y no por copia:
//
//  - La cifra sale de UNA Server Action (`consultarConteoPorStatus`) y de ninguna otra puerta.
//  - «Prohibido», «sesion no valida», «filtro invalido» y «se rompio» NO se degradan al vacio
//    de la grafica: un problema de permisos pintado como cero afirma que no hubo ordenes.
//  - El filtro sale del proveedor de entregas, no de la URL.

import useSWR from "swr";

import { serializarFiltroEntregas } from "@/app/(app)/_components/entregas-filtro-analitica";
import { useFiltroEntregas } from "@/app/(app)/_components/filtro-entregas";
import { formatearValor } from "@/components/private/analytics/formato";
import { GraficaRanking } from "@/components/private/analytics/GraficaRanking";
import { consultarConteoPorStatus } from "@/lib/actions/conteo-por-status";
import type { ResultadoConteoPorStatus } from "@/lib/types/conteo-por-status";

import {
  TEXTO_ERROR_PANEL,
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  TITULO_FILTRO_INVALIDO,
  VACIO_PANEL,
} from "../operativo/textos";
import { CLAVE_TABLERO } from "../operativo/PanelOperativo";

const TITULO = "Detalle de las ordenes";

/** La unidad del formateador: son ordenes contadas, no dinero ni porcentaje. */
const UNIDAD = "conteo";



// El sello de frescura («Actualizado 18:30») se RETIRO el 2026-08-18, igual que en el anillo
// hermano. `lastSync` sigue viajando en el DTO: lo que se quito es el rotulo, no el dato.
// ⚠ AQUI SE PINTABA UNA NOTA que declaraba de donde sale el estado («el resultado de la
// ultima gestion de cada orden; las que nunca se gestionaron cuentan con su estado actual»).
// Retirada por decision humana del 2026-08-18.
//
// Lo que se pierde, dicho aqui para que no se pierda del todo: el bucket de una orden sale de
// su ultima gestion vigente, NO de `orden.estatus`. Una orden gestionada como `devuelta` cae en
// `devuelta` aunque su estatus de hoy sea `devuelta_a_tienda`. Consecuencia real: este desglose y
// el listado de ordenes filtrado por estatus pueden dar numeros DISTINTOS para el mismo dia,
// y ya no hay nada en pantalla que lo explique. Si algun dia alguien reporta que «los numeros
// no cuadran», la respuesta esta en este comentario y en la cabecera del archivo.

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

/**
 * El `value` del catalogo tal cual sale de la base (`en_reparto`, `devuelta_a_tienda`) puesto
 * en algo que se pueda leer en una leyenda: guiones bajos a espacios y la primera en mayuscula.
 *
 * ⚠ NO hay tabla de etiquetas escrita a mano, y es deliberado: `order_status` no tiene columna
 * `label` —la etiqueta ES el value— y una tabla propia aqui se desincronizaria en silencio la
 * proxima vez que el catalogo renombre un valor (ya paso tres veces: features 135, 153 y 154).
 * Un status nuevo entra en la leyenda solo, legible, por el mero hecho de existir. Si algun dia
 * se quieren nombres de verdad («En reparto» vs «Devuelta a tienda»), eso es un catalogo de
 * etiquetas con su propia decision, no un `Record` colado en este archivo.
 */
export function etiquetaDeStatus(value: string): string {
  const conEspacios = value.replaceAll("_", " ");
  return conEspacios.charAt(0).toUpperCase() + conEspacios.slice(1);
}

export function ConteoPorStatusDona() {
  const { filtro } = useFiltroEntregas();
  const filtroSerializado = serializarFiltroEntregas(filtro);

  const { data, error, isLoading } = useSWR(
    [CLAVE_TABLERO, "conteo-por-status", filtroSerializado],
    () => consultar(filtroSerializado),
    { keepPreviousData: false, revalidateOnFocus: false },
  );

  const mensaje = mensajeDe(data, error !== undefined);
  const datos = data?.status === "ok" ? data.datos : null;

  // Sin ningun bucket no hay dona: el marco cae a su estado vacio, que habla de «no hubo
  // movimiento». Se mira `porStatus.length` y no `total > 0` porque son la misma cosa por
  // construccion (los buckets vacios no viajan) y la longitud es la que gobierna el dibujo.
  const hayDato = datos !== null && datos.porStatus.length > 0;

  // ⚠ AQUI NO SE AGRUPA NADA EN «OTROS», y merece decirse porque durante unas horas si se
  // hizo. El paquete de graficas tenia un techo de CINCO categorias (`MAX_SERIES`) porque la
  // paleta tenia cinco tokens y no ciclaba; con ese techo, un desglose de nueve estados
  // perdia cuatro. La solucion de entonces era fundir la cola en un cubo.
  //
  // El 2026-08-18 la paleta paso a VEINTE tokens y a ciclar, y el techo se retiro. Veinte es
  // exactamente el tamano de `ORDER_STATUS_SEED`, asi que este desglose cabe ENTERO con un
  // color por estado: se pintan todos, sin cubo y sin perder ninguna orden.
  //
  // Lo que esto cuesta, dicho: con mas de veinte categorias dos compartirian color. No puede
  // pasar aqui —el catalogo tiene veinte y el bucket sale de el— pero si algun dia el catalogo
  // creciera, esta grafica es la primera que lo notaria.
  const series = hayDato
    ? [
        {
          id: "conteo_por_status",
          etiqueta: TITULO,
          // Ya vienen ordenados de mayor a menor desde el repositorio. NO se reordenan aqui:
          // el color de cada porcion se asigna POR POSICION (`paleta.ts`), asi que dos
          // criterios de orden distintos —uno en la base y otro en el cliente— repintarian
          // los mismos datos con colores distintos segun quien los tocara al final.
          puntos: datos.porStatus.map((fila) => ({
            categoria: etiquetaDeStatus(fila.status),
            valor: fila.conteo,
          })),
        },
      ]
    : [];

  return (
    <div className="flex w-full flex-col gap-2">
      {/* ⚠ FILAS ORDENADAS, NO UNA DONA (decisión del 2026-08-18, opción A). Con hasta veinte
          estados la dona vuelve astillas las porciones pequeñas y obliga a comparar ángulos
          para saber cuál manda. El total pasa al título, donde estaba el centro de la dona. */}
      <GraficaRanking
        titulo={hayDato ? `${TITULO} · ${formatearValor(datos.total, UNIDAD)}` : TITULO}
        series={series}
        unidad={UNIDAD}
        vacio={VACIO_PANEL}
        cargando={isLoading}
        error={mensaje}
      />
    </div>
  );
}

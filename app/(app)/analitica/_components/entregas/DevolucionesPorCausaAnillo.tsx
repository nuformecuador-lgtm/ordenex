"use client";

// El anillo de DEVOLUCIONES POR CAUSA: una porcion por motivo, con el total al centro.
//
// Tercer anillo de la seccion y el mismo molde que los dos anteriores —una Server Action, el
// filtro del proveedor, los cuatro estados del marco— con UNA diferencia que hay que tener
// delante al leer sus cifras:
//
// ⚠ AQUI SE CUENTAN GESTIONES, NO ORDENES. Es la convencion del repo para devoluciones
// (`lib/analytics/metrics.ts`, D10/R35) y esta declarada en `ConteoDevolucionesDTO`. Consecuencia
// visible en esta misma pantalla: el total de este anillo NO tiene por que coincidir con el
// segmento «Devueltas» del anillo de desenlaces, que cuenta ORDENES por su ultimo desenlace. Una
// orden devuelta dos veces aporta DOS aqui y UNA alli, y las dos cifras son correctas.
//
// Los MOTIVOS llegan ya traducidos del servidor y aqui no se traduce nada: los valores del enum
// estan en ingles (`not_found`, `wrong_number`, `wrong_address`) y de un value en ingles no se
// deriva un rotulo en castellano con una regla de formato —hace falta una traduccion, que es un
// dato y vive en `MOTIVO_DE_CAUSA`—. Es justo al reves que el desglose por status, donde la
// etiqueta SI se deriva del value; y la asimetria es deliberada, no un descuido.
//
// Reglas de la casa que se conservan por reuso, no por copia:
//
//  - la cifra sale de UNA Server Action (`consultarConteoDevoluciones`) y de ninguna otra
//    puerta: ni servicio, ni repositorio, ni Prisma, ni una ruta `app/api`;
//  - «prohibido», «sesion no valida», «filtro invalido» y «se rompio» NO se degradan al vacio
//    de la grafica: un problema de permisos pintado como cero afirma que no hubo devoluciones,
//    que es una mentira distinta;
//  - el filtro sale de `FiltroEntregasProvider`, la barra de entregas montada encima, y no de
//    la URL —esa la escribe la barra del OTRO bloque de la pagina—.

import useSWR from "swr";

import { serializarFiltroEntregas } from "@/app/(app)/_components/entregas-filtro-analitica";
import { useFiltroEntregas } from "@/app/(app)/_components/filtro-entregas";
import { formatearValor } from "@/components/private/analytics/formato";
import { GraficaRanking } from "@/components/private/analytics/GraficaRanking";
import { consultarConteoDevoluciones } from "@/lib/actions/conteo-devoluciones";
import type { ResultadoConteoDevoluciones } from "@/lib/types/conteo-devoluciones";

import {
  TEXTO_ERROR_PANEL,
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  TITULO_FILTRO_INVALIDO,
  VACIO_PANEL,
} from "../operativo/textos";
import { CLAVE_TABLERO } from "../operativo/PanelOperativo";

const TITULO = "Causas de devolución";

/** La unidad del formateador: son gestiones contadas, no dinero ni porcentaje. */
const UNIDAD = "conteo";



async function consultar(filtroSerializado: string): Promise<ResultadoConteoDevoluciones> {
  return consultarConteoDevoluciones(JSON.parse(filtroSerializado) as unknown);
}

/** El mensaje de error que corresponde a cada estado que no es `ok`. `null` = no hay error. */
function mensajeDe(
  resultado: ResultadoConteoDevoluciones | undefined,
  fallo: boolean,
): string | null {
  if (fallo) return TEXTO_ERROR_PANEL;
  if (!resultado) return null;
  switch (resultado.status) {
    case "unauthenticated":
      // Texto DISTINTO al de prohibido: «no puedes» y «no sabemos quién eres» piden cosas
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

export function DevolucionesPorCausaAnillo() {
  // El filtro lo publica la barra de entregas: cambiarlo cambia la clave y SWR vuelve a
  // consultar. Sin proveedor (otra pantalla, un test) vale el filtro inicial.
  const { filtro } = useFiltroEntregas();
  const filtroSerializado = serializarFiltroEntregas(filtro);

  const { data, error, isLoading } = useSWR(
    [CLAVE_TABLERO, "conteo-devoluciones", filtroSerializado],
    () => consultar(filtroSerializado),
    { keepPreviousData: false, revalidateOnFocus: false },
  );

  const mensaje = mensajeDe(data, error !== undefined);
  const datos = data?.status === "ok" ? data.datos : null;

  // Sin ninguna causa no hay anillo: el marco cae a su estado vacío, que habla de «no hubo
  // movimiento en el rango». Se mira `porCausa.length` y no `total > 0` porque son la misma
  // cosa por construcción —las causas sin gestiones no viajan— y la longitud es la que gobierna
  // el dibujo. Un anillo de ceros dibujaría una rosquilla vacía indistinguible de un rango sin
  // devoluciones, y encima con un «0» al centro que se lee como una cifra medida.
  const hayDato = datos !== null && datos.porCausa.length > 0;

  // Las CUATRO causas como mucho —las tres tipificadas más «sin causa registrada»— y solo las
  // que tienen gestiones. No se rellenan las vacías, al revés que en el anillo de desenlaces:
  // allí los seis segmentos son fijos y «Devueltas: 0» es una respuesta; aquí una causa que
  // nunca se registró no es una categoría del negocio que haya que enseñar vacía.
  const series = hayDato
    ? [
        {
          id: "conteo_devoluciones",
          etiqueta: TITULO,
          // Ya vienen ordenadas de mayor a menor desde el repositorio. NO se reordenan aquí: el
          // color de cada porción se asigna POR POSICIÓN (`paleta.ts`), así que dos criterios
          // de orden —uno en la base y otro en el cliente— repintarían los mismos datos con
          // colores distintos según quién los tocara al final.
          //
          // Se pinta `motivo` (ya traducido) y no `causa`: el value crudo viaja para agrupar y
          // depurar, no para leerlo en una leyenda.
          puntos: datos.porCausa.map((fila) => ({
            categoria: fila.motivo,
            valor: fila.conteo,
          })),
        },
      ]
    : [];

  return (
    <div className="flex w-full flex-col gap-2">
      {/* ⚠ FILAS ORDENADAS, NO UN ANILLO (decisión del 2026-08-18, opción A). Son cuatro
          causas como mucho, pero la pregunta es «cuál manda y por cuánto», y eso se responde
          comparando longitudes sobre la misma línea base — en un anillo hay que comparar
          ángulos. Además queda en el MISMO lenguaje visual que el desglose por estado, que es
          la otra lectura de la fila. El total pasa al título, donde estaba el centro del
          anillo. */}
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

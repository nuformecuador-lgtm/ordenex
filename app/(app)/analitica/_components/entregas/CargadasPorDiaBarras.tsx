"use client";

// La barra de ORDENES CARGADAS POR DIA: una barra por dia calendario CR con al menos una orden.
//
// Es la tercera lectura de la seccion y comparte con las otras dos TODO lo que se puede
// compartir: el mismo filtro (`FiltroEntregasProvider`), los mismos textos de error, el mismo
// marco y la misma cache de 15 min. Lo que cambia es la pregunta.
//
// ⚠ LAS TRES GRAFICAS NO MIDEN LO MISMO, y conviene tenerlo claro al leer la pantalla:
//   - el anillo y el desglose por estado reparten las ordenes por su DESENLACE, y su ventana
//     cae sobre la fecha efectiva (ultima gestion vigente, o la creacion si nunca se gestiono);
//   - esta serie cuenta CUANDO ENTRO la orden, y su ventana cae sobre `orden.created_at`.
// Por eso el total de esta grafica puede no coincidir con el de las otras dos para el mismo
// filtro: son dos universos distintos sobre el mismo recorte, no un descuadre.
//
// Reglas de la casa que se conservan, y por reuso y no por copia:
//
//  - La cifra sale de UNA Server Action (`consultarConteoCargadasPorDia`) y de ninguna otra
//    puerta: ni servicio, ni repositorio, ni Prisma, ni una ruta `app/api`.
//  - «Prohibido», «sesion no valida», «filtro invalido» y «se rompio» NO se degradan al vacio
//    de la grafica: un problema de permisos pintado como cero afirma que no se cargo nada.
//  - El filtro sale del proveedor de entregas, no de la URL.

import useSWR from "swr";

import { serializarFiltroEntregas } from "@/app/(app)/_components/entregas-filtro-analitica";
import { useFiltroEntregas } from "@/app/(app)/_components/filtro-entregas";
import { GraficaLineas } from "@/components/private/analytics/GraficaLineas";
import { consultarConteoCargadasPorDia } from "@/lib/actions/conteo-cargadas-por-dia";
import type { ResultadoConteoCargadasPorDia } from "@/lib/types/conteo-cargadas";

import {
  TEXTO_ERROR_PANEL,
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  TITULO_FILTRO_INVALIDO,
  VACIO_PANEL,
} from "../operativo/textos";
import { CLAVE_TABLERO } from "../operativo/PanelOperativo";

const TITULO = "Órdenes cargadas por día";

/** La unidad del formateador: son ordenes contadas, no dinero ni porcentaje. */
const UNIDAD = "conteo";

async function consultar(filtroSerializado: string): Promise<ResultadoConteoCargadasPorDia> {
  return consultarConteoCargadasPorDia(JSON.parse(filtroSerializado) as unknown);
}

/** El mensaje de error que corresponde a cada estado que no es `ok`. `null` = no hay error. */
function mensajeDe(
  resultado: ResultadoConteoCargadasPorDia | undefined,
  fallo: boolean,
): string | null {
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

export function CargadasPorDiaBarras() {
  // El filtro lo publica la barra de entregas, la MISMA que mueve las otras dos graficas.
  // Cambiarlo cambia la clave y SWR vuelve a consultar: sin eso, en pantalla quedaria la serie
  // del filtro anterior como si fuera la del nuevo.
  const { filtro } = useFiltroEntregas();
  const filtroSerializado = serializarFiltroEntregas(filtro);

  const { data, error, isLoading } = useSWR(
    [CLAVE_TABLERO, "conteo-cargadas-por-dia", filtroSerializado],
    () => consultar(filtroSerializado),
    { keepPreviousData: false, revalidateOnFocus: false },
  );

  const mensaje = mensajeDe(data, error !== undefined);
  const datos = data?.status === "ok" ? data.datos : null;

  // Sin ningun dia no hay serie: el marco cae a su estado vacio, que habla de «no hubo
  // movimiento en el rango». Una grafica de barras sin barras y con ejes dibujados se lee como
  // una pantalla a medio cargar, no como una respuesta.
  const hayDato = datos !== null && datos.porDia.length > 0;

  const series = hayDato
    ? [
        {
          id: "cargadas_por_dia",
          etiqueta: TITULO,
          // Ya vienen en orden CRONOLOGICO ASCENDENTE desde el repositorio, y eso es contrato
          // suyo. NO se reordenan aqui: una serie temporal con dos criterios de orden —uno en
          // la base y otro en el cliente— acaba pintandose distinto segun quien la toque al
          // final.
          //
          // ⚠ LOS DIAS SIN ORDENES NO VIENEN, y el eje por tanto NO es continuo: entre el 3 y
          // el 7 no habra huecos dibujados, se veran pegados. Es una consecuencia declarada
          // del DTO (`ConteoCargadasPorDiaDTO`), que no rellena porque la consulta puede venir
          // SIN ventana y entonces no existe el conjunto de dias que rellenar. Si algun dia se
          // quiere el eje continuo, se construye aqui a partir de la ventana que pidio ESTA
          // pantalla, que es la unica que la conoce siempre.
          puntos: datos.porDia.map((fila) => ({ categoria: fila.fecha, valor: fila.conteo })),
        },
      ]
    : [];

  return (
    // ⚠ LÍNEA Y NO BARRAS (decisión del 2026-08-18). En una serie diaria la pregunta es la
    // TENDENCIA —si sube o baja—, no comparar el martes contra el jueves; y con treinta días
    // las barras se vuelven un peine ilegible mientras la línea sigue leyéndose. Un hueco en
    // la línea es un día sin cargas: `GraficaLineas` no une los ausentes con una recta, así
    // que no inventa un dato que no existe.
    <GraficaLineas
      titulo={TITULO}
      series={series}
      unidad={UNIDAD}
      vacio={VACIO_PANEL}
      cargando={isLoading}
      error={mensaje}
      // La MITAD de alto (32:9 en vez del 16:9 de siempre). A ancho completo un 16:9 son unos
      // 675 px para una sola fila de barras: la gráfica se comía la pantalla y empujaba fuera
      // de vista todo lo que va debajo.
      proporcion="bajo"
    />
  );
}

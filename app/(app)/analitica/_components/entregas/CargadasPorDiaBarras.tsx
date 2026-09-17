"use client";

// La serie de ORDENES CARGADAS POR DIA: un punto por dia calendario CR del periodo, los dias sin
// ninguna carga a CERO (ficha 445 — antes solo venian los dias con cargas y el eje los pintaba
// equidistantes, de modo que seis semanas de hueco median lo mismo que un dia).
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
import { avisoDeEjeRecortado, ejeContinuoDeDias } from "./eje-de-dias";

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

  // ⭑ FICHA 445 — EL EJE SE CONSTRUYE AQUI, DIA A DIA. Hasta hoy los puntos se pasaban tal como
  // llegaban del DTO, que solo trae los dias CON cargas; como el eje de `recharts` es
  // CATEGORICO, la distancia entre dos puntos era «una posicion» y no «un dia». Medido el
  // 2026-09-17: 2026-07-24 y 2026-09-04 —cuarenta y dos dias de hueco— se dibujaban a la misma
  // distancia que el 21 y el 22 de julio, y la pendiente que se leia era falsa.
  //
  // El relleno se hace en este componente, y no en el DTO, porque es lo que su contrato manda:
  // «Si la grafica necesita el eje continuo, lo construye a partir de la ventana que ELLA pidio,
  // que es la unica que la conoce siempre». La ventana sale del MISMO `filtro` que ya se
  // serializa para la clave de SWR, asi que no hay una segunda fuente que pueda discrepar.
  //
  // Lo que NO cambia: el orden sigue siendo el cronologico ascendente del repositorio, porque
  // el eje se genera avanzando un dia cada vez desde el extremo mas antiguo.
  const eje = hayDato
    ? ejeContinuoDeDias(datos.porDia, { desde: filtro.desde, hasta: filtro.hasta })
    : null;

  const series = eje
    ? [
        {
          id: "cargadas_por_dia",
          etiqueta: TITULO,
          puntos: eje.puntos,
        },
      ]
    : [];

  return (
    // ⚠ LÍNEA Y NO BARRAS (decisión del 2026-08-18). En una serie diaria la pregunta es la
    // TENDENCIA —si sube o baja—, no comparar el martes contra el jueves; y con treinta días
    // las barras se vuelven un peine ilegible mientras la línea sigue leyéndose.
    //
    // FICHA 445 — YA NO HAY HUECOS EN LA LÍNEA, y es lo correcto: un día sin cargas no es un
    // dato ausente (R11 del paquete), es una medida que vale CERO. La consulta cubrió ese día y
    // la respuesta fue «no entró ninguna». `connectNulls={false}` sigue en el lienzo y sigue
    // haciendo falta para las gráficas que sí tienen ausencias reales.
    <>
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
      {/* FICHA 445 — EL RECORTE DEL EJE, DICHO EN VOZ ALTA. Rellenar hace crecer la serie, y sin
          filtro de fecha el eje abarca toda la historia: pasado el techo del paquete
          (`MAX_PUNTOS_SERIE`) se conservan los días más recientes. Callarlo dejaría una
          tendencia sobre un trozo del periodo que el usuario cree completo — y además el techo
          del paquete LANZA fuera de producción, así que el recorte tiene que ocurrir antes de
          entregarle la serie. `role="status"` lo anuncia sin robar el foco. */}
      {eje?.recortado ? (
        <p role="status" className="text-xs text-muted-foreground">
          {avisoDeEjeRecortado(eje.diasMostrados, eje.diasDelPeriodo)}
        </p>
      ) : null}
    </>
  );
}

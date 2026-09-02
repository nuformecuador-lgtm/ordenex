"use client";

// El anillo de ENTREGAS de la seccion: dos segmentos —entregadas y no entregadas— con el
// total en el centro y el sello de frescura debajo.
//
// ─── QUE CAMBIO EL 2026-08-17, Y POR QUE IMPORTA AL LEER ESTE ARCHIVO ────────────────────
//
// Antes las dos mitades NO eran de la misma naturaleza. La cifra salia de `analytics_daily`
// via `consultarAnaliticaOperativa`, y ese rollup obliga a mezclar magnitudes: la izquierda
// era un FLUJO sumado sobre todo el rango y la derecha un STOCK leido en un solo dia (el
// esquema PROHIBE sumar el stock entre fechas, R28). El componente estaba obligado a rotular
// esa mezcla con dos etiquetas calificadas y una nota, y aun asi el total sumaba peras y
// manzanas.
//
// Ahora las dos mitades son la MISMA magnitud: ORDENES del mismo universo, contadas sobre la
// tabla `orden` viva. `entregadas + noEntregadas = total` es cierto por construccion —
// `noEntregadas` es una resta, no una segunda consulta (ver `ConteoEntregasDTO`)—. Por eso
// desaparecen los calificadores de las etiquetas, la nota de mezcla y el modulo de reparto
// entero: ya no hay nada que advertir. Lo que SI hay que advertir, y es nuevo, es la EDAD de
// la cifra: la caches de 15 min, asi que el sello `lastSync` se pinta.
//
// Reglas de la casa que se conservan, y no por copia sino por reuso:
//
//  - La cifra sale de UNA Server Action (`consultarConteoEntregas`) y de ninguna otra puerta:
//    ni servicio, ni repositorio, ni Prisma, ni una ruta `app/api`.
//  - «Prohibido», «sesion no valida», «filtro invalido» y «se rompio» NO se degradan al vacio
//    de la grafica: un problema de permisos pintado como cero afirma que no hubo entregas,
//    que es una mentira distinta. Cada uno usa el estado de error del marco, con el MISMO
//    texto que ya usan los paneles del tablero.
//  - El filtro sale de `FiltroEntregasProvider`, que es donde publica la barra de entregas
//    montada justo encima. No de la URL: esa la escribe `FiltrosOperativos`, que es la barra
//    del OTRO bloque de la pagina, y compartirla fundiria dos filtros que hoy son distintos.

import useSWR from "swr";

import { serializarFiltroEntregas } from "@/app/(app)/_components/entregas-filtro-analitica";
import { useFiltroEntregas } from "@/app/(app)/_components/filtro-entregas";
import { formatearValor } from "@/components/private/analytics/formato";
import { GraficaReparto } from "@/components/private/analytics/GraficaReparto";
import {
  BUCKET_OTROS,
  DESENLACES,
  type ResultadoConteoEntregas,
} from "@/lib/types/conteo-entregas";

import {
  TEXTO_ERROR_PANEL,
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  TITULO_FILTRO_INVALIDO,
  VACIO_PANEL,
} from "../operativo/textos";

import { claveConteoEntregas, consultarConteoEntregasSwr } from "./conteo-entregas-swr";
import { etiquetaDeDesenlace } from "./etiqueta-desenlace";

const TITULO = "Detalle gestión";

/**
 * Los SEIS segmentos, en el orden en que se pintan: los cinco desenlaces del catalogo y el
 * cubo de todo lo demas.
 *
 * El orden lo fija `DESENLACES` y no una lista escrita aqui, por dos motivos: el color de
 * cada porcion se asigna POR POSICION (`paleta.ts`), asi que un orden propio en el cliente
 * repintaria los mismos datos con colores distintos; y un desenlace nuevo en el catalogo
 * entraria en el anillo solo, en vez de desaparecer en «otros» sin que nadie lo note.
 *
 * ⚠ «Otros» va el ULTIMO y se llama por su nombre: no es una categoria del negocio, es lo que
 * no cabe en las cinco. Ponerlo entre medias lo disfrazaria de desenlace.
 */
const SEGMENTOS: readonly string[] = [...DESENLACES, BUCKET_OTROS];

/**
 * FICHA 347 — la funcion se MUDO a `./etiqueta-desenlace`, un modulo puro, y aqui se
 * RE-EXPORTA con su nombre de siempre para que ningun consumidor cambie un import.
 *
 * El motivo de la mudanza esta escrito en el modulo nuevo: la ficha 347 la necesita tambien en
 * `analitica-productos-descarga-columnas.ts`, que es PURO por contrato y lo ejecuta una guardia
 * en node; importar este archivo desde alli habria arrastrado `recharts` a un barrido de
 * columnas. Es una mudanza, no un cambio de comportamiento.
 */
export { etiquetaDeDesenlace };

/** La unidad del formateador: son ordenes contadas, no dinero ni porcentaje. */
const UNIDAD = "conteo";



// ⚠ AQUI SE PINTABA EL SELLO DE FRESCURA («Actualizado 18:30»), y se RETIRO por decision
// humana del 2026-08-18. Conviene saber que se pierde: la cifra se sirve de una cache de 15
// minutos, asi que sin el sello la pantalla afirma IMPLICITAMENTE que el numero es de este
// segundo, y puede llevar hasta un cuarto de hora de retraso.
//
// El dato NO se ha quitado: `ConteoEntregasDTO.lastSync` sigue viajando y el servicio sigue
// sellandolo dentro del productor de la cache. Volver a pintarlo es anadir una linea, no
// rehacer la vertical.

/** El mensaje de error que corresponde a cada estado que no es `ok`. `null` = no hay error. */
function mensajeDe(resultado: ResultadoConteoEntregas | undefined, fallo: boolean): string | null {
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

export function ConteoEntregasAnillo() {
  // El filtro lo publica la barra de entregas. Cambiarlo cambia la clave y SWR vuelve a
  // consultar: sin eso, en pantalla quedaria la cifra del filtro anterior como si fuera la
  // del nuevo. Sin proveedor (otra pantalla, un test) vale el filtro inicial.
  const { filtro } = useFiltroEntregas();
  const filtroSerializado = serializarFiltroEntregas(filtro);

  // La clave y el fetcher salen de `conteo-entregas-swr` y NO se escriben aquí: el botón
  // «Actualizar» lee esta MISMA entrada para pintar su sello de frescura, y dos copias de la
  // clave se separan en silencio (ver la cabecera de aquel módulo).
  const { data, error, isLoading } = useSWR(
    claveConteoEntregas(filtroSerializado),
    () => consultarConteoEntregasSwr(filtroSerializado),
    { keepPreviousData: false, revalidateOnFocus: false },
  );

  const mensaje = mensajeDe(data, error !== undefined);
  const datos = data?.status === "ok" ? data.datos : null;

  // Con el universo VACIO la serie va vacia y el marco cae a su estado vacio, que habla de
  // «no hubo movimiento en el rango». Un anillo de dos ceros dibujaria una rosquilla vacia
  // indistinguible de una operacion sin ordenes, y encima con un «0» al centro que se lee
  // como una cifra medida. `total === 0` es un hecho, pero no es un GRAFICO.
  const hayDato = datos !== null && datos.total > 0;

  // Los SEIS segmentos, incluidos los que valen cero. A diferencia del desglose por status
  // —que omite los buckets vacios porque tiene hasta veinte— aqui los segmentos son FIJOS:
  // «Devueltas: 0» es una respuesta, y un anillo al que le falta un segmento segun el dia se
  // lee como si esa categoria no existiera.
  const series = hayDato
    ? [
        {
          id: "conteo_entregas",
          etiqueta: TITULO,
          puntos: SEGMENTOS.map((clave) => ({
            categoria: etiquetaDeDesenlace(clave),
            valor: datos.porDesenlace[clave] ?? 0,
          })),
        },
      ]
    : [];

  return (
    <div className="flex w-full flex-col gap-2">
      {/* ⚠ UNA BARRA AL 100 %, NO UN ANILLO (decisión del 2026-08-18, opción A). Los seis
          desenlaces se comparan sobre la misma línea base y los pequeños —incidentes al 2 %—
          conservan su franja, su nombre y su cifra; en el anillo eran astillas sin etiqueta.
          El total, que antes iba al centro del anillo, pasa al título. */}
      <GraficaReparto
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

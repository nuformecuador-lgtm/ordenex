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
import { GraficaDonut } from "@/components/private/analytics/GraficaDonut";
import { consultarConteoEntregas } from "@/lib/actions/conteo-entregas";
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
import { CLAVE_TABLERO } from "../operativo/PanelOperativo";

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
 * El `value` del catalogo (`entregada`, `reprogramada`) puesto en algo que se lee en una
 * leyenda. En plural, porque cada segmento cuenta ORDENES y no una sola.
 *
 * Sin tabla de etiquetas escrita a mano: `order_status` no tiene columna `label` —la etiqueta
 * ES el value— y una tabla propia se desincronizaria en silencio el proximo renombre del
 * catalogo. Los cinco desenlaces terminan en «a», asi que el plural es una «s».
 *
 * ⚠ LO QUE YA ESTA EN PLURAL NO SE VUELVE A PLURALIZAR. El bucket «otros» lo esta, y sin esta
 * guarda salia «Otross» en la leyenda. La regla se escribe sobre la FORMA de la palabra y no
 * como un caso especial para «otros»: cualquier value futuro acabado en «s» queda cubierto.
 */
export function etiquetaDeDesenlace(valor: string): string {
  const plural = valor.endsWith("s") ? valor : `${valor}s`;
  return plural.charAt(0).toUpperCase() + plural.slice(1);
}

/** La unidad del formateador: son ordenes contadas, no dinero ni porcentaje. */
const UNIDAD = "conteo";

/**
 * Anillo fino: es un indicador con cifra al centro, no un reparto por categorias.
 *
 * ⚠ EL EXTERIOR NO LLEGA AL BORDE (era `"100%"` hasta el 2026-08-18) y el motivo es el valor
 * sobre cada porcion: recharts lo escribe FUERA del radio exterior, con su linea guia. Con el
 * anillo pegado al borde del contenedor no queda sitio donde ponerlo y el numero sale
 * recortado. Se recoge el radio lo justo para dejarle margen, conservando el grosor de banda
 * (20 puntos antes, 17 ahora): sigue siendo un anillo fino, no un donut.
 */
const RADIO_INTERIOR = "68%";
const RADIO_EXTERIOR = "85%";

// ⚠ AQUI SE PINTABA EL SELLO DE FRESCURA («Actualizado 18:30»), y se RETIRO por decision
// humana del 2026-08-18. Conviene saber que se pierde: la cifra se sirve de una cache de 15
// minutos, asi que sin el sello la pantalla afirma IMPLICITAMENTE que el numero es de este
// segundo, y puede llevar hasta un cuarto de hora de retraso.
//
// El dato NO se ha quitado: `ConteoEntregasDTO.lastSync` sigue viajando y el servicio sigue
// sellandolo dentro del productor de la cache. Volver a pintarlo es anadir una linea, no
// rehacer la vertical.

async function consultar(filtroSerializado: string): Promise<ResultadoConteoEntregas> {
  return consultarConteoEntregas(JSON.parse(filtroSerializado) as unknown);
}

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

  const { data, error, isLoading } = useSWR(
    [CLAVE_TABLERO, "conteo-entregas", filtroSerializado],
    () => consultar(filtroSerializado),
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
      <GraficaDonut
        titulo={TITULO}
        series={series}
        unidad={UNIDAD}
        vacio={VACIO_PANEL}
        cargando={isLoading}
        error={mensaje}
        innerRadius={RADIO_INTERIOR}
        outerRadius={RADIO_EXTERIOR}
        centro={hayDato ? formatearValor(datos.total, UNIDAD) : undefined}
        // Las dos cifras se leen SIN tocar el gráfico: la leyenda va en columna al lado y
        // lleva el conteo pegado al nombre («Entregadas: 20» / «No entregadas: 80»), y el
        // valor se escribe además sobre su porción. Un tooltip es un dato escondido: obliga a
        // apuntar con el ratón, y en una pantalla táctil directamente no existe.
        //
        // Las dos opciones son de ESTE anillo, no del donut: el resto de gráficas de
        // analítica conservan su leyenda abajo. Encenderlas en el lienzo por defecto habría
        // cambiado el tablero financiero y los paneles operativos sin haberlo decidido para
        // ellos.
        leyenda="lateral"
        mostrarValores
      />
    </div>
  );
}

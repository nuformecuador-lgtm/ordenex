"use client";

// El dinero DÍA A DÍA, en barras apiladas y TUMBADAS: una barra por día, cada serie de su color,
// creciendo hacia la derecha.
//
// ⚠ LO QUE LA LONGITUD DE LA BARRA **NO** SIGNIFICA, y hay que leerlo antes de mirar el gráfico.
//
// Apilar afirma que las series son partes de un todo y que la barra entera es su suma. Aquí NO
// lo es, porque las cinco cifras se solapan por definición:
//
//   - `pagoMensajeros` YA está dentro de `egresos` (es una de sus categorías);
//   - `pagoTiendas` TAMBIÉN, por lo mismo (2026-08-18);
//   - `ganancia` es ingresos propios − egresos propios, así que ya está contenida en el juego
//     de `ingresos` y `egresos`, y además puede ser NEGATIVA;
//   - `ingresos` y `egresos` incluyen el contra-entrega, que sólo pasa por la caja.
//
// Sumarlas cuenta dinero dos veces. Se apilan porque así se pidió (2026-08-18) y porque la
// comparación relativa día a día sí se lee bien, pero la longitud total es un artefacto del
// dibujo, no una cifra. La alternativa honesta —si algún día se quiere que la altura signifique
// algo— es apilar sólo el desglose de UNA magnitud (p. ej. egresos = pago a mensajeros + el
// resto) y sacar la ganancia a una línea aparte.
//
// LA SERIE NO TIENE FILTROS: la ventana son los últimos 30 días de Costa Rica y la pone el
// servidor con su reloj (`FinanzasDiarioService`). Por eso vive en la sección financiera, que
// tampoco los tiene, y no cuelga del proveedor de la barra de entregas.

import useSWR from "swr";

import { GraficaBarras } from "@/components/private/analytics/GraficaBarras";
import { consultarFinanzasDiario } from "@/lib/actions/finanzas-diario";
import type { FinanzasDeUnDia, ResultadoFinanzasDiario } from "@/lib/types/finanzas-diario";

import { aNumero } from "../financiero/adaptar";
import {
  TEXTO_ERROR_PANEL,
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  VACIO_PANEL,
} from "../operativo/textos";
import { CLAVE_TABLERO } from "../operativo/PanelOperativo";

const TITULO = "Dinero por día";

/** Son importes: el formateador del paquete los pinta con la moneda configurada. */
const UNIDAD = "moneda";

/**
 * Las CUATRO series y de dónde sale cada una. El orden es el de apilado y el de color
 * (`paleta.ts` colorea por POSICIÓN), así que reordenar aquí repinta el gráfico entero.
 */
const SERIES: readonly {
  readonly id: string;
  readonly etiqueta: string;
  readonly campo: keyof Omit<FinanzasDeUnDia, "fecha">;
}[] = [
  { id: "ingresos", etiqueta: "Ingresos", campo: "ingresos" },
  { id: "egresos", etiqueta: "Egresos", campo: "egresos" },
  { id: "ganancia", etiqueta: "Ganancia", campo: "ganancia" },
  { id: "pago_mensajeros", etiqueta: "Pago a mensajeros", campo: "pagoMensajeros" },
  // Añadida el 2026-08-18. Va DESPUÉS de la de mensajeros y no entre medias: el color se
  // asigna por POSICIÓN, así que insertarla antes habría repintado las cuatro que ya estaban y
  // cualquiera que recordara «la verde era la ganancia» se habría quedado sin referencia.
  { id: "pago_tiendas", etiqueta: "Pago a tiendas", campo: "pagoTiendas" },
];

async function consultar(): Promise<ResultadoFinanzasDiario> {
  return consultarFinanzasDiario();
}

/** El mensaje de error que corresponde a cada estado que no es `ok`. `null` = no hay error. */
function mensajeDe(resultado: ResultadoFinanzasDiario | undefined, fallo: boolean): string | null {
  if (fallo) return TEXTO_ERROR_PANEL;
  if (!resultado) return null;
  switch (resultado.status) {
    case "unauthenticated":
      return TEXTO_SESION_NO_VALIDA;
    case "forbidden":
      return TEXTO_PROHIBIDO;
    default:
      return null;
  }
}

/**
 * @sin-superficie la seccion de finanzas de `/analitica` se comento entera el 2026-08-18 por
 * decision humana, y con ella se fue el unico sitio que montaba esto. El codigo se conserva
 * —esta hecho y probado— y volver a encenderlo es descomentar el bloque de `page.tsx` y sus
 * imports. La anotacion CADUCA: en cuanto la seccion vuelva hay que retirarla, y la guardia lo
 * exige.
 */
export function FinanzasDiarioBarras() {
  // Clave sin filtro: esta lectura no depende de nada que el usuario pueda mover, así que una
  // sola entrada de caché de SWR para toda la pantalla.
  const { data, error, isLoading } = useSWR(
    [CLAVE_TABLERO, "finanzas-diario"],
    () => consultar(),
    { keepPreviousData: false, revalidateOnFocus: false },
  );

  const mensaje = mensajeDe(data, error !== undefined);
  const datos = data?.status === "ok" ? data.datos : null;
  const hayDato = datos !== null && datos.porDia.length > 0;

  // Los importes son STRING hasta aquí: `aNumero` es la ÚNICA conversión, y se hace en el borde
  // del dibujo porque recharts no sabe pintar cadenas. Se reusa la del tablero financiero en vez
  // de escribir otro `Number(...)`: aquella ya rechaza el vacío —`Number("")` es `0`, que sería
  // un cero inventado— y ya tiene declarado su límite de precisión.
  const series = hayDato
    ? SERIES.map((serie) => ({
        id: serie.id,
        etiqueta: serie.etiqueta,
        puntos: datos.porDia.map((dia) => ({
          categoria: dia.fecha,
          valor: aNumero(dia[serie.campo]),
        })),
      }))
    : [];

  return (
    <GraficaBarras
      titulo={TITULO}
      series={series}
      unidad={UNIDAD}
      vacio={VACIO_PANEL}
      cargando={isLoading}
      error={mensaje}
      // MISMA ALTURA que «Órdenes cargadas por día» (`CargadasPorDiaBarras`): las dos son series
      // temporales por día, y con proporciones distintas dos gráficas hermanas de la misma
      // pantalla se leen como si una fuera más importante que la otra. El alto lo resuelve
      // `clasesDeLienzo`, no un `h-[...]` escrito aquí: así sigue siendo una sola definición.
      //
      // ⚠ ESE ALTO Y LAS BARRAS TUMBADAS TIRAN EN DIRECCIONES CONTRARIAS, y conviene saberlo:
      // tumbadas, cada día necesita su franja de alto, y la ventana son 30 días metidos en una
      // caja baja. Se conserva el alto porque se pidió explícitamente; si las franjas quedan
      // demasiado finas para leerlas, lo que hay que subir es la proporción —no reordenar ni
      // recortar la serie, que cambiaría lo que el gráfico dice.
      proporcion="bajo"
      // Lo pedido: una sola columna por día, dividida por color, en vez de cuatro barras
      // hombro con hombro. Ver la advertencia de la cabecera sobre lo que la longitud NO dice.
      apilado
      // Barras TUMBADAS: el día baja por el eje izquierdo y el dinero crece hacia la derecha.
      horizontal
      // Grosor pedido (2026-08-18). Es un TOPE: con 30 días en una caja baja, recharts las
      // dibujará más finas si no caben —nunca más gruesas—, así que este número no puede
      // desbordar el lienzo.
      grosorBarra={20}
    />
  );
}

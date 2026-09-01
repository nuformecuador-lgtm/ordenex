"use client";

// FICHA 345 (T7.2/T8.3) — QUE PRODUCTOS SE MUEVEN, y con que resultado.
//
// Es la septima lectura viva de la seccion de entregas y comparte con las otras seis todo lo
// que se puede compartir: el mismo filtro (`FiltroEntregasProvider`), el mismo prefijo de clave
// SWR (asi el boton «Actualizar» la revalida sin conocerla), los mismos textos de error y la
// misma regla de que un problema de permisos NO se degrada a una tabla vacia.
//
// ─── LAS CUATRO COSAS QUE ESTE COMPONENTE NO HACE, Y CADA UNA POR SU MOTIVO ────────────────
//
//  1. **No reordena las filas.** Llegan ya ordenadas del servicio (unidades desc, ordenes desc,
//     producto asc, tienda asc) y ese orden es DETERMINISTA por contrato (R33). Ordenar aqui
//     por segunda vez daria un orden distinto en la pantalla que en el archivo —que proyecta el
//     DTO tal cual— y ademas convertiria la paginacion en una loteria: la pagina 2 dependeria
//     de cual de los dos ordenes gano.
//  2. **No calcula ningun porcentaje.** `calcularEfectividad(fila.porStatus)` fila a fila, que
//     es la MISMA funcion que produce la fila de KPIs de mas arriba (R28). Por construccion el
//     denominador por producto es el universo entero del recorte, incluidas las ordenes que
//     siguen en proceso (R29). Una segunda definicion de «efectividad» a dos secciones de
//     distancia es exactamente lo que la alternativa A6 del diseño descarto.
//  3. **No escribe ningun literal de estado del catalogo** (`entregada`, `rechazada`...). Los
//     buckets los reparte `calcularEfectividad`, que ya sabe cual es cual y a la que vigila
//     `censo-order-status-rename.guardia`. Una lista de estados aqui se quedaria atras el dia
//     que el catalogo renombre uno, en silencio.
//  4. **No razona sobre permisos para pintar la columna «Tienda».** Ver `hayVariasTiendas`.
//
// ─── EL AVISO QUE NO PUEDE FALTAR (R36) ────────────────────────────────────────────────────
//
// Una orden con varios productos cuenta en CADA uno de ellos. El 12 % de las ordenes medidas en
// produccion lleva mas de uno, asi que la suma de la columna «Ordenes» puede superar el total
// del rango sin que nada este roto. Sin el rotulo, quien sume la columna concluye que las
// cifras no cuadran — y tendra razon en lo que ve y no en lo que deduce.

import { useMemo, useState } from "react";
import { PackageSearch } from "lucide-react";
import useSWR from "swr";

import { serializarFiltroEntregas } from "@/app/(app)/_components/entregas-filtro-analitica";
import { useFiltroEntregas } from "@/app/(app)/_components/filtro-entregas";
import { formatearValor } from "@/components/private/analytics/formato";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { filasLocales } from "@/components/shared/descarga-resultado";
import { Pagination } from "@/components/shared/Pagination";
import { useIsMobile } from "@/hooks/use-mobile";
import type { FilaProductoDTO, ResultadoConteoProductos } from "@/lib/types/conteo-productos";

import {
  TEXTO_ERROR_PANEL,
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  TITULO_FILTRO_INVALIDO,
} from "../operativo/textos";

import { calcularEfectividad } from "./efectividad";
import {
  COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS,
  filaDescargaAnaliticaProductos,
} from "./analitica-productos-descarga-columnas";
import { claveConteoProductos, consultarConteoProductosSwr } from "./productos-swr";

/* -------------------------------------------------------------------------- */
/* Textos                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * TODOS los textos de esta pantalla, en un solo objeto y fuera del JSX: es lo que deja la
 * seccion lista para i18n sin volver a tocar el arbol de componentes.
 */
export const PRODUCTOS_TEXTOS = {
  titulo: "Productos",
  tabla: "Productos del rango, por unidades movidas",
  descarga: "Productos",
  /** R36 — el aviso que impide leer la columna «Ordenes» como si fuera sumable. */
  aviso:
    "Una orden con varios productos cuenta en cada uno: la suma de la columna Órdenes puede superar el total del rango.",
  /**
   * FICHA 346 — la regla de lectura del desglose, dicha en la pantalla.
   *
   * Va aqui porque el defecto que esta ficha repara era INVISIBLE: quien sumaba las columnas y
   * le faltaban seis ordenes no tenia forma de saber si el error estaba en la tabla o en su
   * cuenta. Con la frase, la igualdad es una promesa comprobable a simple vista.
   */
  avisoDesglose:
    "Cada orden cuenta en un solo grupo: entregadas, rechazadas, otros resultados y en proceso suman la columna Órdenes.",
  vacioTitulo: "Sin productos en el rango",
  vacioDescripcion:
    "Ninguna orden del filtro seleccionado dejó un producto que se pueda interpretar.",
} as const;

/** Los encabezados de columna, aparte para que la vista de teléfono use LOS MISMOS. */
export const PRODUCTOS_COLUMNAS = {
  tienda: "Tienda",
  producto: "Producto",
  unidades: "Unidades",
  ordenes: "Órdenes",
  entregadas: "Entregadas",
  rechazadas: "Rechazadas",
  /**
   * FICHA 346 — el cubo que faltaba: los desenlaces que no son entrega ni rechazo.
   *
   * SE LLAMA «Otros resultados» y no «Otros», que es como se llama el cubo del anillo de al
   * lado, porque son cosas OPUESTAS: alli «Otros» son las ordenes SIN desenlace y aqui esas
   * mismas ordenes se llaman «En proceso». Dos rotulos iguales con significados contrarios en
   * la misma pantalla se leen uno por el otro. Tampoco enumera («Devueltas y reprogramadas»):
   * la etiqueta mentiria el dia que el catalogo gane un desenlace mas.
   */
  otrosResultados: "Otros resultados",
  enProceso: "En proceso",
  efectividad: "Efectividad de entrega",
  rechazo: "% de rechazo",
  /** Solo en la vista de teléfono: la celda que apila las ocho cifras de arriba. */
  cifras: "Resultado",
} as const;

/** R35 — el universo del recorte y las ordenes cuyo texto no produjo ningun producto. */
export function textoUniverso(ordenes: number, sinProducto: number): string {
  const total = formatearValor(ordenes, UNIDAD_CONTEO);
  const sin = formatearValor(sinProducto, UNIDAD_CONTEO);
  return `${total} órdenes en el rango · ${sin} sin producto interpretable.`;
}

/* -------------------------------------------------------------------------- */
/* Formato                                                                     */
/* -------------------------------------------------------------------------- */

/** Son ordenes y unidades CONTADAS: ni dinero, ni porcentaje. */
const UNIDAD_CONTEO = "conteo";

/**
 * Los dos porcentajes de la fila llegan como FRACCION (0,375) y `formatearValor` los multiplica
 * por cien. `null` sale como el marcador de dato ausente del repo, nunca como «0 %».
 */
const UNIDAD_PORCENTAJE = "porcentaje";

/** Cuantas filas por pagina de partida. Con 84 productos medidos, tres pantallas. */
const PAGE_SIZE_INICIAL = 25;

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/* -------------------------------------------------------------------------- */
/* Estados que NO son «no hubo productos»                                      */
/* -------------------------------------------------------------------------- */

/**
 * El mensaje que corresponde a cada estado que no es `ok`. `null` = no hay error.
 *
 * R44 — «prohibido», «sesion no valida», «filtro invalido» y «se rompio» son CUATRO textos
 * distintos y ninguno se degrada al estado vacio de la tabla: un problema de permisos pintado
 * como «no hubo productos» afirma un hecho del negocio que nadie ha comprobado.
 */
export function mensajeDe(
  resultado: ResultadoConteoProductos | undefined,
  fallo: boolean,
): string | null {
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
 * R37/R46 — ¿se pinta la columna «Tienda»?
 *
 * SE DECIDE POR EL CONTENIDO DE LA RESPUESTA Y NUNCA POR EL ROL, y esa es la mitad del punto:
 * para un `adminTienda` siempre hay una sola tienda, asi que la columna desaparece sola sin que
 * el cliente razone sobre permisos; y un maestro que filtre una sola tienda tampoco la necesita.
 * Con un `if (rol === …)` aqui habria una segunda regla de alcance en el navegador, que es donde
 * menos vale.
 *
 * Se cuenta por `tiendaId` y no por nombre: dos tiendas homonimas son dos tiendas.
 */
export function hayVariasTiendas(filas: readonly FilaProductoDTO[]): boolean {
  return new Set(filas.map((fila) => fila.tiendaId)).size > 1;
}

/** Clave de fila: la tienda Y el producto. Un producto solo no es unico entre tiendas (R37). */
function claveDeFila(fila: FilaProductoDTO): string {
  return `${fila.tiendaId}::${fila.producto}`;
}

/* -------------------------------------------------------------------------- */
/* Las columnas                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Las CIFRAS de una fila, en el orden del diseño. Se declaran una vez y las consumen las dos
 * vistas —la de escritorio como columnas y la de telefono como lineas apiladas—, de modo que
 * un telefono no puede acabar enseñando menos datos que un portatil (R46).
 *
 * `efectividadGestion` existe en `EfectividadEntrega` y NO se pinta, a proposito: en la lectura
 * por producto lo que interesa es el rechazo COMERCIAL, y dos porcentajes que suman distinto en
 * la misma fila invitan a leer uno por el otro.
 */
type IdCifra =
  | "unidades"
  | "ordenes"
  | "entregadas"
  | "rechazadas"
  | "otrosResultados"
  | "enProceso"
  | "efectividad"
  | "rechazo";

/**
 * El ORDEN de las ocho cifras, declarado una vez. Es el de `design.md §7.3` mas el cubo que
 * anadio la ficha 346.
 *
 * LAS CUATRO PRIMERAS DE CONTEO SUMAN LA COLUMNA «Órdenes» —entregadas, rechazadas, otros
 * resultados y en proceso—, y esa igualdad es el arreglo de la 346: antes eran tres y el
 * desglose se quedaba corto. La comprueba `tests/components/ProductosTabla.test.tsx` leyendo
 * las CELDAS pintadas, no la funcion.
 */
const ORDEN_CIFRAS: readonly { readonly id: IdCifra; readonly etiqueta: string }[] = [
  { id: "unidades", etiqueta: PRODUCTOS_COLUMNAS.unidades },
  { id: "ordenes", etiqueta: PRODUCTOS_COLUMNAS.ordenes },
  { id: "entregadas", etiqueta: PRODUCTOS_COLUMNAS.entregadas },
  { id: "rechazadas", etiqueta: PRODUCTOS_COLUMNAS.rechazadas },
  // FICHA 346 — va PEGADA a las dos anteriores y antes de «En proceso»: las tres primeras son
  // ordenes ya resueltas y la cuarta es trabajo vivo. Leidas en ese orden, la suma de las
  // cuatro es la columna «Órdenes» sin tener que saltar de sitio.
  { id: "otrosResultados", etiqueta: PRODUCTOS_COLUMNAS.otrosResultados },
  { id: "enProceso", etiqueta: PRODUCTOS_COLUMNAS.enProceso },
  { id: "efectividad", etiqueta: PRODUCTOS_COLUMNAS.efectividad },
  { id: "rechazo", etiqueta: PRODUCTOS_COLUMNAS.rechazo },
];

function cifrasDeFila(fila: FilaProductoDTO): Readonly<Record<IdCifra, string>> {
  const e = calcularEfectividad(fila.porStatus);
  return {
    unidades: formatearValor(fila.unidades, UNIDAD_CONTEO),
    ordenes: formatearValor(fila.ordenes, UNIDAD_CONTEO),
    entregadas: formatearValor(e.entregadas, UNIDAD_CONTEO),
    rechazadas: formatearValor(e.rechazadas, UNIDAD_CONTEO),
    otrosResultados: formatearValor(e.otrosDesenlaces, UNIDAD_CONTEO),
    enProceso: formatearValor(e.enProceso, UNIDAD_CONTEO),
    efectividad: formatearValor(e.efectividad, UNIDAD_PORCENTAJE),
    rechazo: formatearValor(e.tasaRechazo, UNIDAD_PORCENTAJE),
  };
}

/**
 * Una cifra de la tabla. `tabular-nums` para que dos filas seguidas queden en rejilla y
 * `whitespace-nowrap` para que un porcentaje no se parta por la mitad.
 *
 * PROHIBIDO AQUI `truncate`, `line-clamp` y `overflow-hidden`, por la leccion medida de las
 * fichas 343 y 344: un numero a medias no se ve roto, se ve como OTRO numero.
 */
function Cifra({ children }: { readonly children: string }) {
  return <span className="tabular-nums whitespace-nowrap">{children}</span>;
}

/**
 * El nombre del producto. `wrap-anywhere` porque los nombres reales son LARGUISIMOS —el mas
 * largo medido en produccion tiene 62 caracteres y tres barras verticales de marketing— y sin
 * esto una sola fila fija el ancho minimo de la tabla y empuja las cifras fuera de la pantalla.
 * `wrap-anywhere` y no `break-words`: el segundo no reduce el `min-content`, que es la medida
 * que aqui manda.
 */
function NombreProducto({ children }: { readonly children: string }) {
  return <span className="wrap-anywhere">{children}</span>;
}

/** Las columnas de ESCRITORIO. La de tienda se antepone solo cuando hace falta. */
function columnasEscritorio(conTienda: boolean): Column<FilaProductoDTO>[] {
  const tienda: Column<FilaProductoDTO>[] = conTienda
    ? [
        {
          id: "tienda",
          value: PRODUCTOS_COLUMNAS.tienda,
          render: (fila) => <NombreProducto>{fila.tienda}</NombreProducto>,
        },
      ]
    : [];

  return [
    ...tienda,
    {
      id: "producto",
      value: PRODUCTOS_COLUMNAS.producto,
      minWidth: "14rem",
      render: (fila) => <NombreProducto>{fila.producto}</NombreProducto>,
    },
    ...ORDEN_CIFRAS.map<Column<FilaProductoDTO>>((cifra) => ({
      id: cifra.id,
      value: cifra.etiqueta,
      align: "right",
      render: (fila) => <Cifra>{cifrasDeFila(fila)[cifra.id]}</Cifra>,
    })),
  ];
}

/**
 * Las columnas de TELEFONO: dos, y ni un dato menos.
 *
 * EL DEFECTO QUE ESTO EVITA, medido por las fichas 343 y 344 en Chromium a 390x844: una tabla de
 * cuatro columnas pedia 309 px en un hueco de 284 y el ultimo numero acababa fuera del area
 * visible; en la 344, 674 px fuera. Esta tabla tiene DIEZ columnas y nombres de producto de 62
 * caracteres, asi que el problema seria peor por construccion.
 *
 * Se apilan: el producto (con su tienda debajo cuando hay varias) en una celda y las ocho
 * cifras, cada una con su etiqueta, en la otra. No se oculta ni un dato y no se abrevia ninguno.
 */
function columnasTelefono(conTienda: boolean): Column<FilaProductoDTO>[] {
  return [
    {
      id: "producto",
      value: PRODUCTOS_COLUMNAS.producto,
      render: (fila) => (
        <div className="flex flex-col gap-0.5 wrap-anywhere">
          <NombreProducto>{fila.producto}</NombreProducto>
          {conTienda ? (
            <span className="text-xs text-muted-foreground">{fila.tienda}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "cifras",
      value: PRODUCTOS_COLUMNAS.cifras,
      align: "right",
      render: (fila) => {
        const cifras = cifrasDeFila(fila);
        return (
          <div className="flex flex-col gap-0.5">
            {ORDEN_CIFRAS.map((cifra) => (
              // La etiqueta a la izquierda y la cifra a la derecha, y la ETIQUETA PUEDE PARTIRSE.
              // Medido a 390 px: con la linea entera en `whitespace-nowrap`, «Efectividad de
              // entrega: 33,3%» fijaba un minimo de 204 px para esta columna y dejaba el nombre
              // del producto en 104 px, partiendo palabras por la mitad. Dejando respirar a la
              // etiqueta, el minimo cae y el nombre recupera sitio. La CIFRA nunca se parte:
              // `whitespace-nowrap` sigue vivo dentro de `Cifra`, que es donde importa.
              <span key={cifra.id} className="flex items-baseline justify-between gap-2">
                <span className="text-left text-xs text-muted-foreground">{cifra.etiqueta}</span>
                <Cifra>{cifras[cifra.id]}</Cifra>
              </span>
            ))}
          </div>
        );
      },
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* El componente                                                               */
/* -------------------------------------------------------------------------- */

export function ProductosTabla() {
  const { filtro } = useFiltroEntregas();
  const filtroSerializado = serializarFiltroEntregas(filtro);

  const { data, error, isLoading } = useSWR(
    claveConteoProductos(filtroSerializado),
    () => consultarConteoProductosSwr(filtroSerializado),
    // `keepPreviousData: false` — al cambiar el filtro la tabla se vacia y vuelve al estado de
    // carga (R43). Conservar la anterior dejaria en pantalla los productos del filtro previo
    // como si fueran los del nuevo.
    { keepPreviousData: false, revalidateOnFocus: false },
  );

  const mensaje = mensajeDe(data, error !== undefined);
  const datos = data?.status === "ok" ? data.datos : null;
  const filas = useMemo(() => datos?.filas ?? [], [datos]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_INICIAL);

  /**
   * R45 — LA PAGINACION ES DEL NAVEGADOR, y es una decision con fecha: la respuesta trae el
   * recorte entero (84 productos medidos en produccion, acotados por el CATALOGO y no por las
   * ventas), asi que paginar en el servidor costaria una consulta por pagina para ahorrar
   * pintar cincuenta filas. ⟨Q3⟩ del spec pregunta a partir de cuantos productos deja de valer;
   * mientras no haya numero, no se inventa un tope.
   *
   * La pagina se recorta contra el total: si el filtro cambia y ahora hay menos productos, una
   * pagina 4 que ya no existe dejaria la tabla vacia con datos detras.
   */
  const totalPaginas = Math.max(1, Math.ceil(filas.length / pageSize));
  const paginaVigente = Math.min(page, totalPaginas);
  const visibles = useMemo(
    () => filas.slice((paginaVigente - 1) * pageSize, paginaVigente * pageSize),
    [filas, paginaVigente, pageSize],
  );

  // R46 — por CONTENIDO. Se mira la respuesta ENTERA y no la pagina visible: si no, la columna
  // aparecería y desaparecería al pasar de página, que es peor que no tenerla.
  const conTienda = hayVariasTiendas(filas);
  const esTelefono = useIsMobile();
  const columnas = esTelefono ? columnasTelefono(conTienda) : columnasEscritorio(conTienda);

  /**
   * R52 — las filas del archivo salen del DTO QUE YA ESTA EN PANTALLA. Sin segunda consulta, asi
   * que el archivo no puede discrepar de la tabla; y son TODAS las filas del recorte, no las de
   * la pagina: la paginacion es un asunto de la pantalla y nadie descarga «la pagina 2».
   *
   * Familia B, y por el ADAPTADOR COMUN (`filasLocales`) y no armando el resultado a mano: ahi
   * es donde vive el tope unico de la app (5.000 filas, `descargaConfig.MAX_FILAS`) y el
   * mensaje accionable cuando se supera. Una tabla que se construyera su `DescargaFilasResult`
   * se saltaria ese tope entera y en silencio — lo vigila
   * `tests/components/descarga/ControlDescargaTransversal.test.tsx`, y esta tabla se vio caer en
   * el antes de cablearlo asi.
   */
  const obtenerFilas = () => filasLocales(filas, filaDescargaAnaliticaProductos);

  return (
    <div className="flex w-full flex-col gap-3">
      {/* R36/R35 — el aviso de multiproducto y, debajo, el universo del recorte. Van ARRIBA y
          no al pie: quien lee la columna «Ordenes» tiene que haber leido antes por que puede
          sumar de mas. El universo solo se pinta cuando hay respuesta: con un error, un total
          de cero seria una cifra inventada. */}
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>{PRODUCTOS_TEXTOS.aviso}</p>
        {/* FICHA 346 — y cómo se leen las columnas del desglose, que desde esta ficha suman. */}
        <p>{PRODUCTOS_TEXTOS.avisoDesglose}</p>
        {datos === null ? null : (
          <p>{textoUniverso(datos.ordenes, datos.ordenesSinProducto)}</p>
        )}
      </div>

      <DataTable
        columns={columnas}
        data={visibles}
        rowKey={claveDeFila}
        ariaLabel={PRODUCTOS_TEXTOS.tabla}
        isLoading={isLoading}
        error={mensaje}
        emptyState={{
          icon: PackageSearch,
          title: PRODUCTOS_TEXTOS.vacioTitulo,
          description: PRODUCTOS_TEXTOS.vacioDescripcion,
        }}
        descarga={
          filas.length === 0
            ? undefined
            : {
                titulo: PRODUCTOS_TEXTOS.descarga,
                columnas: COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS,
                obtenerFilas,
              }
        }
      />

      {/* La barra solo aparece con filas: con la tabla vacia, en carga o en error no hay nada
          que paginar y un «Sin resultados» debajo de un mensaje de permisos lo contradice. */}
      {filas.length === 0 ? null : (
        <Pagination
          page={paginaVigente}
          pageSize={pageSize}
          total={filas.length}
          showFirstLast
          siblingCount={1}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          sticky={false}
        />
      )}
    </div>
  );
}

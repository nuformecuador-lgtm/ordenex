"use client";

import { useMemo, useState } from "react";
import { History, SearchX } from "lucide-react";
import useSWR from "swr";

import {
  DataTable,
  type DataTableDescarga,
  type DescargaFilasResult,
} from "@/components/shared/DataTable";
import {
  SUFIJO_REINTENTO,
  filasDesdeResultado,
} from "@/components/shared/descarga-resultado";
import { Pagination } from "@/components/shared/Pagination";
import { SegmentedToggle } from "@/components/shared/SegmentedToggle";
import {
  listarHistorialAccionesCompleto,
  listarHistorialAccionesPaginado,
} from "@/lib/actions/historial-acciones";
import type {
  ActorHistorialDTO,
  HistorialAccionDTO,
  ListarHistorialAccionesCompletoResult,
  ListarHistorialAccionesResult,
} from "@/lib/types/historial-accion";
import { HISTORIAL_PAGE_SIZE_DEFECTO } from "@/lib/types/historial-accion";
import { claveDeOrden } from "@/lib/types/ordenamiento-listado";
import type { DireccionOrden } from "@/lib/types/ordenamiento-listado";

import {
  columnasHistorialAcciones,
  TITULO_HISTORIAL_ACCIONES,
} from "./historial-acciones-columnas";
import {
  COLUMNAS_DESCARGA_HISTORIAL_ACCIONES,
  filaDescargaHistorialAccion,
} from "./historial-acciones-descarga-columnas";
import {
  MENSAJE_FILTROS_INVALIDOS,
  mensajeLimiteHistorial,
} from "./historial-acciones-descarga";
import {
  DIRECCION_ORDEN_INICIAL_HISTORIAL,
  ETIQUETA_ORDEN_HISTORIAL,
  OPCIONES_ORDEN_HISTORIAL,
  ordenamientoHistorial,
} from "./historial-acciones-orden";
import { HistorialAccionesFiltrosBar } from "./HistorialAccionesFiltrosBar";
import {
  claveDeFiltroHistorial,
  type FiltroHistorialAccionUI,
} from "./seleccion-a-filtro";

// FICHA 362 / T5.4 y T5.5 (design §5.3/§5.4, R21/R22/R27/R30/R34-R37) — el MODULO de cliente
// del historial de acciones.
//
//   page.tsx (server, gate)
//     └─ HistorialAccionesModule          ← esto
//          ├─ HistorialAccionesFiltrosBar (BuscadorFiltros + FilterComponent, R28)
//          ├─ SegmentedToggle             (el orden, R26)
//          ├─ DataTable                   (10 columnas + descarga, R34-R38)
//          └─ Pagination                  (server-side, R22)
//
// SOLO LECTURA (R21): las unicas acciones que este arbol conoce son las LECTURAS del registro
// (`lib/actions/historial-acciones`). Ni un formulario, ni un boton que mute.
// Lo vigila `tests/unit/guards/historial-acciones-solo-lectura.guardia.test.ts`.

/** Opciones de tamaño de página. Ninguna supera `HISTORIAL_PAGE_SIZE_MAX` (100). */
const PAGE_SIZE_OPTIONS = [10, 25, 50];

/** Las dos lecturas del registro. Se inyectan para poder doblarlas en test. */
export interface HistorialAccionesAcciones {
  listar: (input: unknown) => Promise<ListarHistorialAccionesResult>;
  listarCompleto: (input: unknown) => Promise<ListarHistorialAccionesCompletoResult>;
}

export interface HistorialAccionesModuleProps {
  /** Catálogo de actores pre-cargado por la página. Puede venir vacío. */
  actores: ActorHistorialDTO[];
  /**
   * Dobles de las dos Server Actions. La página NUNCA las pasa —una función no cruza la
   * frontera RSC—, así que en producción siempre son las reales.
   */
  acciones?: Partial<HistorialAccionesAcciones>;
  /** Instante desde el que se resuelven los atajos de fecha. Sólo lo pasan los tests. */
  ahora?: Date;
  /** Espera de la barra de filtros. Sólo lo pasan los tests. */
  debounceMs?: number;
}

interface PaginaHistorial {
  items: HistorialAccionDTO[];
  total: number;
  pageSize: number;
}

/**
 * T5.5 (design §5.4) — EL VACIO QUE NO MIENTE.
 *
 * El registro empieza el dia que se despliega. Lo de antes NO existe y no se puede
 * reconstruir: el 2026-09-02 se borraron 79 ordenes sin dejar huella, y ese dato ya no se
 * puede recuperar de ninguna parte. Sin decirlo, el maestro abre el modulo, ve poco o nada y
 * concluye que esta roto —o peor, que no ha pasado nada—. Es la misma familia que la nota
 * `sin_gestion_registrado` de la 264: «ninguna» y «no lo sabemos» son cosas distintas, y
 * confundirlas en una auditoria es el fallo caro.
 */
export const VACIO_TITULO = "Todavía no hay acciones registradas";
export const VACIO_DESCRIPCION =
  "Este registro empieza el día en que se desplegó: lo anterior a esa fecha no quedó guardado y no se puede reconstruir. Lo que ocurra a partir de ahora sí aparece aquí.";

/**
 * El vacío de una BÚSQUEDA no es el vacío del listado (169/R40). Decir «todavía no hay
 * acciones» mientras se busca es literalmente falso —sí las hay, lo que no hay es
 * coincidencias— y empuja a concluir que la pantalla se rompió.
 */
export function vacioConBusqueda(termino: string): {
  title: string;
  description: string;
} {
  return {
    title: "Sin coincidencias",
    description: `Ninguna acción coincide con «${termino}». Revisa el texto o limpia la búsqueda.`,
  };
}

/**
 * T6.2 — el resultado de la lectura completa, traducido a filas de export.
 *
 * ⭑ EL REPARTO, y por qué NO es un adaptador propio. Las dos formas que el contrato de esta
 * ficha declara distintas de `ListarCompletoResult` (`limite_excedido` con `{ maximo }` en vez
 * de `{ total, limite }`, y `validation_error` con `{ motivo }` en vez de `{ fieldErrors }`) se
 * resuelven aquí, en una línea cada una y con su texto; TODO lo demás —el camino feliz, la
 * proyección fila a fila, `unauthenticated` y `forbidden`— va al adaptador COMÚN de la 170,
 * `filasDesdeResultado`. Es el mismo reparto, y por el mismo motivo, que
 * `DetalleMiMovimientoCierre.obtenerFilasDescarga` con su estado `sin_reparto`.
 *
 * Vive en ESTE archivo, junto al `descarga={…}`, y no en un módulo al lado: así el barrido
 * estático de `ControlDescargaTransversal` ve el adaptador común desde el mismo fuente que
 * declara la descarga, que es lo que hace que ese barrido cubra las tablas futuras.
 *
 * ⚠️ `limite_excedido` sale como ERROR y sin filas. Tratarlo como éxito entrega un archivo
 * incompleto que el usuario cree completo — el fallo caro de esta pantalla.
 */
export async function obtenerFilasDescargaHistorial(
  resultado:
    | ListarHistorialAccionesCompletoResult
    | Promise<ListarHistorialAccionesCompletoResult>,
): Promise<DescargaFilasResult> {
  const res = await resultado;
  if (res.status === "limite_excedido") {
    return { status: "error", mensaje: mensajeLimiteHistorial(res.maximo) };
  }
  if (res.status === "validation_error") {
    return { status: "error", mensaje: `${MENSAJE_FILTROS_INVALIDOS} ${SUFIJO_REINTENTO}` };
  }
  // `total` es el del conjunto que devuelve la lectura completa, que por definición ES el
  // dataset entero: no hay recorte del que informar. El adaptador común lo usa sólo para
  // redactar el aviso del tope, y por ese camino ya no se pasa.
  return filasDesdeResultado(
    res.status === "ok"
      ? { status: "ok", items: res.items, total: res.items.length }
      : res,
    filaDescargaHistorialAccion,
  );
}

export function HistorialAccionesModule({
  actores,
  acciones,
  ahora,
  debounceMs,
}: Readonly<HistorialAccionesModuleProps>) {
  const listar = acciones?.listar ?? listarHistorialAccionesPaginado;
  const listarCompleto = acciones?.listarCompleto ?? listarHistorialAccionesCompleto;

  const [termino, setTermino] = useState("");
  const [filtrosControles, setFiltrosControles] = useState<FiltroHistorialAccionUI>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(HISTORIAL_PAGE_SIZE_DEFECTO);
  const [sortDir, setSortDir] = useState<DireccionOrden>(
    DIRECCION_ORDEN_INICIAL_HISTORIAL,
  );

  const orden = useMemo(() => ordenamientoHistorial(sortDir), [sortDir]);

  /**
   * El filtro COMPLETO: lo de los controles más el término del campo, que viaja por su
   * propio camino porque tiene su propio mínimo y su propio debounce (ver la barra).
   * `termino` llega ya recortado y por encima de `BUSQUEDA_MIN_CHARS`, o vacío.
   */
  const filtro = useMemo<FiltroHistorialAccionUI>(
    () => ({ ...filtrosControles, ...(termino === "" ? {} : { q: termino }) }),
    [filtrosControles, termino],
  );

  // La key de SWR es la IDENTIDAD del dato, y tiene que ser un ESCALAR estable: el objeto
  // `filtro` cambia de identidad en cada render y usarlo tal cual dispararía una consulta
  // nueva cada vez.
  const claveFiltro = claveDeFiltroHistorial(filtro);

  /**
   * ⭑ EL ORDEN, EN LA KEY. Es el punto que hace que el control funcione, y el único de este
   * módulo cuya ausencia NO rompe nada visible.
   *
   * Dos peticiones que sólo se diferencian en el orden son DOS respuestas distintas. Sin este
   * escalar, pedir «Más antiguas» encontraría en caché la respuesta de «Más recientes», no
   * volvería a consultar y la tabla se quedaría exactamente igual: el control puesto y las
   * filas sin moverse. Es un fallo MUDO —ni error, ni hueco, ni test rojo— y ya ocurrió en
   * `/ordenes` (documentado en `impl_352.md` y en la ficha 356).
   *
   * `claveDeOrden` es la función del contrato (352) y no una plantilla escrita a mano aquí:
   * incluye `sortBy` además de la dirección, así que el día que se ordene por otra columna la
   * caché se separa sola.
   */
  const claveOrden = claveDeOrden(orden);

  const { data, error, isLoading } = useSWR<PaginaHistorial>(
    ["historial-acciones:list", claveFiltro, claveOrden, page, pageSize],
    async () => {
      const res = await listar({ ...filtro, page, pageSize, ...orden });
      if (res.status !== "ok") throw new Error(res.status);
      return { items: res.items, total: res.total, pageSize: res.pageSize };
    },
  );

  // Al cambiar CUALQUIER filtro, la página actual puede no existir en el nuevo resultado
  // (estabas en la 4 y ahora hay 1). Patrón "ajustar estado durante el render": evita el
  // parpadeo de un fetch a la página vieja que haría un efecto.
  const [claveFiltroPrevia, setClaveFiltroPrevia] = useState(claveFiltro);
  if (claveFiltro !== claveFiltroPrevia) {
    setClaveFiltroPrevia(claveFiltro);
    setPage(1);
  }

  // Cambiar el ORDEN también vuelve a la página 1, y por un motivo propio: la página N de un
  // orden NO es la página N del contrario. Quien está en la 7 mirando lo más reciente y pide
  // lo más antiguo se quedaría en un tramo arbitrario del conjunto dado la vuelta —ni el
  // principio ni el final—, que es peor que un resultado vacío porque parece legítimo.
  const [claveOrdenPrevia, setClaveOrdenPrevia] = useState(claveOrden);
  if (claveOrden !== claveOrdenPrevia) {
    setClaveOrdenPrevia(claveOrden);
    setPage(1);
  }

  // Identidad estable de la página: `data?.items ?? []` fabrica un array nuevo en cada render
  // mientras SWR no tiene datos, y esa identidad inestable se propaga a todo lo que dependa
  // de ella.
  const items = useMemo<HistorialAccionDTO[]>(() => data?.items ?? [], [data]);

  const descarga: DataTableDescarga = {
    titulo: TITULO_HISTORIAL_ACCIONES,
    columnas: COLUMNAS_DESCARGA_HISTORIAL_ACCIONES,
    // R30 — el archivo es EL MISMO CONJUNTO que la pantalla: mismos filtros y mismo orden,
    // resueltos en el servidor. Lo único que no viaja es la página, que es justamente lo que
    // la descarga no tiene.
    //
    // ⚠️ `obtenerFilasDescargaHistorial` traduce `limite_excedido` a un ERROR, no a un éxito
    // vacío. Un archivo incompleto que el usuario cree completo es el fallo caro de esta
    // pantalla.
    obtenerFilas: () =>
      obtenerFilasDescargaHistorial(listarCompleto({ ...filtro, ...orden })),
  };

  const barra = (
    <div className="flex flex-1 flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <HistorialAccionesFiltrosBar
          actores={actores}
          onBuscar={setTermino}
          onFiltrosChange={setFiltrosControles}
          ahora={ahora}
          debounceMs={debounceMs}
        />
      </div>
      <SegmentedToggle
        options={OPCIONES_ORDEN_HISTORIAL}
        valor={sortDir}
        onChange={setSortDir}
        ariaLabel={ETIQUETA_ORDEN_HISTORIAL}
      />
    </div>
  );

  return (
    <section className="flex flex-col gap-4">
      <DataTable
        columns={columnasHistorialAcciones}
        data={items}
        rowKey="id"
        ariaLabel={TITULO_HISTORIAL_ACCIONES}
        descarga={descarga}
        filtros={barra}
        isLoading={isLoading}
        error={error ? "No se pudo cargar el registro de acciones" : null}
        emptyState={
          termino === ""
            ? {
                icon: History,
                title: VACIO_TITULO,
                description: VACIO_DESCRIPCION,
              }
            : { icon: SearchX, ...vacioConBusqueda(termino) }
        }
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        disabled={isLoading}
        showFirstLast
        siblingCount={1}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
      />
    </section>
  );
}

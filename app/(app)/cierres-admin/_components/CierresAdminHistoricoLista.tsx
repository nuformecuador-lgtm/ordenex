"use client";

import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/shared/Pagination";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { cierreConfig } from "@/lib/config/cierre";
import { listarHistoricoCierresAdminCompleto } from "@/lib/actions/cierres-admin";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type { FiltrosCierres } from "@/lib/types/filtros-cierres";
import type { DataTableDescarga } from "@/components/shared/DataTable";

import { RechazadoBloqueanteBadge } from "./cierre-detalle-shared";
import { CierreFacturaResumen } from "./cierre-factura";
import { ListaComprobantes } from "./ListaComprobantes";
import {
  COLUMNAS_DESCARGA_CIERRES_HISTORICO,
  filaDescargaCierreHistorico,
} from "./cierres-admin-descarga-columnas";
import { PendienteLiquidarBadge } from "./PendienteLiquidarBadge";

/**
 * Feature 170 — FASE 2 (T I.2, R43/R44/R52): el HISTÓRICO de «Cierres del día» (feature 38,
 * R5), paginado en el servidor.
 *
 * Pedido humano del 2026-08-16 — DEJA DE SER UNA TABLA: cada cierre resuelto se lee como el
 * comprobante compacto de `cierre-factura`, el mismo que ya usaban la previsualización y el
 * detalle. El archivo conserva su nombre de listado, su control de paginación y su descarga;
 * lo que cambia es la forma de la fila. Ni un dato de la tabla se queda fuera, y esa
 * correspondencia es lo que hay que releer si algún día se toca:
 *
 *     Estado ................. el badge de la hoja (+ la marca de «bloqueante» de 109/R31)
 *     Mensajero, Destino ..... las partes de la segunda línea del comprobante
 *     Fecha resuelta ......... la columna «Fechas» del desglose (solicitado y resuelto)
 *     Total general .......... el total de la cabecera
 *     Pago al mensajero ...... el desglose «Ajustes»
 *     Pendiente de liquidar .. junto al estado, VISIBLE SIN ABRIR NADA (172/R26)
 *     Ingreso de bodega ...... el desglose «Ajustes»
 *     Motivo ................. la línea de motivo de rechazo, fuera del desplegable
 *     Acciones ............... la botonera de la hoja
 *
 * POR QUÉ SIGUE VIVIENDO EN SU PROPIO ARCHIVO: `CierresAdminModule` enseña, junto a este
 * listado, el contador de su cola. La guardia de T H.3 prohíbe que un contador derivado de un
 * array conviva con un control de paginación en el mismo archivo, y separar el listado que
 * pagina del que no lo hace es lo que mantiene ciertas las dos cosas a la vez.
 *
 * POR QUÉ ES CONTROLADO (recibe la página, no la pide): la página se pide una vez, en el
 * módulo, para que las dos lecturas de los mismos cierres no puedan divergir (Q-I3).
 */

/** La página del histórico que se está mostrando, tal como la devuelve el servidor. */
export interface CierresAdminHistoricoPagina {
  items: CierreAdminResumen[];
  total: number;
  pageSize: number;
}

export interface CierresAdminHistoricoListaProps {
  /** Comprobantes de la página visible + el total del CONJUNTO (R41), no el de la página. */
  pagina: CierresAdminHistoricoPagina;
  page: number;
  isLoading: boolean;
  /** `true` si la lectura de la página falló (mensaje accionable en el propio listado). */
  hayError: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** Abre el detalle del cierre (el modal vive en el módulo padre). */
  onAbrir: (cierreId: string) => void;
}

/** Nombre visible del listado: hoja, base del archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA = "Cierres del día resueltos";
/** Nombre accesible del control (R43). Propio: la pantalla monta varios listados paginados. */
export const PAGINACION_HISTORICO_LABEL = "Paginación del histórico de cierres del día";
const ERROR_CARGA = "No se pudo cargar el histórico de cierres.";

// R40: el tamaño sale de la config del dominio (T H.1), nunca de un literal de pantalla, y
// las opciones nunca superan el máximo que el borde acepta.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter((s) => s <= cierreConfig.MAX_PAGE_SIZE);

/**
 * La configuración de descarga de ESTE listado, para que la monte quien pinta la fila de las
 * pestañas (pedido humano del 2026-08-16: el botón va alineado con «Pendientes/Resueltos», no
 * en una fila propia encima de la lista).
 *
 * Vive AQUÍ y no en el módulo aunque allí se use: el título, las columnas y la lectura de la
 * que sale el archivo son de este listado, y separarlas de él es como acaban divergiendo el
 * nombre de la hoja y el de la pantalla.
 *
 * Feature 170 (T I.2, R52) — el listado pinta UNA página; el archivo es el CONJUNTO. Proyectar
 * `pagina.items` habría convertido «descargar el histórico» en «descargar las 25 filas que veo»
 * sin que nada fallara. Feature 184 — Tanda D (T D.3, R1): ese conjunto lo entrega una lectura
 * DEDICADA, que corta por estado en la base con el mismo criterio y el mismo orden que la
 * página, y cuyo tope de filas evalúa el servidor (R6).
 *
 * Pedido humano del 2026-08-16 — «el CONJUNTO» pasa a significar «el conjunto FILTRADO», y la
 * distinción con el alcance sigue intacta: los `filtros` viajan porque el usuario los puso; el
 * ALCANCE no viaja, lo pone el servidor desde la sesión, y un `adminSatelite` sigue descargando
 * solo los cierres de su zona por mucho que filtre (R14/R44).
 */
export function descargaHistoricoCierres(filtros: FiltrosCierres): DataTableDescarga {
  return {
    titulo: TITULO_DESCARGA,
    columnas: COLUMNAS_DESCARGA_CIERRES_HISTORICO,
    obtenerFilas: () =>
      filasDesdeResultado(
        listarHistoricoCierresAdminCompleto({ filtros }),
        filaDescargaCierreHistorico,
      ),
  };
}

export function CierresAdminHistoricoLista({
  pagina,
  page,
  isLoading,
  hayError,
  onPageChange,
  onPageSizeChange,
  onAbrir,
}: Readonly<CierresAdminHistoricoListaProps>) {
  return (
    // Sin encabezado visible (pedido humano del 2026-08-16): la pestaña ya dice «Resueltos».
    // El `aria-label` se queda —la sección necesita nombre para quien no ve la pantalla, y es
    // por él por el que la localizan los tests—.
    <section aria-label="Histórico" className="flex flex-col gap-3">
      <ListaComprobantes
        ariaLabel="Histórico"
        items={pagina.items}
        clave={(c) => c.cierreId}
        isLoading={isLoading}
        error={hayError ? ERROR_CARGA : null}
        emptyMessage="Aún no hay cierres resueltos."
        render={(c) => (
          <CierreFacturaResumen
            cierre={c}
            rotulo={
              <>
                {/* Feature 109/R31: un `rechazado` es BLOQUEANTE hasta que el mensajero
                    re-solicite. Solo la marca: el estado ya lo dice el badge de la hoja. */}
                {c.estado === "rechazado" ? <RechazadoBloqueanteBadge /> : null}
                {/* Feature 172 (T E.3, R26): LA DEUDA SE VE SIN ABRIR NADA. En un cierre no
                    aprobado el pendiente es `null` por definición (R28) y no se pinta: en una
                    tarjeta, el guion de la celda vacía sería ruido junto al estado. */}
                {c.pendientePagoMensajero === null ? null : (
                  <PendienteLiquidarBadge pendiente={c.pendientePagoMensajero} />
                )}
              </>
            }
            acciones={
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={`Ver el cierre resuelto de ${c.mensajeroNombre}`}
                onClick={() => onAbrir(c.cierreId)}
              >
                Ver
              </Button>
            }
          />
        )}
      />

      <Pagination
        page={page}
        pageSize={pagina.pageSize}
        total={pagina.total}
        disabled={isLoading}
        showFirstLast
        siblingCount={1}
        ariaLabel={PAGINACION_HISTORICO_LABEL}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
      />
    </section>
  );
}

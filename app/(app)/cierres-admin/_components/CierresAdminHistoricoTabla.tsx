"use client";

import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { filasDelConjuntoCompleto } from "@/components/shared/descarga-resultado";
import { cierreConfig } from "@/lib/config/cierre";
import { listarCierresAdmin } from "@/lib/actions/cierres-admin";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";

import {
  money,
  EstadoHistoricoRotulo,
  PAGO_MENSAJERO_COL,
  INGRESO_BODEGA_RECHAZOS_COL,
} from "./cierre-detalle-shared";
import { destinoCierre } from "./cierre-labels";
import {
  COLUMNAS_DESCARGA_CIERRES_HISTORICO,
  filaDescargaCierreHistorico,
} from "./cierres-admin-descarga-columnas";
import { PENDIENTE_LIQUIDAR_COL } from "./pago-mensajero-labels";
import { PendienteLiquidarBadge } from "./PendienteLiquidarBadge";

/**
 * Feature 170 — FASE 2 (T I.2, R43/R44/R52): el HISTÓRICO de «Cierres del día» (feature 38,
 * R5), paginado en el servidor. Molde: `UsuariosModule` (página pre-cargada por el Server
 * Component + SWR + `<Pagination>` alimentado por el `total` del servidor).
 *
 * POR QUÉ VIVE EN SU PROPIO ARCHIVO: `CierresAdminModule` muestra, junto a esta tabla, el
 * contador de la cola de pendientes —derivado hoy de `pendientes.length`—, que es correcto
 * (ese array sigue siendo el conjunto entero) y que la tanda J sustituirá por el `total` del
 * servidor cuando pagine la cola. La guardia de T H.3 prohíbe, con razón, que un contador
 * derivado de un array conviva con un control de paginación en el mismo archivo. Separar el
 * listado que pagina del que no lo hace es lo que mantiene ciertas las dos cosas a la vez, en
 * vez de silenciar la guardia.
 *
 * POR QUÉ ES CONTROLADO (recibe la página, no la pide): el histórico de esta pantalla tiene
 * DOS lecturas —esta tabla y la «Vista tipo factura» de abajo, que la 38 dejó como
 * previsualización pendiente de decisión humana—. Si cada una pidiera su página, las dos
 * lecturas de los MISMOS cierres podrían mostrar cosas distintas. La página se pide una vez,
 * en el módulo, y las dos la leen (Q-I3).
 */

/** La página del histórico que se está mostrando, tal como la devuelve el servidor. */
export interface CierresAdminHistoricoPagina {
  items: CierreAdminResumen[];
  total: number;
  pageSize: number;
}

export interface CierresAdminHistoricoTablaProps {
  /** Filas de la página visible + el total del CONJUNTO (R41), no el de la página. */
  pagina: CierresAdminHistoricoPagina;
  page: number;
  isLoading: boolean;
  /** `true` si la lectura de la página falló (mensaje accionable en la propia tabla). */
  hayError: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** Abre el detalle del cierre (el modal vive en el módulo padre). */
  onAbrir: (cierreId: string) => void;
}

/** Nombre visible de la tabla: hoja, base del archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA = "Cierres del día resueltos";
/** Nombre accesible del control (R43). Propio: la pantalla monta varias tablas paginadas. */
export const PAGINACION_HISTORICO_LABEL = "Paginación del histórico de cierres del día";
const ERROR_CARGA = "No se pudo cargar el histórico de cierres.";

// R40: el tamaño sale de la config del dominio (T H.1), nunca de un literal de pantalla, y
// las opciones nunca superan el máximo que el borde acepta.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter((s) => s <= cierreConfig.MAX_PAGE_SIZE);

export function CierresAdminHistoricoTabla({
  pagina,
  page,
  isLoading,
  hayError,
  onPageChange,
  onPageSizeChange,
  onAbrir,
}: Readonly<CierresAdminHistoricoTablaProps>) {
  return (
    <section aria-label="Histórico" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Histórico</h2>
      <div className="overflow-x-auto">
        <DataTable
          columns={columnasHistorico(onAbrir)}
          data={pagina.items}
          rowKey="cierreId"
          ariaLabel="Histórico"
          emptyMessage="Aún no hay cierres resueltos."
          isLoading={isLoading}
          error={hayError ? ERROR_CARGA : null}
          /**
           * Feature 170 (T I.2, R52) — la tabla pinta UNA página; el archivo sigue siendo el
           * CONJUNTO COMPLETO del alcance del actor. Se relee al pulsar el control, con el
           * MISMO listado que la pantalla ya llamaba antes de paginar (`listarCierresAdmin`),
           * que reparte cola e histórico con el mismo criterio y el mismo acotamiento por rol:
           * un `adminSatelite` sigue descargando solo los cierres de su zona (R14/R44).
           * Proyectar `pagina.items` habría convertido «descargar el histórico» en «descargar
           * lo que se ve» sin que nada fallara.
           */
          descarga={{
            titulo: TITULO_DESCARGA,
            columnas: COLUMNAS_DESCARGA_CIERRES_HISTORICO,
            obtenerFilas: () =>
              filasDelConjuntoCompleto(
                listarCierresAdmin().then((res) =>
                  res.status === "ok"
                    ? ({ status: "ok", items: res.historico } as const)
                    : res,
                ),
                filaDescargaCierreHistorico,
              ),
          }}
        />
      </div>

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

// --- Columnas del histórico (solo lectura, R5). Promovidas TAL CUAL desde
// `CierresAdminModule`: ni una columna, ni un rótulo, ni el orden cambian (R44). ---
function columnasHistorico(
  abrir: (cierreId: string) => void,
): Column<CierreAdminResumen>[] {
  return [
    // Feature 109/R31: un `rechazado` del histórico se rotula "bloqueante hasta
    // re-solicitud" (no "resuelto/cerrado"); el resto conserva su etiqueta.
    {
      id: "estado",
      value: "Estado",
      render: (c) => <EstadoHistoricoRotulo estado={c.estado} />,
    },
    { id: "mensajero", value: "Mensajero", render: (c) => c.mensajeroNombre },
    {
      id: "resueltoAt",
      value: "Fecha resuelta",
      render: (c) => c.resueltoAt?.slice(0, 10) ?? "—",
    },
    { id: "destino", value: "Destino", render: (c) => destinoCierre(c) },
    {
      id: "general",
      value: "Total general",
      render: (c) => money(c.totales.general),
    },
    {
      id: "pagoMensajero",
      value: PAGO_MENSAJERO_COL,
      render: (c) => money(c.totalPagoMensajero),
    },
    // Feature 172 (T E.3, R26): LA DEUDA SE VE SIN ABRIR NADA. Va pegada al «Pago al
    // mensajero» porque es su otra mitad: aquello es lo que se le debe por el cierre y esto,
    // lo que de ello sigue sin entregarse. El valor lo DERIVA EL SERVIDOR (T C.2) y aquí solo
    // se pinta (R14).
    //
    // La columna vive en el HISTÓRICO y no en la cola, y no es un olvido: la cola son los
    // cierres `solicitado`/`vencido`, donde el pendiente es `null` por definición (R28) y la
    // columna estaría vacía en todas las filas, siempre. Los cierres aprobados —los únicos que
    // pueden deber algo— se listan aquí.
    {
      id: "pendienteLiquidar",
      value: PENDIENTE_LIQUIDAR_COL,
      render: (c) => <PendienteLiquidarBadge pendiente={c.pendientePagoMensajero} />,
    },
    {
      id: "ingresoBodegaRechazos",
      value: INGRESO_BODEGA_RECHAZOS_COL,
      render: (c) => money(c.totalIngresoBodegaRechazos),
    },
    {
      id: "motivoRechazo",
      value: "Motivo",
      render: (c) => c.motivoRechazo ?? "—",
    },
    {
      id: "acciones",
      value: "Acciones",
      render: (c) => (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => abrir(c.cierreId)}
        >
          Ver
        </Button>
      ),
    },
  ];
}

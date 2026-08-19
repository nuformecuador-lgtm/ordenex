"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
import { Pagination } from "@/components/shared/Pagination";
import { SegmentedToggle } from "@/components/shared/SegmentedToggle";
import { DescargarDatasetButton } from "@/components/shared/DescargarDatasetButton";
import type { DataTableDescarga } from "@/components/shared/DataTable";
import {
  CATALOGO_FILTROS_CIERRES_VACIO,
  type CatalogoFiltrosCierresDTO,
  type FiltrosCierresBodega,
} from "@/lib/types/filtros-cierres";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { useToast } from "@/hooks/useToast";
import { cierreConfig } from "@/lib/config/cierre";
import {
  solicitarCierreBodega,
  listarConsolidablesCompleto,
  listarConsolidablesPaginado,
} from "@/lib/actions/cierre-bodega";
import type { CierreBodegaResumenLite } from "@/lib/interfaces/services/ICierreBodegaService";
import type { CierreTotales } from "@/lib/interfaces/services/ICierreDiaService";
import {
  PagoMensajeroTotal,
  IngresoBodegaRechazosTotal,
  CentralDebeTotal,
  TotalesPanel,
} from "./cierre-detalle-shared";
import { CierreConsolidableFacturaResumen } from "./cierre-factura";
import { ListaComprobantes } from "./ListaComprobantes";
import { PanelConmutado } from "./PanelConmutado";
import {
  CierresBodegaSolicitadosLista,
  descargaBodegaSolicitados,
  type CierresBodegaSolicitadosPagina,
} from "./CierresBodegaSolicitadosLista";
import { FiltrosCierresBarra } from "./FiltrosCierresBarra";
import {
  COLUMNAS_DESCARGA_CONSOLIDABLES,
  filaDescargaConsolidable,
} from "./cierres-bodega-descarga-columnas";

/** Nombre visible del listado de consolidables: hoja, archivo y control (R12/R13). */
const TITULO_DESCARGA_CONSOLIDABLES = "Cierres del día a consolidar";
/** Nombre accesible del control (R43). Propio: la pantalla monta dos listados paginados. */
export const PAGINACION_CONSOLIDABLES_LABEL =
  "Paginación de los cierres del día a consolidar";
const ERROR_CARGA_CONSOLIDABLES = "No se pudieron cargar los cierres a consolidar.";

/** `true` si el objeto no recorta nada: entonces la página pre-cargada del servidor sirve. */
function sinFiltrosBodega(filtros: FiltrosCierresBodega): boolean {
  return Object.values(filtros).every((v) => v === undefined);
}

// --- Pedido humano del 2026-08-16: las dos mitades de esta sección, en pestañas ---
//
// LOS NOMBRES NO SON «Pendientes/Resueltos», y es una decisión, no un descuido. En las otras
// dos secciones esa pareja es exacta —hay una cola de decisión y un histórico de resueltos—;
// aquí las dos mitades son OTRA COSA: lo que todavía no se ha consolidado (cierres del día
// `aprobado` de la zona) y los cierres de BODEGA que esta zona ya solicitó, que incluyen los
// que siguen esperando decisión del maestro. Llamar «Resueltos» a un conjunto que contiene
// solicitudes sin resolver sería una etiqueta falsa en una pantalla de dinero.
const TAB_CONSOLIDAR = "consolidar";
const TAB_SOLICITADOS = "solicitados";
type TabConsolidacion = typeof TAB_CONSOLIDAR | typeof TAB_SOLICITADOS;
const TAB_CONSOLIDAR_LABEL = "A consolidar";
const TAB_SOLICITADOS_LABEL = "Solicitados";
/** Nombre accesible del conmutador. Propio: la pantalla anida varios segmentados. */
const TABS_CONSOLIDACION_LABEL = "Cierre de bodega por etapa";

// R40: el tamaño sale de la config del dominio (T H.1), nunca de un literal de pantalla.
// Es `cierreConfig` y no `cierreBodegaConfig` porque los comprobantes de este listado son `cierre_dia`
// (T J.1, decisión 9): con la config de bodega, ajustar el tamaño de página de los cierres de
// bodega movería también el de una tabla de cierres del día.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter((s) => s <= cierreConfig.MAX_PAGE_SIZE);

/**
 * Feature 170 — FASE 2 (T J.2, R40/R41): la PÁGINA de los consolidables. `total` es el del
 * CONJUNTO —de él sale el contador de cabecera (R42)— y nunca `items.length`.
 */
export interface ConsolidablesPagina {
  items: CierreBodegaResumenLite[];
  total: number;
  pageSize: number;
}

/**
 * Feature 170 — FASE 2 (T J.2): una página de consolidables. La zona NO viaja en el input: la
 * resuelve el servicio desde la sesión, igual que el listado sin paginar (R44).
 */
async function leerConsolidables(
  page: number,
  pageSize: number,
  filtros: FiltrosCierresBodega,
): Promise<ConsolidablesPagina> {
  const res = await listarConsolidablesPaginado({ page, pageSize, filtros });
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

// Feature 40 (T8) — módulo cliente del "Cierre de bodega" del adminSatelite (lado
// SOLICITAR, espejo de la 37 un nivel arriba). Recibe del Server Component padre los
// cierre_dia aprobados consolidables de SU zona (R5), los totales agregados (R10),
// el gate `puedesSolicitar`/`motivoBloqueo` (R6/R7) y su histórico propio (F1.4-h),
// todo ya acotado server-side (R1/R3). La única mutación (Solicitar cierre de
// bodega) va por Server Action y refresca la ruta. Money-safe (R13): los montos son
// STRING; se renderizan con `money()` sin `parseFloat`/`Number`.

export interface ConsolidacionBodegaModuleProps {
  /**
   * Feature 170 — FASE 2 (T J.2, R40/R41): PÁGINA 1 de los cierre_dia `aprobado` sin cierre
   * de bodega de la zona (R5), ya resuelta server-side, más el `total` del conjunto.
   */
  consolidables: ConsolidablesPagina;
  /**
   * Suma snapshot de los consolidables (R10).
   *
   * Feature 170 — FASE 2 (T J.2, R49/R50): los CINCO agregados de dinero de esta pantalla
   * siguen llegando por props, calculados sobre el CONJUNTO COMPLETO en `listarConsolidacion`.
   * NO se derivan de la página, y no es disciplina: dos de ellos —`totalNetoAgregado` y
   * `totalCentralDebeAgregado`— salen de repartir el efectivo entre los pagos INDIVIDUALES
   * ordenados de menor a mayor, y eso no lo produce ni una página ni un `SUM`. Sobre la página
   * visible la pantalla podría decir que la central no debe nada cuando debe 500, y sobre ese
   * número se decide si se cierra la bodega. Como no dependen de la página, R50 sale gratis:
   * cambiar de página no los toca.
   */
  totalesAgregados: CierreTotales;
  /** Feature 39/R18: suma snapshot del pago a mensajeros (STRING), separado de los totales. */
  totalPagoMensajeroAgregado: string;
  /** Feature 56/R17: suma snapshot del ingreso de bodega por rechazos (STRING), separado. */
  totalIngresoBodegaRechazosAgregado: string;
  /**
   * Neto DERIVADO server-side (STRING): `totalesAgregados.general` menos lo que el efectivo
   * alcanzó a pagarle a los mensajeros. Llega ya calculado (money-safe): acá no se resta.
   */
  totalNetoAgregado: string;
  /**
   * Pago a mensajeros que el efectivo NO cubrió (STRING, DERIVADO server-side); lo debe la
   * central. `"0.00"` si el efectivo alcanzó para todos.
   */
  totalCentralDebeAgregado: string;
  /** Gate de "Solicitar cierre de bodega" (R6/R7). */
  puedesSolicitar: boolean;
  /** Texto accionable del bloqueo si `!puedesSolicitar`. */
  motivoBloqueo: string | null;
  /**
   * Feature 170 — FASE 2 (T I.2, R40/R41): PÁGINA 1 del histórico de cierres de bodega de la
   * zona (solo lectura, F1.4-h), ya resuelta server-side, más el `total` del conjunto.
   */
  cierresBodegaPasados: CierresBodegaSolicitadosPagina;
  /** `true` si el adminSatelite no tiene zona asignada (R4). */
  sinZona: boolean;
  /** Opciones de los filtros (bodegas), resueltas por el Server Component. */
  catalogoFiltros?: CatalogoFiltrosCierresDTO;
}

/**
 * La configuración de descarga de «Cierres del día a consolidar», para la fila de las pestañas.
 *
 * Feature 170 (T J.2, R52) — el listado pinta UNA página; el archivo es el CONJUNTO COMPLETO de
 * consolidables de SU zona, y esa zona la resuelve el servidor desde la sesión: descargar no
 * amplía el alcance ni una fila (R14/R44). Feature 184 — Tanda B (T B.2, R1/R6/R10): lo entrega
 * una lectura DEDICADA, que cuesta una consulta y cero aritmética de dinero. Los cinco agregados
 * de la cabecera siguen llegando por props desde `listarConsolidacion` (R49/R50 de la 170).
 *
 * Pedido humano del 2026-08-16 — con los mismos filtros que la página.
 */
function descargaConsolidables(filtros: FiltrosCierresBodega): DataTableDescarga {
  return {
    titulo: TITULO_DESCARGA_CONSOLIDABLES,
    columnas: COLUMNAS_DESCARGA_CONSOLIDABLES,
    obtenerFilas: () =>
      filasDesdeResultado(
        listarConsolidablesCompleto({ filtros }),
        filaDescargaConsolidable,
      ),
  };
}

export function ConsolidacionBodegaModule({
  consolidables,
  totalesAgregados,
  totalPagoMensajeroAgregado,
  totalIngresoBodegaRechazosAgregado,
  totalNetoAgregado,
  totalCentralDebeAgregado,
  puedesSolicitar,
  motivoBloqueo,
  cierresBodegaPasados,
  sinZona,
  catalogoFiltros = CATALOGO_FILTROS_CIERRES_VACIO,
}: ConsolidacionBodegaModuleProps) {
  const router = useRouter();
  const toast = useToast();

  // Confirmación de "Solicitar cierre de bodega"; true = modal abierto.
  const [confirmar, setConfirmar] = useState(false);

  // Feature 170 — FASE 2 (T J.2, R40/R42/R43): página visible de los consolidables. El control
  // vive AQUÍ, junto al contador (decisión de Q-I6): así la guardia de T H.3 ve esta pantalla
  // como paginada y vigila que el número salga del `total` del servidor.
  //
  // R49/R50: los cinco agregados de dinero NO se tocan. Siguen siendo las props que calculó
  // `listarConsolidacion` sobre el conjunto completo; esta lectura solo recorta lo que la
  // tabla PINTA.
  /**
   * Pedido humano del 2026-08-16 — las dos mitades pasan a ser PESTAÑAS. Arranca en «A
   * consolidar»: es la que tiene trabajo (y de la que salen los cinco agregados de dinero y el
   * botón de solicitar).
   */
  const [tab, setTab] = useState<TabConsolidacion>(TAB_CONSOLIDAR);

  /**
   * Pedido humano del 2026-08-16 — la misma barra que la mitad del maestro, sin el filtro de
   * mensajero. En esta pantalla el de bodega es casi siempre trivial (el actor tiene UNA zona),
   * pero se ofrece igual: la barra es la misma y lo que ofrece hace lo que dice.
   */
  const [filtros, setFiltros] = useState<FiltrosCierresBodega>({});

  /** Filtrar devuelve el listado a su página 1. */
  function aplicarFiltros(next: FiltrosCierresBodega) {
    setFiltros(next);
    setPage(1);
  }

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(consolidables.pageSize);
  const { data, error } = useSWR(
    ["cierre-bodega:consolidables", page, pageSize, filtros],
    () => leerConsolidables(page, pageSize, filtros),
    {
      // Con un filtro puesto la página 1 pre-cargada es la del conjunto SIN filtrar: servirla
      // sería enseñar cierres que el filtro excluye.
      fallbackData:
        page === 1 && pageSize === consolidables.pageSize && sinFiltrosBodega(filtros)
          ? consolidables
          : undefined,
    },
  );
  const pagina: ConsolidablesPagina = data ?? { items: [], total: 0, pageSize };
  // R44: el esqueleto sólo cuando NO hay nada que pintar (`isLoading` de SWR sigue en `true`
  // mientras revalida aunque haya `fallbackData`).
  const cargando = data === undefined;

  /** R6-R10: crea la solicitud de cierre de bodega de la zona. */
  async function confirmarSolicitud() {
    const result = await solicitarCierreBodega();
    if (result.status === "ok") {
      toast.success("Cierre de bodega solicitado correctamente.");
      setConfirmar(false);
      router.refresh();
      return;
    }
    // conflict (R6 pendientes / R7 vacío / R8 duplicado) → motivo accionable.
    if (result.status === "conflict") {
      toast.error(result.motivo);
    } else if (result.status === "validation_error") {
      // R4: sin zona.
      const primero = Object.values(result.fieldErrors)[0]?.[0];
      toast.error(primero ?? "No se pudo solicitar el cierre de bodega.");
    } else if (result.status === "forbidden") {
      toast.error("No tenés permiso para solicitar el cierre de bodega.");
    } else if (result.status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    } else {
      toast.error("No se pudo solicitar el cierre de bodega. Intentá de nuevo.");
    }
    setConfirmar(false);
    router.refresh();
  }

  return (
    // `gap-4`: la barra de filtros y las pestañas son una cabecera, no dos secciones.
    <section aria-label="Cierre de bodega" className="flex flex-col gap-4">
      {/* R4: adminSatelite sin zona → aviso accionable, sin tablas de acción. */}
      {sinZona ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          No tenés una zona asignada; contactá a tu administrador.
        </p>
      ) : (
        <>
          {/* ---------- Pestañas: a consolidar / solicitados (pedido humano del 2026-08-16) ----
              El conteo solo va en «A consolidar»: su `total` lo tiene este módulo (del servidor,
              R42), mientras que el de los solicitados vive dentro de
              `CierresBodegaSolicitadosLista`, que pide su propia página. No se inventa. */}
          <FiltrosCierresBarra
            catalogo={catalogoFiltros}
            onChange={aplicarFiltros}
            disabled={cargando}
            sinMensajero
          />

          {/* La descarga va ALINEADA con las pestañas, y es la de la pestaña ACTIVA. */}
          {/* `pb-1`: sin él el grupo segmentado se ve cortado por abajo (su borde y su anillo
              de foco se salen del alto nominal del botón). */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
            <SegmentedToggle
              options={[
                {
                  valor: TAB_CONSOLIDAR,
                  etiqueta: TAB_CONSOLIDAR_LABEL,
                  conteo: pagina.total,
                },
                { valor: TAB_SOLICITADOS, etiqueta: TAB_SOLICITADOS_LABEL },
              ]}
              valor={tab}
              onChange={setTab}
              ariaLabel={TABS_CONSOLIDACION_LABEL}
            />
            <DescargarDatasetButton
              {...(tab === TAB_CONSOLIDAR
                ? descargaConsolidables(filtros)
                : descargaBodegaSolicitados(filtros))}
            />
          </div>

          {/* Los cinco agregados de dinero y el botón de solicitar viven DENTRO de «A
              consolidar», y no encima de las pestañas: hablan exactamente de ese conjunto —son
              su suma— y el botón actúa sobre él. Colgarlos fuera los dejaría a la vista
              mientras se mira un listado del que no hablan. */}
          <PanelConmutado activo={tab === TAB_CONSOLIDAR} ariaLabel={TAB_CONSOLIDAR_LABEL}>
          {/* ---------- Totales agregados a consolidar (R10/R13) ---------- */}
          <TotalesPanel
            totales={totalesAgregados}
            ariaLabel="Totales a consolidar"
            title="Totales a consolidar"
            neto={totalNetoAgregado}
          />

          {/* Feature 39/R18: agregado a pagar a mensajeros, separado del dinero recibido. */}
          <PagoMensajeroTotal
            value={totalPagoMensajeroAgregado}
            ariaLabel="Pago a mensajeros a consolidar"
            label="Total a pagar a mensajeros"
          />

          {/* Feature 56/R17: agregado del ingreso de bodega por rechazos, separado. */}
          <IngresoBodegaRechazosTotal
            value={totalIngresoBodegaRechazosAgregado}
            ariaLabel="Ingreso de bodega por rechazos a consolidar"
          />

          {/* El efectivo no cubrió todos los pagos: el resto lo debe la central. Solo se
              muestra si hay deuda ("0.00" → el efectivo alcanzó, no hay nada que avisar). */}
          {totalCentralDebeAgregado === "0.00" ? null : (
            <CentralDebeTotal
              value={totalCentralDebeAgregado}
              ariaLabel="Central debe"
            />
          )}

          {/* ---------- Cierres del día a consolidar (R5) ---------- */}
          <section
            aria-label="Cierres del día a consolidar"
            className="flex flex-col gap-3"
          >
            {/* SIN ENCABEZADO VISIBLE (pedido humano del 2026-08-16): la pestaña de arriba ya lo
                dice, y repetirlo dos centímetros más abajo no añade nada. El `aria-label` de la
                sección SÍ se queda: sigue haciendo falta un nombre para quien no ve la pantalla, y
                es por él por el que la localizan los tests y el E2E.

                EL CONTADOR NO SE PIERDE, se mudó a la pestaña, y sigue saliendo del TOTAL del
                servidor (R42) — lo vigila `contadores-cabecera.guardia.test.ts`. */}
            {/* Pedido humano del 2026-08-16: cada cierre del día a consolidar se lee como
                COMPROBANTE, la misma hoja que verá el maestro cuando decida el cierre de esta
                bodega. Sin estado ni fechas: los tres son `aprobado` por definición de este
                listado (R5) y el DTO no trae fechas. */}
            <ListaComprobantes
              ariaLabel="Cierres del día a consolidar"
              items={pagina.items}
              clave={(c) => c.cierreDiaId}
              isLoading={cargando}
              error={error ? ERROR_CARGA_CONSOLIDABLES : null}
              emptyMessage="No hay cierres del día aprobados para consolidar."
              render={(c) => <CierreConsolidableFacturaResumen cierre={c} />}
            />

            <Pagination
              page={page}
              pageSize={pageSize}
              total={pagina.total}
              disabled={cargando}
              showFirstLast
              siblingCount={1}
              ariaLabel={PAGINACION_CONSOLIDABLES_LABEL}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
            />
          </section>

          {/* ---------- Solicitar cierre de bodega (R6/R7) ---------- */}
          <section
            aria-label="Solicitar cierre de bodega"
            className="flex flex-col gap-2"
          >
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={() => setConfirmar(true)}
                disabled={!puedesSolicitar}
                title={!puedesSolicitar ? (motivoBloqueo ?? undefined) : undefined}
                aria-describedby={
                  !puedesSolicitar && motivoBloqueo
                    ? "motivo-bloqueo-bodega"
                    : undefined
                }
              >
                Solicitar cierre de bodega
              </Button>
            </div>
            {!puedesSolicitar && motivoBloqueo ? (
              <p
                id="motivo-bloqueo-bodega"
                role="note"
                className="text-sm text-muted-foreground"
              >
                {motivoBloqueo}
              </p>
            ) : null}
          </section>
          </PanelConmutado>

          <PanelConmutado activo={tab === TAB_SOLICITADOS} ariaLabel={TAB_SOLICITADOS_LABEL}>
            {/* ---------- Histórico de cierres de bodega (solo lectura, F1.4-h) ----------
                Feature 170 — FASE 2 (T I.2): el listado, su control de paginación y su descarga
                viven en su propio componente (ver `CierresBodegaSolicitadosLista`). */}
            <CierresBodegaSolicitadosLista initialData={cierresBodegaPasados} />
          </PanelConmutado>
        </>
      )}

      {/* SIN ZONA (R4) el histórico se sigue enseñando fuera de las pestañas: es lo único que
          este actor puede mirar, y esconderlo tras un conmutador que no puede usar dejaría la
          pantalla en blanco detrás de un aviso. */}
      {sinZona ? <CierresBodegaSolicitadosLista initialData={cierresBodegaPasados} /> : null}

      {/* Confirmación de "Solicitar cierre de bodega". */}
      <Modal
        open={confirmar}
        onOpenChange={setConfirmar}
        title="Solicitar cierre de bodega"
        description="Se consolidarán todos los cierres del día aprobados de tu zona en una solicitud a la bodega central. Esta acción no se puede deshacer."
        confirmLabel="Solicitar cierre de bodega"
        onConfirm={confirmarSolicitud}
        closeOnConfirm={false}
      />
    </section>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
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
  money,
  PAGO_MENSAJERO_COL,
  INGRESO_BODEGA_RECHAZOS_COL,
  PagoMensajeroTotal,
  IngresoBodegaRechazosTotal,
  CentralDebeTotal,
  TotalesPanel,
} from "./cierre-detalle-shared";
import {
  CierresBodegaSolicitadosTabla,
  type CierresBodegaSolicitadosPagina,
} from "./CierresBodegaSolicitadosTabla";
import {
  COLUMNAS_DESCARGA_CONSOLIDABLES,
  filaDescargaConsolidable,
} from "./cierres-bodega-descarga-columnas";

/** Nombre visible de la tabla de consolidables: hoja, archivo y control (R12/R13). */
const TITULO_DESCARGA_CONSOLIDABLES = "Cierres del día a consolidar";
/** Nombre accesible del control (R43). Propio: la pantalla monta dos tablas paginadas. */
export const PAGINACION_CONSOLIDABLES_LABEL =
  "Paginación de los cierres del día a consolidar";
const ERROR_CARGA_CONSOLIDABLES = "No se pudieron cargar los cierres a consolidar.";

// R40: el tamaño sale de la config del dominio (T H.1), nunca de un literal de pantalla.
// Es `cierreConfig` y no `cierreBodegaConfig` porque las filas de esta tabla son `cierre_dia`
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
): Promise<ConsolidablesPagina> {
  const res = await listarConsolidablesPaginado({ page, pageSize });
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(consolidables.pageSize);
  const { data, error } = useSWR(
    ["cierre-bodega:consolidables", page, pageSize],
    () => leerConsolidables(page, pageSize),
    {
      fallbackData:
        page === 1 && pageSize === consolidables.pageSize ? consolidables : undefined,
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
    <section aria-label="Cierre de bodega" className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold">Cierre de bodega</h2>

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
            <h3 className="text-base font-semibold">
              Cierres del día a consolidar{" "}
              <span className="text-sm font-normal text-muted-foreground">
                {/* R42: el TOTAL del conjunto que devuelve el servidor. Este contador va
                    junto a los agregados de dinero de arriba: si contara la página, diría
                    «(25)» al lado de un total calculado sobre 60 cierres. */}
                ({pagina.total})
              </span>
            </h3>
            <div className="overflow-x-auto">
              <DataTable
                columns={COLUMNAS_CONSOLIDABLES}
                data={pagina.items}
                rowKey="cierreDiaId"
                ariaLabel="Cierres del día a consolidar"
                emptyMessage="No hay cierres del día aprobados para consolidar."
                isLoading={cargando}
                error={error ? ERROR_CARGA_CONSOLIDABLES : null}
                /**
                 * Feature 170 (T J.2, R52) — la tabla pinta UNA página; el archivo sigue
                 * siendo el CONJUNTO COMPLETO de consolidables de SU zona, y esa zona la
                 * resuelve el servidor desde la sesión: descargar no amplía el alcance ni una
                 * fila (R14/R44).
                 *
                 * Feature 184 — Tanda B (T B.2, R1/R6/R10): ese conjunto lo entrega ahora una
                 * lectura DEDICADA. Antes salía de releer `listarConsolidacion()`, que además
                 * de estas filas produce los cinco agregados de dinero y —lo caro— el reparto
                 * del efectivo entre los pagos INDIVIDUALES de la zona, ordenados de menor a
                 * mayor. Descargar una tabla de siete columnas no tiene por qué costar eso.
                 *
                 * Y no se pierde nada de lo que el comentario anterior defendía: el archivo y
                 * los totales de la cabecera siguen hablando del MISMO conjunto —los
                 * consolidables de la zona—, solo que cada uno lo lee por su lado. Los cinco
                 * agregados siguen llegando por props, sin cambios (R49/R50 de la 170).
                 */
                descarga={{
                  titulo: TITULO_DESCARGA_CONSOLIDABLES,
                  columnas: COLUMNAS_DESCARGA_CONSOLIDABLES,
                  obtenerFilas: () =>
                    filasDesdeResultado(
                      listarConsolidablesCompleto(),
                      filaDescargaConsolidable,
                    ),
                }}
              />
            </div>

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
        </>
      )}

      {/* ---------- Histórico de cierres de bodega (solo lectura, F1.4-h) ----------
          Feature 170 — FASE 2 (T I.2): la tabla, su control de paginación y su descarga viven
          en su propio componente (ver la cabecera de `CierresBodegaSolicitadosTabla`). */}
      <CierresBodegaSolicitadosTabla initialData={cierresBodegaPasados} />

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

// --- Columnas de los cierre_dia consolidables (R5, money-safe R13) ---
const COLUMNAS_CONSOLIDABLES: Column<CierreBodegaResumenLite>[] = [
  { id: "mensajero", value: "Mensajero", render: (c) => c.mensajeroNombre },
  { id: "efectivo", value: "Efectivo", render: (c) => money(c.totales.efectivo) },
  { id: "simpe", value: "SINPE", render: (c) => money(c.totales.simpe) },
  {
    id: "transferencia",
    value: "Transferencia",
    render: (c) => money(c.totales.transferencia),
  },
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
  {
    id: "ingresoBodegaRechazos",
    value: INGRESO_BODEGA_RECHAZOS_COL,
    render: (c) => money(c.totalIngresoBodegaRechazos),
  },
];

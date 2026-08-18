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
import { cierreBodegaConfig } from "@/lib/config/cierre-bodega";
import {
  verCierreBodegaDetalle,
  aprobarCierreBodega,
  rechazarCierreBodega,
  listarPendientesCierresBodegaCompleto,
  listarPendientesCierresBodegaPaginado,
} from "@/lib/actions/cierre-bodega";
import type {
  CierreBodegaDetalleCierre,
  CierreBodegaResumen,
} from "@/lib/interfaces/services/ICierreBodegaService";
import type { TotalesIngresoOrdenex } from "@/lib/interfaces/services/ICierreDiaService";
import {
  DetalleSecciones,
  PagoMensajeroTotal,
  IngresoBodegaRechazosTotal,
  TotalesIngresoPanel,
  MontoDerivadoCard,
  INGRESO_BRUTO_LABEL,
  INGRESO_BRUTO_NOTA,
  GANANCIA_LABEL,
  PAGO_TIENDA_LABEL,
  PAGO_TIENDA_NOTA,
  GANANCIA_NOTA,
  GANANCIA_NOTA_BODEGA,
  TotalesPanel,
  VisorEvidencia,
} from "./cierre-detalle-shared";
import { CierreBodegaFacturaResumen } from "./cierre-factura";
import { ListaComprobantes } from "./ListaComprobantes";
import { PanelConmutado } from "./PanelConmutado";
import {
  CierresBodegaResueltosLista,
  descargaBodegaResueltos,
  type CierresBodegaResueltosPagina,
} from "./CierresBodegaResueltosLista";
import { FiltrosCierresBarra } from "./FiltrosCierresBarra";
import {
  COLUMNAS_DESCARGA_BODEGA_PENDIENTES,
  filaDescargaBodegaPendiente,
} from "./cierres-bodega-descarga-columnas";

/** Nombre visible de la cola: hoja, base del archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA_PENDIENTES = "Cierres de bodega pendientes";
/** Nombre accesible del control de la COLA (R43). La pantalla monta varias tablas paginadas. */
export const PAGINACION_BODEGA_PENDIENTES_LABEL =
  "Paginación de los cierres de bodega pendientes";
const ERROR_CARGA_PENDIENTES = "No se pudieron cargar los cierres de bodega pendientes.";

/** `true` si el objeto no recorta nada: entonces la página pre-cargada del servidor sirve. */
function sinFiltrosBodega(filtros: FiltrosCierresBodega): boolean {
  return Object.values(filtros).every((v) => v === undefined);
}

// --- Pedido humano del 2026-08-16: las dos mitades de esta sección, en pestañas ---
const TAB_PENDIENTES = "pendientes";
const TAB_RESUELTOS = "resueltos";
type TabBodega = typeof TAB_PENDIENTES | typeof TAB_RESUELTOS;
const TAB_PENDIENTES_LABEL = "Pendientes";
const TAB_RESUELTOS_LABEL = "Resueltos";
/** Nombre accesible del conmutador. Propio: la pantalla anida varios segmentados. */
const TABS_BODEGA_LABEL = "Cierres de bodega por estado";

// R40: el tamaño sale de la config del dominio (T H.1), nunca de un literal de pantalla.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= cierreBodegaConfig.MAX_PAGE_SIZE,
);

/**
 * Feature 170 — FASE 2 (T J.2, R40/R41): una página de la cola. El alcance NO viaja en el
 * input —lo resuelve el servicio desde la sesión, igual que el listado sin paginar (R44)—;
 * aquí solo van el número de página y el tamaño.
 */
async function leerPendientes(
  page: number,
  pageSize: number,
  filtros: FiltrosCierresBodega,
): Promise<CierresBodegaColaPagina> {
  const res = await listarPendientesCierresBodegaPaginado({ page, pageSize, filtros });
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

// Feature 40 (T8) — módulo cliente de "Cierres de bodega satélite" del maestro (lado
// APROBAR/RECHAZAR, espejo de la 38 aplicado a CierreBodega). Recibe del Server
// Component padre la cola de `solicitado` (R15) y el histórico de resueltos, ya
// acotados server-side (R2). Al abrir un cierre pide el DETALLE AGREGADO por Server
// Action (totales snapshot R11/R13 + cada cierre_dia con sus 4 secciones por
// resultado y evidencias FIRMADAS R12). Las decisiones (aprobar/rechazar con motivo
// obligatorio R17) van por Server Action y refrescan la ruta. Money-safe (R13): los
// montos son STRING; se renderizan con `money()` sin `parseFloat`/`Number`.

/**
 * Feature 170 — FASE 2 (T J.2, R40/R41): la PÁGINA de la cola, tal como la devuelve el
 * servidor. `total` es el del CONJUNTO —de él sale el contador de cabecera (R42)— y nunca
 * `items.length`.
 */
export interface CierresBodegaColaPagina {
  items: CierreBodegaResumen[];
  total: number;
  pageSize: number;
}

export interface CierresBodegaAdminModuleProps {
  /**
   * Feature 170 — FASE 2 (T J.2, R40/R41): PÁGINA 1 de los cierres de bodega `solicitado`
   * (cola de decisión, R15), ya resuelta server-side, más el `total` del conjunto.
   */
  pendientes: CierresBodegaColaPagina;
  /**
   * Feature 170 — FASE 2 (T I.2, R40/R41): PÁGINA 1 de los resueltos (R15), ya resuelta
   * server-side, más el `total` del conjunto. Deja de ser el array entero.
   */
  historico: CierresBodegaResueltosPagina;
  /**
   * Opciones de los filtros (bodegas), resueltas por el Server Component. Opcional con default
   * VACIO: un montaje que se olvide de pasarla ofrece cero opciones —la pantalla sigue
   * funcionando sin filtrar— en vez de romperse.
   */
  catalogoFiltros?: CatalogoFiltrosCierresDTO;
}

/** Detalle abierto: la cabecera del cierre de bodega + sus cierre_dia incluidos. */
interface DetalleAbierto {
  cierre: CierreBodegaResumen;
  cierres: CierreBodegaDetalleCierre[];
  /** Ingreso de Ordenex agregado de toda la bodega, por concepto (derivado del snapshot). */
  totalesIngreso: TotalesIngresoOrdenex;
  /** Ingreso bruto agregado menos el pago a mensajeros (puede ser negativo). */
  ganancia: string;
  /** Total general agregado menos flete + IVA y comisión + IVA (puede ser negativo). */
  pagoTienda: string;
}

/**
 * La configuración de descarga de la COLA de bodega, para la fila de las pestañas.
 *
 * Feature 170 (T J.2, R52) — el listado pinta UNA página; el archivo es la COLA COMPLETA.
 * Feature 184 — Tanda E (T E.3, R1/R2/R6): sale de la lectura DEDICADA, que corta por estado en
 * la base. El alcance no viaja en la llamada y no puede: es acceso total y lo decide el servicio
 * desde la sesión, así que descargar no amplía lo que el actor podía ver (R14/R44), y el tope de
 * filas se evalúa en el SERVIDOR (R6).
 *
 * Pedido humano del 2026-08-16 — con los mismos filtros que la página: el archivo es «esto que
 * estoy viendo, entero».
 */
function descargaColaBodega(filtros: FiltrosCierresBodega): DataTableDescarga {
  return {
    titulo: TITULO_DESCARGA_PENDIENTES,
    columnas: COLUMNAS_DESCARGA_BODEGA_PENDIENTES,
    obtenerFilas: () =>
      filasDesdeResultado(
        listarPendientesCierresBodegaCompleto({ filtros }),
        filaDescargaBodegaPendiente,
      ),
  };
}

export function CierresBodegaAdminModule({
  pendientes,
  historico,
  catalogoFiltros = CATALOGO_FILTROS_CIERRES_VACIO,
}: Readonly<CierresBodegaAdminModuleProps>) {
  const router = useRouter();
  const toast = useToast();

  // Detalle del cierre de bodega abierto (null = modal cerrado).
  const [detalle, setDetalle] = useState<DetalleAbierto | null>(null);
  // Evidencia (URL firmada, R12) en el visor; null = cerrado.
  const [evidencia, setEvidencia] = useState<string | null>(null);
  // Sub-modal de rechazo (R17): true = abierto.
  const [rechazando, setRechazando] = useState(false);
  // Motivo del rechazo (obligatorio, R17) + su error de validación.
  const [motivo, setMotivo] = useState("");
  const [motivoError, setMotivoError] = useState<string | null>(null);

  // Feature 170 — FASE 2 (T J.2, R40/R42/R43): página visible de la COLA. El control vive
  // AQUÍ, en el módulo, junto al contador (decisión de Q-I6): así la guardia de T H.3 ve esta
  // pantalla como paginada y vigila de verdad que el número salga del `total` del servidor.
  //
  // R50: el estado de esta pantalla —el detalle abierto, el motivo tecleado— vive en los
  // `useState` de arriba, que la página no toca. Cambiar de página no los reinicia.
  /**
   * Pedido humano del 2026-08-16 — cola e histórico pasan a ser PESTAÑAS. Arranca en
   * «Pendientes», que es la que tiene decisiones esperando.
   */
  const [tab, setTab] = useState<TabBodega>(TAB_PENDIENTES);

  /**
   * Pedido humano del 2026-08-16 — «en la parte de bodega deja el mismo filtro solo omitiendo el
   * de mensajero». Misma barra, mismo catálogo de bodegas (GAM + las que tienen admin de zona) y
   * los mismos atajos de fecha que `/ordenes`; lo que no se ofrece es el mensajero, porque un
   * cierre de bodega consolida los de varios y el dato no existe.
   */
  const [filtros, setFiltros] = useState<FiltrosCierresBodega>({});

  /** Filtrar devuelve la cola a su página 1: pedir la 7 de un conjunto recién recortado da vacío. */
  function aplicarFiltros(next: FiltrosCierresBodega) {
    setFiltros(next);
    setPendientesPage(1);
  }

  const [pendientesPage, setPendientesPage] = useState(1);
  const [pendientesPageSize, setPendientesPageSize] = useState(pendientes.pageSize);
  const { data: pendientesData, error: pendientesError } = useSWR(
    ["cierres-bodega:pendientes", pendientesPage, pendientesPageSize, filtros],
    () => leerPendientes(pendientesPage, pendientesPageSize, filtros),
    {
      // El `fallbackData` del Server Component solo vale SIN filtros: con un filtro puesto, la
      // página 1 pre-cargada es la del conjunto sin filtrar, y servirla sería enseñar cierres
      // que el filtro excluye.
      fallbackData:
        pendientesPage === 1 &&
        pendientesPageSize === pendientes.pageSize &&
        sinFiltrosBodega(filtros)
          ? pendientes
          : undefined,
    },
  );
  const colaPendientes: CierresBodegaColaPagina = pendientesData ?? {
    items: [],
    total: 0,
    pageSize: pendientesPageSize,
  };
  // R44: el esqueleto sólo cuando NO hay nada que pintar. `isLoading` de SWR sigue en `true`
  // mientras revalida aunque haya `fallbackData`, y usarlo tal cual haría que la página 1 —la
  // que el Server Component ya resolvió— apareciera como esqueleto antes de enseñar sus filas.
  const pendientesCargando = pendientesData === undefined;

  /** R11-R13: abre el detalle agregado (pide totales + gestiones + evidencias firmadas). */
  async function abrirDetalle(cierreBodegaId: string) {
    const result = await verCierreBodegaDetalle({ cierreBodegaId });
    if (result.status === "ok") {
      setDetalle({
        cierre: result.cierre,
        cierres: result.cierres,
        totalesIngreso: result.totalesIngreso,
        ganancia: result.ganancia,
        pagoTienda: result.pagoTienda,
      });
      return;
    }
    if (result.status === "no_encontrada") {
      toast.error("El cierre de bodega ya no está disponible. Actualizando la lista.");
      router.refresh();
      return;
    }
    if (result.status === "forbidden") {
      toast.error("No tenés permiso para ver este cierre de bodega.");
      return;
    }
    if (result.status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
      return;
    }
    // validation_error (id malformado) u otro → feedback genérico.
    toast.error("No se pudo abrir el detalle del cierre de bodega. Intentá de nuevo.");
  }

  function cerrarDetalle() {
    setDetalle(null);
    setRechazando(false);
    setMotivo("");
    setMotivoError(null);
  }

  /** Traduce un resultado de dominio de error a feedback accionable + refresco. */
  function manejarErrorDecision(
    status:
      | "conflict"
      | "no_encontrada"
      | "forbidden"
      | "unauthenticated"
      | "validation_error",
  ) {
    if (status === "conflict") {
      toast.error("Este cierre de bodega ya fue resuelto.");
    } else if (status === "no_encontrada") {
      toast.error("El cierre de bodega ya no está disponible.");
    } else if (status === "forbidden") {
      toast.error("No tenés permiso para resolver este cierre de bodega.");
    } else if (status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    } else {
      toast.error("No se pudo resolver el cierre de bodega. Intentá de nuevo.");
    }
    cerrarDetalle();
    router.refresh();
  }

  /** R16: aprueba el cierre de bodega abierto. */
  async function confirmarAprobacion() {
    if (!detalle) return;
    const result = await aprobarCierreBodega({
      cierreBodegaId: detalle.cierre.cierreBodegaId,
    });
    if (result.status === "ok") {
      toast.success("Cierre de bodega aprobado correctamente.");
      cerrarDetalle();
      router.refresh();
      return;
    }
    manejarErrorDecision(result.status);
  }

  /** R17: rechaza el cierre de bodega abierto con motivo obligatorio. */
  async function confirmarRechazo() {
    if (!detalle) return;
    const motivoLimpio = motivo.trim();
    if (motivoLimpio.length === 0) {
      setMotivoError("El motivo de rechazo es obligatorio.");
      return; // R17: sin motivo NO se envía
    }
    const result = await rechazarCierreBodega({
      cierreBodegaId: detalle.cierre.cierreBodegaId,
      motivo: motivoLimpio,
    });
    if (result.status === "ok") {
      toast.success("Cierre de bodega rechazado correctamente.");
      cerrarDetalle();
      router.refresh();
      return;
    }
    if (result.status === "validation_error") {
      const primero = Object.values(result.fieldErrors)[0]?.[0];
      setMotivoError(primero ?? "El motivo de rechazo es obligatorio.");
      return;
    }
    manejarErrorDecision(result.status);
  }

  const cierreAbierto = detalle?.cierre ?? null;
  const esPendiente = cierreAbierto?.estado === "solicitado";

  return (
    // `gap-4`: la barra de filtros y las pestañas son una cabecera, no dos secciones.
    <section
      aria-label="Cierres de bodega satélite"
      className="flex flex-col gap-4"
    >
      {/* ---------- Pestañas: pendientes / resueltos (pedido humano del 2026-08-16) ----------
          Solo «Pendientes» lleva conteo, y la asimetría es deliberada: su `total` lo tiene ESTE
          módulo (viene del servidor, R42), mientras que el de los resueltos vive dentro de
          `CierresBodegaResueltosLista`, que pide su propia página. Antes que inventar aquí un
          número —o subir el estado de aquel listado solo para pintarlo— la pestaña se queda sin
          él: un conteo equivocado en una cola de dinero es peor que ninguno. */}
      <FiltrosCierresBarra
        catalogo={catalogoFiltros}
        onChange={aplicarFiltros}
        disabled={pendientesCargando}
        sinMensajero
      />

      {/* La descarga va ALINEADA con las pestañas, y es la de la pestaña ACTIVA. */}
      {/* `pb-1` (pedido humano del 2026-08-16): el grupo segmentado se estaba viendo cortado
          por abajo. Su borde y su anillo de foco se salen del alto nominal del botón, y sin
          este respiro el contenedor de la fila los recorta. */}
<div className="flex flex-wrap items-center justify-between gap-2 pb-1">
        <SegmentedToggle
          options={[
            {
              valor: TAB_PENDIENTES,
              etiqueta: TAB_PENDIENTES_LABEL,
              conteo: colaPendientes.total,
            },
            { valor: TAB_RESUELTOS, etiqueta: TAB_RESUELTOS_LABEL },
          ]}
          valor={tab}
          onChange={setTab}
          ariaLabel={TABS_BODEGA_LABEL}
        />
        <DescargarDatasetButton
          {...(tab === TAB_PENDIENTES
            ? descargaColaBodega(filtros)
            : descargaBodegaResueltos(filtros))}
        />
      </div>

      <PanelConmutado activo={tab === TAB_PENDIENTES} ariaLabel={TAB_PENDIENTES_LABEL}>
      {/* ---------- Cola de pendientes (R15) ---------- */}
      <section
        aria-label="Cierres de bodega pendientes"
        className="flex flex-col gap-3"
      >
        {/* SIN ENCABEZADO VISIBLE (pedido humano del 2026-08-16): la pestaña de arriba ya lo
            dice, y repetirlo dos centímetros más abajo no añade nada. El `aria-label` de la
            sección SÍ se queda: sigue haciendo falta un nombre para quien no ve la pantalla, y
            es por él por el que la localizan los tests y el E2E.

            EL CONTADOR NO SE PIERDE, se mudó a la pestaña, y sigue saliendo del TOTAL del
            servidor (R42) — lo vigila `contadores-cabecera.guardia.test.ts`. */}
        {/* Pedido humano del 2026-08-16: la cola se lee como COMPROBANTES. Cada cierre de
            bodega es la misma hoja compacta que el maestro ya usaba para los cierres del día,
            con las partes propias de una bodega (zona y quién solicitó) y, en su desglose,
            cuántos cierres del día consolida. */}
        <ListaComprobantes
          ariaLabel="Cierres de bodega pendientes"
          items={colaPendientes.items}
          clave={(c) => c.cierreBodegaId}
          isLoading={pendientesCargando}
          error={pendientesError ? ERROR_CARGA_PENDIENTES : null}
          emptyMessage="No hay cierres de bodega pendientes de decisión."
          render={(c) => (
            <CierreBodegaFacturaResumen
              cierre={c}
              acciones={
                <Button
                  type="button"
                  size="sm"
                  aria-label={`Ver / decidir el cierre de bodega de ${c.zonaNombre}`}
                  onClick={() => abrirDetalle(c.cierreBodegaId)}
                >
                  Ver / decidir
                </Button>
              }
            />
          )}
        />

        <Pagination
          page={pendientesPage}
          pageSize={pendientesPageSize}
          total={colaPendientes.total}
          disabled={pendientesCargando}
          showFirstLast
          siblingCount={1}
          ariaLabel={PAGINACION_BODEGA_PENDIENTES_LABEL}
          onPageChange={setPendientesPage}
          onPageSizeChange={(s) => {
            setPendientesPageSize(s);
            setPendientesPage(1);
          }}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
        />
      </section>

      </PanelConmutado>

      <PanelConmutado activo={tab === TAB_RESUELTOS} ariaLabel={TAB_RESUELTOS_LABEL}>
        {/* ---------- Histórico (solo lectura, R15) ----------
            Feature 170 — FASE 2 (T I.2): el listado, su control de paginación y su descarga
            viven en su propio componente (ver la cabecera de `CierresBodegaResueltosLista`). */}
        <CierresBodegaResueltosLista initialData={historico} onAbrir={abrirDetalle} />
      </PanelConmutado>

      {/* ---------- Detalle agregado del cierre de bodega (R11-R13) ---------- */}
      <Modal
        open={detalle !== null}
        onOpenChange={(next) => {
          if (!next) cerrarDetalle();
        }}
        title="Detalle del cierre de bodega"
        description={
          cierreAbierto
            ? `${cierreAbierto.zonaNombre} · ${cierreAbierto.solicitadoPorNombre}`
            : undefined
        }
        // Sin ancho propio: el default del Modal (75% de la pantalla) es el que corresponde
        // a un detalle con tablas anchas.
        confirmLabel="Cerrar"
        hideCancel
        onConfirm={cerrarDetalle}
      >
        {detalle ? (
          <div className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto pr-1">
            {/* Panel de totales AGREGADOS snapshot (R11/R13). */}
            <TotalesPanel
              totales={detalle.cierre.totales}
              ariaLabel="Totales del cierre de bodega"
              title="Totales del cierre de bodega"
            />

            {/* Primero los ingresos: qué facturó Ordenex y qué le queda. Recién después,
                lo que se paga o se debe (mismo orden que el detalle del cierre de mensajero). */}
            <TotalesIngresoPanel
              totales={detalle.totalesIngreso}
              ariaLabel="Ingreso de Ordenex del cierre de bodega"
            />

            {/* Bruto y ganancia agregados: el mismo cálculo que en el cierre de mensajero. */}
            <MontoDerivadoCard
              value={detalle.totalesIngreso.total}
              label={INGRESO_BRUTO_LABEL}
              nota={INGRESO_BRUTO_NOTA}
              ariaLabel="Ingreso bruto del cierre de bodega"
            />
            {/* Feature 39/R20: agregado a pagar a mensajeros, separado del dinero recibido.
                Va encima de la ganancia: es el sustraendo. */}
            <PagoMensajeroTotal
              value={detalle.cierre.totalPagoMensajero}
              ariaLabel="Pago a mensajeros del cierre de bodega"
              label="Total a pagar a mensajeros"
            />
            <MontoDerivadoCard
              value={detalle.ganancia}
              label={GANANCIA_LABEL}
              nota={GANANCIA_NOTA_BODEGA}
              ariaLabel="Ganancia del cierre de bodega"
            />

            {/* Feature 56/R17: agregado del ingreso de bodega por rechazos, separado. */}
            <IngresoBodegaRechazosTotal
              value={detalle.cierre.totalIngresoBodegaRechazos}
              ariaLabel="Ingreso de bodega por rechazos del cierre de bodega"
            />

            {/* Cierra el detalle agregado: lo que se les paga a las tiendas. */}
            <MontoDerivadoCard
              value={detalle.pagoTienda}
              label={PAGO_TIENDA_LABEL}
              nota={PAGO_TIENDA_NOTA}
              ariaLabel="Pago a tienda del cierre de bodega"
            />

            {/* Motivo de rechazo si el cierre de bodega del histórico fue rechazado. */}
            {detalle.cierre.motivoRechazo ? (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  Motivo de rechazo:{" "}
                </span>
                {detalle.cierre.motivoRechazo}
              </p>
            ) : null}

            {/* Sub-detalle por cada cierre_dia incluido (R11): mensajero + totales +
                4 secciones por resultado con evidencia firmada (R12). */}
            {detalle.cierres.map((cierreDia) => (
              <section
                key={cierreDia.cierreDiaId}
                aria-label={`Cierre del día · ${cierreDia.mensajeroNombre}`}
                className="flex flex-col gap-4 rounded-lg border border-border p-4"
              >
                <h3 className="text-base font-semibold">
                  {cierreDia.mensajeroNombre}
                </h3>
                <TotalesPanel
                  totales={cierreDia.totales}
                  ariaLabel={`Totales · ${cierreDia.mensajeroNombre}`}
                  title="Totales del cierre del día"
                />
                {/* Primero los ingresos de ESTE cierre_dia; después lo que se le paga. */}
                <TotalesIngresoPanel
                  totales={cierreDia.totalesIngreso}
                  ariaLabel={`Ingreso de Ordenex · ${cierreDia.mensajeroNombre}`}
                />
                <MontoDerivadoCard
                  value={cierreDia.totalesIngreso.total}
                  label={INGRESO_BRUTO_LABEL}
                  nota={INGRESO_BRUTO_NOTA}
                  ariaLabel={`Ingreso bruto · ${cierreDia.mensajeroNombre}`}
                />
                {/* Feature 39/R20: pago snapshot a este mensajero, separado del dinero recibido. */}
                <PagoMensajeroTotal
                  value={cierreDia.totalPagoMensajero}
                  ariaLabel={`Pago al mensajero · ${cierreDia.mensajeroNombre}`}
                />
                <MontoDerivadoCard
                  value={cierreDia.ganancia}
                  label={GANANCIA_LABEL}
                  nota={GANANCIA_NOTA}
                  ariaLabel={`Ganancia · ${cierreDia.mensajeroNombre}`}
                />
                {/* Feature 56/R19: ingreso de bodega por rechazos de este cierre_dia, separado. */}
                <IngresoBodegaRechazosTotal
                  value={cierreDia.totalIngresoBodegaRechazos}
                  ariaLabel={`Ingreso de bodega por rechazos · ${cierreDia.mensajeroNombre}`}
                />
                {/* Cierra el sub-detalle: lo que se le paga a la tienda por este cierre_dia. */}
                <MontoDerivadoCard
                  value={cierreDia.pagoTienda}
                  label={PAGO_TIENDA_LABEL}
                  nota={PAGO_TIENDA_NOTA}
                  ariaLabel={`Pago a tienda · ${cierreDia.mensajeroNombre}`}
                />
                {/* Feature 170 (T E.5/R13): el `contexto` da nombre ÚNICO a la descarga de
                    cada sección — este modal monta las mismas cinco secciones una vez por
                    mensajero incluido, y sin él todos los controles se llamarían igual. */}
                <DetalleSecciones
                  grupos={cierreDia.grupos}
                  onVerEvidencia={setEvidencia}
                  contexto={cierreDia.mensajeroNombre}
                />
              </section>
            ))}

            {/* Acciones: solo en un cierre de bodega PENDIENTE (`solicitado`). */}
            {esPendiente ? (
              <section
                aria-label="Decisión del cierre de bodega"
                className="flex flex-wrap justify-end gap-3 border-t pt-4"
              >
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    setMotivo("");
                    setMotivoError(null);
                    setRechazando(true);
                  }}
                >
                  Rechazar
                </Button>
                <Button type="button" onClick={confirmarAprobacion}>
                  Aprobar
                </Button>
              </section>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* ---------- Sub-modal de rechazo con motivo obligatorio (R17) ---------- */}
      <Modal
        open={rechazando}
        onOpenChange={(next) => {
          if (!next) {
            setRechazando(false);
            setMotivoError(null);
          }
        }}
        title="Rechazar cierre de bodega"
        description="Indicá el motivo del rechazo. La bodega satélite lo verá para corregir."
        confirmLabel="Rechazar cierre de bodega"
        confirmVariant="destructive"
        onConfirm={confirmarRechazo}
        closeOnConfirm={false}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="motivo-rechazo-bodega" className="text-sm font-medium">
            Motivo del rechazo
          </label>
          <textarea
            id="motivo-rechazo-bodega"
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value);
              if (motivoError) setMotivoError(null);
            }}
            rows={4}
            aria-required="true"
            aria-invalid={motivoError !== null}
            aria-describedby={
              motivoError ? "motivo-rechazo-bodega-error" : undefined
            }
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {motivoError ? (
            <p
              id="motivo-rechazo-bodega-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {motivoError}
            </p>
          ) : null}
        </div>
      </Modal>

      {/* ---------- Visor de evidencia (URL firmada, R12) ---------- */}
      <VisorEvidencia url={evidencia} onClose={() => setEvidencia(null)} />
    </section>
  );
}

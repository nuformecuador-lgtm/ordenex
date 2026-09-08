"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
import { Pagination } from "@/components/shared/Pagination";
import { SegmentedToggle } from "@/components/shared/SegmentedToggle";
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
  listarGestionesCierresBodegaCompleto,
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
  TotalesIngresoPanel,
  TotalesPanel,
  TOTAL_GENERAL_LABEL,
  VisorEvidencia,
  // Feature 393 (F5, design §5) — los rotulos y las notas de las dos cascadas. Los mismos que
  // lee la tarjeta (R23): el texto vive en el modulo PURO `cierre-labels` y se pide por esta
  // puerta, que es donde este modulo ya pedia el resto.
  CASCADA_CENTRAL_TITULO,
  CASCADA_DUENO_TITULO,
  PARA_LA_CENTRAL_LABEL,
  PARA_LA_TIENDA_LABEL,
  NETO_ORDENEX_LABEL,
  COBRADO_SOBRE_RECAUDADO_LABEL,
  FACTURADO_ORDENEX_LABEL,
  GANA_BODEGA_SATELITE_LABEL,
  PAGO_MENSAJERO_LABEL,
  FLETE_CON_IVA_LABEL,
  COMISION_CON_IVA_LABEL,
  FLETE_DEV_CON_IVA_LABEL,
  PARA_LA_CENTRAL_NOTA,
  PARA_LA_CENTRAL_NEGATIVO_NOTA,
  EFECTIVO_NO_CUBRE_NOTA,
  GANA_BODEGA_SATELITE_NOTA,
  FLETE_RECHAZO_NO_DEDUCIBLE_NOTA,
  esMontoNegativo,
} from "./cierre-detalle-shared";
import { CascadaDinero, type LineaCascada } from "./CascadaDinero";
import { CierreBodegaFacturaResumen } from "./cierre-factura";
import {
  DescargarCierresButton,
  type DescargaResumenCierres,
} from "./DescargarCierresButton";
import { ListaComprobantes } from "./ListaComprobantes";
import { PanelConmutado } from "./PanelConmutado";
import {
  CierresBodegaResueltosLista,
  descargaBodegaResueltos,
  type CierresBodegaResueltosPagina,
} from "./CierresBodegaResueltosLista";
import { FiltrosCierresBarra } from "./FiltrosCierresBarra";
import {
  AMBITO_DESCARGA_BODEGA_PENDIENTES,
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
  /** Total general agregado menos flete + IVA y comisión + IVA (puede ser negativo). */
  pagoTienda: string;
  /**
   * Feature 393 — los cuatro derivados AGREGADOS de las dos cascadas, tal como los emite el
   * servidor. `ganancia` ya no se guarda: en esta superficie la absorbió `netoOrdenex`, que
   * resta ADEMÁS lo que gana la bodega satélite (las dos sólo coinciden cuando esa cifra es 0).
   * El servicio la sigue devolviendo —la lee el detalle del cierre de MENSAJERO (R30)—, aquí
   * simplemente no se pinta.
   */
  cobradoSobreRecaudado: string;
  netoOrdenex: string;
  paraLaCentral: string;
  efectivoCubreDescuentos: boolean;
}

/**
 * Feature 393 (§4) — LAS LÍNEAS DE LA CASCADA «lo que va a la central», en un solo sitio.
 *
 * Es la cascada que la bodega satélite necesita para operar: de lo que se recaudó, cuánto le
 * entrega a la central. Los cuatro importes llegan YA DERIVADOS del servidor; aquí sólo se
 * eligen los rótulos, el orden y las notas. Ni una resta (R13).
 *
 * Vive en una función y no escrito dos veces porque el modal la monta una vez para el agregado
 * y otra por cada `cierre_dia`: dos copias es como dos superficies acaban diciendo cosas
 * distintas de la misma cifra (R23).
 */
function lineasCascadaCentral(nivel: {
  general: string;
  totalPagoMensajero: string;
  totalIngresoBodegaRechazos: string;
  paraLaCentral: string;
  efectivoCubreDescuentos: boolean;
}): LineaCascada[] {
  // R26/R36/R37: la nota fija dice de qué resta sale; las dos condicionales, qué pasa cuando el
  // número no es tranquilo. Van SUELTAS y no unidas en un párrafo: cada una está o no está, y
  // fundirlas dejaría sin poder distinguir cuál se puso.
  const notas = [PARA_LA_CENTRAL_NOTA];
  if (esMontoNegativo(nivel.paraLaCentral)) notas.push(PARA_LA_CENTRAL_NEGATIVO_NOTA);
  if (!nivel.efectivoCubreDescuentos) notas.push(EFECTIVO_NO_CUBRE_NOTA);

  return [
    // D5: la primera línea reusa el rótulo del total que YA está en esta pantalla («Total
    // general», el del panel de arriba). Estrenar un «Lo recaudado» sería dar dos nombres a la
    // misma cifra en la misma superficie, que es el defecto que esta ficha viene a arreglar.
    { label: TOTAL_GENERAL_LABEL, monto: nivel.general, signo: "neutro" },
    { label: PAGO_MENSAJERO_LABEL, monto: nivel.totalPagoMensajero, signo: "resta" },
    {
      label: GANA_BODEGA_SATELITE_LABEL,
      monto: nivel.totalIngresoBodegaRechazos,
      signo: "resta",
      notas: [GANA_BODEGA_SATELITE_NOTA],
    },
    {
      label: PARA_LA_CENTRAL_LABEL,
      monto: nivel.paraLaCentral,
      signo: "neutro",
      destacado: true,
      notas,
    },
  ];
}

/**
 * Feature 393 (§3) — LAS LÍNEAS DE LA CASCADA «de quién es el dinero».
 *
 * Sólo en el detalle, que sólo abre el maestro (R39): la satélite ve lo suyo y nadie ve un
 * margen que no le toca.
 *
 * La LÍNEA PUENTE («Cobrado sobre lo recaudado») no es decorativa y va SIEMPRE, también con el
 * flete por rechazo en cero (R10): ese cobro se le factura a la tienda pero NO sale de lo
 * recaudado —un rechazo no cobra contra entrega—, así que sin ella la pantalla enseñaría
 * «recaudado − facturado = para la tienda», que no da en cuanto hay un rechazo.
 */
function lineasCascadaDueno(nivel: {
  general: string;
  totalesIngreso: TotalesIngresoOrdenex;
  totalPagoMensajero: string;
  totalIngresoBodegaRechazos: string;
  pagoTienda: string;
  cobradoSobreRecaudado: string;
  netoOrdenex: string;
}): LineaCascada[] {
  return [
    { label: TOTAL_GENERAL_LABEL, monto: nivel.general, signo: "neutro" },
    { label: FLETE_CON_IVA_LABEL, monto: nivel.totalesIngreso.fleteConIva, signo: "resta" },
    {
      label: COMISION_CON_IVA_LABEL,
      monto: nivel.totalesIngreso.comisionConIva,
      signo: "resta",
    },
    { label: PARA_LA_TIENDA_LABEL, monto: nivel.pagoTienda, signo: "neutro", destacado: true },
    // La línea puente: lo mismo que se acaba de restar, ahora leído como lo que Ordenex cobró.
    {
      label: COBRADO_SOBRE_RECAUDADO_LABEL,
      monto: nivel.cobradoSobreRecaudado,
      signo: "neutro",
    },
    {
      label: FLETE_DEV_CON_IVA_LABEL,
      monto: nivel.totalesIngreso.fleteDevolucionConIva,
      signo: "suma",
      notas: [FLETE_RECHAZO_NO_DEDUCIBLE_NOTA],
    },
    { label: FACTURADO_ORDENEX_LABEL, monto: nivel.totalesIngreso.total, signo: "neutro" },
    { label: PAGO_MENSAJERO_LABEL, monto: nivel.totalPagoMensajero, signo: "resta" },
    {
      label: GANA_BODEGA_SATELITE_LABEL,
      monto: nivel.totalIngresoBodegaRechazos,
      signo: "resta",
      notas: [GANA_BODEGA_SATELITE_NOTA],
    },
    { label: NETO_ORDENEX_LABEL, monto: nivel.netoOrdenex, signo: "neutro", destacado: true },
  ];
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
function descargaColaBodega(filtros: FiltrosCierresBodega): DescargaResumenCierres {
  return {
    titulo: TITULO_DESCARGA_PENDIENTES,
    columnas: COLUMNAS_DESCARGA_BODEGA_PENDIENTES,
    // Ficha 314: enciende el selector de columnas de esta descarga (ámbito propio, R10).
    ambitoColumnas: AMBITO_DESCARGA_BODEGA_PENDIENTES,
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
  const { mutate } = useSWRConfig();

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
        pagoTienda: result.pagoTienda,
        // Feature 393 (R12/R20): los cuatro llegan derivados del servidor con aritmética
        // decimal exacta. La pantalla no resta nada.
        cobradoSobreRecaudado: result.cobradoSobreRecaudado,
        netoOrdenex: result.netoOrdenex,
        paraLaCentral: result.paraLaCentral,
        efectivoCubreDescuentos: result.efectivoCubreDescuentos,
      });
      return;
    }
    if (result.status === "no_encontrada") {
      toast.error("El cierre de bodega ya no está disponible. Actualizando la lista.");
      refrescarListas();
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

  /**
   * Pedido humano del 2026-08-19 — aprobar o rechazar tiene que dejarse ver en la cola.
   * `router.refresh()` sólo re-resuelve el Server Component, y su página llega acá como
   * `fallbackData`: SWR ya tiene datos y no la vuelve a mirar, así que el cierre resuelto
   * seguía en la lista. Se revalidan todas las páginas/filtros de la cola, no sólo la
   * visible: la fila resuelta puede estar en cualquiera de ellas.
   */
  function refrescarListas() {
    void mutate(
      (clave) => Array.isArray(clave) && clave[0] === "cierres-bodega:pendientes",
    );
    router.refresh();
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
    refrescarListas();
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
      refrescarListas();
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
      refrescarListas();
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
        <div className="flex flex-wrap items-center gap-2">
          {/* UN SOLO botón, el mismo control que monta `CierresAdminModule` y con la MISMA
              declaración de columnas para el detalle (R26); lo único que cambia es la Server
              Action, porque el conjunto es otro: acá salen las gestiones de los cierres del día
              ya CONSOLIDADOS en un cierre de bodega —las bodegas satélite—, que en la otra
              pantalla el maestro no ve (design §2.6).

              Los controles de descarga de los OTROS listados de esta pantalla no se tocan: no
              tienen equivalente detallado, así que no hay nada que unificar en ellos. */}
          <DescargarCierresButton
            resumen={
              tab === TAB_PENDIENTES
                ? descargaColaBodega(filtros)
                : descargaBodegaResueltos(filtros)
            }
            catalogo={catalogoFiltros}
            accion={listarGestionesCierresBodegaCompleto}
            disabled={pendientesCargando}
          />
        </div>
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

            {/* Feature 393 (design §7.2) — LAS DOS CASCADAS, separadas y rotuladas. Sustituyen
                a las cinco tarjetas sueltas que estaban aquí («Ingreso bruto», «Pago a
                mensajeros», «Ganancia», «Ingreso de bodega por rechazos» y «Pago a tienda»):
                eran las mismas cifras, sueltas, sin cascada y con nombres que no son los que usa
                quien las lee. Los componentes NO se borran —los monta el detalle del cierre de
                MENSAJERO (R30)—; aquí se deja de montarlos (R34/D4).

                LA CASCADA B VA PRIMERO, y no es un detalle de maquetación: es el número
                operativo —lo que la satélite le entrega a la central— y es con el que cierra la
                tarjeta, así que el detalle empieza por lo mismo (R23). */}
            <CascadaDinero
              titulo={CASCADA_CENTRAL_TITULO}
              ariaLabel={`${CASCADA_CENTRAL_TITULO} · cierre de bodega`}
              lineas={lineasCascadaCentral({
                general: detalle.cierre.totales.general,
                totalPagoMensajero: detalle.cierre.totalPagoMensajero,
                totalIngresoBodegaRechazos: detalle.cierre.totalIngresoBodegaRechazos,
                paraLaCentral: detalle.paraLaCentral,
                efectivoCubreDescuentos: detalle.efectivoCubreDescuentos,
              })}
            />

            <CascadaDinero
              titulo={CASCADA_DUENO_TITULO}
              ariaLabel={`${CASCADA_DUENO_TITULO} · cierre de bodega`}
              lineas={lineasCascadaDueno({
                general: detalle.cierre.totales.general,
                totalesIngreso: detalle.totalesIngreso,
                totalPagoMensajero: detalle.cierre.totalPagoMensajero,
                totalIngresoBodegaRechazos: detalle.cierre.totalIngresoBodegaRechazos,
                pagoTienda: detalle.pagoTienda,
                cobradoSobreRecaudado: detalle.cobradoSobreRecaudado,
                netoOrdenex: detalle.netoOrdenex,
              })}
            />

            {/* El desglose por concepto de la línea «Lo que Ordenex facturó»: sin cambios. */}
            <TotalesIngresoPanel
              totales={detalle.totalesIngreso}
              ariaLabel="Ingreso de Ordenex del cierre de bodega"
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
                {/* Feature 393 (R15/R23) — las MISMAS dos cascadas, con los MISMOS rótulos,
                    para ESTE cierre_dia. Cada una sale de los snapshots de su propio nivel: el
                    día NO usa el pago agregado ni el agregado se corrige para cuadrar con la
                    suma de los días (R17). */}
                <CascadaDinero
                  titulo={CASCADA_CENTRAL_TITULO}
                  ariaLabel={`${CASCADA_CENTRAL_TITULO} · ${cierreDia.mensajeroNombre}`}
                  lineas={lineasCascadaCentral({
                    general: cierreDia.totales.general,
                    totalPagoMensajero: cierreDia.totalPagoMensajero,
                    totalIngresoBodegaRechazos: cierreDia.totalIngresoBodegaRechazos,
                    paraLaCentral: cierreDia.paraLaCentral,
                    efectivoCubreDescuentos: cierreDia.efectivoCubreDescuentos,
                  })}
                />
                <CascadaDinero
                  titulo={CASCADA_DUENO_TITULO}
                  ariaLabel={`${CASCADA_DUENO_TITULO} · ${cierreDia.mensajeroNombre}`}
                  lineas={lineasCascadaDueno({
                    general: cierreDia.totales.general,
                    totalesIngreso: cierreDia.totalesIngreso,
                    totalPagoMensajero: cierreDia.totalPagoMensajero,
                    totalIngresoBodegaRechazos: cierreDia.totalIngresoBodegaRechazos,
                    pagoTienda: cierreDia.pagoTienda,
                    cobradoSobreRecaudado: cierreDia.cobradoSobreRecaudado,
                    netoOrdenex: cierreDia.netoOrdenex,
                  })}
                />
                {/* El desglose por concepto de ESTE cierre_dia: sin cambios. */}
                <TotalesIngresoPanel
                  totales={cierreDia.totalesIngreso}
                  ariaLabel={`Ingreso de Ordenex · ${cierreDia.mensajeroNombre}`}
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

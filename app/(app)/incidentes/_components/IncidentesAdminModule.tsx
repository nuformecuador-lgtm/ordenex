"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/shared/Modal";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { filasDelConjuntoCompleto } from "@/components/shared/descarga-resultado";
import { useToast } from "@/hooks/useToast";
import { incidentesConfig } from "@/lib/config/incidentes";
import {
  aprobarIncidente,
  rechazarIncidente,
  retractarIncidente,
  verIncidente,
  listarIncidentes,
  listarPendientesIncidentesPaginado,
} from "@/lib/actions/incidentes";
import type { IncidenteAdminDTO } from "@/lib/interfaces/services/IIncidenteAdminService";
import { INDEMNIZACION_MONTO_MAX } from "@/lib/types/cierres-admin";
import { montoValido } from "@/app/(app)/wallet/_components/wallet-labels";
// La etiqueta visible de la causa sale del catálogo derivado del SEED, el MISMO que usan el
// panel del mensajero (T2.1) y el modal de reporte (T2.7): las tres pantallas hablan de la
// misma causa y no pueden llamarla distinto. Precedente de forma: `estatus-label`.
import { CAUSA_INCIDENTE_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-incidente-options";
// `money` y el badge de estado se REUSAN de los cierres: el patrón de aprobación es el mismo
// (enum `CierreEstado`, dos colas, motivo sólo al rechazar) y el formato del dinero no puede
// divergir entre dos pantallas del mismo administrador. Lo que NO se reusa es
// `EstadoHistoricoRotulo`: su marcador «bloqueante hasta re-solicitud» es del cierre del
// mensajero y sería FALSO aquí (un incidente rechazado devuelve la orden a su origen y se
// puede volver a reportar; no bloquea a nadie).
import { money, EstadoCierreBadge } from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import {
  IncidentesHistoricoTabla,
  type IncidentesHistoricoPagina,
} from "./IncidentesHistoricoTabla";
import {
  COLUMNAS_DESCARGA_INCIDENTES_PENDIENTES,
  filaDescargaIncidentePendiente,
} from "./incidentes-descarga-columnas";

// Feature 158 (T2.8, R49/R50/R54 — camino del ADMIN) — cola de aprobación de incidentes.
// ESPEJO de `CierresAdminModule` (38), que es la aplicación original del patrón que el humano
// pidió reusar: dos colas («Pendientes de decisión» + «Histórico» de solo lectura), detalle en
// modal y sub-modales de decisión. Vive en PÁGINA PROPIA (Q-I) porque un incidente no es un
// cierre; precedente de la decisión: `cierres-bodega-admin` en su día.
//
// Los datos llegan por PROPS desde el Server Component padre, que ya resolvió permisos y
// alcance (`docs/architecture.md`): este módulo no fetchea la lista.

/**
 * Feature 170 — FASE 2 (T J.2, R40/R41): la PÁGINA de la cola, tal como la devuelve el
 * servidor. `total` es el del CONJUNTO —de él sale el contador de cabecera (R42)— y nunca
 * `items.length`.
 */
export interface IncidentesColaPagina {
  items: IncidenteAdminDTO[];
  total: number;
  pageSize: number;
}

export interface IncidentesAdminModuleProps {
  /**
   * Feature 170 — FASE 2 (T J.2, R40/R41): PÁGINA 1 de los incidentes `solicitado` del
   * alcance (cola de decisión, R49), ya resuelta server-side, más el `total` del conjunto.
   */
  pendientes: IncidentesColaPagina;
  /**
   * Feature 170 — FASE 2 (T I.2, R40/R41): PÁGINA 1 del histórico de resueltos (R49), ya
   * resuelta server-side, más el `total` del conjunto. Deja de ser el array entero.
   */
  historico: IncidentesHistoricoPagina;
  /** `true` si el `adminSatelite` no tiene zona asignada (patrón 38/R3). */
  sinZona: boolean;
}

// --- Textos visibles (separados de la lógica, i18n-ready) ---

export const TITULO_PENDIENTES = "Pendientes de decisión";
export const TITULO_HISTORICO = "Histórico";
/**
 * Feature 170 (T E.6, R12/R13): nombres de las DESCARGAS. No se reusan `TITULO_PENDIENTES`
 * ni `TITULO_HISTORICO` porque son los encabezados DENTRO de la pantalla de incidentes: un
 * archivo llamado `historico-2026-07-31.xlsx` no diría de qué es, y el nombre accesible del
 * control («Descargar Histórico») sería el mismo que el de la pantalla de cierres.
 */
export const TITULO_DESCARGA_PENDIENTES = "Incidentes pendientes";
export const TITULO_DESCARGA_HISTORICO = "Incidentes resueltos";
export const VACIO_PENDIENTES = "No hay incidentes pendientes de decisión.";
export const VACIO_HISTORICO = "Aún no hay incidentes resueltos.";
export const SIN_ZONA_AVISO = "No tenés una zona asignada; contactá a tu administrador.";

export const APROBAR_TITULO = "Aprobar el incidente e indemnizar";
export const APROBAR_DETALLE =
  "Al aprobar, el monto sale de la caja principal como un egreso de indemnización. La orden se queda en incidente: esta decisión no se deshace.";
export const APROBAR_CONFIRMAR = "Aprobar e indemnizar";
export const MONTO_LABEL = "Monto de la indemnización";
export const MONTO_AYUDA = `Mayor que 0 y hasta ₡${INDEMNIZACION_MONTO_MAX}, con hasta 2 decimales (por ejemplo 12500.00).`;
/**
 * Mensajes POR CAUSA del monto inválido: dicen QUÉ corregir. Es la misma lección de m5 del PR 1
 * —un «monto inválido» único deja al admin adivinando si sobra un dígito o si el problema es la
 * coma—, con el máximo interpolado del contrato y no tecleado.
 */
export const MONTO_EXCEDE = `El monto no puede superar ₡${INDEMNIZACION_MONTO_MAX} (10 dígitos y 2 decimales). Revisá si sobra un dígito.`;
export const MONTO_FORMATO =
  "Escribí un monto mayor que 0, con punto decimal y sin separador de miles (por ejemplo 12500.00).";

export const RECHAZAR_TITULO = "Rechazar el incidente";
export const RECHAZAR_DETALLE =
  "La orden volverá al estado desde el que se reportó y no habrá indemnización. Indicá el motivo: lo verá quien lo reportó.";
export const RECHAZAR_CONFIRMAR = "Rechazar incidente";
export const MOTIVO_RECHAZO_LABEL = "Motivo del rechazo";
export const MOTIVO_RECHAZO_REQUERIDO = "El motivo de rechazo es obligatorio.";

export const RETRACTAR_TITULO = "Retractar mi reporte";
export const RETRACTAR_DETALLE =
  "Retirás el incidente que reportaste. La orden vuelve al estado desde el que la reportaste y no se paga nada. Podés volver a reportarla si hace falta.";
export const RETRACTAR_CONFIRMAR = "Retractar reporte";

/**
 * R51 en la INTERFAZ (T2.9). El servidor lo rechaza igual (y esa es la guardia real); esto
 * evita que la UI invite a algo que la transacción va a negar, y dice POR QUÉ en vez de dejar
 * un botón apagado sin explicación. La alternativa accionable —retractarlo— va al lado.
 */
export const R51_MOTIVO =
  "No podés aprobar ni rechazar un incidente que reportaste vos: la decisión del dinero es de otro administrador. Si fue un error, podés retractarlo.";

const EVIDENCIA_TITULO = "Evidencia del incidente";
const SIN_EVIDENCIA = "Este incidente no tiene fotos disponibles.";
/**
 * El «—» del monto de un incidente pendiente NO significa «no se indemniza», sino «todavía no
 * se decidió». Un guion pelado se leería como lo contrario, así que lleva su nota (mismo
 * patrón que `PAGO_SIN_TARIFA_NOTA` de los cierres y que la columna equivalente de T2.3).
 */
export const INDEMNIZACION_PENDIENTE_NOTA =
  "Se captura al aprobar el incidente; todavía no se indemnizó.";

/** Nombre accesible del control de la COLA (R43). Propio: la pantalla monta dos tablas. */
export const PAGINACION_PENDIENTES_LABEL = "Paginación de los incidentes pendientes";
export const ERROR_CARGA_PENDIENTES = "No se pudieron cargar los incidentes pendientes.";

// R40: el tamaño sale de la config del dominio (T H.1), nunca de un literal de pantalla.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= incidentesConfig.MAX_PAGE_SIZE,
);

/** Identificación legible de la orden del incidente (misma forma que la cola de cierres). */
function referencia(i: IncidenteAdminDTO): string {
  return `${i.numRemision} · ${i.destinatario}`;
}

/**
 * Feature 170 — FASE 2 (T J.2, R40/R41): una página de la cola. El alcance NO viaja en el
 * input —lo resuelve el servicio desde la sesión, por la zona de la ORDEN (R44)—; aquí solo
 * van el número de página y el tamaño.
 */
async function leerPendientes(
  page: number,
  pageSize: number,
): Promise<IncidentesColaPagina> {
  const res = await listarPendientesIncidentesPaginado({ page, pageSize });
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

export function IncidentesAdminModule({
  pendientes,
  historico,
  sinZona,
}: Readonly<IncidentesAdminModuleProps>) {
  const router = useRouter();
  const toast = useToast();

  // Incidente abierto en el detalle (null = modal cerrado).
  const [detalle, setDetalle] = useState<IncidenteAdminDTO | null>(null);
  // Visor de una evidencia (URL FIRMADA, R46); null = cerrado.
  const [evidencia, setEvidencia] = useState<string | null>(null);
  // Sub-modales de decisión.
  const [aprobando, setAprobando] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const [retractando, setRetractando] = useState(false);
  // Monto tal cual lo teclea el admin: STRING de extremo a extremo (money-safe, R55).
  const [monto, setMonto] = useState("");
  const [montoError, setMontoError] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [motivoError, setMotivoError] = useState<string | null>(null);

  // Feature 170 — FASE 2 (T J.2, R40/R42/R43): página visible de la COLA. El control vive
  // AQUÍ, en el módulo, junto al contador (decisión de Q-I6): así la guardia de T H.3 ve esta
  // pantalla como paginada y vigila que el número salga del `total` del servidor.
  //
  // R50: el monto tecleado, el motivo y el incidente abierto viven en los `useState` de
  // arriba, que esta lectura no toca; cambiar de página no los reinicia. El hook va ANTES del
  // corte por `sinZona`: los hooks de React no admiten un retorno temprano por delante.
  const [pendientesPage, setPendientesPage] = useState(1);
  const [pendientesPageSize, setPendientesPageSize] = useState(pendientes.pageSize);
  const { data: pendientesData, error: pendientesError } = useSWR(
    ["incidentes:pendientes", pendientesPage, pendientesPageSize],
    () => leerPendientes(pendientesPage, pendientesPageSize),
    {
      fallbackData:
        pendientesPage === 1 && pendientesPageSize === pendientes.pageSize
          ? pendientes
          : undefined,
    },
  );
  const colaPendientes: IncidentesColaPagina = pendientesData ?? {
    items: [],
    total: 0,
    pageSize: pendientesPageSize,
  };
  // R44: el esqueleto sólo cuando NO hay nada que pintar (`isLoading` de SWR sigue en `true`
  // mientras revalida aunque haya `fallbackData`).
  const pendientesCargando = pendientesData === undefined;

  // R48 (patrón 38/R3): sin zona no hay alcance que resolver → aviso accionable, sin colas.
  if (sinZona) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        {SIN_ZONA_AVISO}
      </p>
    );
  }

  /**
   * Abre el detalle pidiéndolo al servidor en vez de pintar la fila que ya se tiene. Dos
   * razones concretas: las URLs de evidencia son FIRMADAS y con vigencia acotada (R46) —las de
   * la carga de la página caducan si la pestaña queda abierta—, y el estado puede haber
   * cambiado (otro admin ya lo resolvió). Mismo camino que `CierresAdminModule.abrirDetalle`.
   */
  async function abrirDetalle(incidenteId: string) {
    const result = await verIncidente({ incidenteId });
    if (result.status === "ok") {
      setDetalle(result.incidente);
      return;
    }
    if (result.status === "no_encontrada") {
      toast.error("El incidente ya no está disponible. Actualizando la lista.");
      router.refresh();
      return;
    }
    if (result.status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
      return;
    }
    toast.error("No se pudo abrir el detalle del incidente. Intentá de nuevo.");
  }

  function cerrarDetalle() {
    setDetalle(null);
    setAprobando(false);
    setRechazando(false);
    setRetractando(false);
    setMonto("");
    setMontoError(null);
    setMotivo("");
    setMotivoError(null);
  }

  /** Traduce un resultado de dominio de error a feedback accionable + refresco. */
  function manejarErrorDecision(
    status: "conflict" | "no_encontrada" | "forbidden" | "unauthenticated",
    motivoServidor?: string,
  ) {
    if (status === "conflict") {
      // El servidor manda su motivo REAL (ya resuelto por otro, o R51): se muestra tal cual.
      toast.error(motivoServidor ?? "Este incidente ya fue resuelto por otro administrador.");
    } else if (status === "no_encontrada") {
      toast.error("El incidente ya no está disponible.");
    } else if (status === "forbidden") {
      toast.error("No tenés permiso para resolver este incidente.");
    } else {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    }
    cerrarDetalle();
    router.refresh();
  }

  const montoOk = montoValido(monto.trim(), INDEMNIZACION_MONTO_MAX);

  /** Mensaje accionable del monto tecleado; `undefined` si está vacío o es válido. */
  function errorDeMonto(valor: string): string | undefined {
    const limpio = valor.trim();
    if (limpio === "" || montoValido(limpio, INDEMNIZACION_MONTO_MAX)) return undefined;
    // Bien formado pero por encima del tope → el problema es el tamaño, no la sintaxis.
    return montoValido(limpio) ? MONTO_EXCEDE : MONTO_FORMATO;
  }

  /** R50/R52: aprueba con el monto capturado. */
  async function confirmarAprobacion() {
    if (!detalle || !montoOk) return; // doble candado: el botón ya está deshabilitado
    const result = await aprobarIncidente({
      incidenteId: detalle.incidenteId,
      monto: monto.trim(), // STRING TAL CUAL, sin `parseFloat` (R55)
    });
    if (result.status === "ok") {
      toast.success("Incidente aprobado; la indemnización salió de la caja principal.");
      cerrarDetalle();
      router.refresh();
      return;
    }
    if (result.status === "validation_error") {
      setMontoError(Object.values(result.fieldErrors)[0]?.[0] ?? MONTO_FORMATO);
      return; // el sub-modal sigue abierto: cerrarlo obligaría a recapturar
    }
    manejarErrorDecision(
      result.status,
      result.status === "conflict" ? result.motivo : undefined,
    );
  }

  /** R54: rechaza con motivo obligatorio y devuelve la orden a su origen. */
  async function confirmarRechazo() {
    if (!detalle) return;
    const motivoLimpio = motivo.trim();
    if (motivoLimpio.length === 0) {
      setMotivoError(MOTIVO_RECHAZO_REQUERIDO);
      return; // R54: sin motivo NO se envía
    }
    const result = await rechazarIncidente({
      incidenteId: detalle.incidenteId,
      motivo: motivoLimpio,
    });
    if (result.status === "ok") {
      toast.success("Incidente rechazado; la orden volvió a su estado anterior.");
      cerrarDetalle();
      router.refresh();
      return;
    }
    if (result.status === "validation_error") {
      setMotivoError(Object.values(result.fieldErrors)[0]?.[0] ?? MOTIVO_RECHAZO_REQUERIDO);
      return;
    }
    manejarErrorDecision(
      result.status,
      result.status === "conflict" ? result.motivo : undefined,
    );
  }

  /** R59: el AUTOR retira su propio reporte mientras sigue `solicitado`. Sin motivo. */
  async function confirmarRetracto() {
    if (!detalle) return;
    const result = await retractarIncidente({ incidenteId: detalle.incidenteId });
    if (result.status === "ok") {
      toast.success("Reporte retractado; la orden volvió a su estado anterior.");
      cerrarDetalle();
      router.refresh();
      return;
    }
    if (result.status === "validation_error") {
      toast.error("No se pudo retractar el reporte. Intentá de nuevo.");
      return;
    }
    manejarErrorDecision(
      result.status,
      result.status === "conflict" ? result.motivo : undefined,
    );
  }

  const esPendiente = detalle?.estado === "solicitado";

  return (
    <div className="flex flex-col gap-8">
      {/* ---------- Pendientes de decisión (R49) ---------- */}
      <section aria-label={TITULO_PENDIENTES} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          {TITULO_PENDIENTES}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {/* R42: el TOTAL del conjunto que devuelve el servidor, nunca el tamaño de la
                página: cada fila de esta cola es un paquete esperando decisión de dinero. */}
            ({colaPendientes.total})
          </span>
        </h2>
        <div className="overflow-x-auto">
          <DataTable
            columns={columnasPendientes(abrirDetalle)}
            data={colaPendientes.items}
            rowKey="incidenteId"
            ariaLabel={TITULO_PENDIENTES}
            emptyMessage={VACIO_PENDIENTES}
            isLoading={pendientesCargando}
            error={pendientesError ? ERROR_CARGA_PENDIENTES : null}
            /**
             * Feature 170 (T J.2, R52) — la tabla pinta UNA página; el archivo sigue siendo la
             * COLA COMPLETA. Se relee con el MISMO listado que la pantalla ya llamaba antes de
             * paginar (`listarIncidentes`), que acota por la zona de la ORDEN para un
             * `adminSatelite`: descargar no amplía el alcance (R14/R44).
             *
             * Las URL firmadas de las evidencias NO viajan al archivo (R22): esta tabla no
             * las muestra y el módulo de columnas ni siquiera las lee.
             */
            descarga={{
              titulo: TITULO_DESCARGA_PENDIENTES,
              columnas: COLUMNAS_DESCARGA_INCIDENTES_PENDIENTES,
              obtenerFilas: () =>
                filasDelConjuntoCompleto(
                  listarIncidentes().then((res) =>
                    res.status === "ok"
                      ? ({ status: "ok", items: res.pendientes } as const)
                      : res,
                  ),
                  filaDescargaIncidentePendiente,
                ),
            }}
          />
        </div>

        <Pagination
          page={pendientesPage}
          pageSize={pendientesPageSize}
          total={colaPendientes.total}
          disabled={pendientesCargando}
          showFirstLast
          siblingCount={1}
          ariaLabel={PAGINACION_PENDIENTES_LABEL}
          onPageChange={setPendientesPage}
          onPageSizeChange={(s) => {
            setPendientesPageSize(s);
            setPendientesPage(1);
          }}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
        />
      </section>

      {/* ---------- Histórico (solo lectura, R49) ----------
          Feature 170 — FASE 2 (T I.2): la tabla, su control de paginación y su descarga viven
          en su propio componente (ver la cabecera de `IncidentesHistoricoTabla`). */}
      <IncidentesHistoricoTabla
        initialData={historico}
        titulo={TITULO_HISTORICO}
        mensajeVacio={VACIO_HISTORICO}
        tituloDescarga={TITULO_DESCARGA_HISTORICO}
        onAbrir={abrirDetalle}
      />

      {/* ---------- Detalle del incidente ---------- */}
      <Modal
        open={detalle !== null}
        onOpenChange={(next) => {
          if (!next) cerrarDetalle();
        }}
        title="Detalle del incidente"
        description={detalle ? referencia(detalle) : undefined}
        confirmLabel="Cerrar"
        hideCancel
        onConfirm={cerrarDetalle}
      >
        {detalle ? (
          <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pr-1">
            <section aria-label="Datos del incidente" className="flex flex-col gap-2">
              <Dato label="Estado del incidente">
                <EstadoCierreBadge estado={detalle.estado} />
              </Dato>
              <Dato label="Causa">{CAUSA_INCIDENTE_LABEL[detalle.causa]}</Dato>
              <Dato label="Motivo">{detalle.motivo}</Dato>
              <Dato label="Reportado por">{detalle.reportadoPorNombre}</Dato>
              <Dato label="Reportado el">{detalle.createdAt.slice(0, 10)}</Dato>
              <Dato label="Nº Guía">{detalle.numGuia ?? "—"}</Dato>
              <Dato label="Zona">{detalle.zonaNombre}</Dato>
              <Dato label="Estado de la orden">{estatusLabel(detalle.estatusValue)}</Dato>
              <Dato
                label="Indemnización"
                nota={detalle.indemnizacion === null ? INDEMNIZACION_PENDIENTE_NOTA : undefined}
              >
                {money(detalle.indemnizacion)}
              </Dato>
              {detalle.resueltoPorNombre ? (
                <Dato label="Resuelto por">
                  {`${detalle.resueltoPorNombre}${
                    detalle.resueltoAt ? ` · ${detalle.resueltoAt.slice(0, 10)}` : ""
                  }`}
                </Dato>
              ) : null}
              {detalle.motivoRechazo ? (
                <Dato label="Motivo de rechazo">{detalle.motivoRechazo}</Dato>
              ) : null}
            </section>

            {/* R46: SIEMPRE URL firmada; el `storage_path` crudo no llega al cliente. */}
            <section aria-label="Evidencias del incidente" className="flex flex-col gap-2">
              <h3 className="text-base font-semibold">Evidencias</h3>
              {detalle.evidenciaUrls.length === 0 ? (
                <p className="text-sm text-muted-foreground">{SIN_EVIDENCIA}</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {detalle.evidenciaUrls.map((url, i) => (
                    <li key={url}>
                      <button
                        type="button"
                        onClick={() => setEvidencia(url)}
                        aria-label={`Ver evidencia ${i + 1}`}
                        className="rounded-md border border-border p-0"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`Evidencia ${i + 1}`}
                          className="size-20 rounded-md object-cover"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Decisión: sólo sobre un incidente `solicitado`. El histórico es solo lectura. */}
            {esPendiente ? (
              <section
                aria-label="Decisión del incidente"
                className="flex flex-col gap-3 border-t pt-4"
              >
                {/* T2.9 (R51): en un incidente PROPIO la decisión no se ofrece, y el motivo se
                    lee. El servidor lo vuelve a rechazar; esto es que la UI no invite. */}
                {detalle.esPropio ? (
                  <p role="note" className="text-sm text-muted-foreground">
                    {R51_MOTIVO}
                  </p>
                ) : null}
                <div className="flex flex-wrap justify-end gap-3">
                  {detalle.esPropio ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setRetractando(true)}
                    >
                      {RETRACTAR_CONFIRMAR}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={detalle.esPropio}
                    onClick={() => {
                      setMotivo("");
                      setMotivoError(null);
                      setRechazando(true);
                    }}
                  >
                    Rechazar
                  </Button>
                  <Button
                    type="button"
                    disabled={detalle.esPropio}
                    onClick={() => {
                      setMonto("");
                      setMontoError(null);
                      setAprobando(true);
                    }}
                  >
                    Aprobar
                  </Button>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* ---------- Sub-modal de aprobación con captura del monto (R50) ---------- */}
      <Modal
        open={aprobando}
        onOpenChange={(next) => {
          if (!next) {
            setAprobando(false);
            setMontoError(null);
          }
        }}
        title={APROBAR_TITULO}
        description={APROBAR_DETALLE}
        confirmLabel={APROBAR_CONFIRMAR}
        confirmDisabled={!montoOk}
        onConfirm={confirmarAprobacion}
        closeOnConfirm={false}
      >
        <div className="flex flex-col gap-2">
          {detalle ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Orden: </span>
              <span className="font-medium">{referencia(detalle)}</span>
              {" · "}
              <span className="text-muted-foreground">Causa: </span>
              <span className="font-medium">{CAUSA_INCIDENTE_LABEL[detalle.causa]}</span>
            </p>
          ) : null}
          <Label htmlFor="incidente-monto">{MONTO_LABEL}</Label>
          <Input
            id="incidente-monto"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={monto}
            aria-invalid={montoError ?? errorDeMonto(monto) ? true : undefined}
            aria-describedby={
              (montoError ?? errorDeMonto(monto))
                ? "incidente-monto-error"
                : "incidente-monto-ayuda"
            }
            onChange={(e) => {
              setMonto(e.target.value);
              if (montoError) setMontoError(null);
            }}
          />
          {(montoError ?? errorDeMonto(monto)) ? (
            <p id="incidente-monto-error" role="alert" className="text-sm text-destructive">
              {montoError ?? errorDeMonto(monto)}
            </p>
          ) : (
            <p id="incidente-monto-ayuda" className="text-xs text-muted-foreground">
              {MONTO_AYUDA}
            </p>
          )}
        </div>
      </Modal>

      {/* ---------- Sub-modal de rechazo con motivo obligatorio (R54) ---------- */}
      <Modal
        open={rechazando}
        onOpenChange={(next) => {
          if (!next) {
            setRechazando(false);
            setMotivoError(null);
          }
        }}
        title={RECHAZAR_TITULO}
        description={RECHAZAR_DETALLE}
        confirmLabel={RECHAZAR_CONFIRMAR}
        confirmVariant="destructive"
        onConfirm={confirmarRechazo}
        closeOnConfirm={false}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="incidente-motivo-rechazo" className="text-sm font-medium">
            {MOTIVO_RECHAZO_LABEL}
          </label>
          <textarea
            id="incidente-motivo-rechazo"
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value);
              if (motivoError) setMotivoError(null);
            }}
            rows={4}
            aria-required="true"
            aria-invalid={motivoError !== null}
            aria-describedby={motivoError ? "incidente-motivo-rechazo-error" : undefined}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {motivoError ? (
            <p
              id="incidente-motivo-rechazo-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {motivoError}
            </p>
          ) : null}
        </div>
      </Modal>

      {/* ---------- Sub-modal de retracto del AUTOR (R59) ---------- */}
      <Modal
        open={retractando}
        onOpenChange={(next) => {
          if (!next) setRetractando(false);
        }}
        title={RETRACTAR_TITULO}
        description={RETRACTAR_DETALLE}
        confirmLabel={RETRACTAR_CONFIRMAR}
        confirmVariant="destructive"
        onConfirm={confirmarRetracto}
        closeOnConfirm={false}
      />

      {/* ---------- Visor de evidencia (URL firmada, R46) ---------- */}
      <Modal
        open={evidencia !== null}
        onOpenChange={(next) => {
          if (!next) setEvidencia(null);
        }}
        title={EVIDENCIA_TITULO}
        confirmLabel="Cerrar"
        hideCancel
        onConfirm={() => setEvidencia(null)}
      >
        {evidencia ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={evidencia}
            alt="Evidencia fotográfica del incidente"
            className="max-h-[60vh] w-full rounded-md object-contain"
          />
        ) : null}
      </Modal>
    </div>
  );
}

/** Fila etiqueta/valor del detalle. `nota` va como texto accesible, no sólo visual. */
function Dato({
  label,
  nota,
  children,
}: {
  label: string;
  nota?: string;
  children: React.ReactNode;
}) {
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">{`${label}: `}</span>
      <span className="font-medium" title={nota} aria-label={nota ? `${label}: ${nota}` : undefined}>
        {children}
      </span>
    </p>
  );
}

// --- Columnas de la cola de pendientes (R49) ---
function columnasPendientes(
  abrir: (incidenteId: string) => void,
): Column<IncidenteAdminDTO>[] {
  return [
    { id: "numRemision", value: "Nº Remisión", render: (i) => i.numRemision },
    { id: "numGuia", value: "Nº Guía", render: (i) => i.numGuia ?? "—" },
    { id: "destinatario", value: "Destinatario", render: (i) => i.destinatario },
    { id: "zona", value: "Zona", render: (i) => i.zonaNombre },
    // La causa SIEMPRE traducida: el slug del enum (`danado`) no se pinta nunca.
    { id: "causa", value: "Causa", render: (i) => CAUSA_INCIDENTE_LABEL[i.causa] },
    { id: "reportadoPor", value: "Reportado por", render: (i) => i.reportadoPorNombre },
    { id: "createdAt", value: "Fecha", render: (i) => i.createdAt.slice(0, 10) },
    {
      id: "acciones",
      value: "Acciones",
      render: (i) => (
        <Button
          type="button"
          size="sm"
          onClick={() => abrir(i.incidenteId)}
          aria-label={`Ver o decidir el incidente de la orden ${i.numRemision}`}
        >
          Ver / decidir
        </Button>
      ),
    },
  ];
}

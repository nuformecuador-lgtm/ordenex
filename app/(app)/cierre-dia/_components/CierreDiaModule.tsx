"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MetodoPagoValue } from "@prisma/client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { useToast } from "@/hooks/useToast";
import {
  deshacerGestion,
  solicitarCierre,
  verCierrePasado,
} from "@/lib/actions/cierre-dia";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreTotales,
  CierrePasadoDTO,
  CierreResultado,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreEstado, CierreDestinoTipo } from "@/lib/types/cierre";
// Feature 158 (T2.3): la columna de la causa es la MISMA que la del detalle del admin — se
// reusa en vez de reescribirla, para que las dos pantallas no puedan divergir en la etiqueta.
import { COLUMNA_CAUSA_INCIDENTE } from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
// Pedido humano: el detalle de un cierre pasado se lee con el MISMO comprobante del admin
// (feature 38/40), en su variante `mensajero`. Una sola hoja para las dos pantallas.
import { CierreFacturaDetalle } from "@/app/(app)/cierres-admin/_components/cierre-factura";

// Feature 37 (T15, R3-R7/R10/R11/R18): módulo cliente del "Cierre del día". Recibe
// del Server Component padre los grupos ya resueltos (por resultado), los totales
// snapshot-able, el gate `puedesSolicitar` + su `motivoBloqueo` y el histórico de
// cierres. Las mutaciones (Solicitar cierre; feature 67/R35-R38: Devolver a gestión)
// van por Server Action y refrescan la ruta para releer el estado del servidor. Los
// montos llegan como STRING (money-safe): se renderizan tal cual, sin `parseFloat`/`Number`.

export interface CierreDiaModuleProps {
  grupos: CierreGrupos;
  totales: CierreTotales;
  /** Feature 39/R11: total DERIVADO a pagar al mensajero (STRING), separado de `totales`. */
  totalPagoMensajero: string;
  puedesSolicitar: boolean;
  motivoBloqueo: string | null;
  cierresPasados: CierrePasadoDTO[];
  /**
   * Feature 41/R21: `true` si el mensajero está BLOQUEADO (tiene un cierre
   * `solicitado`/`vencido` pendiente). Derivado server-side y pasado por props; el
   * módulo solo muestra el aviso accionable. Feature 111/R12: el bloqueo es TOTAL
   * (no puede gestionar NI recibir); el aviso lo comunica.
   */
  bloqueado: boolean;
  /**
   * Feature 111/R13: `true` si el mensajero tiene un cierre `vencido`. Habilita un
   * CTA diferenciado para SOLICITAR (enviar a aprobación) ese vencido, con
   * INDEPENDENCIA del gate de creación (`puedesSolicitar`). Derivado server-side.
   */
  tieneVencido: boolean;
  /**
   * Feature 109/R31: `true` si el mensajero tiene un cierre `rechazado`. En el modelo
   * GLOBAL un `rechazado` NO es terminal: bloquea y es RE-SOLICITABLE. Habilita el MISMO
   * CTA de re-solicitud que el `vencido` (misma Server Action `solicitarCierre`, que el
   * backend enruta a la transición `rechazado → solicitado`), con INDEPENDENCIA del gate
   * de creación (`puedesSolicitar`). Derivado server-side. Excluyente del `vencido` en la
   * práctica (invariante R30: nunca 2 cierres abiertos a la vez).
   */
  tieneRechazado: boolean;
}

// Feature 41/R21 + 111/R12: aviso accionable de BLOQUEO TOTAL (texto separado,
// i18n-ready). El bloqueo abarca gestionar Y recibir: el mensajero debe resolver su
// cierre pendiente antes de operar con las guías.
const BLOQUEO_AVISO =
  "No puedes gestionar ni recibir nuevas asignaciones hasta resolver tu cierre pendiente.";

// Feature 111/R13: CTA + aviso del cierre `vencido` (texto separado, i18n-ready).
const VENCIDO_AVISO =
  "Tienes un cierre vencido sin resolver. Envíalo a aprobación para destrabar tu operación.";
const VENCIDO_CTA_LABEL = "Solicitar aprobación del cierre vencido";
const VENCIDO_CONFIRM_TITULO = "Solicitar aprobación del cierre vencido";
const VENCIDO_CONFIRM_DETALLE =
  "Se enviará tu cierre vencido a tu bodega para aprobación. No se recalculan los montos ya registrados.";
const VENCIDO_OK = "Cierre vencido enviado a aprobación.";

// Feature 109/R31: CTA + aviso del cierre `rechazado` (texto separado, i18n-ready).
// En el modelo GLOBAL un cierre `rechazado` NO es terminal: sigue bloqueando la operación
// hasta que el mensajero lo VUELVA A SOLICITAR y su bodega lo APRUEBE (espejo del `vencido`).
// El copy lo deja explícito para que no se lea como "resuelto/cerrado".
const RECHAZADO_AVISO =
  "Tu cierre fue rechazado, pero no queda cerrado: sigue bloqueando tu operación hasta que lo vuelvas a enviar a aprobación y tu bodega lo apruebe.";
const RECHAZADO_CTA_LABEL = "Solicitar aprobación del cierre rechazado";
const RECHAZADO_CONFIRM_TITULO = "Solicitar aprobación del cierre rechazado";
const RECHAZADO_CONFIRM_DETALLE =
  "Se enviará de nuevo tu cierre rechazado a tu bodega para aprobación. No se recalculan los montos ya registrados.";
const RECHAZADO_OK = "Cierre rechazado enviado a aprobación.";

// Pedido humano: "ver" el detalle de un cierre YA solicitado (textos separados, i18n-ready).
const VER_DETALLE_COL = "Detalle";
const VER_DETALLE_LABEL = "Ver";
const DETALLE_TITULO = "Detalle del cierre";
const DETALLE_CARGANDO = "Cargando el detalle…";
const DETALLE_ERROR = "No se pudo cargar el detalle de este cierre.";
const DETALLE_NO_ENCONTRADA = "Este cierre ya no está disponible.";
const DETALLE_NOTA =
  "Los montos son los que quedaron congelados al solicitar el cierre.";

/** Feature 39: etiquetas del pago al mensajero (texto separado, i18n-ready). */
const PAGO_MENSAJERO_LABEL = "Ganancia";
const PAGO_MENSAJERO_COL = "Ganancia";

// Feature 67 (R35-R38): textos del deshacer (separados de la lógica, i18n-ready).
const DESHACER_COL = "Acciones";
const DESHACER_LABEL = "Devolver a gestión";
const DESHACER_TITULO = "Devolver la orden a gestión";
const DESHACER_DETALLE =
  "La gestión quedará anulada (queda el registro de quién la hizo y cuándo) y la orden volverá a tu lista para gestionar.";
const DESHACER_OK = "Gestión deshecha; la orden volvió a tu lista para gestionar.";
const DESHACER_FORBIDDEN = "No podés deshacer esta gestión.";
const DESHACER_ERROR = "No se pudo deshacer la gestión. Intentá de nuevo.";
/** Nombre accesible del botón de la fila (R35): identifica SU orden, no el botón genérico. */
function deshacerAriaLabel(g: CierreDetalleGestion): string {
  return `${DESHACER_LABEL} la orden ${g.numRemision} · ${g.destinatario}`;
}

// --- Etiquetas i18n-ready (texto separado de la lógica) ---
const RESULTADO_LABEL: Record<CierreResultado, string> = {
  entregada: "Entregadas",
  reprogramada: "Reprogramadas",
  devuelta: "Devueltas",
  rechazada: "Rechazadas",
  incidente: "Incidentes", // feature 158/R18
};

const RESULTADO_VACIO: Record<CierreResultado, string> = {
  entregada: "No hay entregas.",
  reprogramada: "No hay reprogramaciones.",
  devuelta: "No hay devoluciones.",
  rechazada: "No hay rechazos.",
  incidente: "No hay incidentes.", // feature 158/R18
};

const METODO_LABEL: Record<MetodoPagoValue, string> = {
  efectivo: "Efectivo",
  SINPE: "SINPE",
  transferencia: "Transferencia",
};

const ESTADO_LABEL: Record<CierreEstado, string> = {
  solicitado: "Solicitado",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
  vencido: "Vencido", // feature 41: etiqueta minima; el aviso de bloqueo (R21) lo hace frontend_dev
};

const DESTINO_LABEL: Record<CierreDestinoTipo, string> = {
  bodega_central: "Bodega central",
  bodega_satelite: "Bodega satélite",
};

/**
 * Orden fijo de las secciones (R3). Feature 158/R18: los `incidente` son un grupo PROPIO y
 * van AL FINAL, después de los cuatro desenlaces normales — el mismo criterio que en el paso
 * de resultados del panel del mensajero: no es una forma más de terminar la entrega.
 */
const ORDEN_RESULTADOS: CierreResultado[] = [
  "entregada",
  "reprogramada",
  "devuelta",
  "rechazada",
  "incidente",
];

/**
 * Prefija el símbolo de colón a un monto que YA viene como string (money-safe,
 * R6/R7): NUNCA se parsea a número para no perder precisión. `null` → "—".
 */
function money(value: string | null): string {
  return value === null ? "—" : `₡${value}`;
}

/** Une la jerarquía geográfica en una línea legible (omite los vacíos, R4). */
function ubicacion(g: CierreDetalleGestion): string {
  return [g.zonaNombre, g.provinciaNombre, g.cantonNombre, g.distritoNombre]
    .filter((parte): parte is string => Boolean(parte))
    .join(" · ");
}

export function CierreDiaModule({
  grupos,
  totales,
  totalPagoMensajero,
  puedesSolicitar,
  motivoBloqueo,
  cierresPasados,
  bloqueado,
  tieneVencido,
  tieneRechazado,
}: CierreDiaModuleProps) {
  const router = useRouter();
  const toast = useToast();

  // Confirmación de "Solicitar cierre"; true = modal abierto.
  const [confirmar, setConfirmar] = useState(false);
  // Feature 111/R13: confirmación del CTA del cierre `vencido`; true = modal abierto.
  const [confirmarVencido, setConfirmarVencido] = useState(false);
  // Feature 109/R31: confirmación del CTA del cierre `rechazado`; true = modal abierto.
  const [confirmarRechazado, setConfirmarRechazado] = useState(false);
  // Evidencia (URL firmada, R5) en el visor; null = cerrado.
  const [evidencia, setEvidencia] = useState<string | null>(null);
  // Feature 67/R36: fila pendiente de confirmar el deshacer; null = modal cerrado.
  const [deshacerFila, setDeshacerFila] = useState<CierreDetalleGestion | null>(
    null,
  );
  // Feature 67: gestionId del deshacer EN VUELO; deshabilita el botón de ESA fila
  // (anti-doble-submit en la UI; el WHERE guardado del repo lo cubre igual).
  const [deshaciendo, setDeshaciendo] = useState<string | null>(null);
  // Pedido humano: cierre pasado ABIERTO en el visor de detalle; null = modal cerrado. El
  // detalle se pide bajo demanda (no viaja en las props de la página: son N cierres).
  const [cierreAbierto, setCierreAbierto] = useState<CierrePasadoDTO | null>(null);
  const [detalleGrupos, setDetalleGrupos] = useState<CierreGrupos | null>(null);
  const [detalleError, setDetalleError] = useState<string | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  /** Abre el visor de un cierre pasado y carga su detalle (solo lectura). */
  async function abrirDetalle(cierre: CierrePasadoDTO) {
    setCierreAbierto(cierre);
    setDetalleGrupos(null);
    setDetalleError(null);
    setCargandoDetalle(true);
    try {
      const result = await verCierrePasado({ cierreId: cierre.cierreId });
      if (result.status === "ok") {
        setDetalleGrupos(result.grupos);
        return;
      }
      // `no_encontrada` = el cierre ya no existe o no es suyo (no se distinguen, igual que
      // en el servidor); el resto son fallos de borde y comparten mensaje accionable.
      setDetalleError(
        result.status === "no_encontrada" ? DETALLE_NO_ENCONTRADA : DETALLE_ERROR,
      );
    } finally {
      setCargandoDetalle(false);
    }
  }

  /**
   * Feature 37 + 111/R13 + 109/R31: envía el cierre. Un mismo camino sirve para
   * "Solicitar cierre" (crea) y los CTA de re-solicitud del `vencido`/`rechazado`
   * (transiciones vencido→solicitado / rechazado→solicitado): el backend enruta según
   * el estado abierto del mensajero. El toast distingue por `via` (P2). Cierra los tres
   * modales pase lo que pase.
   */
  async function confirmarSolicitud() {
    const result = await solicitarCierre();
    if (result.status === "ok") {
      toast.success(
        result.via === "vencido_solicitado"
          ? VENCIDO_OK
          : result.via === "rechazado_solicitado"
            ? RECHAZADO_OK
            : "Cierre solicitado correctamente.",
      );
      setConfirmar(false);
      setConfirmarVencido(false);
      setConfirmarRechazado(false);
      router.refresh();
      return;
    }
    const mensaje =
      result.status === "conflict" || result.status === "validation_error"
        ? mensajeError(result, "No se pudo solicitar el cierre.")
        : result.status === "forbidden"
          ? "No tenés permiso para solicitar el cierre."
          : "No se pudo solicitar el cierre. Intentá de nuevo.";
    toast.error(mensaje);
    setConfirmar(false);
    setConfirmarVencido(false);
    setConfirmarRechazado(false);
  }

  /**
   * Feature 67/R36-R38: ejecuta el deshacer ya confirmado. `ok` → toast + `router.refresh()`
   * (R37: la vista releé el estado del SERVIDOR; la fila desaparece y los totales se
   * recalculan allá, nunca se mutan acá). Error → toast accionable y NI la tabla NI los
   * totales se tocan (R38): no hay refresh y las filas siguen siendo las props del padre.
   */
  async function confirmarDeshacer() {
    const fila = deshacerFila;
    if (!fila) return;
    setDeshaciendo(fila.gestionId);
    const result = await deshacerGestion({ gestionId: fila.gestionId });
    if (result.status === "ok") {
      toast.success(DESHACER_OK);
      setDeshacerFila(null);
      // `deshaciendo` NO se limpia: la fila se va con el refresh y su botón se
      // desmonta; re-habilitarlo solo abriría la ventana a un segundo envío que el
      // server rechazaría con "esta gestión ya fue deshecha" (R3).
      router.refresh();
      return;
    }
    const mensaje =
      result.status === "conflict" || result.status === "validation_error"
        ? // R38: el `motivo` del conflict YA viene accionable del server (no se reescribe acá).
          mensajeError(result, DESHACER_ERROR)
        : result.status === "forbidden"
          ? DESHACER_FORBIDDEN
          : DESHACER_ERROR;
    toast.error(mensaje);
    setDeshaciendo(null);
    setDeshacerFila(null);
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ---------- Aviso de bloqueo TOTAL del mensajero (feature 41/R21 + 111/R12) ---------- */}
      {bloqueado ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {BLOQUEO_AVISO}
        </p>
      ) : null}

      {/* ---------- CTA del cierre vencido (feature 111/R13) ----------
          Se ofrece SIEMPRE que haya un `vencido`, con INDEPENDENCIA del gate de
          creación (`puedesSolicitar`): solicitar el vencido es la vía para destrabar
          la operación. Llama a la MISMA action `solicitarCierre()`; el backend la
          enruta a la transición vencido→solicitado. */}
      {tieneVencido ? (
        <section
          aria-label="Cierre vencido"
          className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3"
        >
          <p className="text-sm text-destructive">{VENCIDO_AVISO}</p>
          <Button
            type="button"
            variant="destructive"
            className="w-fit"
            onClick={() => setConfirmarVencido(true)}
          >
            {VENCIDO_CTA_LABEL}
          </Button>
        </section>
      ) : null}

      {/* ---------- CTA del cierre rechazado (feature 109/R31) ----------
          Mismo patrón que el `vencido` (mismo action `solicitarCierre()` → el backend
          enruta a la transición rechazado→solicitado). Se ofrece SIEMPRE que haya un
          `rechazado`, con INDEPENDENCIA del gate de creación (`puedesSolicitar`). El copy
          comunica que un `rechazado` NO es terminal: bloquea hasta re-solicitar + aprobar. */}
      {tieneRechazado ? (
        <section
          aria-label="Cierre rechazado"
          className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3"
        >
          <p className="text-sm text-destructive">{RECHAZADO_AVISO}</p>
          <Button
            type="button"
            variant="destructive"
            className="w-fit"
            onClick={() => setConfirmarRechazado(true)}
          >
            {RECHAZADO_CTA_LABEL}
          </Button>
        </section>
      ) : null}

      {/* ---------- Panel de totales por método de pago (R7) ---------- */}
      <section aria-label="Totales del día" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Totales del día</h2>
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
            <TotalItem label="Efectivo" value={money(totales.efectivo)} />
            <TotalItem label="SINPE" value={money(totales.simpe)} />
            <TotalItem
              label="Transferencia"
              value={money(totales.transferencia)}
            />
            <TotalItem label="Total general" value={money(totales.general)} emphasis />
          </CardContent>
        </Card>
      </section>

      {/* ---------- Ganancia (R11): total SEPARADO del dinero recibido ---------- */}
      <section aria-label={PAGO_MENSAJERO_LABEL} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{PAGO_MENSAJERO_LABEL}</h2>
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <span className="text-sm font-medium text-muted-foreground">
              Total de ganancia
            </span>
            <span className="text-lg font-semibold">
              {money(totalPagoMensajero)}
            </span>
          </CardContent>
        </Card>
      </section>

      {/* ---------- Secciones por resultado (R3/R4/R5/R6) ---------- */}
      {ORDEN_RESULTADOS.map((resultado) => {
        const filas = grupos[resultado] ?? [];
        // Pedido: no mostrar las secciones sin registros (p. ej. reprogramadas con 0).
        if (filas.length === 0) return null;
        return (
          <section
            key={resultado}
            aria-label={RESULTADO_LABEL[resultado]}
            className="flex flex-col gap-3"
          >
            <h2 className="text-lg font-semibold">
              {RESULTADO_LABEL[resultado]}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({filas.length})
              </span>
            </h2>
            <div className="overflow-x-auto">
              <DataTable
                columns={columnasPara(
                  resultado,
                  setEvidencia,
                  setDeshacerFila,
                  deshaciendo,
                )}
                data={filas}
                rowKey="gestionId"
                ariaLabel={RESULTADO_LABEL[resultado]}
                emptyMessage={RESULTADO_VACIO[resultado]}
              />
            </div>
          </section>
        );
      })}

      {/* ---------- Solicitar cierre (R10/R11) ---------- */}
      <section aria-label="Solicitar cierre" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={() => setConfirmar(true)}
            disabled={!puedesSolicitar}
            title={!puedesSolicitar ? motivoBloqueo ?? undefined : undefined}
            aria-describedby={
              !puedesSolicitar && motivoBloqueo ? "motivo-bloqueo" : undefined
            }
          >
            Solicitar cierre
          </Button>
        </div>
        {!puedesSolicitar && motivoBloqueo ? (
          <p
            id="motivo-bloqueo"
            role="note"
            className="text-sm text-muted-foreground"
          >
            {motivoBloqueo}
          </p>
        ) : null}
      </section>

      {/* ---------- Cierres solicitados (histórico, solo lectura, R18) ---------- */}
      <section aria-label="Cierres solicitados" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Cierres solicitados</h2>
        <div className="overflow-x-auto">
          <DataTable
            columns={columnasPasados(abrirDetalle)}
            data={cierresPasados}
            rowKey="cierreId"
            ariaLabel="Cierres solicitados"
            emptyMessage="Aún no has solicitado ningún cierre."
          />
        </div>
      </section>

      {/* Confirmación de "Solicitar cierre". */}
      <Modal
        open={confirmar}
        onOpenChange={setConfirmar}
        title="Solicitar cierre del día"
        description="Se agruparán todas tus gestiones pendientes en una solicitud de cierre. Esta acción no se puede deshacer."
        confirmLabel="Solicitar cierre"
        onConfirm={confirmarSolicitud}
        closeOnConfirm={false}
      />

      {/* Feature 111/R13: confirmación del CTA del cierre vencido (differente del
          "Solicitar cierre" del día). Misma action; el backend transiciona el vencido. */}
      <Modal
        open={confirmarVencido}
        onOpenChange={setConfirmarVencido}
        title={VENCIDO_CONFIRM_TITULO}
        description={VENCIDO_CONFIRM_DETALLE}
        confirmLabel="Solicitar aprobación"
        onConfirm={confirmarSolicitud}
        closeOnConfirm={false}
      />

      {/* Feature 109/R31: confirmación del CTA del cierre rechazado (espejo del vencido).
          Misma action; el backend transiciona rechazado→solicitado. */}
      <Modal
        open={confirmarRechazado}
        onOpenChange={setConfirmarRechazado}
        title={RECHAZADO_CONFIRM_TITULO}
        description={RECHAZADO_CONFIRM_DETALLE}
        confirmLabel="Solicitar aprobación"
        onConfirm={confirmarSolicitud}
        closeOnConfirm={false}
      />

      {/* Feature 67/R36: confirmación explícita del deshacer (una sola por módulo,
          parametrizada con la fila elegida: el Modal ya es un focus-trap accesible). */}
      <Modal
        open={deshacerFila !== null}
        onOpenChange={(next) => {
          if (!next) setDeshacerFila(null);
        }}
        title={DESHACER_TITULO}
        description={
          deshacerFila
            ? `Orden ${deshacerFila.numRemision} · ${deshacerFila.destinatario}. ${DESHACER_DETALLE}`
            : undefined
        }
        confirmLabel={DESHACER_LABEL}
        onConfirm={confirmarDeshacer}
        closeOnConfirm={false}
      />

      {/* Pedido humano: visor SOLO LECTURA del detalle de un cierre pasado. Mismas secciones
          por resultado que la vista del día, sin la columna de acciones: un cierre ya
          solicitado no se deshace desde aquí. */}
      <Modal
        open={cierreAbierto !== null}
        onOpenChange={(next) => {
          if (!next) setCierreAbierto(null);
        }}
        title={DETALLE_TITULO}
        description={
          cierreAbierto
            ? `${ESTADO_LABEL[cierreAbierto.estado]} · ${cierreAbierto.solicitadoAt.slice(0, 10)} · ${DESTINO_LABEL[cierreAbierto.destinoTipo]}`
            : undefined
        }
        confirmLabel="Cerrar"
        hideCancel
        onConfirm={() => setCierreAbierto(null)}
      >
        {cierreAbierto ? (
          <div className="flex flex-col gap-4">
            {cargandoDetalle ? (
              <p role="status" className="text-sm text-muted-foreground">
                {DETALLE_CARGANDO}
              </p>
            ) : null}
            {detalleError ? (
              <p role="alert" className="text-sm text-destructive">
                {detalleError}
              </p>
            ) : null}
            {detalleGrupos ? (
              <>
                {/* MISMO comprobante que usa el admin (`CierreFacturaDetalle`), en su
                    variante `mensajero`: sin el ingreso de Ordenex ni la liquidación (no es
                    plata suya, design §7.2) y con lo recibido + su pago en los renglones. */}
                <CierreFacturaDetalle
                  audiencia="mensajero"
                  cierre={{
                    cierreId: cierreAbierto.cierreId,
                    estado: cierreAbierto.estado,
                    destinoTipo: cierreAbierto.destinoTipo,
                    totales: cierreAbierto.totales,
                    totalPagoMensajero: cierreAbierto.totalPagoMensajero,
                    totalIngresoBodegaRechazos:
                      cierreAbierto.totalIngresoBodegaRechazos,
                    solicitadoAt: cierreAbierto.solicitadoAt,
                    resueltoAt: cierreAbierto.resueltoAt ?? null,
                    motivoRechazo: cierreAbierto.motivoRechazo ?? null,
                  }}
                  grupos={detalleGrupos}
                  onVerEvidencia={setEvidencia}
                />
                <p role="note" className="text-xs text-muted-foreground">
                  {DETALLE_NOTA}
                </p>
              </>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* Visor de evidencia (URL firmada, R5). */}
      <Modal
        open={evidencia !== null}
        onOpenChange={(next) => {
          if (!next) setEvidencia(null);
        }}
        title="Evidencia de la gestión"
        confirmLabel="Cerrar"
        hideCancel
        onConfirm={() => setEvidencia(null)}
      >
        {evidencia ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={evidencia}
            alt="Evidencia fotográfica de la gestión"
            className="max-h-[60vh] w-full rounded-md object-contain"
          />
        ) : null}
      </Modal>
    </div>
  );
}

/**
 * Devuelve el mensaje accionable de un resultado de dominio de error. El `motivo` de un
 * `conflict` lo redacta el SERVER (ya es accionable): acá no se reescribe. `fallback` es
 * el texto de la operación que llama, para el caso degenerado de `fieldErrors` vacío.
 */
function mensajeError(
  result:
    | { status: "conflict"; motivo: string }
    | { status: "validation_error"; fieldErrors: Record<string, string[]> },
  fallback: string,
): string {
  if (result.status === "conflict") return result.motivo;
  const primero = Object.values(result.fieldErrors)[0]?.[0];
  return primero ?? fallback;
}

/** Ítem del panel de totales. */
function TotalItem({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={
          emphasis ? "text-lg font-semibold" : "text-base font-medium"
        }
      >
        {value}
      </span>
    </div>
  );
}

// --- Columnas comunes a TODAS las secciones (R4; feature 158: tambien al grupo `incidente`) ---
const COLUMNAS_COMUNES: Column<CierreDetalleGestion>[] = [
  {
    id: "numGuia",
    value: "Nº Guía",
    render: (g) => g.numGuia ?? "—",
  },
  { id: "numRemision", value: "Nº Remisión" },
  { id: "destinatario", value: "Destinatario" },
  { id: "direccion", value: "Dirección", render: (g) => g.direccion ?? "—" },
  { id: "ubicacion", value: "Ubicación", render: (g) => ubicacion(g) || "—" },
  { id: "producto", value: "Producto" },
  { id: "tiendaNombre", value: "Tienda" },
];

/**
 * Construye las columnas de una sección: las comunes (R4) + las específicas del
 * resultado (monto+método si entregada R6; fecha+motivo si reprogramada; motivo
 * si devuelta; motivo+evidencia si rechazada, R5) + la de acciones (67/R35). El
 * setter del visor de evidencia se inyecta para la columna de la sección
 * "Rechazadas"; el del deshacer, para la columna de acciones de las 4.
 */
function columnasPara(
  resultado: CierreResultado,
  verEvidencia: (url: string) => void,
  pedirDeshacer: (g: CierreDetalleGestion) => void,
  deshaciendo: string | null,
): Column<CierreDetalleGestion>[] {
  // Feature 39/R10: pago al mensajero DERIVADO por orden (money-safe STRING, tal cual).
  const columnaPago: Column<CierreDetalleGestion> = {
    id: "pagoMensajero",
    value: PAGO_MENSAJERO_COL,
    render: (g) => money(g.pagoMensajero),
  };
  // Feature 67/R35: "Devolver a gestión" por fila, en todas las tablas — feature 158/Q-D:
  // tambien en la del `incidente`, que SI se puede deshacer. NO hay estado
  // "no deshacible" que pintar: la vista solo lista gestiones dentro de la ventana
  // (`findGestionesPendientes` filtra `cierre_id IS NULL` + `anulada_at IS NULL`) y
  // son todas del actor (`/cierre-dia` es exclusivo del mensajero dueño, `page.tsx`
  // hace `notFound()` para el resto). Una gestión que sale de la ventana desaparece
  // de la tabla; una carrera la corta el server con `conflict` + motivo (R38).
  const columnaAcciones: Column<CierreDetalleGestion> = {
    id: "acciones",
    value: DESHACER_COL,
    render: (g) => (
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={deshacerAriaLabel(g)}
        disabled={deshaciendo === g.gestionId}
        onClick={() => pedirDeshacer(g)}
      >
        {DESHACER_LABEL}
      </Button>
    ),
  };
  if (resultado === "entregada") {
    return [
      ...COLUMNAS_COMUNES,
      { id: "monto", value: "Monto", render: (g) => money(g.montoRecibido) },
      {
        id: "metodo",
        value: "Método",
        render: (g) => (g.metodoPago ? METODO_LABEL[g.metodoPago] : "—"),
      },
      columnaPago,
      columnaAcciones,
    ];
  }
  if (resultado === "reprogramada") {
    return [
      ...COLUMNAS_COMUNES,
      {
        id: "fechaReprogramacion",
        value: "Nueva fecha",
        render: (g) => g.fechaReprogramacion ?? "—",
      },
      { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
      columnaPago,
      columnaAcciones,
    ];
  }
  if (resultado === "devuelta") {
    return [
      ...COLUMNAS_COMUNES,
      { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
      columnaPago,
      columnaAcciones,
    ];
  }
  // Feature 158/R17/R18: el `incidente` es un grupo PROPIO y NO lleva NINGUNA columna de
  // dinero — ni pago al mensajero (un incidente no se paga) ni el monto de la indemnización
  // (es plata que se le paga a la tienda, no al mensajero: no es suya y no la ve, design §7.2).
  // El backend lo garantiza en la CONSULTA: `WITH_DETALLE` ni siquiera selecciona la columna,
  // así que aquí `indemnizacion` es SIEMPRE `null` y no hay monto que pintar.
  //
  // La CAUSA sí llega y sí se muestra: es el hecho que el propio mensajero reportó, no dinero.
  // Sin esta columna, el `select` que el backend puso a propósito no lo vería nadie.
  //
  // Sí conserva la columna de acciones: un `incidente` SE PUEDE deshacer mientras no esté
  // vinculado a un cierre (Q-D/R14), por la misma vía que el resto de resultados.
  if (resultado === "incidente") {
    return [
      ...COLUMNAS_COMUNES,
      COLUMNA_CAUSA_INCIDENTE,
      { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
      columnaEvidencia(verEvidencia),
      columnaAcciones,
    ];
  }
  // rechazada: motivo + evidencia firmada (R5)
  return [
    ...COLUMNAS_COMUNES,
    { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
    columnaEvidencia(verEvidencia),
    columnaPago,
    columnaAcciones,
  ];
}

/**
 * Columna de la evidencia FIRMADA (R5), compartida por `rechazada` y `incidente` (158/R18):
 * abre el visor con la URL que ya viene firmada del servidor, nunca el storage_path crudo.
 */
function columnaEvidencia(
  verEvidencia: (url: string) => void,
): Column<CierreDetalleGestion> {
  return {
    id: "evidencia",
    value: "Evidencia",
    render: (g) =>
      g.evidenciaUrl ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => verEvidencia(g.evidenciaUrl as string)}
        >
          Ver evidencia
        </Button>
      ) : (
        "—"
      ),
  };
}

// --- Columnas del histórico de cierres (R18) ---
/**
 * Pedido humano: el histórico ya no es solo una fila de totales — cada cierre se puede ABRIR
 * y ver su detalle (las mismas gestiones agrupadas por resultado que se veían el día que se
 * solicitó, con los montos ya congelados). La columna se construye con el handler inyectado,
 * como las de evidencia/deshacer de las tablas del día.
 */
function columnasPasados(
  verDetalle: (cierre: CierrePasadoDTO) => void,
): Column<CierrePasadoDTO>[] {
  return [
    ...COLUMNAS_PASADOS,
    {
      id: "detalle",
      value: VER_DETALLE_COL,
      render: (c) => (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`${VER_DETALLE_LABEL} del cierre del ${c.solicitadoAt.slice(0, 10)}`}
          onClick={() => verDetalle(c)}
        >
          {VER_DETALLE_LABEL}
        </Button>
      ),
    },
  ];
}

const COLUMNAS_PASADOS: Column<CierrePasadoDTO>[] = [
  {
    id: "estado",
    value: "Estado",
    render: (c) => ESTADO_LABEL[c.estado],
  },
  {
    id: "destino",
    value: "Destino",
    render: (c) => DESTINO_LABEL[c.destinoTipo],
  },
  {
    id: "efectivo",
    value: "Efectivo",
    render: (c) => money(c.totales.efectivo),
  },
  { id: "simpe", value: "SINPE", render: (c) => money(c.totales.simpe) },
  {
    id: "transferencia",
    value: "Transferencia",
    render: (c) => money(c.totales.transferencia),
  },
  {
    id: "general",
    value: "Total",
    render: (c) => money(c.totales.general),
  },
  {
    id: "pagoMensajero",
    value: PAGO_MENSAJERO_COL,
    render: (c) => money(c.totalPagoMensajero),
  },
  {
    id: "solicitadoAt",
    value: "Fecha",
    render: (c) => c.solicitadoAt.slice(0, 10),
  },
];

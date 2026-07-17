"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MetodoPagoValue } from "@prisma/client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared/Modal";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { useToast } from "@/hooks/useToast";
import { deshacerGestion, solicitarCierre } from "@/lib/actions/cierre-dia";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreTotales,
  CierrePasadoDTO,
  CierreResultado,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreEstado, CierreDestinoTipo } from "@/lib/types/cierre";

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
   * `solicitado`/`vencido` pendiente) para recibir nuevas asignaciones. Derivado
   * server-side y pasado por props; el módulo solo muestra el aviso accionable.
   */
  bloqueado: boolean;
}

// Feature 41/R21: aviso accionable de bloqueo (texto separado, i18n-ready).
const BLOQUEO_AVISO =
  "No puedes recibir nuevas asignaciones hasta que tu cierre pendiente sea resuelto por tu bodega.";

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
};

const RESULTADO_VACIO: Record<CierreResultado, string> = {
  entregada: "No hay entregas.",
  reprogramada: "No hay reprogramaciones.",
  devuelta: "No hay devoluciones.",
  rechazada: "No hay rechazos.",
};

const METODO_LABEL: Record<MetodoPagoValue, string> = {
  efectivo: "Efectivo",
  SIMPE: "SIMPE",
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

/** Orden fijo de las 4 secciones (R3). */
const ORDEN_RESULTADOS: CierreResultado[] = [
  "entregada",
  "reprogramada",
  "devuelta",
  "rechazada",
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
}: CierreDiaModuleProps) {
  const router = useRouter();
  const toast = useToast();

  // Confirmación de "Solicitar cierre"; true = modal abierto.
  const [confirmar, setConfirmar] = useState(false);
  // Evidencia (URL firmada, R5) en el visor; null = cerrado.
  const [evidencia, setEvidencia] = useState<string | null>(null);
  // Feature 67/R36: fila pendiente de confirmar el deshacer; null = modal cerrado.
  const [deshacerFila, setDeshacerFila] = useState<CierreDetalleGestion | null>(
    null,
  );
  // Feature 67: gestionId del deshacer EN VUELO; deshabilita el botón de ESA fila
  // (anti-doble-submit en la UI; el WHERE guardado del repo lo cubre igual).
  const [deshaciendo, setDeshaciendo] = useState<string | null>(null);

  async function confirmarSolicitud() {
    const result = await solicitarCierre();
    if (result.status === "ok") {
      toast.success("Cierre solicitado correctamente.");
      setConfirmar(false);
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
      {/* ---------- Aviso de bloqueo del mensajero (feature 41/R21) ---------- */}
      {bloqueado ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {BLOQUEO_AVISO}
        </p>
      ) : null}

      {/* ---------- Panel de totales por método de pago (R7) ---------- */}
      <section aria-label="Totales del día" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Totales del día</h2>
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
            <TotalItem label="Efectivo" value={money(totales.efectivo)} />
            <TotalItem label="SIMPE" value={money(totales.simpe)} />
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
            columns={COLUMNAS_PASADOS}
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

// --- Columnas comunes a las 4 secciones (R4) ---
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
  // Feature 67/R35: "Devolver a gestión" por fila, en las 4 tablas. NO hay estado
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
  // rechazada: motivo + evidencia firmada (R5)
  return [
    ...COLUMNAS_COMUNES,
    { id: "motivo", value: "Motivo", render: (g) => g.motivo ?? "—" },
    {
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
    },
    columnaPago,
    columnaAcciones,
  ];
}

// --- Columnas del histórico de cierres (R18) ---
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
  { id: "simpe", value: "SIMPE", render: (c) => money(c.totales.simpe) },
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

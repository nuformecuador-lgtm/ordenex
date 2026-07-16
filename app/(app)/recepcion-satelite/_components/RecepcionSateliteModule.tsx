"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { BodegaLiberadasHoy } from "@/components/private/BodegaLiberadasHoy";
import { PorAceptarSection } from "@/app/(app)/_components/PorAceptarSection";
import { useToast } from "@/hooks/useToast";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { LiberadaHoyRow } from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";

import { devolverATienda } from "@/lib/actions/devolucion-origen";
import { recibirLote } from "@/lib/actions/recepcion-satelite";

import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { devolucionOrigenErrorMessage } from "@/app/(app)/ordenes/_components/devolucion-origen-error-messages";
import { EscanerRecepcion } from "./EscanerRecepcion";
import { RecepcionDetalle } from "./RecepcionDetalle";
import { recibidasColumns } from "./recibidas-columns";
import { AsignarSateliteModal } from "./AsignarSateliteModal";
import {
  BODEGA_BLOQUEADA_TITULO,
  BODEGA_CIERRES_ABIERTOS_DETALLE,
  bodegaBloqueadaLineas,
  bodegaCierresAbiertosTitulo,
  type BodegaBloqueoCausa,
} from "./asignacion-satelite-bloqueo";

// Feature 33 (T12, R6/R7/R8/R9): módulo de la bodega satélite. Recibe los DOS
// grupos ya resueltos por el Server Component padre (datos sensibles por props,
// sin fetch de cliente) y el nombre de la zona / `sinZona`. La ÚNICA acción del
// módulo es la recepción por escaneo (R7: "Por recibir" NO expone asignar ni
// gestionar). Tras cada recepción exitosa se refresca la ruta para releer el
// estado del servidor.

export interface RecepcionSateliteModuleProps {
  /** Órdenes en `en_ruta_bodega_satelite` de la zona del adminSatelite. */
  porRecibir: RecepcionSateliteDTO[];
  /** Órdenes ya en `en_bodega_satelite` de la zona (base de la feature 34). */
  recibidas: RecepcionSateliteDTO[];
  /**
   * Feature 48/T9 (R10/R14): órdenes en `rechazada` de la zona del adminSatelite,
   * elegibles para la acción "Devolver a la tienda" (transición
   * `rechazada → devuelta_origen`). Acotadas server-side por zona; vacío = sin
   * órdenes por devolver.
   */
  porDevolver?: RecepcionSateliteDTO[];
  /** Nombre de la zona del adminSatelite (para el display, R9); `null` si no tiene. */
  zonaNombre: string | null;
  /** `true` si el adminSatelite no tiene zona asignada (R5). */
  sinZona: boolean;
  /**
   * Feature 34 (T8/R5): mensajeros de la zona del adminSatelite para el modal de
   * asignación (ya scoped server-side; el módulo no fetchea datos sensibles).
   */
  mensajeros: { id: string; nombre: string }[];
  /**
   * Feature 41 (R22) + ajuste admin_satelite: bloqueo DERIVADO server-side de la bodega
   * satélite. Si `bloqueada` (todos los mensajeros con cierre O CierreBodega pendiente),
   * se muestra el aviso de bloqueo y se deshabilita "Asignar". Si NO está bloqueada pero
   * `cierresAbiertos > 0`, se muestra un aviso INFORMATIVO (no bloqueante) y se puede
   * seguir asignando a los mensajeros sin cierre. `mensajerosConCierreIds` deshabilita a
   * esos mensajeros en el selector del modal.
   */
  bloqueoBodega: BodegaBloqueoCausa & {
    bloqueada: boolean;
    cierresAbiertos?: number;
    totalMensajeros?: number;
    mensajerosConCierreIds?: string[];
  };
  /**
   * Feature 46 (R15/R16): órdenes liberadas HOY (CR) por el cron para esta bodega
   * satélite (`en_bodega_satelite`), pre-resueltas server-side. Alimentan el aviso
   * derivado "Liberadas hoy (reprogramación)". Vacío = sin aviso.
   */
  liberadasHoy?: LiberadaHoyRow[];
}

/**
 * Estado legible "en bodega satélite de <zona>" (R9): deriva del `estatusValue`
 * (etiqueta de `estatusLabel`) y del nombre de zona de la orden.
 */
function estadoLegible(orden: RecepcionSateliteDTO, zonaNombre: string | null): string {
  const base = estatusLabel(orden.estatusValue);
  const zona = orden.zonaNombre || zonaNombre;
  return zona ? `${base} de ${zona}` : base;
}

/**
 * Feature 48 (T9, R10/R14): fila de la sección "Por devolver a tienda". Cada orden
 * `rechazada` de la zona ofrece la acción "Devolver a la tienda", que ejecuta el
 * retorno `rechazada → devuelta_origen` vía la Server Action `devolverATienda`. El
 * estado de carga y el error son POR FILA (aislados): el botón se deshabilita
 * mientras procesa y un `status != ok` muestra el aviso sin afectar a las demás
 * filas. En éxito, el padre releé el estado del servidor (`router.refresh`).
 */
function FilaPorDevolver({
  orden,
  zonaNombre,
  onDevuelta,
}: {
  orden: RecepcionSateliteDTO;
  zonaNombre: string | null;
  onDevuelta: () => void;
}) {
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDevolver() {
    setProcesando(true);
    setError(null);
    const result = await devolverATienda({ ordenId: orden.id });
    if (result.status !== "ok") {
      setError(devolucionOrigenErrorMessage(result.status));
      setProcesando(false);
      return;
    }
    onDevuelta(); // relee el estado del servidor; la fila desaparece del listado
  }

  return (
    <li className="flex flex-col gap-2">
      <Card>
        <CardHeader>
          <CardTitle>
            {orden.numRemision} · {orden.destinatario}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <RecepcionDetalle
            orden={orden}
            estadoLegible={estadoLegible(orden, zonaNombre)}
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleDevolver}
              disabled={procesando}
            >
              {procesando ? "Devolviendo…" : "Devolver a bodega central"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

export function RecepcionSateliteModule({
  porRecibir,
  recibidas,
  porDevolver = [],
  zonaNombre,
  sinZona,
  mensajeros,
  bloqueoBodega,
  liberadasHoy = [],
}: RecepcionSateliteModuleProps) {
  const router = useRouter();
  const toast = useToast();
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);

  // Feature 63: recepción EN LOTE ("Aceptar todas" / "Aceptar" por-orden), análoga
  // al "Recoger" del mensajero. Cablea la Server Action `recibirLote`; tras éxito
  // releé el estado del servidor (patrón feature 33) y da feedback por toast.
  async function aceptarRecepcion(ordenIds: string[]) {
    if (ordenIds.length === 0) return;
    const result = await recibirLote({ ordenIds });
    if (result.status === "ok") {
      toast.success(`${result.recibidas} orden(es) recibida(s).`);
      router.refresh();
      return;
    }
    toast.error(
      result.status === "sin_zona"
        ? "No tienes una zona asignada para recibir órdenes."
        : "No se pudieron recibir las órdenes.",
    );
  }

  function toggleSeleccion(id: string, checked: boolean) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // Snapshot de las órdenes seleccionadas (por id, filtrando las que sigan en la
  // lista actual) para pasarlas al modal de asignación.
  const ordenesSeleccionadas = useMemo(
    () => recibidas.filter((orden) => seleccionados.has(orden.id)),
    [recibidas, seleccionados],
  );

  // Feature 63 (pedido humano): "Recibidas" pasa de cards a DataTable. La columna
  // inicial "Seleccionar" se compone aquí (fuente de verdad de la selección, R4),
  // igual que `OrdenesApartado` prepende su checkbox a `ordenesColumns`. Las
  // columnas de datos viven en `recibidas-columns.tsx`.
  const columnasRecibidas = useMemo<Column<RecepcionSateliteDTO>[]>(
    () => [
      {
        id: "seleccionar",
        value: "Seleccionar",
        render: (orden: RecepcionSateliteDTO) => (
          <Checkbox
            checked={seleccionados.has(orden.id)}
            onCheckedChange={(checked) =>
              toggleSeleccion(orden.id, checked === true)
            }
            aria-label={`Seleccionar ${orden.numRemision}`}
          />
        ),
      },
      ...recibidasColumns(zonaNombre),
    ],
    [seleccionados, zonaNombre],
  );

  function handleSuccess() {
    setSeleccionados(new Set());
    setModalOpen(false);
    router.refresh(); // relee el estado del servidor (patrón feature 33)
  }

  return (
    <div className="flex flex-col gap-8">
      {/* R5: aviso accionable si el adminSatelite no tiene zona asignada. */}
      {sinZona ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          No tienes una zona asignada. Pide a un administrador que te asigne una
          zona para poder recibir órdenes.
        </p>
      ) : (
        <EscanerRecepcion onRecibida={() => router.refresh()} />
      )}

      {/* ---------- Sección: Por recibir (en_ruta_bodega_satelite) ---------- */}
      {/* Feature 63: REUTILIZA la sección compartida "por aceptar" del mensajero:
          banner con contador de nuevas + "Aceptar todas" (lote -> recibirLote con
          todos los ids) + "Aceptar" por-orden (recibirLote con uno). Sin zona no se
          muestran los botones (solo se listan). Escáner QR y demás secciones intactos. */}
      <PorAceptarSection
        titulo="Por recibir"
        nuevasLabel={(n) => `${n} Órdenes nuevas por recibir`}
        ordenes={porRecibir}
        onAceptarTodas={(ids) => void aceptarRecepcion(ids)}
        onAceptarUna={(id) => void aceptarRecepcion([id])}
        textoBotonTodas="Aceptar todas"
        textoBotonUna="Aceptar"
        vacio="No hay órdenes por recibir."
        mostrarAcciones={!sinZona}
        renderDetalle={(orden) => (
          <RecepcionDetalle
            orden={orden}
            estadoLegible={estadoLegible(orden, zonaNombre)}
          />
        )}
      />

      {/* ---------- Sección: Recibidas (en_bodega_satelite) ---------- */}
      {/* Feature 34 (R4): lista seleccionable + acción "Asignar". */}
      <section
        aria-label="Recibidas"
        className="flex flex-col gap-3 border-t pt-6"
      >
        {/* Feature 41 (R22): aviso de bodega BLOQUEADA con causa diferenciada (bloqueo
            duro: todos los mensajeros con cierre O CierreBodega pendiente). */}
        {bloqueoBodega.bloqueada ? (
          <div
            role="alert"
            className="flex flex-col gap-1 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <span className="font-medium">{BODEGA_BLOQUEADA_TITULO}</span>
            <ul className="list-disc pl-5">
              {bodegaBloqueadaLineas(bloqueoBodega).map((linea) => (
                <li key={linea}>{linea}</li>
              ))}
            </ul>
          </div>
        ) : (bloqueoBodega.cierresAbiertos ?? 0) > 0 ? (
          /* Ajuste admin_satelite: aviso INFORMATIVO (no bloqueante) cuando algunos —no
             todos— los mensajeros tienen un cierre abierto. La asignación sigue activa. */
          <div
            role="status"
            className="flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400"
          >
            <span className="font-medium">
              {bodegaCierresAbiertosTitulo(bloqueoBodega.cierresAbiertos ?? 0)}
            </span>
            <span>{BODEGA_CIERRES_ABIERTOS_DETALLE}</span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Recibidas</h2>
          <Button
            type="button"
            onClick={() => setModalOpen(true)}
            disabled={
              ordenesSeleccionadas.length === 0 || bloqueoBodega.bloqueada
            }
          >
            Asignar
          </Button>
        </div>
        <DataTable
          columns={columnasRecibidas}
          data={recibidas}
          rowKey="id"
          ariaLabel="Recibidas"
          emptyMessage="Aún no has recibido órdenes."
        />
      </section>

      {/* ---------- Sección: Por devolver a tienda (rechazada) ---------- */}
      {/* Feature 48 (R10/R14): órdenes `rechazada` de la zona; cada una ofrece
          "Devolver a la tienda" (rechazada → devuelta_origen) con estado/error por
          fila. Tras el éxito se releé el estado del servidor. */}
      <section
        aria-label="Por devolver a bodega central"
        className="flex flex-col gap-3 border-t pt-6"
      >
        <h2 className="text-lg font-semibold">Por devolver a bodega central</h2>
        {porDevolver.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay órdenes por devolver.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {porDevolver.map((orden) => (
              <FilaPorDevolver
                key={orden.id}
                orden={orden}
                zonaNombre={zonaNombre}
                onDevuelta={() => router.refresh()}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Feature 46 (R15/R16): aviso derivado "Liberadas hoy (reprogramación)" de la
          bodega satélite (en_bodega_satelite). Datos por props; se oculta si no hay. */}
      <BodegaLiberadasHoy liberadas={liberadasHoy} />

      <AsignarSateliteModal
        open={modalOpen}
        ordenes={ordenesSeleccionadas}
        mensajeros={mensajeros}
        mensajerosBloqueadosIds={bloqueoBodega.mensajerosConCierreIds ?? []}
        onOpenChange={setModalOpen}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

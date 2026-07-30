"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Column } from "@/components/shared/DataTable";
import {
  conBadgePrioridad,
  resaltarFilaPrioridad,
} from "@/components/shared/PrioridadResalte";
import { SelectAllCheckbox } from "@/components/shared/SelectAllCheckbox";
import { DescargarManifiestoButton } from "@/components/shared/DescargarManifiestoButton";
import { BodegaLiberadasHoy } from "@/components/private/BodegaLiberadasHoy";
import { PorAceptarSection } from "@/app/(app)/_components/PorAceptarSection";
import { useToast } from "@/hooks/useToast";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { LiberadaHoyRow } from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";

import { enviarACentral } from "@/lib/actions/envio-devolucion-central";
import { recibirLote } from "@/lib/actions/recepcion-satelite";
import { recuperarABodega } from "@/lib/actions/resolver-novedad";

import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { envioDevolucionCentralErrorMessage } from "@/app/(app)/ordenes/_components/envio-devolucion-central-error-messages";
import { recuperarBodegaErrorMessage } from "@/app/(app)/ordenes/_components/recuperar-bodega-error-messages";
// Feature 158 (T2.7, decisión del humano del 2026-07-30): el reporte de incidente también
// vive aquí. Se IMPORTA el mismo disparador y el mismo modal de `/ordenes`; esta superficie
// sólo aporta SU regla de disponibilidad (alcance por zona, R48).
import { ReportarIncidenteAccion } from "@/app/(app)/ordenes/_components/ReportarIncidenteAccion";
import { puedeReportarIncidenteSatelite } from "./incidente-satelite";
import { EscanerRecepcion } from "./EscanerRecepcion";
import { RecepcionDetalle } from "./RecepcionDetalle";
import { recibidasColumns } from "./recibidas-columns";
import { AsignarSateliteModal } from "./AsignarSateliteModal";
import { DeshacerAsignacionSateliteModal } from "./DeshacerAsignacionSateliteModal";
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
   * Feature 139/T3.3 (R13/R21): órdenes en `por_devolver` de la zona del adminSatelite,
   * elegibles para la acción POR LOTE "Enviar a central" (transición
   * `por_devolver → devolviendo_a_bodega_central`). REEMPLAZA el viejo scope `rechazada`
   * (feature 48): la rechazada sale de ese estado solo al aprobar el cierre, que la deja
   * en `por_devolver`. Acotadas server-side por zona; vacío = sin órdenes por devolver.
   */
  porDevolver?: RecepcionSateliteDTO[];
  /**
   * Feature 139/T3.3 (R21): órdenes en `devolviendo_a_bodega_central` de la zona,
   * INFORMATIVAS (ya enviadas y en tránsito a la central; la recepción la hace la central
   * por QR, no el satélite). Acotadas server-side por zona; solo lectura, sin acción.
   */
  enTransitoACentral?: RecepcionSateliteDTO[];
  /**
   * Feature 100/T4.1 (R12): órdenes en `devuelta` (novedad) de la zona del
   * adminSatelite, elegibles para "Recuperar a bodega" (transición
   * `devuelta → en_bodega_satelite`). Acotadas server-side por zona; vacío = sin
   * órdenes por recuperar.
   */
  devueltas?: RecepcionSateliteDTO[];
  /**
   * Feature 149/T6.4 (R35): órdenes en `por_recoger` de la zona del adminSatelite —ya
   * asignadas a un mensajero que AÚN no las recogió—, elegibles para la acción POR LOTE
   * "Deshacer asignación" (`por_recoger → en_bodega_satelite`). Acotadas server-side por zona;
   * vacío = sin órdenes asignadas pendientes de recogida. El caso (b)
   * (`en_ruta_bodega_satelite`, sección "Por recibir") NO ofrece esta acción (R36).
   */
  asignadas?: RecepcionSateliteDTO[];
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
 * Feature 100 (T4.1, R12): fila de la sección "Devueltas". Cada orden `devuelta` de
 * la zona ofrece la acción "Recuperar", que ejecuta la recuperación
 * `devuelta → en_bodega_satelite` vía la Server Action `recuperarABodega`. Espejo
 * EXACTO de `FilaPorDevolver` (48): estado de carga POR FILA (botón deshabilitado
 * mientras procesa) y feedback por toast (éxito relee el estado del servidor; un
 * `status != ok` muestra el error claro por estado sin afectar a las demás filas).
 */
function FilaDevuelta({
  orden,
  zonaNombre,
  onRecuperada,
  onError,
}: {
  orden: RecepcionSateliteDTO;
  zonaNombre: string | null;
  onRecuperada: () => void;
  onError: (mensaje: string) => void;
}) {
  const [procesando, setProcesando] = useState(false);

  async function handleRecuperar() {
    setProcesando(true);
    const result = await recuperarABodega({ ordenId: orden.id });
    if (result.status !== "ok") {
      onError(recuperarBodegaErrorMessage(result.status));
      setProcesando(false);
      return;
    }
    onRecuperada(); // relee el estado del servidor; la fila desaparece del listado
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
          <div className="flex justify-end">
            <Button type="button" onClick={handleRecuperar} disabled={procesando}>
              {procesando ? "Recuperando…" : "Recuperar"}
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
  enTransitoACentral = [],
  devueltas = [],
  asignadas = [],
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
  // Feature 139/T3.3 (R13): Set de selección PROPIO de la sección "Por devolver"
  // (independiente del de "Recibidas"), para el envío por lote a la bodega central.
  const [seleccionadosPorDevolver, setSeleccionadosPorDevolver] = useState<
    Set<string>
  >(new Set());
  const [enviandoACentral, setEnviandoACentral] = useState(false);
  // Feature 149/T6.4 (R35): Set de selección PROPIO de la sección "Asignadas (por recoger)",
  // independiente del de "Recibidas" y del de "Por devolver", y estado de su modal.
  const [seleccionadosAsignadas, setSeleccionadosAsignadas] = useState<
    Set<string>
  >(new Set());
  const [deshacerOpen, setDeshacerOpen] = useState(false);
  // Feature 148 (T13, R22): ids del ÚLTIMO envío a central que salieron `ok`. El lote
  // vive solo aquí (el service es por-orden, §9.1), así que se conserva para poder
  // ofrecer su manifiesto después del refresco. Vacío = sin descarga que ofrecer (R17).
  const [ultimoEnvioACentral, setUltimoEnvioACentral] = useState<string[]>([]);

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

  function toggleTodos(ids: string[], checked: boolean) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (checked) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  // Snapshot de las órdenes seleccionadas (por id, filtrando las que sigan en la
  // lista actual) para pasarlas al modal de asignación.
  const ordenesSeleccionadas = useMemo(
    () => recibidas.filter((orden) => seleccionados.has(orden.id)),
    [recibidas, seleccionados],
  );

  /**
   * Feature 158 (T2.7): columna de acciones POR FILA con «Reportar incidente». Se compone
   * aquí y se añade SÓLO a las secciones cuyo estado es uno de los cinco orígenes
   * (`Recibidas` = `en_bodega_satelite`, `Asignadas (por recoger)` = `por_recoger`), nunca a
   * `Por devolver`, `En tránsito a central` ni `Devueltas`, cuyos estados no lo son.
   *
   * Tras el éxito se RELEE del servidor (`router.refresh()`, patrón de todas las acciones de
   * este módulo): la orden pasa a `incidente` y desaparece de su sección.
   */
  const columnaIncidente = useMemo<Column<RecepcionSateliteDTO>>(
    () => ({
      id: "incidente",
      value: "Incidente",
      render: (orden: RecepcionSateliteDTO) => (
        <ReportarIncidenteAccion
          orden={orden}
          disponible={puedeReportarIncidenteSatelite(orden, zonaNombre, sinZona)}
          onSuccess={() => router.refresh()}
        />
      ),
    }),
    [zonaNombre, sinZona, router],
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
        // Cabecera = checkbox "seleccionar todo" sobre las recibidas visibles.
        renderHeader: () => {
          const ids = recibidas.map((orden) => orden.id);
          return (
            <SelectAllCheckbox
              selectableIds={ids}
              selectedIds={seleccionados}
              onToggleAll={(checked) => toggleTodos(ids, checked)}
              ariaLabel="Seleccionar todas las recibidas"
            />
          );
        },
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
      // Feature 101/R8: decora las columnas de datos para anexar el badge "Prioritaria"
      // a las órdenes liberadas por el SLA (prioridad=true) que esperan reasignación en
      // ESTE grupo ("Recibidas", en_bodega_satelite). El checkbox va delante del decorado,
      // así el badge cae en la primera columna de datos (Nº Guía).
      ...conBadgePrioridad(recibidasColumns(zonaNombre)),
      // Feature 158 (T2.7): `en_bodega_satelite` es uno de los cinco orígenes.
      columnaIncidente,
    ],
    [seleccionados, zonaNombre, recibidas, columnaIncidente],
  );

  function handleSuccess() {
    setSeleccionados(new Set());
    setModalOpen(false);
    router.refresh(); // relee el estado del servidor (patrón feature 33)
  }

  // ---------- Feature 139/T3.3 (R13/R21) — envío por lote a bodega central ----------
  function togglePorDevolver(id: string, checked: boolean) {
    setSeleccionadosPorDevolver((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function togglePorDevolverTodos(ids: string[], checked: boolean) {
    setSeleccionadosPorDevolver((prev) => {
      const next = new Set(prev);
      if (checked) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  // Columnas de "Por devolver": mismo patrón que "Recibidas" (checkbox de selección
  // compuesto aquí, fuente de verdad, + columnas de datos reusadas). SIN badge de
  // prioridad (el resalte por SLA es exclusivo de "Recibidas", R10 de la feature 101).
  const columnasPorDevolver = useMemo<Column<RecepcionSateliteDTO>[]>(
    () => [
      {
        id: "seleccionar",
        value: "Seleccionar",
        renderHeader: () => {
          const ids = porDevolver.map((orden) => orden.id);
          return (
            <SelectAllCheckbox
              selectableIds={ids}
              selectedIds={seleccionadosPorDevolver}
              onToggleAll={(checked) => togglePorDevolverTodos(ids, checked)}
              ariaLabel="Seleccionar todas las órdenes por devolver"
            />
          );
        },
        render: (orden: RecepcionSateliteDTO) => (
          <Checkbox
            checked={seleccionadosPorDevolver.has(orden.id)}
            onCheckedChange={(checked) =>
              togglePorDevolver(orden.id, checked === true)
            }
            aria-label={`Seleccionar ${orden.numRemision}`}
          />
        ),
      },
      ...recibidasColumns(zonaNombre),
    ],
    [seleccionadosPorDevolver, zonaNombre, porDevolver],
  );

  // ---------- Feature 149/T6.4 (R35/R37/R38) — deshacer asignación por lote ----------
  function toggleAsignada(id: string, checked: boolean) {
    setSeleccionadosAsignadas((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAsignadasTodas(ids: string[], checked: boolean) {
    setSeleccionadosAsignadas((prev) => {
      const next = new Set(prev);
      if (checked) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  // Columnas de "Asignadas (por recoger)": patrón EXACTO de "Por devolver" (checkbox de
  // selección compuesto aquí, fuente de verdad, + columnas de datos reusadas).
  const columnasAsignadas = useMemo<Column<RecepcionSateliteDTO>[]>(
    () => [
      {
        id: "seleccionar",
        value: "Seleccionar",
        renderHeader: () => {
          const ids = asignadas.map((orden) => orden.id);
          return (
            <SelectAllCheckbox
              selectableIds={ids}
              selectedIds={seleccionadosAsignadas}
              onToggleAll={(checked) => toggleAsignadasTodas(ids, checked)}
              ariaLabel="Seleccionar todas las órdenes asignadas"
            />
          );
        },
        render: (orden: RecepcionSateliteDTO) => (
          <Checkbox
            checked={seleccionadosAsignadas.has(orden.id)}
            onCheckedChange={(checked) =>
              toggleAsignada(orden.id, checked === true)
            }
            aria-label={`Seleccionar ${orden.numRemision}`}
          />
        ),
      },
      ...recibidasColumns(zonaNombre),
      // Feature 158 (T2.7): `por_recoger` es uno de los cinco orígenes, y estas órdenes
      // están FÍSICAMENTE en la bodega satélite esperando a que las recojan.
      columnaIncidente,
    ],
    [seleccionadosAsignadas, zonaNombre, asignadas, columnaIncidente],
  );

  // Snapshot del lote que va al modal (por id, acotado a las órdenes aún listadas).
  const asignadasSeleccionadas = useMemo(
    () => asignadas.filter((orden) => seleccionadosAsignadas.has(orden.id)),
    [asignadas, seleccionadosAsignadas],
  );

  // R38: éxito ⇒ limpia la selección, cierra el modal y RELEE el estado del servidor (la
  // orden desaparece de "Asignadas" y reaparece en "Recibidas").
  function handleDeshacerSuccess() {
    setSeleccionadosAsignadas(new Set());
    setDeshacerOpen(false);
    router.refresh();
  }

  // Columnas de "En tránsito a central": SOLO lectura (sin checkbox), reusa las de datos.
  const columnasEnTransito = useMemo<Column<RecepcionSateliteDTO>[]>(
    () => recibidasColumns(zonaNombre),
    [zonaNombre],
  );

  // R13: "Enviar a central" recorre la selección de `por_devolver` y dispara
  // `enviarACentral({ ordenId })` por cada una (loop await, patrón DevolverATiendaModal),
  // acumulando errores para no ocultar un fallo parcial. Feedback por toast; en cualquier
  // caso se relee el estado del servidor y se limpia la selección.
  async function enviarSeleccionadasACentral() {
    const ids = porDevolver
      .filter((orden) => seleccionadosPorDevolver.has(orden.id))
      .map((orden) => orden.id);
    if (ids.length === 0) return;
    setEnviandoACentral(true);
    let enviadas = 0;
    const errores: string[] = [];
    // Feature 148/R22: solo las EFECTIVAMENTE enviadas entran al manifiesto; las que
    // fallaron quedan fuera. No cambia el manejo del resultado de negocio (R25/R27).
    const enviadasIds: string[] = [];
    for (const id of ids) {
      const result = await enviarACentral({ ordenId: id });
      if (result.status === "ok") {
        enviadas += 1;
        enviadasIds.push(id);
      } else errores.push(envioDevolucionCentralErrorMessage(result.status));
    }
    setEnviandoACentral(false);
    setSeleccionadosPorDevolver(new Set());
    setUltimoEnvioACentral(enviadasIds);
    if (enviadas > 0) {
      toast.success(`${enviadas} orden(es) enviada(s) a bodega central.`);
    }
    if (errores.length > 0) toast.error(errores[0]);
    router.refresh();
  }

  const porDevolverSeleccionadas = seleccionadosPorDevolver.size;

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
            className="flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-strong"
          >
            <span className="font-medium">
              {bodegaCierresAbiertosTitulo(bloqueoBodega.cierresAbiertos ?? 0)}
            </span>
            <span>{BODEGA_CIERRES_ABIERTOS_DETALLE}</span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Recibidas</h2>
        </div>
        {/* "Asignar" vive en el flujo, encima de la tabla y alineado a la derecha;
            queda deshabilitado sin selección o con la bodega bloqueada. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
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
          rowClassName={resaltarFilaPrioridad}
          emptyMessage="Aún no has recibido órdenes."
        />
      </section>

      {/* ---------- Sección: Asignadas (por recoger) ---------- */}
      {/* Feature 149/T6.4 (R35/R36): órdenes de la zona ya asignadas a un mensajero que aún
          NO las recogió. Tabla seleccionable (patrón "Por devolver") + acción POR LOTE
          "Deshacer asignación" (por_recoger → en_bodega_satelite) sobre la selección. La
          sección "Por recibir" (en_ruta_bodega_satelite) NO ofrece esta acción: el caso (b)
          es competencia de la bodega central (R36). El cierre de día pendiente de un
          mensajero NO bloquea esta acción (Q1 CERRADA, R19): a diferencia de "Asignar", el
          botón no mira `bloqueoBodega`. */}
      <section
        aria-label="Asignadas (por recoger)"
        className="flex flex-col gap-3 border-t pt-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Asignadas (por recoger)</h2>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDeshacerOpen(true)}
            disabled={asignadasSeleccionadas.length === 0}
          >
            Deshacer asignación
          </Button>
        </div>
        <DataTable
          columns={columnasAsignadas}
          data={asignadas}
          rowKey="id"
          ariaLabel="Asignadas (por recoger)"
          emptyMessage="No hay órdenes asignadas por recoger."
        />
      </section>

      {/* ---------- Sección: Por devolver (por_devolver) ---------- */}
      {/* Feature 139/T3.3 (R13/R21): órdenes en `por_devolver` de la zona. Tabla
          seleccionable (patrón "Recibidas") + acción POR LOTE "Enviar a central"
          (por_devolver → devolviendo_a_bodega_central) sobre la selección. Tras el
          envío se releé el estado del servidor y se limpia la selección. */}
      <section
        aria-label="Por devolver"
        className="flex flex-col gap-3 border-t pt-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Por devolver</h2>
          <Button
            type="button"
            onClick={() => void enviarSeleccionadasACentral()}
            disabled={porDevolverSeleccionadas === 0 || enviandoACentral}
          >
            {enviandoACentral ? "Enviando…" : "Enviar a central"}
          </Button>
        </div>
        <DataTable
          columns={columnasPorDevolver}
          data={porDevolver}
          rowKey="id"
          ariaLabel="Por devolver"
          emptyMessage="No hay órdenes por devolver."
        />
      </section>

      {/* ---------- Sección: En tránsito a central (devolviendo_a_bodega_central) ---------- */}
      {/* Feature 139/T3.3 (R21): órdenes ya enviadas, en tránsito a la bodega central.
          Solo lectura (la recepción la hace la central por QR, no el satélite). */}
      <section
        aria-label="En tránsito a central"
        className="flex flex-col gap-3 border-t pt-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">En tránsito a central</h2>
          {/* Feature 148 (T13, R22): manifiesto del último envío a central, solo con
              las órdenes que salieron `ok`. Botón EXPLÍCITO (§9.7): ni descarga
              automática ni acción en el toast. */}
          <DescargarManifiestoButton
            flujo="devolucion_central"
            seleccion={{ ordenIds: ultimoEnvioACentral }}
            label="Descargar manifiesto del último envío"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Órdenes ya enviadas; la bodega central las recibirá por escaneo. Aquí solo
          se muestran para seguimiento.
        </p>
        <DataTable
          columns={columnasEnTransito}
          data={enTransitoACentral}
          rowKey="id"
          ariaLabel="En tránsito a central"
          emptyMessage="No hay órdenes en tránsito a central."
        />
      </section>

      {/* ---------- Sección: Devueltas (devuelta) ---------- */}
      {/* Feature 100/T4.1 (R12): órdenes `devuelta` (novedad) de la zona; cada una
          ofrece "Recuperar" (devuelta → en_bodega_satelite) con estado por fila. En
          éxito se relee el estado del servidor + toast; un error se avisa por toast. */}
      <section
        aria-label="Devueltas"
        className="flex flex-col gap-3 border-t pt-6"
      >
        <h2 className="text-lg font-semibold">Devueltas</h2>
        {devueltas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay órdenes por recuperar.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {devueltas.map((orden) => (
              <FilaDevuelta
                key={orden.id}
                orden={orden}
                zonaNombre={zonaNombre}
                onRecuperada={() => {
                  toast.success("Orden recuperada a bodega.");
                  router.refresh();
                }}
                onError={(mensaje) => toast.error(mensaje)}
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

      <DeshacerAsignacionSateliteModal
        open={deshacerOpen}
        ordenes={asignadasSeleccionadas}
        onOpenChange={setDeshacerOpen}
        onSuccess={handleDeshacerSuccess}
      />
    </div>
  );
}

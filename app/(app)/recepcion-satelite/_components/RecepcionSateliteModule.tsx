"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { BodegaLiberadasHoy } from "@/components/private/BodegaLiberadasHoy";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { LiberadaHoyRow } from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";

import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { EscanerRecepcion } from "./EscanerRecepcion";
import { RecepcionDetalle } from "./RecepcionDetalle";
import { AsignarSateliteModal } from "./AsignarSateliteModal";
import {
  BODEGA_BLOQUEADA_TITULO,
  bodegaBloqueadaLineas,
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
   * Feature 41 (R22): bloqueo DERIVADO server-side de la bodega satélite (regla
   * estricta R17). Si `bloqueada`, se muestra el aviso con la causa diferenciada y
   * se deshabilita "Asignar". Llega por props desde el Server Component.
   */
  bloqueoBodega: BodegaBloqueoCausa & { bloqueada: boolean };
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

function ListaOrdenes({
  ordenes,
  zonaNombre,
  vacio,
}: {
  ordenes: RecepcionSateliteDTO[];
  zonaNombre: string | null;
  vacio: string;
}) {
  if (ordenes.length === 0) {
    return <p className="text-sm text-muted-foreground">{vacio}</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {ordenes.map((orden) => (
        <li key={orden.id}>
          <Card>
            <CardHeader>
              <CardTitle>
                {orden.numRemision} · {orden.destinatario}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RecepcionDetalle
                orden={orden}
                estadoLegible={estadoLegible(orden, zonaNombre)}
              />
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

/**
 * Feature 34 (T8, R4): lista SELECCIONABLE de órdenes `en_bodega_satelite` de la
 * sección "Recibidas". Cada fila tiene un checkbox accesible; la selección la
 * gobierna el módulo padre (fuente de verdad) para poder abrir el modal de
 * asignación con el lote elegido.
 */
function ListaRecibidas({
  ordenes,
  zonaNombre,
  seleccionados,
  onToggle,
}: {
  ordenes: RecepcionSateliteDTO[];
  zonaNombre: string | null;
  seleccionados: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
}) {
  if (ordenes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aún no has recibido órdenes.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {ordenes.map((orden) => (
        <li key={orden.id} className="flex items-start gap-3">
          <Checkbox
            className="mt-4"
            checked={seleccionados.has(orden.id)}
            onCheckedChange={(checked) => onToggle(orden.id, checked === true)}
            aria-label={`Seleccionar ${orden.numRemision}`}
          />
          <Card className="flex-1">
            <CardHeader>
              <CardTitle>
                {orden.numRemision} · {orden.destinatario}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RecepcionDetalle
                orden={orden}
                estadoLegible={estadoLegible(orden, zonaNombre)}
              />
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function RecepcionSateliteModule({
  porRecibir,
  recibidas,
  zonaNombre,
  sinZona,
  mensajeros,
  bloqueoBodega,
  liberadasHoy = [],
}: RecepcionSateliteModuleProps) {
  const router = useRouter();
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);

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
      {/* R7: NO expone ninguna acción de asignar/gestionar; solo se listan. */}
      <section aria-label="Por recibir" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Por recibir</h2>
        <ListaOrdenes
          ordenes={porRecibir}
          zonaNombre={zonaNombre}
          vacio="No hay órdenes por recibir."
        />
      </section>

      {/* ---------- Sección: Recibidas (en_bodega_satelite) ---------- */}
      {/* Feature 34 (R4): lista seleccionable + acción "Asignar". */}
      <section
        aria-label="Recibidas"
        className="flex flex-col gap-3 border-t pt-6"
      >
        {/* Feature 41 (R22): aviso de bodega bloqueada con causa diferenciada. */}
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
        <ListaRecibidas
          ordenes={recibidas}
          zonaNombre={zonaNombre}
          seleccionados={seleccionados}
          onToggle={toggleSeleccion}
        />
      </section>

      {/* Feature 46 (R15/R16): aviso derivado "Liberadas hoy (reprogramación)" de la
          bodega satélite (en_bodega_satelite). Datos por props; se oculta si no hay. */}
      <BodegaLiberadasHoy liberadas={liberadasHoy} />

      <AsignarSateliteModal
        open={modalOpen}
        ordenes={ordenesSeleccionadas}
        mensajeros={mensajeros}
        onOpenChange={setModalOpen}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

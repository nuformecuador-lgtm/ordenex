"use client";

import { useRouter } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { EscanerRecepcion } from "./EscanerRecepcion";
import { RecepcionDetalle } from "./RecepcionDetalle";

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

export function RecepcionSateliteModule({
  porRecibir,
  recibidas,
  zonaNombre,
  sinZona,
}: RecepcionSateliteModuleProps) {
  const router = useRouter();

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
      <section
        aria-label="Recibidas"
        className="flex flex-col gap-3 border-t pt-6"
      >
        <h2 className="text-lg font-semibold">Recibidas</h2>
        <ListaOrdenes
          ordenes={recibidas}
          zonaNombre={zonaNombre}
          vacio="Aún no has recibido órdenes."
        />
      </section>
    </div>
  );
}

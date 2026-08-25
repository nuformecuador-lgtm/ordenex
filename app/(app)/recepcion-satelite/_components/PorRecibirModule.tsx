"use client";

import { useRouter } from "next/navigation";

import { PorAceptarSection } from "@/app/(app)/_components/PorAceptarSection";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { AvisoSinZonaSatelite } from "./AvisoSinZonaSatelite";
import { EscanerRecepcion } from "./EscanerRecepcion";
import { SateliteOrderCard } from "./SateliteOrderCard";

// Feature 279 (T3.2) — pantalla «Por recibir» del portal del `adminSatelite`.
//
// Es la mitad de arriba de lo que hasta el 2026-08-24 era una sola pantalla: el escáner y
// las órdenes en camino a la bodega satélite (`en_ruta_bodega_satelite`). La otra mitad
// —el listado de la bodega, sus filtros, su paginación, sus acciones de lote y sus
// modales— vive en `RecepcionSateliteModule` y esta pantalla NO monta nada de eso (R16).
//
// TRES DECISIONES QUE NO SON OBVIAS, y que se rompen en silencio si se «simplifican»:
//
// 1. **Las tarjetas no ofrecen NINGÚN botón** (R1/R2). Recibir es sólo por QR. El botón
//    «Aceptar» por-orden se retiró con toda su cadena de servidor (la recepción en lote,
//    R34–R41), así que aquí no hay nada que volver a cablear: no es que el botón esté
//    oculto, es que la acción ya no existe.
//
// 2. **El escáner se ofrece siempre que haya zona** (R42/R43), con la lista vacía
//    incluida. Antes la condición era «hay zona Y hay algo por recibir», y eso escondía la
//    herramienta justo cuando el actor tenía el paquete en la mano y la orden todavía no
//    figuraba en la última lectura. Es el mismo fallo que la feature 167 documentó con la
//    recolección del mensajero. La condición que SÍ se conserva es la zona: sin zona el
//    servidor responde `sin_zona`, así que un escáner ahí sólo sabría producir un error.
//
// 3. **La relectura tras el QR es `router.refresh()` y NADA MÁS** (R21). En esta pantalla
//    no hay SWR: la lista viene entera del Server Component, y volver a resolverlo es
//    exactamente lo que hace desaparecer la orden recién recibida. El `mutate()` que sí
//    lleva «En bodega» es de una clave que esta pantalla no monta; llamarlo aquí sería
//    ruido.

export interface PorRecibirModuleProps {
  /** Órdenes en `en_ruta_bodega_satelite` de la zona del `adminSatelite`. */
  porRecibir: RecepcionSateliteDTO[];
  /** Nombre de la zona del actor (para el estado legible de la tarjeta); `null` si no tiene. */
  zonaNombre: string | null;
  /** `true` si el `adminSatelite` no tiene zona asignada (R25/R26). */
  sinZona: boolean;
}

/**
 * Estado legible "en ruta a bodega satélite de <zona>" (R9): deriva del `estatusValue`
 * (etiqueta de `estatusLabel`) y del nombre de zona de la orden, con el de la zona del
 * actor como respaldo.
 */
function estadoLegible(orden: RecepcionSateliteDTO, zonaNombre: string | null): string {
  const base = estatusLabel(orden.estatusValue);
  const zona = orden.zonaNombre || zonaNombre;
  return zona ? `${base} de ${zona}` : base;
}

export function PorRecibirModule({
  porRecibir,
  zonaNombre,
  sinZona,
}: Readonly<PorRecibirModuleProps>) {
  const router = useRouter();

  // R26: sin zona no se ofrece NADA de recepción — ni el escáner ni las tarjetas—, sólo
  // el aviso. El retorno temprano lo deja imposible de mezclar con el resto del árbol.
  if (sinZona) {
    return (
      <div className="flex flex-col gap-8">
        <AvisoSinZonaSatelite />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Recepción por guía: MISMA tarjeta que la recogida del mensajero
          (`EscanerGuiaCard`), con los dos caminos — cámara y número tecleado.
          La condición es `!sinZona` y nada más (R42/R43): NO mira cuántas órdenes
          devolvió la última lectura. */}
      <EscanerRecepcion onRecibida={() => router.refresh()} />

      {/* La sección aporta el encabezado, el banner del contador y el texto del vacío;
          la tarjeta la pinta este módulo con `renderItem`, sin pie de acciones (R1/R5). */}
      <PorAceptarSection
        titulo="Por recibir"
        nuevasLabel={(n) => `${n} Órdenes nuevas por recibir`}
        ordenes={porRecibir}
        vacio="No hay órdenes por recibir."
        listClassName="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        renderItem={(orden) => (
          <SateliteOrderCard
            orden={orden}
            estadoLegible={estadoLegible(orden, zonaNombre)}
          />
        )}
      />
    </div>
  );
}

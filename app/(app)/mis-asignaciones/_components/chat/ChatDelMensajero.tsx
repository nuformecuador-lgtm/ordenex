"use client";

import { useMemo, useState } from "react";

import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { agruparContactosChat } from "./chat-contactos";
import { ChatFlotante } from "./ChatFlotante";

// FICHA 430 (SF-001, punto 3) — EL CHAT DEL MENSAJERO EN LAS PANTALLAS QUE NO GESTIONAN.
//
// `ChatFlotante` tiene la apertura CONTROLADA porque en Reparto hay dos disparadores: el botón
// flotante y la acción «Mensaje» del panel de detalle. Donde no hay panel de gestión —hoy «Por
// recoger»— ese segundo disparador no existe, así que el estado no tiene dueño natural: lo
// sostiene este envoltorio, que además compone los grupos de contactos.
//
// POR QUÉ UN COMPONENTE Y NO METERLO EN `RecogerModule`. La página es un Server Component y no
// puede pasarle un manejador a un componente de cliente, así que alguien tiene que ser cliente.
// Poniéndolo aquí, `RecogerModule` —que es la pantalla de recoger, no la del chat— no cambia ni una
// línea ni gana props que no le tocan; la página monta las dos piezas como ya monta `KpisMensajero`
// junto a `RepartoModule`.
//
// ⛔ NO ES UNA SEGUNDA LISTA. Recibe las MISMAS tres listas que Reparto y las agrupa con la MISMA
// función: si las dos pantallas compusieran contactos distintos, el distintivo de sin leer diría
// números distintos en cada una y cada una escondería los pendientes de la otra.

export interface ChatDelMensajeroProps {
  /** Órdenes en `en_reparto` del mensajero. */
  porGestionar: MiAsignacionDTO[];
  /** Órdenes en `ayuda_tienda` del mensajero (feature 235). */
  conAyuda: MiAsignacionDTO[];
  /** Órdenes en `por_recoger`: asignadas y todavía sin recoger. */
  porRecoger: MiAsignacionDTO[];
}

export function ChatDelMensajero({
  porGestionar,
  conAyuda,
  porRecoger,
}: Readonly<ChatDelMensajeroProps>) {
  const [abierto, setAbierto] = useState(false);
  const contactos = useMemo(
    () => agruparContactosChat(porGestionar, conAyuda, porRecoger),
    [porGestionar, conAyuda, porRecoger],
  );

  return (
    <ChatFlotante
      contactos={contactos}
      // Sin panel de gestión no hay ninguna orden «en detalle»: el chat abre por la lista, que es
      // lo que corresponde en una pantalla donde el mensajero todavía está eligiendo.
      ordenEnDetalleId={null}
      abierto={abierto}
      onAbiertoChange={setAbierto}
    />
  );
}

"use client";

import { useState } from "react";
import { MessageSquareDot, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import { normalizeName } from "@/lib/utils/normalize";
import {
  avisoReservaParaOtroDia,
  ETIQUETA_PARA_MANANA,
  PESTANA_PARA_OTRO_DIA,
  PESTANA_PARA_RECOGER_HOY,
} from "@/lib/utils/dia-reparto-textos";

import { coincideBusqueda } from "../mis-asignaciones-buscador";
import { ESTADO_CHIP, estadoDe, iniciales, zonaCorta } from "./chat-format";
import {
  contadorContactos,
  SECCION_CON_EL_PAQUETE,
  SIN_COINCIDENCIAS,
  SIN_CONTACTOS,
  type GruposDeContactos,
} from "./chat-contactos";

// Rediseño del chat (rama ux) — columna izquierda: un contacto por orden ASIGNADA (su
// destinatario). Filtra en cliente con el MISMO criterio que el buscador del módulo
// (`coincideBusqueda`: guía, remisión, teléfono o nombre), así que buscar aquí se siente
// igual que buscar allá. Nada de datos inventados: cada fila muestra solo lo que trae el
// DTO de la asignación — remisión (identificador que el mensajero canta por radio), guía
// cuando existe, estado y zona.
//
// SIN LEER: cada fila puede llevar un distintivo con los entrantes que el cliente mandó y el
// mensajero todavía no ha visto. El conteo llega ya resuelto desde `ChatFlotante` (servidor,
// `resumenNoLeidosChat`); aquí solo se pinta. Una fila sin entrada en el mapa es cero.
//
// ⭑ FICHA 430 (SF-001, punto 3) — LA LISTA DEJA DE SER SÓLO «EN REPARTO». Entran también las
// órdenes ASIGNADAS y todavía sin recoger, que es lo que esta ficha vino a arreglar: hasta hoy el
// mensajero no podía escribirle al cliente de un paquete que aún no llevaba encima. Por eso la
// lista pasa a tener TRES grupos en vez de uno, y por eso el contador de la cabecera ya no puede
// decir «en reparto».
//
// LOS TRES GRUPOS NO SON DECORACIÓN. Son la respuesta a «¿qué tengo en la mano ahora mismo?», que
// es distinta de «¿con quién puedo hablar?»: la orden de otro día se conversa igual, pero el
// servidor no la va a dejar recoger hasta su día. Mezclarla con las de hoy es exactamente lo que la
// ficha 277 deshizo en la pantalla «Por recoger», y sus dos rótulos se importan de allí en vez de
// escribirse otra vez.

/** Tope del distintivo: por encima se pinta `+9` (el ancho de la burbuja es fijo). */
const BADGE_MAX = 9;

function OrdenFila({
  orden,
  seleccionada,
  noLeidos,
  onSeleccionar,
}: {
  orden: MiAsignacionDTO;
  seleccionada: boolean;
  /** Entrantes sin leer de esta conversación; 0 = sin distintivo. */
  noLeidos: number;
  onSeleccionar: (id: string) => void;
}) {
  const chip = ESTADO_CHIP[estadoDe(orden.estatusValue)];
  return (
    <button
      type="button"
      onClick={() => onSeleccionar(orden.id)}
      aria-current={seleccionada ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors",
        "hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        seleccionada && "bg-accent",
      )}
    >
      <div className="relative shrink-0">
        <div
          className="flex size-11 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground"
          aria-hidden="true"
        >
          {iniciales(orden.destinatario)}
        </div>
        {noLeidos > 0 ? (
          // Mismos tokens que el distintivo del botón flotante y que la campana: `-strong` es
          // la variante contrast-safe (AA) del semántico, con `text-background` acompañando su
          // giro entre temas. Va sobre el avatar, que es el ancla visual de la fila.
          <span
            data-testid={`chat-no-leidos-${orden.id}`}
            className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-card bg-danger-strong px-1 text-[11px] font-semibold leading-none text-background"
          >
            {noLeidos > BADGE_MAX ? `+${BADGE_MAX}` : noLeidos}
          </span>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold text-foreground">
            {orden.destinatario}
          </p>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {orden.numRemision}
          </span>
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {orden.numGuia !== null ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {orden.numGuia}
            </span>
          ) : null}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium leading-none",
              chip.className,
            )}
          >
            {chip.label}
          </span>
          {/* FICHA 430 (punto 3) — LA MARCA DEL DÍA VA EN LA FILA, no sólo en el grupo. El grupo
              ordena la lista; la fila es lo que el mensajero lee cuando el buscador la ha sacado de
              su sitio, y es lo que entra en el nombre accesible del botón. Cuelga de
              `esParaManana` y NO del grupo a propósito: una orden ya recogida puede quedar marcada
              para un día posterior (pasó en producción el 2026-08-21 con un `UPDATE` a mano), y así
              la marca no se le cae por estar en «En reparto».
              Mismo `Badge variant="info"` con el que la pintan las tres cards del portal: un solo
              lenguaje para un solo dato. */}
          {orden.esParaManana ? (
            <Badge variant="info">{ETIQUETA_PARA_MANANA}</Badge>
          ) : null}
        </div>

        <p className="mt-1 truncate text-xs text-muted-foreground">
          {zonaCorta(orden)}
        </p>

        {/* FICHA 430 (punto 3) — Y CON PALABRAS, no sólo con el badge. Si el mensajero escribe el
            día antes, el cliente le va a pedir que se la lleve hoy: tiene que saber, antes de
            prometer nada, que el sistema se lo va a impedir y DESDE QUÉ DÍA podrá. El literal sale
            de la fuente única (`avisoReservaParaOtroDia`, 261/R15) con la fecha ya resuelta por el
            servidor (`fechaRepartoISO`, R14): aquí no se construye ninguna fecha.
            Es un `<span>` de bloque y no un `<p role="note">` como en la card: dentro de un
            `<button>` el texto se pliega al nombre accesible de la fila, así que un rol propio no
            se anunciaría — y un `<p>` más dentro del botón tampoco mejora nada. */}
        {orden.esParaManana ? (
          <span className="mt-1 block text-[11px] font-semibold text-muted-foreground">
            {avisoReservaParaOtroDia(orden.fechaRepartoISO)}
          </span>
        ) : null}

        {/* El distintivo de arriba es una cifra suelta sobre el avatar: fuera de contexto no
            dice de qué es. El nombre accesible del botón lo dice con palabras. */}
        {noLeidos > 0 ? (
          <span className="sr-only">
            {noLeidos === 1 ? "1 mensaje sin leer" : `${noLeidos} mensajes sin leer`}
          </span>
        ) : null}
      </div>
    </button>
  );
}

export interface ChatOrdenesListaProps {
  /**
   * Ficha 430: los contactos YA AGRUPADOS por lo que el mensajero tiene en la mano. Llegan
   * compuestos por `agruparContactosChat` desde el módulo de la pantalla; la lista no vuelve a
   * decidir de qué grupo es cada orden, igual que la 235 hizo con el corte de «ayuda».
   */
  contactos: GruposDeContactos;
  /**
   * Entrantes sin leer por `ordenId`. Ausencia = cero. Lo resuelve `ChatFlotante` contra el
   * servidor; la lista no consulta nada por su cuenta.
   */
  noLeidos: ReadonlyMap<string, number>;
  /** Conversación abierta ahora mismo. */
  seleccionadaId: string | null;
  /** Orden en gestión (la del detalle): se ancla arriba, separada del resto. */
  ordenEnDetalleId: string | null;
  onSeleccionar: (id: string) => void;
  className?: string;
}

export function ChatOrdenesLista({
  contactos,
  noLeidos,
  seleccionadaId,
  ordenEnDetalleId,
  onSeleccionar,
  className,
}: Readonly<ChatOrdenesListaProps>) {
  const [query, setQuery] = useState("");

  const q = normalizeName(query);
  const filtrar = (ordenes: MiAsignacionDTO[]) =>
    ordenes.filter((o) => coincideBusqueda(o, q));

  // La orden EN GESTIÓN se ancla arriba y sale de su grupo, para no aparecer dos veces. Sólo
  // puede estar entre las ya recogidas: el puntero 1-a-1 del servidor apunta a una `en_reparto`.
  const enGestion =
    filtrar(contactos.conElPaquete).find((o) => o.id === ordenEnDetalleId) ?? null;
  const grupos: { titulo: string; ordenes: MiAsignacionDTO[] }[] = [
    {
      titulo: SECCION_CON_EL_PAQUETE,
      ordenes: filtrar(contactos.conElPaquete).filter((o) => o.id !== ordenEnDetalleId),
    },
    { titulo: PESTANA_PARA_RECOGER_HOY, ordenes: filtrar(contactos.porRecogerHoy) },
    { titulo: PESTANA_PARA_OTRO_DIA, ordenes: filtrar(contactos.paraOtroDia) },
  ];
  const visibles =
    (enGestion ? 1 : 0) + grupos.reduce((n, g) => n + g.ordenes.length, 0);

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col border-border bg-card md:border-r",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="font-heading text-base font-semibold text-foreground">
          Conversaciones
        </h2>
        {/* `mr-10` (40px): en móvil la lista ocupa todo el ancho y esta esquina cae justo
            debajo de la X de cierre del Dialog. En ≥md la lista es la columna izquierda y la
            X queda lejos, así que el margen se anula.
            Ficha 430: cuenta LO QUE EL MENSAJERO TIENE, no lo que el buscador deja a la vista —
            mismo criterio que los contadores de «Por recoger» (277/R16). */}
        <span className="mr-10 text-[11px] text-muted-foreground md:mr-0">
          {contadorContactos(contactos.todas.length)}
        </span>
      </header>

      <div className="px-3 py-3">
        <div className="flex items-center gap-2 rounded-full bg-muted px-3.5 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar guía o destinatario"
            aria-label="Buscar guía o destinatario"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {/* Orden en gestión: se ancla arriba con la barra de marca (mismo lenguaje que
            el MODO FOCO del módulo). */}
        {enGestion ? (
          <section aria-label="Orden en gestión">
            <div className="flex items-center gap-1.5 px-4 pb-1 pt-1">
              <MessageSquareDot className="size-3.5 text-primary" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                En gestión
              </span>
            </div>
            <div className="border-l-[3px] border-primary bg-primary/5">
              <OrdenFila
                orden={enGestion}
                seleccionada={seleccionadaId === enGestion.id}
                noLeidos={noLeidos.get(enGestion.id) ?? 0}
                onSeleccionar={onSeleccionar}
              />
            </div>
          </section>
        ) : null}

        {/* Un grupo vacío no se pinta: un encabezado sobre la nada no dice nada, y el vacío
            general ya tiene su propio mensaje abajo. Los nombres accesibles de las secciones son
            los TRES distintos, que es por donde se identifican. */}
        {grupos.map((grupo) =>
          grupo.ordenes.length === 0 ? null : (
            <section key={grupo.titulo} aria-label={grupo.titulo}>
              <div className="px-4 pb-1 pt-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {grupo.titulo}
                </span>
              </div>
              <div className="divide-y divide-border/60">
                {grupo.ordenes.map((orden) => (
                  <OrdenFila
                    key={orden.id}
                    orden={orden}
                    seleccionada={seleccionadaId === orden.id}
                    noLeidos={noLeidos.get(orden.id) ?? 0}
                    onSeleccionar={onSeleccionar}
                  />
                ))}
              </div>
            </section>
          ),
        )}

        {visibles === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {contactos.todas.length === 0 ? SIN_CONTACTOS : SIN_COINCIDENCIAS}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

"use client";

import useSWR from "swr";

import { HiloNotasOrden } from "@/components/shared/HiloNotasOrden";
import { Modal } from "@/components/shared/Modal";
import {
  borrarNotaOrden,
  listarNotasOrden,
  publicarNotaOrden,
} from "@/lib/actions/orden-notas";
import type { NovedadDTO } from "@/lib/types/novedad";

// Feature 227 (T3.3, design §5.1) — montaje del hilo del lado TIENDA.
//
// CARGA BAJO DEMANDA, y ése es el punto entero de este archivo. El hilo NO viaja dentro de
// `NovedadDTO` ni se pide en el listado paginado: sería una consulta por orden de la página
// (N+1, alternativa A6 descartada en design §4/§6) para un dato que solo se mira al abrir una
// orden. El padre monta este modal SOLO con una orden activa y con `key={orden.id}`, así que
// la lectura ocurre una vez, al abrir, y arranca fresca en cada apertura.
//
// La ventana de escritura NO se decide aquí: `puedeEscribir` llega en la respuesta de
// `listarNotasOrden` y es «este actor, con este rol, está dentro de SU ventana» (R19/D1). Esta
// pantalla lista exactamente las órdenes `devuelta` (`novedadWhere`), que es la ventana del
// adminTienda, pero eso lo afirma el servidor: la UI no lo re-deriva del estatus.

const TEXTOS = {
  titulo: "Notas de la orden",
  hilo: "Notas con el mensajero",
  cargando: "Cargando las notas…",
  cerrar: "Cerrar",
  forbidden:
    "No podés ver las notas de esta orden. Actualizá la pantalla: puede que ya no esté en devolución.",
  sesion: "Tu sesión expiró. Iniciá sesión de nuevo para ver las notas.",
  fallo: "No se pudieron cargar las notas. Cerrá y volvé a abrir para intentarlo.",
} as const;

export interface HiloNotasNovedadModalProps {
  /** Orden abierta (snapshot). El padre monta el modal solo cuando hay una. */
  orden: NovedadDTO;
  onOpenChange: (open: boolean) => void;
}

/**
 * @sin-superficie el 2026-08-18, por pedido humano, se retiro el boton «Notas» de
 * `NovedadAcciones`, que era el UNICO punto desde el que `/novedades` abria este modal. El
 * componente se conserva intacto y sin montar en vez de borrarse por dos razones: la guardia
 * `orden-nota-frontera` lo lleva en su lista FIRMADA de nucleo del hilo (borrarlo la pone roja y
 * es una decision aparte, no la consecuencia de quitar un boton), y volver a darle superficie es
 * reponer una linea en el modulo. CONSECUENCIA VIVA MIENTRAS ESTO SIGA ASI: la tienda no lee ni
 * responde el hilo desde `/novedades`, y eso incluye el MOTIVO de una solicitud de ayuda, que el
 * mensajero publica como nota de ese mismo hilo.
 */
export function HiloNotasNovedadModal({
  orden,
  onOpenChange,
}: Readonly<HiloNotasNovedadModalProps>) {
  // Se lee con SWR y la Server Action como fetcher, mismo patrón que el hilo del chat
  // (`ChatConversacion`): la clave lleva el `ordenId` y `mutate()` es el refresco DESDE EL
  // SERVIDOR que el hilo pide tras publicar o borrar (R17). El modal solo existe mientras
  // hay una orden abierta, así que la clave nace y muere con la apertura.
  const {
    data: hilo,
    isLoading,
    mutate,
  } = useSWR(["orden-notas", orden.id], () =>
    listarNotasOrden({ ordenId: orden.id }),
  );

  const hiloOk = hilo?.status === "ok" ? hilo : null;
  /** Motivo del rechazo TIPADO (o del fallo de transporte, que SWR ya capturó). */
  const aviso =
    hilo?.status === "forbidden"
      ? TEXTOS.forbidden
      : hilo?.status === "unauthenticated"
        ? TEXTOS.sesion
        : TEXTOS.fallo;

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title={TEXTOS.titulo}
      description={`Conversación sobre la orden de ${orden.destinatario}.`}
      hideConfirm
      cancelLabel={TEXTOS.cerrar}
      size="md"
    >
      {isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          {TEXTOS.cargando}
        </p>
      ) : hiloOk ? (
        <HiloNotasOrden
          ordenId={orden.id}
          notas={hiloOk.notas}
          puedeEscribir={hiloOk.puedeEscribir}
          onPublicar={publicarNotaOrden}
          onBorrar={borrarNotaOrden}
          onRefrescar={async () => {
            await mutate();
          }}
          titulo={TEXTOS.hilo}
        />
      ) : (
        <p role="alert" className="text-sm text-danger-strong">
          {aviso}
        </p>
      )}
    </Modal>
  );
}

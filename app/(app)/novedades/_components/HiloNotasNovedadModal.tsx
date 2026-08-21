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
// `listarNotasOrden` y es «este actor, con este rol, está dentro de SU ventana» (R19/D1).
//
// ⚠️ 2026-08-19 (FEATURE 236, T6.7) — ESTA CABECERA DECÍA «esta pantalla lista exactamente las
// órdenes `devuelta`», y ya no es cierto: `/novedades` lista ahora DOS GRUPOS —la devolución
// anclada (`devuelta`) y la ayuda solicitada (`ayuda_tienda`)—, cada uno en su pestaña y con su
// predicado. Lo que NO cambió es lo que esa frase protegía, y por eso se conserva palabra por
// palabra: **la UI no re-deriva `puedeEscribir` del estatus** (R30). Los dos grupos coinciden hoy
// con `VENTANA_ESCRITURA.adminTienda`, pero eso lo afirma el SERVIDOR y lo vigila una guardia
// (`hilo-ventana-alcanzable`), no una condición escrita aquí. El día que dejen de coincidir, este
// componente seguirá siendo correcto sin tocarlo.

const TEXTOS = {
  titulo: "Notas de la orden",
  hilo: "Notas con el mensajero",
  cargando: "Cargando las notas…",
  cerrar: "Cerrar",
  // 2026-08-19 (feature 236): decía «puede que ya no esté en devolución». Sobre una orden en la
  // que un mensajero pidió ayuda —que sigue en la calle y nunca se devolvió— eso era falso, que es
  // justo la clase de afirmación que esta ficha vino a retirar de la pantalla. El motivo sigue
  // siendo OPACO (el servidor no dice cuál de los cinco es) y sigue diciendo qué hacer.
  forbidden:
    "No podés ver las notas de esta orden. Actualizá la pantalla: puede que su estado ya no lo permita.",
  sesion: "Tu sesión expiró. Iniciá sesión de nuevo para ver las notas.",
  fallo: "No se pudieron cargar las notas. Cerrá y volvé a abrir para intentarlo.",
} as const;

export interface HiloNotasNovedadModalProps {
  /** Orden abierta (snapshot). El padre monta el modal solo cuando hay una. */
  orden: NovedadDTO;
  onOpenChange: (open: boolean) => void;
}

/**
 * **VUELVE A TENER SUPERFICIE el 2026-08-19 (feature 236, T6.1 — R27).**
 *
 * El 2026-08-18, por pedido humano, se retiró el botón «Notas» de `NovedadAcciones`, que era el
 * ÚNICO punto desde el que `/novedades` abría este modal. Durante ese día el componente vivió en
 * disco sin montar, anotado `@sin-superficie`, y la consecuencia estaba escrita: **la tienda no
 * leía ni respondía el hilo, y eso incluía el MOTIVO de una solicitud de ayuda** — que el mensajero
 * publica precisamente como nota de este mismo hilo, y que la 235 hizo OBLIGATORIA.
 *
 * Lo repone la acción «Conversación» de la card del grupo de ayuda (`ACCIONES_POR_GRUPO`), montada
 * por `NovedadesModule` con `key={orden.id}`. Fue **reponer una línea en el módulo**, tal como
 * decía la anotación: no se escribió ningún hilo nuevo, ni se tocó este archivo más allá de esta
 * nota y de la cabecera. Se cuenta en vez de borrarse porque explica por qué este componente
 * sobrevivió un día sin consumidores —la guardia `orden-nota-frontera` lo lleva en su lista FIRMADA
 * de núcleo del hilo, así que borrarlo era una decisión aparte y no la consecuencia de quitar un
 * botón— y porque es el precedente de lo que cuesta retirar una superficie sin mirar quién la
 * usaba.
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

"use client";

import useSWR from "swr";

import { HiloNotasOrden } from "@/components/shared/HiloNotasOrden";
import { Modal } from "@/components/shared/Modal";
import {
  borrarNotaOrden,
  listarNotasOrden,
  publicarNotaOrden,
} from "@/lib/actions/orden-notas";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 235 (T5.2, R35) — montaje del hilo del lado MENSAJERO, para las órdenes en
// `ayuda_tienda`.
//
// POR QUÉ EXISTE, y por qué no basta con la ventana. Desde la 235 el mensajero tiene la ventana de
// escritura abierta sobre una orden en `ayuda_tienda` (`VENTANA_ESCRITURA.mensajero` la incluye,
// R34), pero su única superficie del hilo vivía DENTRO de `GestionarOrdenPanel` — y ese panel es
// inalcanzable para estas órdenes, porque dejan de ser gestionables (R16). Sin esto, el mensajero
// tendría el permiso y ningún sitio donde ejercerlo: el permiso inejercitable que R35 prohíbe. Y la
// consecuencia real no es abstracta: la tienda le escribe «¿el cliente está?» y no hay quien
// conteste. El hilo bidireccional se vuelve unidireccional de hecho.
//
// NO SE ESCRIBE NINGÚN HILO NUEVO. Es el MISMO montaje que `HiloNotasNovedadModal` hace del lado
// tienda, sobre el MISMO componente compartido (`components/shared/HiloNotasOrden`) y las MISMAS
// Server Actions. Lo único propio es de qué DTO sale la orden.
//
// CARGA BAJO DEMANDA: el hilo NO viaja dentro de `MiAsignacionDTO` ni se pide en el listado del
// portal — sería una consulta por orden en la pantalla más caliente. El padre monta este modal solo
// con una orden abierta y con `key={orden.id}`, así que la lectura ocurre al abrir y arranca fresca
// en cada apertura.
//
// LA VENTANA DE ESCRITURA NO SE DECIDE AQUÍ: `puedeEscribir` llega en la respuesta de
// `listarNotasOrden`, calculado en el servidor (R19/D1 de la 227). La UI no la re-deriva del
// estatus; si lo hiciera, sería la segunda fuente de verdad de siempre.

const TEXTOS = {
  titulo: "Conversación de la orden",
  hilo: "Notas con la tienda",
  cargando: "Cargando las notas…",
  cerrar: "Cerrar",
  forbidden:
    "No podés ver las notas de esta orden. Actualizá la pantalla: puede que ya no esté asignada a vos.",
  sesion: "Tu sesión expiró. Iniciá sesión de nuevo para ver las notas.",
  fallo: "No se pudieron cargar las notas. Cerrá y volvé a abrir para intentarlo.",
} as const;

export interface HiloNotasAyudaModalProps {
  /** Orden abierta (snapshot). El padre monta el modal solo cuando hay una. */
  orden: MiAsignacionDTO;
  onOpenChange: (open: boolean) => void;
}

export function HiloNotasAyudaModal({
  orden,
  onOpenChange,
}: Readonly<HiloNotasAyudaModalProps>) {
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

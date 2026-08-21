"use client";

import { useState } from "react";
import { Truck } from "lucide-react";
import useSWR from "swr";

import { EmptyState } from "@/components/shared/EmptyState";
import { Modal } from "@/components/shared/Modal";
import { Pagination } from "@/components/shared/Pagination";
import { TabsGroup } from "@/components/shared/TabsGroup";
import { useToast } from "@/hooks/useToast";
import {
  listarPostulacionesRecurso,
  marcarPostulacionRecursoAtendida,
} from "@/lib/actions/atencion-postulaciones-recurso";
import { postulacionRecursoConfig } from "@/lib/config/postulacion-recurso";
import type { PostulacionRecursoDTO } from "@/lib/types/postulacion-recurso";

import { PostulacionRecursoCard } from "./PostulacionRecursoCard";
import { postulacionRecursoErrorMessage } from "./postulacion-recurso-error-messages";

// Feature 253 (T7.2, design §7) — el panel del admin de las postulaciones de vehiculo o bodega.
//
// ⚠️ VA AL LADO DE `PostulacionesPendientesPanel`, NO DENTRO. Aquel componente sabe demasiado de
// otra cosa: firma URLs de un bucket privado, tiene su `EmptyState` con copy de mensajeros y su
// modal decide entre "Aprobar" y "Rechazar" un `EstadoUsuario`. Meter aqui un tercer caso
// mezclaria dos dominios que solo comparten la palabra "postulacion" (design §7). Lo que SI se
// comparte es la FORMA: mismo fetcher SWR que lanza, misma `Pagination`, mismo `Modal`, mismo
// `EmptyState`. Se copia el patron, no el componente.

/** Las dos pestanas (R33). El valor viaja al filtro `atendidas` del listado. */
const PESTANA_PENDIENTES = "pendientes";
const PESTANA_ATENDIDAS = "atendidas";

/** R35 — el estado vacio EXPLICA de donde salen estas postulaciones, no dice solo "no hay nada". */
const TEXTO_VACIO_PENDIENTES =
  "Cuando alguien ofrezca su vehículo o su bodega desde la web, su postulación aparece acá para que la contacten.";
const TEXTO_VACIO_ATENDIDAS =
  "Acá quedan las postulaciones que alguien del equipo ya marcó como atendidas.";

/** El fallo de CARGA tampoco puede ser mudo: si el listado no llega, la pantalla lo dice. */
const TEXTO_ERROR_CARGA =
  "No se pudieron cargar las postulaciones de vehículos y bodegas.";

interface PaginaPostulaciones {
  items: PostulacionRecursoDTO[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Fetcher del listado: llama la Server Action del admin y **lanza** si el resultado no es `ok`,
 * para que SWR exponga `error` y la pantalla pueda pintarlo. Molde literal de
 * `PostulacionesPendientesPanel.pendientesFetcher`.
 */
async function postulacionesFetcher(
  atendidas: boolean,
  page: number,
  pageSize: number,
): Promise<PaginaPostulaciones> {
  const res = await listarPostulacionesRecurso({ atendidas, page, pageSize });
  if (res.status !== "ok") throw new Error(res.status);
  return {
    items: res.items,
    page: res.page,
    pageSize: res.pageSize,
    total: res.total,
  };
}

export function PostulacionRecursoPanel() {
  const [pestana, setPestana] = useState<string>(PESTANA_PENDIENTES);
  const [page, setPage] = useState(1);
  const [aAtender, setAAtender] = useState<PostulacionRecursoDTO | null>(null);
  /**
   * R34 — el fallo de atender se pinta EN LA PANTALLA, no solo por toast. El toast es un aviso
   * que se va solo; si el unico canal fuera ese, quien mira la lista dos segundos despues no
   * tiene forma de saber que la operacion no ocurrio. La fila, mientras tanto, PERMANECE.
   */
  const [errorAtender, setErrorAtender] = useState<string | null>(null);

  const atendidas = pestana === PESTANA_ATENDIDAS;
  const pageSize = postulacionRecursoConfig.PAGE_SIZE_DEFAULT;
  const toast = useToast();

  const { data, error, isLoading, mutate } = useSWR(
    ["postulaciones-recurso", atendidas, page, pageSize],
    () => postulacionesFetcher(atendidas, page, pageSize),
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  function cambiarPestana(siguiente: string) {
    setPestana(siguiente);
    // La pagina 7 de pendientes no existe en atendidas: quedarse en ella pintaria un vacio que
    // no significa "no hay ninguna".
    setPage(1);
    setErrorAtender(null);
  }

  /**
   * Confirmacion del modal. En `ok`: toast, refresco (la fila desaparece de pendientes y aparece
   * en atendidas) y el `Modal` cierra solo. En `ActionError` se LANZA, para reusar el canal
   * `onError` del `Modal`: el modal permanece abierto y la fila permanece.
   */
  async function handleConfirm() {
    if (!aAtender) return;
    setErrorAtender(null);

    const res = await marcarPostulacionRecursoAtendida(aAtender.id);
    if (res.status !== "ok") throw res;

    toast.success("Postulación marcada como atendida.");
    await mutate();
  }

  function handleError(err: unknown) {
    const status =
      err && typeof err === "object" && "status" in err
        ? String((err as { status: unknown }).status)
        : "";
    const mensaje = postulacionRecursoErrorMessage(status);
    // Los DOS canales, a proposito: el toast avisa ahora y el texto se queda.
    setErrorAtender(mensaje);
    toast.error(mensaje);
  }

  const contenido = (
    <div className="flex flex-col gap-4">
      {errorAtender ? (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger-strong"
        >
          {errorAtender}
        </p>
      ) : null}

      {isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Cargando postulaciones de vehículos y bodegas…
        </p>
      ) : error ? (
        <p role="alert" className="text-sm text-danger-strong">
          {TEXTO_ERROR_CARGA}
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={
            atendidas
              ? "No hay postulaciones atendidas"
              : "No hay vehículos ni bodegas por revisar"
          }
          description={atendidas ? TEXTO_VACIO_ATENDIDAS : TEXTO_VACIO_PENDIENTES}
          className="rounded-xl border border-dashed border-border bg-muted/30 py-20"
        />
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {items.map((postulacion) => (
              <li key={postulacion.id}>
                <PostulacionRecursoCard
                  postulacion={postulacion}
                  onAtender={atendidas ? undefined : setAAtender}
                />
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            disabled={isLoading}
            showFirstLast
            siblingCount={1}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );

  return (
    <section
      className="flex flex-col gap-4"
      aria-label="Vehículos y bodegas ofrecidos"
    >
      <TabsGroup
        ariaLabel="Estado de las postulaciones de vehículos y bodegas"
        value={pestana}
        onValueChange={cambiarPestana}
        items={[
          { value: PESTANA_PENDIENTES, label: "Pendientes", content: contenido },
          { value: PESTANA_ATENDIDAS, label: "Atendidas", content: contenido },
        ]}
      />

      <Modal
        open={aAtender !== null}
        onOpenChange={(next) => {
          if (!next) setAAtender(null);
        }}
        title="Marcar como atendida"
        description={
          aAtender
            ? `¿Ya contactaron a ${aAtender.nombre}? La postulación pasa a la pestaña «Atendidas».`
            : undefined
        }
        confirmLabel="Marcar como atendida"
        onConfirm={handleConfirm}
        onError={handleError}
      />
    </section>
  );
}

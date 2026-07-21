"use client";

import { useState } from "react";
import useSWR from "swr";

import { Modal } from "@/components/shared/Modal";
import { Pagination } from "@/components/shared/Pagination";
import { useToast } from "@/hooks/useToast";
import {
  aprobarPostulacion,
  listarPostulacionesPendientes,
  rechazarPostulacion,
} from "@/lib/actions/aprobacion-postulaciones";
import { aprobacionPostulacionesConfig } from "@/lib/config/aprobacion-postulaciones";
import type { ActionError } from "@/lib/types/orden";
import type { PostulacionPendienteDTO } from "@/lib/types/aprobacion-postulacion";

import { PostulacionCard } from "./PostulacionCard";
import { decisionErrorMessage } from "./decision-error-messages";

interface PendientesPageData {
  items: PostulacionPendienteDTO[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Fetcher del listado: llama la Server Action de la feature 22 y lanza si el
 * resultado no es "ok", para que SWR exponga `error` (R12). Regenerar el listado
 * (revalidacion) refresca tambien las URLs firmadas caducables (A2).
 */
async function pendientesFetcher(
  page: number,
  pageSize: number,
): Promise<PendientesPageData> {
  const res = await listarPostulacionesPendientes({ page, pageSize });
  if (res.status !== "ok") throw new Error(res.status);
  return {
    items: res.items,
    page: res.page,
    pageSize: res.pageSize,
    total: res.total,
  };
}

type AccionTipo = "aprobar" | "rechazar";

interface AccionEnCurso {
  usuarioId: string;
  nombre: string;
  tipo: AccionTipo;
}

function nombreCompleto(p: PostulacionPendienteDTO): string {
  return [p.nombre, p.primerApellido, p.segundoApellido]
    .filter((part): part is string => !!part && part.trim() !== "")
    .join(" ");
}

/** Type guard: el resultado de decision es un ActionError (status != "ok"). */
function esActionError(result: { status: string }): result is ActionError {
  return result.status !== "ok";
}

/**
 * Panel de postulaciones pendientes (feature 23, R5–R18). Client Component que
 * consume las Server Actions de la feature 22 via SWR (listar) y llamadas
 * directas (aprobar/rechazar). Estados: carga, error, vacio y lista de tarjetas
 * + paginacion. La confirmacion usa el `Modal` async (spinner + anti doble-submit);
 * el resultado se comunica por `Toast` y refresca el listado (la fila desaparece).
 */
export function PostulacionesPendientesPanel() {
  const [page, setPage] = useState(1);
  const pageSize = aprobacionPostulacionesConfig.PAGE_SIZE_DEFAULT;
  const [accion, setAccion] = useState<AccionEnCurso | null>(null);

  const toast = useToast();

  const { data, error, isLoading, mutate } = useSWR(
    ["postulaciones:pendientes", page, pageSize],
    () => pendientesFetcher(page, pageSize),
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  function abrirConfirmacion(
    tipo: AccionTipo,
    postulacion: PostulacionPendienteDTO,
  ) {
    setAccion({
      usuarioId: postulacion.usuarioId,
      nombre: nombreCompleto(postulacion),
      tipo,
    });
  }

  /**
   * Confirmacion del modal: ejecuta la action segun el tipo. En `ok` muestra
   * toast de exito, refresca (mutate) y deja que el Modal cierre. En ActionError
   * lanza para que el Modal invoque `onError` y el modal permanezca abierto (R18).
   */
  async function handleConfirm() {
    if (!accion) return;
    const { usuarioId, tipo } = accion;

    const result =
      tipo === "aprobar"
        ? await aprobarPostulacion(usuarioId)
        : await rechazarPostulacion(usuarioId);

    if (esActionError(result)) {
      // R18: se lanza para reusar el canal onError del Modal; el toast de error
      // se dispara en onError. El modal permanece abierto y la fila permanece.
      throw result;
    }

    // R17: exito -> toast, refresco (la fila desaparece), y el Modal cierra solo.
    toast.success(
      tipo === "aprobar"
        ? "Postulación aprobada."
        : "Postulación rechazada.",
    );
    await mutate();
  }

  function handleError(err: unknown) {
    // El error lanzado en handleConfirm es el propio ActionError.
    const status =
      err && typeof err === "object" && "status" in err
        ? (err as ActionError).status
        : "validation_error";
    toast.error(decisionErrorMessage(status));
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Postulaciones pendientes">
      {isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Cargando postulaciones…
        </p>
      ) : error ? (
        <p role="alert" className="text-sm text-danger-strong">
          No se pudieron cargar las postulaciones
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay postulaciones pendientes
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {items.map((postulacion) => (
              <li key={postulacion.usuarioId}>
                <PostulacionCard
                  postulacion={postulacion}
                  onAprobar={(p) => abrirConfirmacion("aprobar", p)}
                  onRechazar={(p) => abrirConfirmacion("rechazar", p)}
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

      <Modal
        open={accion !== null}
        onOpenChange={(next) => {
          if (!next) setAccion(null);
        }}
        title={
          accion?.tipo === "rechazar"
            ? "Rechazar postulación"
            : "Aprobar postulación"
        }
        description={
          accion
            ? accion.tipo === "rechazar"
              ? `¿Rechazar la postulación de ${accion.nombre}?`
              : `¿Aprobar la postulación de ${accion.nombre}?`
            : undefined
        }
        confirmLabel={accion?.tipo === "rechazar" ? "Rechazar" : "Aprobar"}
        confirmVariant={accion?.tipo === "rechazar" ? "destructive" : "default"}
        onConfirm={handleConfirm}
        onError={handleError}
      />
    </section>
  );
}

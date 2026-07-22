"use client";

import { useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import useSWR from "swr";

import { DataTable } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { apiKeysConfig } from "@/lib/config/api-keys";
import { listarApiKeys } from "@/lib/actions/api-keys";
import type { ApiKeyListItemDTO } from "@/lib/types/api-key";

import { buildApiKeysColumns } from "./api-keys-columns";
import {
  GenerarApiKeyForm,
  type GenerarApiKeyFormHandle,
} from "./GenerarApiKeyForm";
import { RevelarApiKeyModal } from "./RevelarApiKeyModal";

// R18/R19: opciones acotadas por MAX_PAGE_SIZE del backend.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= apiKeysConfig.MAX_PAGE_SIZE,
);

export interface ApiKeysPageData {
  items: ApiKeyListItemDTO[];
  total: number;
  pageSize: number;
}

export interface ApiKeysModuleProps {
  /** Listado pre-cargado en el servidor (R12); alimenta el fallback de SWR. */
  initialData: ApiKeysPageData;
}

/** Secreto revelado UNA sola vez tras generar (R24); `null` = sin revelar. */
interface Revelado {
  plainKey: string;
  identificador: string;
}

async function apiKeysFetcher(
  page: number,
  pageSize: number,
): Promise<ApiKeysPageData> {
  const res = await listarApiKeys({ page, pageSize });
  if (res.status !== "ok") throw new Error("list_failed");
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

/**
 * Módulo cliente de gestión de API keys (feature 82). Molde de `UsuariosModule`:
 * `DataTable` + `Pagination` (R14–R19), botón "Generar API key" (D9) que abre un
 * modal de creación con `GenerarApiKeyForm` (R20), y —tras `ok`— un modal de
 * revelado del secreto (R24–R28). Cablea las Server Actions; SWR con
 * `fallbackData` del servidor (R12).
 */
export function ApiKeysModule({ initialData }: ApiKeysModuleProps) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialData.pageSize);

  const [formOpen, setFormOpen] = useState(false);
  const [revelado, setRevelado] = useState<Revelado | null>(null);
  const formRef = useRef<GenerarApiKeyFormHandle>(null);

  const { data, error, isLoading, mutate } = useSWR(
    ["api-keys:list", page, pageSize],
    () => apiKeysFetcher(page, pageSize),
    {
      fallbackData:
        page === 1 && pageSize === initialData.pageSize
          ? initialData
          : undefined,
    },
  );

  function abrirGenerar() {
    setFormOpen(true);
  }

  async function onConfirmForm() {
    // R31: el `Modal` bloquea el segundo submit mientras esta promesa corre
    // (anti-doble-submit por fase "pending" + `pendingRef`).
    const res = await formRef.current?.submit();
    if (!res) return;
    if (res.status === "ok") {
      // R29: refresca el listado al recibir `ok`, ANTES de cerrar; la nueva fila
      // con su prefijo ya está en la tabla cuando aparece el modal de revelado.
      await mutate();
      setFormOpen(false);
      // R24: el secreto pasa al modal de revelado (única vez que existe).
      setRevelado({
        plainKey: res.plainKey,
        identificador: res.apiKey.identificador,
      });
    } else if (res.status !== "validation_error" && res.status !== "conflict") {
      // R23: forbidden / unauthenticated → toast; el modal NO se cierra (R21/R22
      // los pinta el propio formulario por campo).
      toast.error(mensajeError(res.status));
    }
  }

  // Una sola fuente de verdad de la key SWR: la celda de acciones refresca el
  // listado a través de este `onMutated` (que llama a `mutate`), en vez de tocar
  // el caché SWR por su cuenta. El revelado del secreto rotado lo maneja la propia
  // celda con su `RevelarApiKeyModal`; aquí solo se reusa para el secreto generado.
  const columns = buildApiKeysColumns({ onMutated: () => mutate().then(() => {}) });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" onClick={abrirGenerar}>
          Generar API key
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        rowKey="id"
        ariaLabel="API keys"
        isLoading={isLoading}
        error={error ? "No se pudieron cargar las API keys" : null}
        emptyState={{
          icon: KeyRound,
          title: "No hay API keys",
          description: "Genera una API key para conectar sistemas externos con Ordenex.",
          action: (
            <Button type="button" onClick={abrirGenerar}>
              Generar API key
            </Button>
          ),
        }}
      />

      <Pagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        disabled={isLoading}
        showFirstLast
        siblingCount={1}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
      />

      <Modal
        open={formOpen}
        onOpenChange={setFormOpen}
        title="Generar API key"
        confirmLabel="Generar"
        cancelLabel="Cancelar"
        closeOnConfirm={false}
        onConfirm={onConfirmForm}
      >
        <GenerarApiKeyForm ref={formRef} />
      </Modal>

      {revelado ? (
        <RevelarApiKeyModal
          plainKey={revelado.plainKey}
          identificador={revelado.identificador}
          onClose={() => setRevelado(null)}
        />
      ) : null}
    </section>
  );
}

/**
 * Traduce el `status` de error del backend a un mensaje de UI. Solo cubre los
 * estados que llegan aquí como toast (`forbidden`/`unauthenticated`); el detalle
 * de validación y el conflicto se muestran por campo en el formulario.
 */
function mensajeError(status: string): string {
  switch (status) {
    case "unauthenticated":
      return "Tu sesión expiró. Vuelve a iniciar sesión.";
    case "forbidden":
      return "No tienes permiso para esta acción.";
    default:
      return "Revisa los datos e inténtalo de nuevo.";
  }
}

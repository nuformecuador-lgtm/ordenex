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
import { registrarWebhook } from "@/lib/actions/webhooks";
import type { ApiKeyListItemDTO } from "@/lib/types/api-key";

import { buildApiKeysColumns } from "./api-keys-columns";
import {
  GenerarApiKeyForm,
  type GenerarApiKeyFormHandle,
} from "./GenerarApiKeyForm";
import { RevelarSecretosModal } from "./RevelarSecretosModal";

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

/**
 * Secretos revelados UNA sola vez tras el alta (R7/R8); `null` = sin revelar.
 * Feature 108: el revelado es combinado (clave de API + secreto de webhook). Si el
 * webhook no se solicitó o falló, `webhookSecret` es `null`; en el fallo parcial
 * (R11) `webhookFallo` porta el aviso neutro.
 */
interface Revelado {
  plainKey: string;
  identificador: string;
  webhookSecret: string | null;
  webhookFallo: string | null;
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
    // R6/R31: la fase "pending" del `Modal` (anti-doble-submit por `pendingRef`)
    // cubre TODA esta promesa, que abarca las DOS acciones encadenadas.
    const out = await formRef.current?.submit();
    if (!out) return;
    const { keyResult, webhookUrl } = out;

    if (keyResult.status !== "ok") {
      if (
        keyResult.status !== "validation_error" &&
        keyResult.status !== "conflict"
      ) {
        // R23: forbidden / unauthenticated → toast; el modal NO se cierra
        // (validation_error/conflict los pinta el propio formulario por campo).
        toast.error(mensajeError(keyResult.status));
      }
      return;
    }

    const { plainKey } = keyResult;
    const identificador = keyResult.apiKey.identificador;

    // R2: sin URL de webhook → una sola acción; se revela solo la clave.
    if (webhookUrl.length === 0) {
      await mutate(); // R14: refresca ANTES del revelado.
      setFormOpen(false);
      setRevelado({
        plainKey,
        identificador,
        webhookSecret: null,
        webhookFallo: null,
      });
      return;
    }

    // R5: encadena `registrarWebhook` reusando el `usuarioId` que trae la key.
    const wh = await registrarWebhook({
      ownerUsuarioId: keyResult.apiKey.usuarioId,
      url: webhookUrl,
    });

    // R14: refresca el listado antes de revelar, en éxito o fallo parcial.
    await mutate();
    setFormOpen(false);

    if (wh.status === "creada") {
      // R8: revelado combinado de ambos secretos, una sola vez.
      setRevelado({
        plainKey,
        identificador,
        webhookSecret: wh.secret,
        webhookFallo: null,
      });
    } else {
      // R11/R12/R13: fallo parcial. La key ya existe: se revela igual su secreto,
      // se avisa (sin internals) que el webhook no quedó registrado y la fila
      // permite reintentar por el botón "Editar". El secreto NUNCA se pierde.
      toast.error(
        "La API key se creó, pero el webhook no quedó registrado. Puedes registrarlo con el botón Editar de la fila.",
      );
      setRevelado({
        plainKey,
        identificador,
        webhookSecret: null,
        webhookFallo:
          "La API key se creó, pero el webhook no quedó registrado. Puedes registrarlo con el botón Editar de la fila.",
      });
    }
  }

  const columns = buildApiKeysColumns();

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
        <RevelarSecretosModal
          plainKey={revelado.plainKey}
          identificador={revelado.identificador}
          webhookSecret={revelado.webhookSecret}
          webhookFallo={revelado.webhookFallo}
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

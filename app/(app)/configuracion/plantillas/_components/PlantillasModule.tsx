"use client";

import { useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import useSWR from "swr";

import { DataTable } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { useToast } from "@/hooks/useToast";
import { plantillasConfig } from "@/lib/config/plantillas";
import {
  cambiarEstadoPlantilla,
  eliminarPlantilla,
  enviarPlantillaAprobacion,
  listarPlantillas,
  listarPlantillasCompleto,
  marcarPlantillaBienvenida,
} from "@/lib/actions/plantillas";
import type { PlantillaListItemDTO } from "@/lib/types/plantilla-mensaje";

import { buildPlantillasColumns } from "./plantillas-columns";
import {
  COLUMNAS_DESCARGA_PLANTILLAS,
  filaDescargaPlantilla,
} from "./plantillas-descarga-columnas";
import {
  CrearPlantillaForm,
  type CrearPlantillaFormHandle,
} from "./CrearPlantillaForm";
import {
  EditarPlantillaForm,
  type EditarPlantillaFormHandle,
} from "./EditarPlantillaForm";
import { FormSheet } from "./FormSheet";
import { SincronizarPlantillasButton } from "./SincronizarPlantillasButton";

// Opciones acotadas por MAX_PAGE_SIZE del backend (nunca una consulta sin límite).
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= plantillasConfig.MAX_PAGE_SIZE,
);

/** R12/R13: nombre visible del listado; da nombre a la hoja, al archivo y al control. */
const TITULO_DESCARGA = "Plantillas de mensaje";

export interface PlantillasPageData {
  items: PlantillaListItemDTO[];
  total: number;
  pageSize: number;
}

export interface PlantillasModuleProps {
  /** Listado pre-cargado en el servidor; alimenta el fallback de SWR. */
  initialData: PlantillasPageData;
}

async function plantillasFetcher(
  page: number,
  pageSize: number,
): Promise<PlantillasPageData> {
  const res = await listarPlantillas({ page, pageSize });
  if (res.status !== "ok") throw new Error("list_failed");
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

/**
 * Módulo cliente de gestión de plantillas (feature 107). Molde de `ApiKeysModule`:
 * `DataTable` + `Pagination`, botón "Nueva plantilla" que abre el formulario de
 * creación (R8), edición por fila (R20) y la ÚNICA acción de estado "Desactivar"
 * (destino `inactivo`, R24). Cablea las Server Actions; SWR con `fallbackData` del
 * servidor.
 */
export function PlantillasModule({ initialData }: PlantillasModuleProps) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialData.pageSize);

  const [crearOpen, setCrearOpen] = useState(false);
  const [editar, setEditar] = useState<PlantillaListItemDTO | null>(null);
  // Aviso PREVIO a editar una plantilla que Meta ya tiene: editarla la devuelve a revisión y
  // la deja sin usar mientras tanto. Se pregunta ANTES de abrir el formulario, no después de
  // escribir: descubrir la consecuencia con el texto ya cambiado es descubrirla tarde.
  const [avisoEditar, setAvisoEditar] = useState<PlantillaListItemDTO | null>(null);
  const [enviarAprobacion, setEnviarAprobacion] = useState<PlantillaListItemDTO | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [desactivar, setDesactivar] = useState<PlantillaListItemDTO | null>(
    null,
  );
  const [eliminar, setEliminar] = useState<PlantillaListItemDTO | null>(null);

  const crearRef = useRef<CrearPlantillaFormHandle>(null);
  const editarRef = useRef<EditarPlantillaFormHandle>(null);

  const { data, error, isLoading, mutate } = useSWR(
    ["plantillas:list", page, pageSize],
    () => plantillasFetcher(page, pageSize),
    {
      fallbackData:
        page === 1 && pageSize === initialData.pageSize
          ? initialData
          : undefined,
    },
  );

  async function onConfirmCrear() {
    const res = await crearRef.current?.submit();
    if (!res) return;
    if (res.status === "ok") {
      await mutate();
      setCrearOpen(false);
    } else if (res.status !== "validation_error" && res.status !== "conflict") {
      // forbidden/unauthenticated → toast; validación y conflicto los pinta el form.
      toast.error(mensajeError(res.status));
    }
  }

  async function onConfirmEditar() {
    const res = await editarRef.current?.submit();
    if (!res) return;
    if (res.status === "ok") {
      await mutate();
      setEditar(null);
    } else if (res.status === "not_found") {
      toast.error("La plantilla ya no existe.");
      await mutate();
      setEditar(null);
    } else if (res.status !== "validation_error" && res.status !== "conflict") {
      toast.error(mensajeError(res.status));
    }
  }

  /**
   * Abre la edición. Un BORRADOR (guardado sin aprobación y nunca enlazado con Meta) entra
   * directo: editarlo no tiene consecuencia, sigue siendo un borrador. Cualquier otra pasa
   * primero por el aviso, porque guardar la manda a revisión.
   */
  function onEditarClick(row: PlantillaListItemDTO) {
    const esBorrador = row.estado === "saved_not_aprobation" && row.templateId === null;
    if (esBorrador) setEditar(row);
    else setAvisoEditar(row);
  }

  async function onConfirmEnviarAprobacion() {
    if (!enviarAprobacion) return;
    // El botón queda deshabilitado mientras dura la llamada: el envío NO se puede cancelar,
    // así que lo último que debe permitir esta pantalla es dispararlo dos veces.
    setEnviando(true);
    try {
      const res = await enviarPlantillaAprobacion(enviarAprobacion.id);
      if (res.status === "ok") {
        toast.success("Plantilla enviada para aprobación.");
      } else if (res.status === "ya_enviada") {
        toast.info("Esa plantilla ya estaba en revisión.");
      } else if (res.status === "no_configurado") {
        toast.error("WhatsApp no está configurado: no hay a dónde enviarla.");
        return;
      } else if (res.status === "not_found") {
        toast.error("La plantilla ya no existe.");
      } else {
        toast.error(mensajeError(res.status));
        return;
      }
      await mutate();
      setEnviarAprobacion(null);
    } finally {
      setEnviando(false);
    }
  }

  /**
   * Marca la fila como MENSAJE DE BIENVENIDA. SIN modal de confirmación, a diferencia del
   * envío a aprobación: esto no sale de casa y se deshace marcando otra. Lo único irreversible
   * de la pantalla es lo que llega a Meta.
   */
  async function onMarcarBienvenida(row: PlantillaListItemDTO) {
    const res = await marcarPlantillaBienvenida(row.id);
    if (res.status === "ok") {
      toast.success(`"${row.nombre}" es ahora el mensaje de bienvenida.`);
      await mutate();
    } else if (res.status === "not_found") {
      toast.error("La plantilla ya no existe.");
      await mutate();
    } else if (res.status === "estado_invalido") {
      // El boton ya viene deshabilitado para este caso: llegar aqui significa que la fila
      // cambio de estado desde la ultima carga. Por eso se REFRESCA ademas de avisar, o el
      // maestro seguiria viendo un boton habilitado que no funciona.
      toast.error("Solo una plantilla activa puede ser el mensaje de bienvenida.");
      await mutate();
    } else {
      toast.error(mensajeError(res.status));
    }
  }

  async function onConfirmDesactivar() {
    if (!desactivar) return;
    // R24/R25: el front SOLO emite el destino `inactivo`.
    const res = await cambiarEstadoPlantilla(desactivar.id, {
      estado: "inactivo",
    });
    if (res.status === "ok") {
      await mutate();
      setDesactivar(null);
    } else if (res.status === "not_found") {
      toast.error("La plantilla ya no existe.");
      await mutate();
      setDesactivar(null);
    } else {
      toast.error(mensajeError(res.status));
    }
  }

  async function onConfirmEliminar() {
    if (!eliminar) return;
    // R27: SOFT DELETE; el backend excluye por `deletedAt IS NULL`, así que basta
    // con revalidar el listado para que la fila desaparezca.
    const res = await eliminarPlantilla(eliminar.id);
    if (res.status === "ok") {
      toast.success("Plantilla eliminada.");
      await mutate();
      setEliminar(null);
    } else if (res.status === "not_found") {
      // Ya no existe (borrada por otra sesión): igual sale del listado tras revalidar.
      toast.error("La plantilla ya no existe.");
      await mutate();
      setEliminar(null);
    } else {
      toast.error(mensajeError(res.status));
    }
  }

  const columns = buildPlantillasColumns({
    onEditar: onEditarClick,
    onEnviarAprobacion: (row) => setEnviarAprobacion(row),
    onDesactivar: (row) => setDesactivar(row),
    onEliminar: (row) => setEliminar(row),
    onMarcarBienvenida: (row) => void onMarcarBienvenida(row),
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-end gap-2">
        <SincronizarPlantillasButton onSincronizado={() => void mutate()} />
        <Button type="button" onClick={() => setCrearOpen(true)}>
          Nueva plantilla
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        rowKey="id"
        ariaLabel="Plantillas de mensaje"
        /**
         * Feature 170 (T B.4, R1/R9/R12/R13) — descarga del listado COMPLETO. Familia A:
         * lo que la tabla pinta es una página, así que las filas del archivo las trae la
         * Server Action del modo completo (mismo servicio, mismo guard de `maestro`, mismo
         * tope y la MISMA exclusión de plantillas borradas, que vive en el repositorio).
         *
         * El input va VACÍO: el schema es `.strict()` y sin `page`/`pageSize`, que en el
         * modo completo no significan nada (mandarlos daría `validation_error`).
         */
        descarga={{
          titulo: TITULO_DESCARGA,
          columnas: COLUMNAS_DESCARGA_PLANTILLAS,
          obtenerFilas: () =>
            filasDesdeResultado(listarPlantillasCompleto({}), filaDescargaPlantilla),
        }}
        isLoading={isLoading}
        error={error ? "No se pudieron cargar las plantillas" : null}
        emptyState={{
          icon: MessageSquareText,
          title: "No hay plantillas",
          description:
            "Crea una plantilla de mensaje con campos variables para reutilizarla.",
          action: (
            <Button type="button" onClick={() => setCrearOpen(true)}>
              Nueva plantilla
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

      <FormSheet
        open={crearOpen}
        onOpenChange={setCrearOpen}
        title="Nueva plantilla"
        confirmLabel="Crear"
        cancelLabel="Cancelar"
        onConfirm={onConfirmCrear}
      >
        <CrearPlantillaForm ref={crearRef} />
      </FormSheet>

      <FormSheet
        open={editar !== null}
        onOpenChange={(open) => {
          if (!open) setEditar(null);
        }}
        title="Editar plantilla"
        confirmLabel="Guardar"
        cancelLabel="Cancelar"
        onConfirm={onConfirmEditar}
      >
        {editar ? (
          <EditarPlantillaForm ref={editarRef} plantilla={editar} />
        ) : null}
      </FormSheet>

      <Modal
        open={enviarAprobacion !== null}
        onOpenChange={(open) => {
          if (!open && !enviando) setEnviarAprobacion(null);
        }}
        title="Enviar para aprobación"
        description={
          enviarAprobacion
            ? `La plantilla "${enviarAprobacion.nombre}" se enviará a WhatsApp para su aprobación. Este proceso NO se puede cancelar: una vez enviada, no se puede retirar de revisión ni volver atrás. La plantilla quedará en revisión y no podrá usarse hasta que WhatsApp la apruebe.`
            : undefined
        }
        confirmLabel={enviando ? "Enviando…" : "Continuar"}
        cancelLabel="Cancelar"
        closeOnConfirm={false}
        confirmDisabled={enviando}
        onConfirm={onConfirmEnviarAprobacion}
      />

      <Modal
        open={avisoEditar !== null}
        onOpenChange={(open) => {
          if (!open) setAvisoEditar(null);
        }}
        title="Editar envía la plantilla para aprobación"
        description={
          avisoEditar
            ? `Al actualizar "${avisoEditar.nombre}" se enviará de nuevo a WhatsApp para su aprobación y quedará deshabilitada para su uso hasta que sea aprobada. Se aconseja crear una plantilla nueva y eliminar la anterior cuando la nueva esté aprobada, para no quedarte sin ninguna disponible mientras tanto.`
            : undefined
        }
        confirmLabel="Continuar"
        cancelLabel="Cancelar"
        closeOnConfirm={false}
        onConfirm={() => {
          setEditar(avisoEditar);
          setAvisoEditar(null);
        }}
      />

      <Modal
        open={desactivar !== null}
        onOpenChange={(open) => {
          if (!open) setDesactivar(null);
        }}
        title="Desactivar plantilla"
        // Si la que se desactiva ES la bienvenida, el aviso lo dice ANTES de confirmar: la
        // marca se pierde sola (la desactivacion la retira) y nadie designa una sustituta.
        // Sin esta frase, el negocio se queda sin mensaje de bienvenida en silencio, y el
        // sitio donde se nota es el cliente que no recibe nada al recoger su paquete.
        description={
          desactivar
            ? desactivar.welcomeMessage
              ? `La plantilla "${desactivar.nombre}" pasará a estado inactivo y DEJARÁ DE SER el mensaje de bienvenida. Ninguna otra queda marcada: hasta que elijas una plantilla activa, no se enviará nada al recoger el paquete.`
              : `La plantilla "${desactivar.nombre}" pasará a estado inactivo.`
            : undefined
        }
        confirmLabel="Desactivar"
        cancelLabel="Cancelar"
        confirmVariant="destructive"
        closeOnConfirm={false}
        onConfirm={onConfirmDesactivar}
      />

      <Modal
        open={eliminar !== null}
        onOpenChange={(open) => {
          if (!open) setEliminar(null);
        }}
        title="Eliminar plantilla"
        description={
          eliminar
            ? `La plantilla "${eliminar.nombre}" se eliminará y dejará de aparecer en el listado.`
            : undefined
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        confirmVariant="destructive"
        closeOnConfirm={false}
        onConfirm={onConfirmEliminar}
      />
    </section>
  );
}

/** Traduce el `status` de error a un mensaje de UI (solo los que llegan como toast). */
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

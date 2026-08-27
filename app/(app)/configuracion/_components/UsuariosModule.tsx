"use client";

import { useRef, useState } from "react";
import { Users } from "lucide-react";
import useSWR from "swr";

import { DataTable } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { useToast } from "@/hooks/useToast";
import { usuariosConfig } from "@/lib/config/usuarios";
import {
  cambiarEstadoUsuario,
  obtenerUsuario,
  listarUsuarios,
  listarUsuariosCompleto,
  restablecerContrasenaUsuario,
} from "@/lib/actions/usuarios";
import type { UsuarioListItemDTO } from "@/lib/types/usuario";
import type { UsuarioPublico } from "@/lib/interfaces/repositories/IUserRepository";

import { buildUsuariosColumns } from "./usuarios-columns";
import {
  COLUMNAS_DESCARGA_USUARIOS,
  filaDescargaUsuario,
} from "./usuarios-descarga-columnas";
import { ContrasenaGeneradaPanel } from "./ContrasenaGeneradaPanel";
import { UsuarioForm, type UsuarioFormHandle } from "./UsuarioForm";

/** R12/R13: nombre visible del listado; da nombre a la hoja, al archivo y al control. */
const TITULO_DESCARGA = "Usuarios";

// R13: opciones acotadas por MAX_PAGE_SIZE del backend.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= usuariosConfig.MAX_PAGE_SIZE,
);

export interface UsuariosPageData {
  items: UsuarioListItemDTO[];
  total: number;
  pageSize: number;
}

export interface UsuariosModuleProps {
  /** Listado pre-cargado en el servidor (R13); alimenta el fallback de SWR. */
  initialData: UsuariosPageData;
}

/**
 * Feature 287/R21/R24 — la contraseña recién generada, viva SOLO en el estado de React de
 * este componente y solo hasta que se cierre el panel. No se guarda en `localStorage`, ni en
 * cookie, ni en la caché de SWR, ni se vuelve a pedir: el backend la devuelve exactamente una
 * vez, en la rama `ok`, y no existe ninguna lectura que la repita.
 */
interface ContrasenaRevelada {
  /** A quién pertenece; solo para nombrarlo en el encabezado del panel. */
  nombre: string;
  /** El claro. Se descarta al cerrar el panel (R29). */
  contrasena: string;
}

async function usuariosFetcher(
  page: number,
  pageSize: number,
): Promise<UsuariosPageData> {
  const res = await listarUsuarios({ page, pageSize });
  if (res.status !== "ok") throw new Error("list_failed");
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

type FormMode = "crear" | "editar";

/**
 * Módulo cliente de gestión de usuarios: DataTable + Pagination (R26), botón
 * Crear + Modal async con `UsuarioForm` (R27), activar/inactivar por fila
 * (R20/R21) y feedback vía `useToast` (R28). Cablea las Server Actions.
 */
export function UsuariosModule({ initialData }: UsuariosModuleProps) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialData.pageSize);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("crear");
  const [editUsuario, setEditUsuario] = useState<UsuarioPublico | null>(null);
  const [estadoPendienteId, setEstadoPendienteId] = useState<string | null>(null);
  const formRef = useRef<UsuarioFormHandle>(null);

  // Feature 287 (T10). Tres estados, y ninguno de los tres guarda nada fuera de React:
  // a quién se le va a restablecer (la confirmación de R26), qué fila está en curso, y la
  // contraseña revelada (R28), que se descarta al cerrar (R29).
  const [restablecerObjetivo, setRestablecerObjetivo] =
    useState<UsuarioListItemDTO | null>(null);
  const [restablecerPendienteId, setRestablecerPendienteId] = useState<string | null>(
    null,
  );
  const [contrasenaRevelada, setContrasenaRevelada] =
    useState<ContrasenaRevelada | null>(null);

  const { data, error, isLoading, mutate } = useSWR(
    ["usuarios:list", page, pageSize],
    () => usuariosFetcher(page, pageSize),
    { fallbackData: page === 1 && pageSize === initialData.pageSize ? initialData : undefined },
  );

  function abrirCrear() {
    setFormMode("crear");
    setEditUsuario(null);
    setFormOpen(true);
  }

  async function abrirEditar(row: UsuarioListItemDTO) {
    const res = await obtenerUsuario(row.id);
    if (res.status !== "ok") {
      toast.error(mensajeError(res.status));
      return;
    }
    setFormMode("editar");
    setEditUsuario(res.usuario);
    setFormOpen(true);
  }

  async function onConfirmForm() {
    const res = await formRef.current?.submit();
    if (!res) return;
    if (res.status === "ok") {
      await mutate();
      const conPassword = "generatedPassword" in res && !!res.generatedPassword;
      toast.success(
        formMode === "crear" ? "Usuario creado" : "Usuario actualizado",
      );
      // R33: si hay contraseña generada, el modal permanece abierto para
      // mostrarla una vez; el usuario lo cierra manualmente.
      if (!conPassword) setFormOpen(false);
    } else {
      toast.error(mensajeError(res.status));
    }
  }

  async function cambiarEstado(row: UsuarioListItemDTO) {
    const destino = row.estado === "activo" ? "inactivo" : "activo";
    setEstadoPendienteId(row.id);
    try {
      const res = await cambiarEstadoUsuario(row.id, { estado: destino });
      if (res.status === "ok") {
        await mutate();
        toast.success(
          destino === "inactivo" ? "Usuario inactivado" : "Usuario activado",
        );
      } else {
        toast.error(mensajeError(res.status));
      }
    } finally {
      setEstadoPendienteId(null);
    }
  }

  /**
   * Feature 287 (R26/R27/R28/R30) — el confirmar del modal, y NADA antes que él. El botón de
   * la fila solo abrió esta ventana; hasta aquí no se ha tocado ninguna contraseña.
   *
   * La acción recibe SOLO el `id` y eso es el requisito (R6/R10): no hay objeto de entrada,
   * luego no hay dónde meter una contraseña elegida por el maestro. Si alguna vez le crece un
   * segundo argumento de entrada, el test de forma de esta llamada se pone rojo.
   */
  async function confirmarRestablecer() {
    const objetivo = restablecerObjetivo;
    if (!objetivo) return;
    setRestablecerPendienteId(objetivo.id);
    try {
      const res = await restablecerContrasenaUsuario(objetivo.id);
      setRestablecerObjetivo(null);
      if (res.status === "ok") {
        // R28: el claro pasa al estado efímero del panel. R19: se dice cuántas sesiones
        // se cerraron, porque cerrar sesiones ajenas no puede ser un efecto invisible.
        setContrasenaRevelada({
          nombre: objetivo.nombre,
          contrasena: res.generatedPassword,
        });
        toast.success(mensajeSesionesRevocadas(res.sesionesRevocadas));
      } else {
        // R30: el error se informa y el panel NO se abre. Ninguna rama que no sea `ok`
        // lleva contraseña —lo impide el tipo—, y aquí tampoco se pinta ninguna.
        toast.error(mensajeError(res.status));
      }
    } finally {
      setRestablecerPendienteId(null);
    }
  }

  const columns = buildUsuariosColumns({
    onEditar: (row) => {
      void abrirEditar(row);
    },
    onCambiarEstado: (row) => {
      void cambiarEstado(row);
    },
    estadoPendienteId,
    // R27: abrir la confirmación es TODO lo que hace el botón de la fila.
    onRestablecerContrasena: (row) => {
      setRestablecerObjetivo(row);
    },
    restablecerPendienteId,
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" onClick={abrirCrear}>
          Crear usuario
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        rowKey="id"
        ariaLabel="Usuarios"
        /**
         * Feature 170 (T B.4, R1/R9/R12/R13) — descarga del listado COMPLETO, no de la
         * página visible: la tabla es de Familia A (el `data` de arriba es un recorte
         * server-side de `pageSize`), así que las filas las trae la Server Action del
         * modo completo, con el mismo guard de rol y el mismo tope que el listado.
         *
         * Se construye EN EL RENDER (design §5): sin filtros que cerrar hoy, pero el día
         * que los haya el closure leerá los de ESTE render y no los de un memo caducado.
         * El input va VACÍO a propósito: el schema es `.strict()` y sin `page`/`pageSize`
         * (mandarlos sería `validation_error`), y `sortBy`/`sortDir` caen en el MISMO
         * default que usa `listarUsuarios`, así que el archivo sale en el orden de pantalla.
         */
        descarga={{
          titulo: TITULO_DESCARGA,
          columnas: COLUMNAS_DESCARGA_USUARIOS,
          obtenerFilas: () =>
            filasDesdeResultado(listarUsuariosCompleto({}), filaDescargaUsuario),
        }}
        isLoading={isLoading}
        error={error ? "No se pudieron cargar los usuarios" : null}
        emptyState={{
          icon: Users,
          title: "No hay usuarios",
          description: "Crea el primer usuario para dar acceso al sistema.",
          action: (
            <Button type="button" onClick={abrirCrear}>
              Crear usuario
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
        title={formMode === "crear" ? "Crear usuario" : "Editar usuario"}
        confirmLabel="Guardar"
        cancelLabel="Cerrar"
        closeOnConfirm={false}
        onConfirm={onConfirmForm}
      >
        <UsuarioForm
          key={`${formMode}:${editUsuario?.id ?? "nuevo"}`}
          ref={formRef}
          mode={formMode}
          usuario={editUsuario}
        />
      </Modal>

      {/* Feature 287/R26 — la confirmación explícita. Va en `description` y no en el cuerpo
          para que el Modal la cuelgue de `aria-describedby`: quien usa lector de pantalla
          oye la advertencia al abrirse, no solo quien la ve. */}
      <Modal
        open={restablecerObjetivo !== null}
        onOpenChange={(next) => {
          // R27: cerrar por Cancelar, Escape u overlay descarta el objetivo sin ejecutar nada.
          if (!next) setRestablecerObjetivo(null);
        }}
        title="Restablecer contraseña"
        description={
          restablecerObjetivo
            ? `Se generará una contraseña nueva para ${restablecerObjetivo.nombre}. La actual dejará de servir y se cerrarán sus sesiones abiertas. La verás una sola vez.`
            : null
        }
        confirmLabel="Restablecer"
        cancelLabel="Cancelar"
        confirmVariant="destructive"
        closeOnConfirm={false}
        onConfirm={confirmarRestablecer}
      />

      {/* R28/R29 — la contraseña, una sola vez. Al cerrar, el estado se descarta y no queda
          ningún control que la reponga: el único camino de vuelta es restablecer OTRA. */}
      <Modal
        open={contrasenaRevelada !== null}
        onOpenChange={(next) => {
          if (!next) setContrasenaRevelada(null);
        }}
        title="Contraseña restablecida"
        confirmLabel="Cerrar"
        hideCancel
        onConfirm={() => setContrasenaRevelada(null)}
      >
        {contrasenaRevelada ? (
          <ContrasenaGeneradaPanel
            contrasena={contrasenaRevelada.contrasena}
            encabezado={`Contraseña nueva de ${contrasenaRevelada.nombre}. Entrégasela por un canal directo: nadie le ha avisado.`}
            inputId="contrasena-restablecida"
          />
        ) : null}
      </Modal>
    </section>
  );
}

/**
 * Feature 287/R19 — cuántas sesiones se cerraron. El número viene del repositorio, no de una
 * suposición del cliente, y se dice siempre: revocar el acceso de otra persona no puede ser un
 * efecto que solo se vea en la base de datos.
 */
function mensajeSesionesRevocadas(sesiones: number): string {
  if (sesiones === 0) {
    return "Contraseña restablecida. No había sesiones abiertas.";
  }
  if (sesiones === 1) {
    return "Contraseña restablecida. Se cerró 1 sesión abierta.";
  }
  return `Contraseña restablecida. Se cerraron ${sesiones} sesiones abiertas.`;
}

/**
 * Traduce el `status` del `ActionError` del backend a un mensaje de UI. No es un
 * switch de mensajes de dominio: el detalle de validación se muestra por campo
 * en el formulario; aquí solo se da el feedback de toast (R28).
 */
function mensajeError(status: string): string {
  switch (status) {
    case "unauthenticated":
      return "Tu sesión expiró. Vuelve a iniciar sesión.";
    case "forbidden":
      return "No tienes permiso para esta acción.";
    case "not_found":
      return "El usuario no existe.";
    case "conflict":
      return "El email o la cédula ya están en uso.";
    // Feature 287/R5 — negativa PROPIA, distinta de `forbidden`: no es que no tengas permiso,
    // es que restablecerte a ti mismo te cerraría la sesión antes de poder copiar la
    // contraseña. Merece su mensaje, no el genérico (`design.md` §7, D4).
    case "self_reset_forbidden":
      return "No puedes restablecer tu propia contraseña desde aquí.";
    default:
      return "Revisa los datos e inténtalo de nuevo.";
  }
}

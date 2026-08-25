"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import { FormField } from "@/components/shared/FormField";
import { useToast } from "@/hooks/useToast";
import { crearTarifa, actualizarTarifa } from "@/lib/actions/tarifas";
import { GRUPO_TARIFABLE, type TarifaDTO } from "@/lib/types/tarifa";
import type { UsuarioPorRolDTO } from "@/lib/types/usuario-por-rol";
import type { ZonaDTO } from "@/lib/types/zona";

import {
  TarifaCamposGrid,
  tarifaValoresDesde,
  tarifaValoresVacios,
  validarTarifaCampos,
  type TarifaCampoKey,
  type TarifaFieldErrors,
  type TarifaValores,
} from "./TarifaCampos";

// Los campos numéricos viven en `TarifaCampos` porque los comparten DOS
// formularios: este y la sección "Tarifas de zona" de `CrearZonaForm`. Son el
// mismo formulario salvo por la selección de tienda. Se reexportan con los
// nombres viejos para no romper a quien ya los importaba de aquí.
export {
  TARIFA_CAMPOS as TIENDA_CAMPOS,
  tarifaValoresVacios as tiendaValoresVacios,
} from "./TarifaCampos";
export type {
  TarifaCampoKey as TiendaCampoKey,
  TarifaValores as TiendaValores,
} from "./TarifaCampos";

/** Datos pre-cargados en edición. */
export interface TiendaFormInitial {
  tarifaId?: string;
  tiendaId: string;
  valores: TarifaValores;
}

type FieldErrors = TarifaFieldErrors;

/**
 * Destino de lo que se está capturando: la tarifa "por defecto" (la fila con
 * `zona_id` NULL, la que aplica cuando ninguna zona calza) o una zona concreta.
 * Es lo único que decide si el payload viaja o no con `zonaId`.
 */
type Destino = { kind: "default" } | { kind: "zona"; id: string };

function esMismoDestino(a: Destino, b: Destino): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "zona" && b.kind === "zona") return a.id === b.id;
  return true;
}

/** Tarifa ya guardada para un (tienda, destino), si existe. */
function tarifaDe(
  tarifas: TarifaDTO[],
  tiendaId: string,
  destino: Destino,
): TarifaDTO | undefined {
  if (!tiendaId) return undefined;
  const zonaId = destino.kind === "zona" ? destino.id : null;
  return tarifas.find((t) => t.tiendaId === tiendaId && t.zonaId === zonaId);
}

/**
 * Formulario de crear/editar "tienda": un `select` del dueño de la tarifa
 * (tienda_id, vacío inicialmente) + los campos numéricos de `tarifas` (sin
 * nombre ni zona_id). El dueño puede ser un administrador de tienda o la cuenta
 * dedicada de una API key; el select los separa en dos grupos con encabezado
 * porque ambos son usuarios y el nombre por sí solo no dice de cuál se trata.
 * Todos obligatorios. Reusa las Server Actions de tarifas.
 *
 * Se reparte en dos columnas (grid 9-3): a la izquierda el mismo formulario, a
 * la derecha el panel de zonas, que es un SELECTOR de destino: "Por defecto"
 * (la fila con `zona_id` NULL) de primeras y luego una por zona. El lápiz de
 * una fila la vuelve la activa —resaltada con fondo— y carga en el formulario
 * la tarifa que ese destino ya tenga (en blanco si aún no tiene ninguna); el
 * "Guardar" de la izquierda escribe en `tarifas` contra esa fila, y sólo se
 * habilita cuando los obligatorios están completos.
 */
export function CrearTiendaForm({
  mode,
  adminTiendas,
  apiKeys = [],
  zonas = [],
  tarifas = [],
  initial,
  onSaved,
  onCancel,
}: {
  mode: "crear" | "editar";
  adminTiendas: UsuarioPorRolDTO[];
  /** Cuentas dedicadas de API key (rol `apiKey`), tarifables igual que una tienda. */
  apiKeys?: UsuarioPorRolDTO[];
  /** Zonas del catálogo: pueblan el panel derecho debajo de "Por defecto". */
  zonas?: ZonaDTO[];
  /** Tarifas ya guardadas: deciden si un destino se CREA o se ACTUALIZA. */
  tarifas?: TarifaDTO[];
  initial?: TiendaFormInitial;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const esEditar = mode === "editar";

  const [tiendaId, setTiendaId] = useState(initial?.tiendaId ?? "");
  const [valores, setValores] = useState<TarifaValores>(
    initial?.valores ?? tarifaValoresVacios(),
  );
  // Arranca en "Por defecto": es la fila de primeras del panel.
  const [destino, setDestino] = useState<Destino>({ kind: "default" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [guardando, setGuardando] = useState(false);

  const opciones: SelectOption[] = [
    ...adminTiendas.map((u) => ({
      value: u.id,
      label: u.nombre,
      group: GRUPO_TARIFABLE.adminTienda,
    })),
    ...apiKeys.map((u) => ({
      value: u.id,
      label: u.nombre,
      group: GRUPO_TARIFABLE.apiKey,
    })),
  ];

  function setCampo(key: TarifaCampoKey, value: string) {
    setValores((prev) => ({ ...prev, [key]: value }));
  }

  // ¿Está el formulario en condiciones de escribir en `tarifas`? Es la MISMA
  // comprobación que corre al enviar (`validarTarifaCampos` + el dueño), no una
  // copia relajada: si divergieran, el botón podría habilitarse para un envío
  // que la validación va a rechazar. Se recalcula en cada tecla; son 9 campos.
  const completo = Boolean(tiendaId) && validarTarifaCampos(valores).ok;

  /**
   * Lápiz del panel: cambia el destino y RECARGA el formulario con lo que ese
   * destino ya tenga guardado —para "Por defecto", la fila con `zona_id` NULL—.
   * Sólo queda en blanco cuando ese destino aún no tiene tarifa, que es el caso
   * en que no hay nada que mostrar. Se llama "editar" y tiene que editar: dejar
   * los campos vacíos sobre una tarifa que existe invita a reescribirla entera
   * a ciegas, o a guardar ceros creyendo que se conserva lo anterior.
   */
  function editarDestino(next: Destino) {
    setDestino(next);
    cargarValores(tiendaId, next);
  }

  /**
   * Cambiar de dueño recarga igual que cambiar de destino: la tarifa es de un
   * par (tienda, zona), así que mover cualquiera de los dos cambia QUÉ fila se
   * está editando. Sin esto la selección inicial de tienda dejaba el formulario
   * vacío sobre la fila "Por defecto" —cuyo lápiz está oculto por ser la
   * activa—, así que no había forma de traer sus valores sin dar un rodeo por
   * otra zona.
   */
  function seleccionarTienda(next: string) {
    setTiendaId(next);
    cargarValores(next, destino);
  }

  /** Vuelca en el formulario la tarifa de ese par, o lo deja en blanco si no hay. */
  function cargarValores(tienda: string, dest: Destino) {
    const existente = tarifaDe(tarifas, tienda, dest);
    setValores(existente ? tarifaValoresDesde(existente) : tarifaValoresVacios());
    setErrors({});
  }

  /** Valida en cliente (dueño + campos numéricos) y arma el payload. */
  function validar(): { ok: true; payload: Record<string, unknown> } | { ok: false } {
    const campos = validarTarifaCampos(valores);
    const next: FieldErrors = campos.ok ? {} : { ...campos.errors };
    if (!tiendaId) next.tiendaId = ["Selecciona un administrador de tienda o una API key."];

    if (Object.keys(next).length > 0 || !campos.ok) {
      setErrors(next);
      return { ok: false };
    }
    setErrors({});
    const numericos = campos.numericos;
    // El destino decide el acotado: una zona viaja con `zonaId`; "Por defecto"
    // viaja SIN `zonaId` (queda NULL) y es la tarifa de caída de la tienda.
    const acotado =
      destino.kind === "zona"
        ? { zonaId: destino.id, isDefault: false }
        : { isDefault: true };
    return { ok: true, payload: { tiendaId, ...numericos, ...acotado } };
  }

  /**
   * Escribe en la tabla `tarifas` contra el destino activo del panel: si ya hay
   * una fila para ese (tienda, zona) la ACTUALIZA, si no la CREA. Los dos casos
   * se avisan distinto a propósito —"guardada" y "actualizada" no son lo mismo
   * para quien acaba de tocar una tarifa que ya existía—.
   */
  async function guardar() {
    const res = validar();
    if (!res.ok) return;

    // En edición, la fila que se abrió desde el listado es la que manda mientras
    // el destino siga siendo "Por defecto"; para una zona se busca la suya.
    const existente =
      esEditar && initial?.tarifaId && destino.kind === "default"
        ? { id: initial.tarifaId }
        : tarifaDe(tarifas, tiendaId, destino);

    setGuardando(true);
    try {
      const result = existente
        ? await actualizarTarifa(existente.id, res.payload)
        : await crearTarifa(res.payload);

      if (result.status === "ok") {
        toast.success(
          existente
            ? "Tarifa actualizada correctamente"
            : "Tarifa guardada correctamente",
        );
        onSaved();
        return;
      }
      if (result.status === "validation_error") {
        setErrors(result.fieldErrors);
      }
      toast.error(mensajeDeError(result.status));
    } catch {
      toast.error("Error actualizando tarifa");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="flex flex-col gap-6 rounded-md border border-border p-4 lg:col-span-9">
        <h3 className="text-sm font-semibold">
          {esEditar ? "Editar tienda" : "Nueva tienda"}
        </h3>

        <FormField
          id="tienda-admin"
          label="Administrador de tienda o API key"
          error={errors.tiendaId}
          hint={
            esEditar
              ? "No se puede cambiar en edición: para otra tienda, abre su tarifa desde el listado."
              : undefined
          }
        >
          {({
            "aria-invalid": ariaInvalid,
            "aria-describedby": ariaDescribedBy,
          }) => (
            <Select
              value={tiendaId}
              onValueChange={seleccionarTienda}
              options={opciones}
              placeholder="Selecciona un administrador de tienda o una API key"
              // En EDICIÓN el dueño no se toca: la fila que se abrió es la de
              // esa tienda, y cambiar el select aquí no movería la tarifa de
              // dueño —crearía o pisaría la de OTRA tienda sin decirlo—. Para
              // cambiar de tienda se sale y se abre la suya. En creación sigue
              // abierto, y se cierra sólo si no hay a quién elegir.
              disabled={esEditar || opciones.length === 0}
              aria-label="Administrador de tienda o API key"
              aria-invalid={ariaInvalid}
              aria-describedby={ariaDescribedBy}
            />
          )}
        </FormField>

        <TarifaCamposGrid
          idPrefix="tienda"
          valores={valores}
          errors={errors}
          onChange={setCampo}
        />

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => void guardar()}
            loading={guardando}
            // No se habilita hasta que estén los obligatorios (y el dueño de la
            // tarifa): escribe en `tarifas`, y un envío que sólo puede volver
            // con errores de campo no vale la pena ofrecerlo.
            disabled={!completo}
          >
            {guardando ? "Guardando…" : "Guardar"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={guardando}
          >
            Cancelar
          </Button>
        </div>
      </div>

      <ZonasPanel zonas={zonas} destino={destino} onEditar={editarDestino} />
    </div>
  );
}

/**
 * Panel derecho: "Por defecto" de primeras y luego una fila por zona. Es un
 * SELECTOR de destino, no un formulario: no guarda nada por su cuenta —eso lo
 * hace el "Guardar" de la izquierda contra la fila activa—. La activa se
 * distingue por FONDO (`bg-accent`, que el tema define en claro y en oscuro) y
 * esconde su propio lápiz: el lápiz sirve para IR a otro destino, y en el
 * destino donde ya estás no tiene a dónde llevarte —sus valores ya están
 * cargados, porque los trae quien cambia de destino o de tienda—.
 */
function ZonasPanel({
  zonas,
  destino,
  onEditar,
}: {
  zonas: ZonaDTO[];
  destino: Destino;
  onEditar: (next: Destino) => void;
}) {
  const filas: { key: string; label: string; destino: Destino }[] = [
    { key: "default", label: "Por defecto", destino: { kind: "default" } },
    ...zonas.map((z) => ({
      key: z.id,
      label: z.nombre,
      destino: { kind: "zona" as const, id: z.id },
    })),
  ];

  return (
    <aside className="flex flex-col gap-3 rounded-md border border-border p-4 lg:col-span-3">
      <h3 className="text-sm font-semibold">Zonas</h3>
      <p className="text-xs text-muted-foreground">
        El lápiz carga en el formulario la tarifa de esa zona. “Guardar”
        escribe lo tecleado en la resaltada.
      </p>

      <ul className="flex flex-col gap-1">
        {filas.map((fila) => {
          const activa = esMismoDestino(destino, fila.destino);
          return (
            <li
              key={fila.key}
              // `bg-accent`/`text-accent-foreground` son tokens del tema: el
              // resaltado sale legible en claro y en oscuro sin escribir dos
              // colores a mano ni depender de `dark:`.
              className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 ${
                activa ? "bg-accent font-medium text-accent-foreground" : ""
              }`}
              aria-current={activa ? "true" : undefined}
            >
              <span className="truncate text-sm">{fila.label}</span>
              {activa ? (
                // Hueco del mismo tamaño que el botón: sin él la fila activa
                // encoge 32px y la lista da un salto al cambiar de destino.
                <span className="size-8 shrink-0" aria-hidden="true" />
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Editar tarifa de ${fila.label}`}
                  onClick={() => onEditar(fila.destino)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/** Mensaje legible para los estados de error de crear/actualizar tarifa. */
function mensajeDeError(status: string): string {
  switch (status) {
    case "validation_error":
      return "Revisa los campos: el formulario está incompleto.";
    case "unauthenticated":
      return "Tu sesión expiró.";
    case "forbidden":
      return "No tienes permiso para esta acción.";
    case "not_found":
      return "La tienda no existe.";
    // Nuevo desde el único (zona_id, tienda_id): ese par ya está ocupado. Sin este
    // caso caía en el genérico, que no dice qué corregir.
    case "conflict":
      return "Ya existe una tarifa para esa combinación de zona y tienda.";
    default:
      return "Error actualizando tarifa";
  }
}

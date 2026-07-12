"use client";

import {
  forwardRef,
  useImperativeHandle,
  useState,
  type ReactNode,
  // TODO(zonas): `useMemo` y `useSWR` quedan sin uso al comentar el subsistema
  // de distritos (navegación provincia→cantón→distrito). Reactivar cuando se
  // reconstruya contra la API vigente (`arbolZonas`).
  // useMemo,
} from "react";
// import useSWR from "swr";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// TODO(zonas): `Select`/`SelectOption` y `Switch` sólo los usaba el bloque
// comentado (selectores de provincia/cantón y toggle esGam, que ya no existe).
// import { Select, type SelectOption } from "@/components/ui/select";
// import { Switch } from "@/components/ui/switch";
import {
  actualizarZonaSchema,
  crearZonaSchema,
  type ActualizarZonaResult,
  type CrearZonaResult,
  // TODO(zonas): `DistritoCatalogoDTO` NO existe en `lib/types/zona`. El catálogo
  // geográfico dejó de exponerse como lista plana de distritos; hoy se sirve como
  // árbol (`ArbolZonas`/`ArbolDistritoNode`). Import comentado por inexistente.
  // type DistritoCatalogoDTO,
  type ZonaDTO,
} from "@/lib/types/zona";
import {
  actualizarZona,
  crearZona,
  // TODO(zonas): `listarProvincias`/`listarCantones`/`listarDistritos` NO existen
  // en `lib/actions/zonas`. La navegación del catálogo global se retiró; la única
  // acción de lectura del árbol es `arbolZonas`. Imports comentados por inexistentes.
  // listarCantones,
  // listarDistritos,
  // listarProvincias,
} from "@/lib/actions/zonas";

type FieldErrors = Record<string, string[]>;

export type ZonaFormResult = CrearZonaResult | ActualizarZonaResult;

/** Handle imperativo: el Modal anfitrión dispara el submit async (R31). */
export interface ZonaFormHandle {
  submit: () => Promise<ZonaFormResult>;
}

export interface ZonaFormProps {
  /** "crear" pide el set completo; "editar" prefila nombre/pagos/esGam. */
  mode: "crear" | "editar";
  /** Zona en edición (prefill de campos escalares). */
  zona?: ZonaDTO | null;
}

interface FormState {
  nombre: string;
  // TODO(zonas): `pagoEntrega`/`pagoRechazo`/`esGam` ya no forman parte del
  // modelo de zona. El esquema vigente pide `cobroVehiculo`, `distritoIds` y
  // `tarifas` (tarifa_zona_mensajero). Campos conservados sólo como referencia.
  // pagoEntrega: string;
  // pagoRechazo: string;
  // esGam: boolean;
}

function initialState(zona?: ZonaDTO | null): FormState {
  return {
    nombre: zona?.nombre ?? "",
    // TODO(zonas): `zona.pagoEntrega`/`pagoRechazo`/`esGam` NO existen en `ZonaDTO`
    // (hoy: id, nombre, cobroVehiculo, distritosCount, tarifas?). Prefill roto.
    // pagoEntrega: zona ? String(zona.pagoEntrega) : "0",
    // pagoRechazo: zona ? String(zona.pagoRechazo) : "0",
    // esGam: zona?.esGam ?? false,
  };
}

/**
 * Formulario de creación/edición de zona (patrón `UsuarioForm`). Captura
 * `nombre`, `pagoEntrega`, `pagoRechazo`, un toggle `esGam` ("marcar como zona
 * central/GAM") y un selector de distritos que navega el catálogo geográfico
 * GLOBAL provincia → cantón → distrito consumiendo las Server Actions
 * `listarProvincias`/`listarCantones`/`listarDistritos` (R31). Cada distrito ya
 * asignado a OTRA zona se deshabilita mostrando a qué zona pertenece. Los
 * errores de validación y los conflictos (nombre duplicado o distrito ya
 * asignado) se muestran junto a su campo sin perder los valores ya escritos
 * (R33). Reusa los schemas de `lib/types/zona` para validar en cliente.
 *
 * TODO(zonas): este componente está DESALINEADO con la API vigente de feature 24
 * (redefinida). Se comentó todo lo que referencia símbolos inexistentes o el
 * modelo antiguo (pagos/esGam, catálogo plano de distritos, conflict.reason,
 * firma de actualizarZona). Sólo queda operativo el campo `nombre`. Reconstruir
 * contra: crearZonaSchema/actualizarZonaSchema { nombre, cobroVehiculo,
 * distritoIds, tarifas }, actualizarZona(id, input) y el árbol `arbolZonas`.
 */
export const ZonaForm = forwardRef<ZonaFormHandle, ZonaFormProps>(
  function ZonaForm({ mode, zona }, ref) {
    const isEditar = mode === "editar";

    const [form, setForm] = useState<FormState>(() => initialState(zona));
    const [errors, setErrors] = useState<FieldErrors>({});

    // TODO(zonas): subsistema de distritos comentado en bloque. Dependía de
    // `listarProvincias/listarCantones/listarDistritos` (inexistentes) y de
    // `DistritoCatalogoDTO` (inexistente). Incluye el seed de edición, la
    // navegación del catálogo global y la selección/toggle de distritos.
    /*
    // Selección de distritos: id -> nombre (para chips y complete-set de envío).
    const [selected, setSelected] = useState<Record<string, string>>({});
    // El backend recibe el conjunto COMPLETO de distritos; en edición solo se
    // envía si el usuario tocó el selector (si no, se dejan intactos).
    const [distritosTocados, setDistritosTocados] = useState(false);

    // Navegación del catálogo global.
    const [provinciaId, setProvinciaId] = useState("");
    const [cantonId, setCantonId] = useState("");

    const { data: provincias } = useSWR("zonas:provincias", async () => {
      const res = await listarProvincias();
      return res.status === "ok" ? res.items : [];
    });

    const { data: cantones } = useSWR(
      provinciaId ? ["zonas:cantones", provinciaId] : null,
      async () => {
        const res = await listarCantones(provinciaId);
        return res.status === "ok" ? res.items : [];
      },
    );

    // R31 (edición): a medida que se cargan los distritos de un cantón, los que ya
    // pertenecen a ESTA zona se pre-marcan (sin marcar el selector como "tocado",
    // para no reescribir el conjunto si el usuario no cambia nada). Se hace en el
    // `onSuccess` de SWR (callback de evento), no en un efecto, para evitar
    // renders en cascada.
    function seedSeleccionEdicion(items: DistritoCatalogoDTO[]) {
      if (!isEditar || !zona) return;
      setSelected((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const d of items) {
          if (d.zonaId === zona.id && !(d.id in next)) {
            next[d.id] = d.nombre;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }

    const { data: distritos } = useSWR(
      cantonId ? ["zonas:distritos", cantonId] : null,
      async () => {
        const res = await listarDistritos(cantonId);
        return res.status === "ok" ? res.items : [];
      },
      { onSuccess: seedSeleccionEdicion },
    );

    const provinciaOptions: SelectOption[] = useMemo(
      () => (provincias ?? []).map((p) => ({ value: p.id, label: p.nombre })),
      [provincias],
    );

    const cantonOptions: SelectOption[] = useMemo(
      () => (cantones ?? []).map((c) => ({ value: c.id, label: c.nombre })),
      [cantones],
    );

    const selectedIds = Object.keys(selected);

    function toggleDistrito(id: string, nombre: string) {
      setDistritosTocados(true);
      setSelected((prev) => {
        const next = { ...prev };
        if (id in next) delete next[id];
        else next[id] = nombre;
        return next;
      });
    }
    */

    function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
      setForm((prev) => ({ ...prev, [key]: value }));
    }

    // TODO(zonas): `buildCandidate` construía el payload antiguo
    // { nombre, pagoEntrega, pagoRechazo, esGam, distritoIds }. El esquema vigente
    // exige { nombre, cobroVehiculo, distritoIds, tarifas }. Comentado por completo.
    /*
    function buildCandidate(): unknown {
      const base = {
        nombre: form.nombre,
        pagoEntrega: Number(form.pagoEntrega),
        pagoRechazo: Number(form.pagoRechazo),
        esGam: form.esGam,
      };
      if (isEditar) {
        return {
          ...base,
          id: zona?.id ?? "",
          // Complete-set: solo se envía si el usuario tocó el selector (R22).
          ...(distritosTocados ? { distritoIds: selectedIds } : {}),
        };
      }
      return { ...base, distritoIds: selectedIds };
    }

    function validate(): { input: unknown; result?: ZonaFormResult } {
      const candidate = buildCandidate();
      const schema = isEditar ? actualizarZonaSchema : crearZonaSchema;
      const parsed = schema.safeParse(candidate);
      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors as FieldErrors;
        return { input: null, result: { status: "validation_error", fieldErrors } };
      }
      return { input: parsed.data };
    }

    async function submit(): Promise<ZonaFormResult> {
      const { input, result } = validate();
      if (result) {
        setErrors(result.status === "validation_error" ? result.fieldErrors : {});
        return result;
      }

      const res: ZonaFormResult =
        isEditar && zona ? await actualizarZona(input) : await crearZona(input);

      if (res.status === "validation_error") {
        setErrors(res.fieldErrors);
      } else if (res.status === "conflict") {
        // R33: el conflicto se muestra junto a su campo, sin perder valores.
        if (res.reason === "nombre") {
          setErrors({ nombre: ["Ya existe una zona con ese nombre."] });
        } else {
          setErrors({ distritoIds: [mensajeConflictoDistrito(res.distritoIds, selected)] });
        }
      } else {
        setErrors({});
      }
      return res;
    }
    */

    // Stub temporal: mientras el submit real está comentado, el handle debe
    // seguir cumpliendo el contrato `ZonaFormHandle`. Referencia los símbolos
    // vigentes (schemas + acciones) sólo para dejar el flujo mínimo alineado.
    // TODO(zonas): reimplementar validate()/submit() contra el esquema y la firma
    // actuales (crearZona(input) / actualizarZona(id, input)).
    async function submit(): Promise<ZonaFormResult> {
      void isEditar;
      void zona;
      void actualizarZonaSchema;
      void crearZonaSchema;
      void actualizarZona;
      void crearZona;
      const fieldErrors: FieldErrors = {
        nombre: ["Formulario de zonas en reconstrucción (API desalineada)."],
      };
      setErrors(fieldErrors);
      return { status: "validation_error", fieldErrors };
    }

    useImperativeHandle(ref, () => ({ submit }));

    return (
      <div className="flex flex-col gap-3">
        <Field id="nombre" label="Nombre" errors={errors.nombre}>
          <Input
            id="nombre"
            value={form.nombre}
            aria-invalid={errors.nombre ? true : undefined}
            onChange={(e) => setField("nombre", e.target.value)}
          />
        </Field>

        {/* TODO(zonas): campos `pagoEntrega`/`pagoRechazo` y toggle `esGam`
            comentados: no existen en el modelo vigente de zona. */}
        {/*
        <Field id="pagoEntrega" label="Pago por entrega" errors={errors.pagoEntrega}>
          <Input
            id="pagoEntrega"
            type="number"
            min={0}
            step="0.01"
            value={form.pagoEntrega}
            aria-invalid={errors.pagoEntrega ? true : undefined}
            onChange={(e) => setField("pagoEntrega", e.target.value)}
          />
        </Field>

        <Field id="pagoRechazo" label="Pago por rechazo" errors={errors.pagoRechazo}>
          <Input
            id="pagoRechazo"
            type="number"
            min={0}
            step="0.01"
            value={form.pagoRechazo}
            aria-invalid={errors.pagoRechazo ? true : undefined}
            onChange={(e) => setField("pagoRechazo", e.target.value)}
          />
        </Field>

        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="esGam">Marcar como zona central / GAM</Label>
          <Switch
            id="esGam"
            aria-label="Marcar como zona central / GAM"
            checked={form.esGam}
            onCheckedChange={(next) => setField("esGam", next)}
          />
        </div>
        */}

        {/* TODO(zonas): selector de distritos (provincia → cantón → distrito)
            comentado: dependía de listarProvincias/listarCantones/listarDistritos
            (inexistentes) y del estado `selected`/`distritos`/`provinciaOptions`/
            `cantonOptions`/`selectedIds` del bloque comentado arriba. */}
        {/*
        <fieldset className="flex flex-col gap-3 border-t border-border pt-3">
          <legend className="text-sm font-medium">Distritos de la zona</legend>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provincia">Provincia</Label>
            <Select
              aria-label="Provincia"
              value={provinciaId}
              options={provinciaOptions}
              placeholder="Selecciona una provincia"
              onValueChange={(v) => {
                setProvinciaId(v);
                setCantonId("");
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="canton">Cantón</Label>
            <Select
              aria-label="Cantón"
              value={cantonId}
              options={cantonOptions}
              placeholder="Selecciona un cantón"
              disabled={!provinciaId}
              onValueChange={(v) => setCantonId(v)}
            />
          </div>

          {cantonId ? (
            <div
              className="flex flex-col gap-1.5"
              role="group"
              aria-label="Distritos disponibles"
            >
              {(distritos ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay distritos para este cantón.
                </p>
              ) : (
                (distritos ?? []).map((d) => {
                  const enOtraZona =
                    d.zonaId !== null && (!zona || d.zonaId !== zona.id);
                  const checked = d.id in selected;
                  return (
                    <label
                      key={d.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={enOtraZona}
                        aria-label={d.nombre}
                        onChange={() => toggleDistrito(d.id, d.nombre)}
                      />
                      <span>{d.nombre}</span>
                      {enOtraZona ? (
                        <span className="text-xs text-muted-foreground">
                          (asignado a {d.zonaNombre})
                        </span>
                      ) : null}
                    </label>
                  );
                })
              )}
            </div>
          ) : null}

          <p className="text-sm text-muted-foreground" data-testid="distritos-seleccionados">
            {selectedIds.length > 0
              ? `Distritos seleccionados: ${selectedIds.length}`
              : "Sin distritos seleccionados"}
          </p>

          {errors.distritoIds && errors.distritoIds.length > 0 ? (
            <p id="distritoIds-error" role="alert" className="text-sm text-destructive">
              {errors.distritoIds.join(", ")}
            </p>
          ) : null}
        </fieldset>
        */}
      </div>
    );
  },
);

// TODO(zonas): `mensajeConflictoDistrito` usaba `conflict.distritoIds`, que ya
// no forma parte del resultado de conflicto (hoy `{ status: "conflict" }` sin
// payload). Helper comentado hasta que el conflicto de distrito vuelva a exponer
// los ids afectados.
/*
function mensajeConflictoDistrito(
  ids: string[] | undefined,
  selected: Record<string, string>,
): string {
  if (!ids || ids.length === 0) {
    return "Uno de los distritos ya pertenece a otra zona.";
  }
  const nombres = ids.map((id) => selected[id] ?? id);
  return `Estos distritos ya pertenecen a otra zona: ${nombres.join(", ")}.`;
}
*/

/** Envoltorio accesible de un campo con label y errores (i18n vía props). */
function Field({
  id,
  label,
  errors,
  children,
}: {
  id: string;
  label: string;
  errors?: string[];
  children: ReactNode;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {errors && errors.length > 0 ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {errors.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

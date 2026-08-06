"use client";

import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import useSWR from "swr";
import type { ZodError } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FieldError } from "@/components/shared/FieldError";
import { FormField } from "@/components/shared/FormField";
import {
  crearZonaSchema,
  type ActualizarZonaResult,
  type ArbolZonas,
  type CrearZonaResult,
  type DistritoCatalogoDTO,
  type ZonaDTO,
} from "@/lib/types/zona";
import { actualizarZona, arbolZonas, crearZona } from "@/lib/actions/zonas";
import {
  listarCantones,
  listarDistritos,
  listarProvincias,
} from "@/lib/actions/geo";
import { listarVehiculos } from "@/lib/actions/vehiculos";

type FieldErrors = Record<string, string[]>;

export type ZonaFormResult = CrearZonaResult | ActualizarZonaResult;

/** Handle imperativo: el Modal anfitrión dispara el submit async (R11/R12). */
export interface ZonaFormHandle {
  submit: () => Promise<ZonaFormResult>;
}

/** Central actualmente designada, derivada por el módulo (R6-UI). */
export interface CentralActual {
  id: string;
  nombre: string;
}

export interface ZonaFormProps {
  /** "crear" pide el set completo; "editar" prefila los campos de la zona. */
  mode: "crear" | "editar";
  /** Zona en edición (prefill de escalares + tarifas). */
  zona?: ZonaDTO | null;
  /**
   * Zona que hoy es central (según el listado cargado). Sirve para advertir de la
   * reasignación al marcar OTRA zona como central (R6-UI, decisión F1.4-A).
   * Limitación conocida: sólo es fiable si la central está en la página cargada;
   * el backend garantiza la invariante igualmente.
   */
  centralActual?: CentralActual | null;
}

interface FormState {
  nombre: string;
  cobroVehiculo: boolean;
  esCentral: boolean;
}

/** Fila de tarifa en la UI: montos como texto (inputs), vehículo "" = ninguno. */
interface TarifaRow {
  cobroEntregado: string;
  cobroRechazado: string;
  vehiculoId: string;
}

/**
 * Contexto geográfico de un distrito seleccionado (tipo INTERNO de UI; NO cruza la
 * frontera cliente↔servidor ni vive en `lib/types/zona.ts`). Guardar la geografía en el
 * propio `selected` permite derivar el resumen agrupado provincia→cantón desde una única
 * fuente de verdad (F1.4-c), sin un segundo estado que sincronizar.
 * `provinciaId/provinciaNombre` pueden ser `null` cuando el distrito se pre-carga en edición
 * vía `arbolZonas` (que no trae provincia): se enriquecen perezosamente al navegar (F1.4-e).
 */
interface DistritoSeleccionado {
  distritoNombre: string;
  cantonId: string;
  cantonNombre: string;
  provinciaId: string | null;
  provinciaNombre: string | null;
}

/** Grupo del resumen: distritos seleccionados agrupados provincia → cantón (R4). */
interface ResumenDistrito {
  id: string;
  nombre: string;
}
interface ResumenCanton {
  cantonId: string;
  cantonNombre: string;
  distritos: ResumenDistrito[];
}
interface ResumenProvincia {
  provinciaId: string | null;
  provinciaNombre: string | null;
  cantones: ResumenCanton[];
}

function initialState(zona?: ZonaDTO | null): FormState {
  return {
    nombre: zona?.nombre ?? "",
    cobroVehiculo: zona?.cobroVehiculo ?? false,
    // R7: al editar una zona ya central, el toggle arranca activado.
    esCentral: zona?.esCentral ?? false,
  };
}

function initialTarifas(zona?: ZonaDTO | null): TarifaRow[] {
  return (zona?.tarifas ?? []).map((t) => ({
    cobroEntregado: String(t.cobroEntregado),
    cobroRechazado: String(t.cobroRechazado),
    vehiculoId: t.vehiculoId ?? "",
  }));
}

/**
 * Reconstruye `fieldErrors` a partir de un `ZodError`. Los paths de primer nivel
 * (`nombre`, `distritoIds`, `esCentral`, `tarifas`) salen de `flatten().fieldErrors`;
 * los paths ANIDADOS de tarifas (`tarifas.i.vehiculoId`) no aparecen ahí, así que se
 * recolectan aparte y se agregan a un mensaje visible bajo la clave `tarifas` (R11/R8).
 */
function toFieldErrors(error: ZodError): FieldErrors {
  const flat = error.flatten().fieldErrors as FieldErrors;
  const fieldErrors: FieldErrors = { ...flat };
  for (const issue of error.issues) {
    if (issue.path[0] === "tarifas" && issue.path.length > 1) {
      const list = fieldErrors.tarifas ?? [];
      list.push(issue.message);
      fieldErrors.tarifas = list;
    }
  }
  return fieldErrors;
}

/**
 * Formulario de creación/edición de zona (patrón imperativo `forwardRef` disparado
 * por el `Modal` de `ZonasModule`). Captura `nombre`, `cobroVehiculo`, el toggle
 * `esCentral` (R3/R4/R7), el conjunto de distritos navegando el catálogo geográfico
 * global provincia → cantón → distrito (R10) y las tarifas por mensajero condicionadas
 * a `cobroVehiculo` (R8). Valida con el mismo `crearZonaSchema` en cliente y servidor,
 * muestra errores por campo conservando los valores (R11) y, al marcar una zona como
 * central existiendo otra, exige confirmación de la reasignación (R6-UI, F1.4-A).
 *
 * DIVERGENCIA escalar↔N:M (deuda de nivel feature-24, NO se resuelve aquí):
 * el seed (`scripts/seed-zonas.ts`) asigna distritos por el ESCALAR `distrito.zonaId`,
 * pero `listarDistritos` (GeoRepository) lee la asignación del N:M `ZonaDistrito`. Una
 * zona SEMBRADA (no creada por el CRUD) tendría sus distritos NO pre-marcados en edición,
 * porque no existen filas `ZonaDistrito` para ella. Sólo se documenta el efecto.
 *
 * @sin-superficie muerte de SEGUNDO ORDEN: su unico montador es `ZonasModule`, al que ninguna ruta monta (ver el motivo completo alli). Arrastra consigo a `listarProvincias`/`listarCantones`/`listarDistritos` de `lib/actions/geo.ts` y a `arbolZonas`, que son suyas y de nadie mas.
 */
export const ZonaForm = forwardRef<ZonaFormHandle, ZonaFormProps>(
  function ZonaForm({ mode, zona, centralActual }, ref) {
    const isEditar = mode === "editar";

    const [form, setForm] = useState<FormState>(() => initialState(zona));
    const [tarifas, setTarifas] = useState<TarifaRow[]>(() =>
      initialTarifas(zona),
    );
    // Distritos seleccionados: id -> contexto geográfico. Fuente de verdad ÚNICA de la
    // selección; checkboxes del cantón abierto y resumen agrupado derivan/mutan este mapa
    // (F1.4-c). El conjunto COMPLETO enviado al backend es `Object.keys(selected)`.
    const [selected, setSelected] = useState<Record<string, DistritoSeleccionado>>({});
    const [errors, setErrors] = useState<FieldErrors>({});
    // Mensaje de conflicto de dominio a nivel formulario (sin campo concreto).
    const [formError, setFormError] = useState<string | null>(null);
    // R6-UI: confirmación explícita para reasignar la central.
    const [confirmarReasignacion, setConfirmarReasignacion] = useState(false);

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

    // R9/R10 (edición): a medida que se cargan los distritos de un cantón, los que ya
    // pertenecen a ESTA zona se pre-marcan Y se enriquece su provincia/cantón (los
    // pre-cargados vía `arbolZonas` llegan con provincia `null`). Se hace en el `onSuccess`
    // de SWR (callback de evento), no en un efecto en cascada, para no re-renderizar de más.
    function seedSeleccionEdicion(items: DistritoCatalogoDTO[]) {
      if (!isEditar || !zona) return;
      const provinciaNombre =
        (provincias ?? []).find((p) => p.id === provinciaId)?.nombre ?? null;
      const cantonNombre =
        (cantones ?? []).find((c) => c.id === cantonId)?.nombre ?? cantonId;
      setSelected((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const d of items) {
          if (d.zonaId !== zona.id) continue;
          const existing = next[d.id];
          if (!existing) {
            next[d.id] = {
              distritoNombre: d.nombre,
              cantonId,
              cantonNombre,
              provinciaId: provinciaId || null,
              provinciaNombre,
            };
            changed = true;
          } else if (existing.provinciaId === null && provinciaId) {
            // Enriquecer provincia del distrito pre-cargado sin geografía completa.
            next[d.id] = {
              ...existing,
              cantonId,
              cantonNombre,
              provinciaId,
              provinciaNombre,
            };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }

    // R9 (edición): siembra TODOS los distritos pre-asignados de la zona desde el árbol de
    // lectura `arbolZonas` (frontend-puro; el backend no cambia). El árbol NO trae provincia,
    // así que se siembra con `provinciaId: null` y se agrupa por cantón hasta que el maestro
    // navegue la provincia (entonces `seedSeleccionEdicion` la enriquece). Merge idempotente:
    // NO pisa lo ya presente/enriquecido.
    function seedDesdeArbol(arbol: ArbolZonas | null) {
      if (!isEditar || !zona || !arbol) return;
      const node = Object.values(arbol).find((z) => z.id === zona.id);
      if (!node) return;
      setSelected((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const canton of Object.values(node.cantones)) {
          for (const distrito of Object.values(canton.distritos)) {
            if (distrito.id in next) continue;
            next[distrito.id] = {
              distritoNombre: distrito.value,
              cantonId: canton.id,
              cantonNombre: canton.value,
              provinciaId: null,
              provinciaNombre: null,
            };
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

    const { data: vehiculos } = useSWR("zonas:vehiculos", async () => {
      const res = await listarVehiculos();
      return res.status === "ok" ? res.items : [];
    });

    // R9: en edición, lee el árbol de zonas (solo maestro, gate en la acción) para
    // pre-cargar TODOS los distritos de la zona desde el inicio, no solo los del cantón
    // navegado. Lectura pura; no se toca el backend.
    useSWR(
      isEditar && zona ? ["zonas:arbol", zona.id] : null,
      async () => {
        const res = await arbolZonas();
        return res.status === "ok" ? res.arbol : null;
      },
      { onSuccess: seedDesdeArbol },
    );

    const provinciaOptions: SelectOption[] = useMemo(
      () => (provincias ?? []).map((p) => ({ value: p.id, label: p.nombre })),
      [provincias],
    );

    const cantonOptions: SelectOption[] = useMemo(
      () => (cantones ?? []).map((c) => ({ value: c.id, label: c.nombre })),
      [cantones],
    );

    const vehiculoOptions: SelectOption[] = useMemo(
      () => (vehiculos ?? []).map((v) => ({ value: v.id, label: v.name })),
      [vehiculos],
    );

    const selectedIds = Object.keys(selected);

    // Resumen agrupado provincia → cantón derivado de `selected` (R3/R4). Los distritos con
    // provincia aún desconocida (pre-carga edición) caen en un grupo sin encabezado de
    // provincia, agrupados por cantón (F1.4-e). Sin estado extra: se deriva de la fuente única.
    const resumen = useMemo<ResumenProvincia[]>(() => {
      const SIN_PROVINCIA = " sin-provincia";
      const provMap = new Map<string, ResumenProvincia>();
      for (const [id, info] of Object.entries(selected)) {
        const provKey = info.provinciaId ?? SIN_PROVINCIA;
        let prov = provMap.get(provKey);
        if (!prov) {
          prov = {
            provinciaId: info.provinciaId,
            provinciaNombre: info.provinciaNombre,
            cantones: [],
          };
          provMap.set(provKey, prov);
        }
        let canton = prov.cantones.find((c) => c.cantonId === info.cantonId);
        if (!canton) {
          canton = {
            cantonId: info.cantonId,
            cantonNombre: info.cantonNombre,
            distritos: [],
          };
          prov.cantones.push(canton);
        }
        canton.distritos.push({ id, nombre: info.distritoNombre });
      }
      const groups = [...provMap.values()];
      for (const prov of groups) {
        prov.cantones.sort((a, b) => a.cantonNombre.localeCompare(b.cantonNombre));
        for (const c of prov.cantones) {
          c.distritos.sort((a, b) => a.nombre.localeCompare(b.nombre));
        }
      }
      groups.sort((a, b) => {
        // Provincias conocidas primero (alfabético); el grupo sin provincia al final.
        if (a.provinciaNombre && b.provinciaNombre) {
          return a.provinciaNombre.localeCompare(b.provinciaNombre);
        }
        if (a.provinciaNombre) return -1;
        if (b.provinciaNombre) return 1;
        return 0;
      });
      return groups;
    }, [selected]);

    // R6-UI: hay que reasignar la central si el usuario la marca y ya existe OTRA.
    const reasignaCentral =
      form.esCentral &&
      centralActual != null &&
      centralActual.id !== (zona?.id ?? null);

    function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
      setForm((prev) => ({ ...prev, [key]: value }));
    }

    // Marca/desmarca desde el checkbox del cantón abierto capturando su geografía al vuelo.
    function toggleDistrito(distrito: DistritoCatalogoDTO) {
      setSelected((prev) => {
        const next = { ...prev };
        if (distrito.id in next) {
          delete next[distrito.id];
          return next;
        }
        const provinciaNombre =
          (provincias ?? []).find((p) => p.id === provinciaId)?.nombre ?? null;
        const cantonNombre =
          (cantones ?? []).find((c) => c.id === cantonId)?.nombre ?? cantonId;
        next[distrito.id] = {
          distritoNombre: distrito.nombre,
          cantonId,
          cantonNombre,
          provinciaId: provinciaId || null,
          provinciaNombre,
        };
        return next;
      });
    }

    // Quita un distrito desde el resumen (R5). Comparte estado con los checkboxes: si el
    // distrito pertenece al cantón abierto, su checkbox se desmarca solo (R6).
    function removeDistrito(id: string) {
      setSelected((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }

    function addTarifa() {
      setTarifas((prev) => [
        ...prev,
        { cobroEntregado: "", cobroRechazado: "", vehiculoId: "" },
      ]);
    }

    function removeTarifa(index: number) {
      setTarifas((prev) => prev.filter((_, i) => i !== index));
    }

    function updateTarifa(index: number, patch: Partial<TarifaRow>) {
      setTarifas((prev) =>
        prev.map((t, i) => (i === index ? { ...t, ...patch } : t)),
      );
    }

    function buildCandidate(): unknown {
      return {
        nombre: form.nombre,
        cobroVehiculo: form.cobroVehiculo,
        esCentral: form.esCentral,
        // El backend recibe SIEMPRE el conjunto COMPLETO (≥1) (R8/R9/R10).
        distritoIds: selectedIds,
        tarifas: tarifas.map((t) => {
          const base = {
            cobroEntregado: Number(t.cobroEntregado),
            cobroRechazado: Number(t.cobroRechazado),
          };
          // vehiculoId sólo si el usuario eligió uno; el schema decide si es válido
          // según `cobroVehiculo` (applyTarifaRules), igual en cliente y servidor.
          return t.vehiculoId ? { ...base, vehiculoId: t.vehiculoId } : base;
        }),
      };
    }

    async function submit(): Promise<ZonaFormResult> {
      setFormError(null);

      // R6-UI: si reasigna la central, exige confirmación explícita ANTES de mutar.
      if (reasignaCentral && !confirmarReasignacion) {
        const fieldErrors: FieldErrors = {
          esCentral: [
            "Confirma la reasignación de la zona central antes de guardar.",
          ],
        };
        setErrors(fieldErrors);
        return { status: "validation_error", fieldErrors };
      }

      const candidate = buildCandidate();
      const parsed = crearZonaSchema.safeParse(candidate);
      if (!parsed.success) {
        const fieldErrors = toFieldErrors(parsed.error);
        setErrors(fieldErrors);
        return { status: "validation_error", fieldErrors };
      }

      const res: ZonaFormResult =
        isEditar && zona
          ? await actualizarZona(zona.id, parsed.data)
          : await crearZona(parsed.data);

      if (res.status === "validation_error") {
        setErrors(res.fieldErrors);
      } else if (res.status === "conflict") {
        // R11: el conflicto de dominio (nombre o distritos) no trae payload de razón;
        // se muestra un mensaje genérico razonable, sin cerrar el modal ni resetear.
        setErrors({});
        setFormError(
          "Revisa el nombre o los distritos: ya hay un conflicto.",
        );
      } else if (res.status === "ok") {
        setErrors({});
        setFormError(null);
      }
      return res;
    }

    useImperativeHandle(ref, () => ({ submit }));

    const canAddTarifa = form.cobroVehiculo || tarifas.length === 0;

    return (
      <div className="flex flex-col gap-4">
        {/* Error a NIVEL FORMULARIO (conflicto de dominio, sin campo concreto):
            FieldError suelto, sin el andamiaje label/control. */}
        <FieldError>{formError}</FieldError>

        <FormField id="nombre" label="Nombre" error={errors.nombre}>
          <Input
            value={form.nombre}
            onChange={(e) => setField("nombre", e.target.value)}
          />
        </FormField>

        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="cobroVehiculo">Cobra por tipo de vehículo</Label>
          <Switch
            id="cobroVehiculo"
            aria-label="Cobra por tipo de vehículo"
            checked={form.cobroVehiculo}
            onCheckedChange={(next) => setField("cobroVehiculo", next)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="esCentral">Marcar como zona central</Label>
            <Switch
              id="esCentral"
              aria-label="Marcar como zona central"
              checked={form.esCentral}
              onCheckedChange={(next) => {
                setField("esCentral", next);
                if (!next) setConfirmarReasignacion(false);
              }}
            />
          </div>

          {reasignaCentral ? (
            <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 p-2">
              <p role="alert" className="text-sm">
                {`La zona «${centralActual?.nombre ?? ""}» dejará de ser la central.`}
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label="Entiendo que reasignaré la zona central"
                  checked={confirmarReasignacion}
                  onChange={(e) => setConfirmarReasignacion(e.target.checked)}
                />
                <span>Entiendo que reasignaré la zona central</span>
              </label>
            </div>
          ) : null}

          <FieldError id="esCentral-error" messages={errors.esCentral} />
        </div>

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
                  // Deshabilitar los distritos asignados a OTRA zona (R10).
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
                        onChange={() => toggleDistrito(d)}
                      />
                      <span>{d.nombre}</span>
                      {enOtraZona ? (
                        <span className="text-xs text-muted-foreground">
                          {`(asignado a ${d.zonaNombre ?? "otra zona"})`}
                        </span>
                      ) : null}
                    </label>
                  );
                })
              )}
            </div>
          ) : null}

          {resumen.length > 0 ? (
            <div
              role="group"
              aria-label="Distritos seleccionados de la zona"
              data-testid="resumen-distritos"
              className="flex flex-col gap-2 overflow-x-hidden rounded-lg border border-border bg-muted/30 p-2"
            >
              {resumen.map((prov) => (
                <div
                  key={prov.provinciaId ?? "sin-provincia"}
                  className="flex flex-col gap-1.5"
                  role={prov.provinciaNombre ? "group" : undefined}
                  aria-label={prov.provinciaNombre ?? undefined}
                >
                  {prov.provinciaNombre ? (
                    <p className="text-sm font-medium break-words">
                      {prov.provinciaNombre}
                    </p>
                  ) : null}
                  {prov.cantones.map((canton) => (
                    <div
                      key={canton.cantonId}
                      role="group"
                      aria-label={canton.cantonNombre}
                      className="flex flex-col gap-1 pl-2"
                    >
                      <p className="text-xs font-medium text-muted-foreground break-words">
                        {canton.cantonNombre}
                      </p>
                      <ul className="flex flex-col gap-1">
                        {canton.distritos.map((d) => (
                          <li
                            key={d.id}
                            className="flex items-center justify-between gap-2 pl-2"
                          >
                            <span className="min-w-0 break-words text-sm">
                              {d.nombre}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="shrink-0"
                              aria-label={`Quitar ${d.nombre}`}
                              onClick={() => removeDistrito(d.id)}
                            >
                              Quitar
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}

          <p
            className="text-sm text-muted-foreground"
            data-testid="distritos-seleccionados"
          >
            {selectedIds.length > 0
              ? `Distritos seleccionados: ${selectedIds.length}`
              : "Sin distritos seleccionados"}
          </p>

          {/* Error del GRUPO de distritos (fieldset), no de un control único:
              FieldError suelto asociado al conjunto. */}
          <FieldError id="distritoIds-error" messages={errors.distritoIds} />
        </fieldset>

        <fieldset className="flex flex-col gap-3 border-t border-border pt-3">
          <legend className="text-sm font-medium">Tarifas de la zona</legend>

          {tarifas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin tarifas.</p>
          ) : (
            tarifas.map((t, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-lg border border-border p-2"
                role="group"
                aria-label={`Tarifa ${i + 1}`}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`tarifa-${i}-entregado`}>
                    Cobro entregado
                  </Label>
                  <Input
                    id={`tarifa-${i}-entregado`}
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label={`Cobro entregado tarifa ${i + 1}`}
                    value={t.cobroEntregado}
                    onChange={(e) =>
                      updateTarifa(i, { cobroEntregado: e.target.value })
                    }
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`tarifa-${i}-rechazado`}>
                    Cobro rechazado
                  </Label>
                  <Input
                    id={`tarifa-${i}-rechazado`}
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label={`Cobro rechazado tarifa ${i + 1}`}
                    value={t.cobroRechazado}
                    onChange={(e) =>
                      updateTarifa(i, { cobroRechazado: e.target.value })
                    }
                  />
                </div>

                {form.cobroVehiculo ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`tarifa-${i}-vehiculo`}>Vehículo</Label>
                    <Select
                      aria-label={`Vehículo tarifa ${i + 1}`}
                      value={t.vehiculoId}
                      options={vehiculoOptions}
                      placeholder="Selecciona un vehículo"
                      onValueChange={(v) => updateTarifa(i, { vehiculoId: v })}
                    />
                  </div>
                ) : null}

                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Quitar tarifa ${i + 1}`}
                    onClick={() => removeTarifa(i)}
                  >
                    Quitar
                  </Button>
                </div>
              </div>
            ))
          )}

          {canAddTarifa ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={addTarifa}
            >
              Agregar tarifa
            </Button>
          ) : null}

          {/* Error del GRUPO de tarifas (fieldset): FieldError suelto. */}
          <FieldError id="tarifas-error" messages={errors.tarifas} />
        </fieldset>
      </div>
    );
  },
);

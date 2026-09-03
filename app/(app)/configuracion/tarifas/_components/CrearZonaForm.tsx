"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/shared/FieldError";
import { FormField } from "@/components/shared/FormField";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import {
  crearZonaSchema,
  type ZonaActionError,
  type ZonaDTO,
} from "@/lib/types/zona";
import { crearZona, actualizarZona } from "@/lib/actions/zonas";
import { crearTarifa, actualizarTarifa } from "@/lib/actions/tarifas";
import {
  actualizarDistritosEspeciales,
  type ProvinciaArbolDTO,
} from "@/lib/actions/geografia";
import type { VehiculoDTO } from "@/lib/types/vehiculos";

import { GeografiaSelector } from "./GeografiaSelector";
import { PAGO_ZONA_TEXTO } from "./tarifas-labels";
import {
  CobroVehiculoTarifas,
  type CobroVehiculoValue,
} from "./CobroVehiculoTarifas";
import {
  TARIFA_CAMPOS_ZONA,
  TarifaCamposGrid,
  hayAlgunValor,
  tarifaValoresVacios,
  validarTarifaCampos,
  type TarifaCampoKey,
  type TarifaFieldErrors,
  type TarifaValores,
} from "./TarifaCampos";

type FieldErrors = Record<string, string[]>;

/** Valores pre-cargados para editar (o vacíos al crear). */
export interface ZonaFormInitial {
  /** Presente sólo en edición. */
  zonaId?: string;
  nombre: string;
  distritoIds: string[];
  cobro: CobroVehiculoValue;
  /** Marca de zona central (a lo sumo una en true). */
  esCentral?: boolean;
  /**
   * Tarifa de cobro acotada a esta zona y a NINGUNA tienda (`tienda_id` NULL):
   * la fila de `tarifas` que edita la sección "Tarifas de zona". Presente sólo
   * si ya existe.
   */
  tarifaZonaId?: string;
  /** Valores de esa tarifa (strings); vacíos si la zona aún no tiene. */
  tarifaValores?: TarifaValores;
}

export const cobroVacio = (): CobroVehiculoValue => ({
  cobroVehiculo: false,
  tarifas: [{ cobroEntregado: 0, cobroRechazado: 0 }],
});

/**
 * Formulario de crear/editar zona. Compone nombre + selección de distritos
 * (GeografiaSelector) + cobro por vehículo (CobroVehiculoTarifas). Al guardar
 * arma el payload, lo valida contra `crearZonaSchema` (mismo schema que la
 * action) y llama a `crearZona` o `actualizarZona` según el modo. Notifica con
 * toast el éxito/error y avisa al padre con `onSaved` para refrescar la lista.
 */
export function CrearZonaForm({
  mode,
  provincias,
  vehiculos,
  zonas,
  initial,
  onSaved,
  onCancel,
}: {
  mode: "crear" | "editar";
  provincias: ProvinciaArbolDTO[];
  vehiculos: VehiculoDTO[];
  /** Zonas existentes, para verificar si ya hay una marcada como central. */
  zonas: ZonaDTO[];
  initial?: ZonaFormInitial;
  /** Se invoca tras crear/actualizar con éxito (el padre refresca y cierra). */
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const esEditar = mode === "editar";

  // Marca de especial que traía el árbol al montar. El guardado envía el DELTA
  // contra esto: sólo los distritos que el usuario tocó, ni uno más.
  const [especialesIniciales] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    for (const p of provincias)
      for (const c of p.cantones)
        for (const d of c.distritos) if (d.zonaEspecial) ids.add(d.id);
    return ids;
  });

  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [distritoIds, setDistritoIds] = useState<string[]>(
    initial?.distritoIds ?? [],
  );
  // Marca de zona especial tal como la reporta el selector. Arranca en `null`
  // (el selector aún no habló) para no confundirlo con "ninguno es especial".
  const [especiales, setEspeciales] = useState<string[] | null>(null);
  const [cobro, setCobro] = useState<CobroVehiculoValue>(
    initial?.cobro ?? cobroVacio(),
  );
  const [esCentral, setEsCentral] = useState<boolean>(initial?.esCentral ?? false);
  // Sección "Tarifas de zona": mismos campos que el formulario de tienda.
  const [tarifaValores, setTarifaValores] = useState<TarifaValores>(
    initial?.tarifaValores ?? tarifaValoresVacios(),
  );
  const [tarifaErrors, setTarifaErrors] = useState<TarifaFieldErrors>({});

  const [errors, setErrors] = useState<FieldErrors>({});
  const [guardando, setGuardando] = useState(false);
  // Id de la zona ya persistida en ESTA sesión del formulario. Existe para que
  // un fallo al guardar la tarifa de zona no deje reintentar creando una zona
  // duplicada: a partir del primer éxito el guardado pasa a ser actualización.
  const [zonaIdGuardada, setZonaIdGuardada] = useState<string | undefined>(
    initial?.zonaId,
  );
  // Igual para la tarifa: tras crearla, el reintento la actualiza.
  const [tarifaZonaId, setTarifaZonaId] = useState<string | undefined>(
    initial?.tarifaZonaId,
  );
  // Zona central en conflicto (ya marcada); si !== null, se muestra el modal de
  // confirmación antes de reestablecer la marca a esta zona.
  const [centralConflicto, setCentralConflicto] = useState<ZonaDTO | null>(null);

  function setCampoTarifa(key: TarifaCampoKey, value: string) {
    setTarifaValores((prev) => ({ ...prev, [key]: value }));
  }

  /** Arma el candidato y lo valida contra el mismo schema que la action. */
  function validar() {
    const candidate = {
      nombre,
      cobroVehiculo: cobro.cobroVehiculo,
      esCentral,
      distritoIds,
      tarifas: cobro.tarifas,
    };
    return crearZonaSchema.safeParse(candidate);
  }

  /**
   * Valida la sección "Tarifas de zona". Dejarla ENTERA en blanco es válido y
   * significa "esta zona no lleva tarifa propia" (no borra la que hubiera); en
   * cuanto se escribe un campo, rigen las mismas reglas que en el formulario de
   * tienda: todos obligatorios salvo la tarifa especial.
   */
  function validarTarifa():
    | { ok: true; numericos: Record<string, number | null> | null }
    | { ok: false } {
    if (!hayAlgunValor(tarifaValores, TARIFA_CAMPOS_ZONA)) {
      setTarifaErrors({});
      return { ok: true, numericos: null };
    }
    const campos = validarTarifaCampos(tarifaValores, TARIFA_CAMPOS_ZONA);
    if (!campos.ok) {
      setTarifaErrors(campos.errors);
      return { ok: false };
    }
    setTarifaErrors({});
    return { ok: true, numericos: campos.numericos };
  }

  /**
   * Guarda la tarifa acotada a la zona (`zona_id` = la zona, `tienda_id` NULL:
   * aplica a cualquier tienda que no tenga la suya). Devuelve `true` si no había
   * nada que guardar o si se guardó bien.
   */
  async function guardarTarifaZona(
    zonaId: string,
    numericos: Record<string, number | null> | null,
  ): Promise<boolean> {
    if (!numericos) return true;
    const payload = { ...numericos, zonaId, isDefault: false };
    const res = tarifaZonaId
      ? await actualizarTarifa(tarifaZonaId, payload)
      : await crearTarifa(payload);

    if (res.status === "ok") {
      setTarifaZonaId(res.tarifa.id);
      return true;
    }
    if (res.status === "validation_error") setTarifaErrors(res.fieldErrors);
    toast.error(
      "La zona se guardó, pero no se pudo guardar la tarifa de zona.",
    );
    return false;
  }

  /**
   * Persiste la marca `distrito.zona_especial` de los distritos que cambiaron.
   * Como la marca vive en el distrito y no en la zona, al refrescar queda
   * resaltada en TODAS las zonas que contengan ese distrito.
   *
   * Devuelve `true` si no había nada que guardar o si se guardó bien. Un fallo
   * aquí NO tumba el guardado de la zona: avisa y sigue.
   */
  async function guardarEspeciales(): Promise<boolean> {
    if (especiales === null) return true; // el selector no reportó nada aún
    const actuales = new Set(especiales);
    const marcar = [...actuales].filter((id) => !especialesIniciales.has(id));
    const desmarcar = [...especialesIniciales].filter(
      (id) => !actuales.has(id),
    );
    if (marcar.length === 0 && desmarcar.length === 0) return true;

    const res = await actualizarDistritosEspeciales({ marcar, desmarcar });
    if (res.status === "ok") return true;
    toast.error("No se pudo guardar la marca de zona especial.");
    return false;
  }

  /** Envía el payload (crear/actualizar) y maneja resultado/errores. */
  async function enviar() {
    const parsed = validar();
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      return;
    }
    // Las dos secciones se validan ANTES de tocar el servidor: nada de guardar
    // la zona y descubrir después que la tarifa no pasaba.
    const tarifa = validarTarifa();
    if (!tarifa.ok) return;

    setErrors({});
    setGuardando(true);
    try {
      // Ramas separadas (en vez de un `zonaIdGuardada ? A : B` con `res` único):
      // `ActualizarZonaResult["ok"]` trae `ordenesReconciliadas` y
      // `CrearZonaResult["ok"]` no (T6/R13); estructuralmente uno es asignable
      // al otro (tener una propiedad de más no rompe la asignación), así que
      // anotar `res` con la unión explícita le impide a `tsc` angostarlo por
      // asignación: `res.status === "ok"` cae en la unión de LOS DOS "ok",
      // no en el de la rama que de verdad corrió. Sin anotar el tipo, `tsc`
      // sigue el tipo "evolutivo" de cada asignación y sí distingue las ramas.
      let ordenesReconciliadas = 0;
      let res;
      if (zonaIdGuardada) {
        res = await actualizarZona(zonaIdGuardada, parsed.data);
        if (res.status === "ok") ordenesReconciliadas = res.ordenesReconciliadas;
      } else {
        res = await crearZona(parsed.data);
      }

      if (res.status === "ok") {
        setZonaIdGuardada(res.zona.id);
        if (!(await guardarTarifaZona(res.zona.id, tarifa.numericos))) return;
        // La marca de especial se guarda con la zona ya persistida: si falla,
        // la zona sigue guardada y sólo se avisa de lo que no entró.
        await guardarEspeciales();
        toast.success(mensajeGuardado(esEditar, ordenesReconciliadas));
        onSaved();
        return;
      }

      // Error: validación por campo inline; el resto como toast.
      if (res.status === "validation_error") {
        setErrors(res.fieldErrors);
      }
      toast.error(mensajeDeError(res));
    } catch {
      toast.error("Ocurrió un error inesperado.");
    } finally {
      setGuardando(false);
    }
  }

  async function guardar() {
    const parsed = validar();
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      return;
    }
    setErrors({});

    // Si se marca como central, verifica que ninguna otra zona ya lo esté. Si la hay,
    // se pide confirmación (reestablecerá la marca a esta zona).
    if (esCentral) {
      const conflicto = zonas.find(
        (z) => z.esCentral && z.id !== zonaIdGuardada,
      );
      if (conflicto) {
        setCentralConflicto(conflicto);
        return;
      }
    }

    await enviar();
  }

  return (
    <div className="flex flex-col gap-6 rounded-md border border-border p-4">
      <h3 className="text-sm font-semibold">
        {esEditar ? "Editar zona" : "Nueva zona"}
      </h3>

      <FormField id="nombre-zona" label="Nombre de la zona" error={errors.nombre}>
        <Input
          value={nombre}
          placeholder="Ej: San José centro"
          onChange={(e) => setNombre(e.target.value)}
        />
      </FormField>

      <div className="flex items-center gap-2">
        <Checkbox
          id="es-central-zona"
          checked={esCentral}
          onCheckedChange={(checked) => setEsCentral(checked === true)}
        />
        <Label htmlFor="es-central-zona" className="cursor-pointer">
          Zona Central
        </Label>
      </div>

      <GeografiaSelector
        provincias={provincias}
        initialSelected={initial?.distritoIds}
        onSelectedChange={setDistritoIds}
        onEspecialesChange={setEspeciales}
      />
      {/* Error del GRUPO de distritos (selector geográfico): FieldError suelto. */}
      <FieldError messages={errors.distritoIds} />

      {/* Las dos secciones van lado a lado (6-6 del grid de 12) desde `lg`; por
          debajo se apilan, que es lo único legible en un móvil. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Sección 1: lo que Ordenex PAGA por cada gestión de la zona —al mensajero la entrega,
            a la bodega el rechazo del cliente—.
            La celda es `relative` y la sección se posiciona ABSOLUTA dentro (sólo
            desde `lg`): así no aporta altura, la fila la fija "Tarifas de zona" y
            esta columna nunca queda más alta que la otra —si su contenido no cabe
            (cobro por vehículo con varias filas), scrollea dentro. Por debajo de
            `lg` vuelve al flujo normal y se apila sin recortes. */}
        <div className="relative lg:col-span-6">
          <section className="flex flex-col gap-4 rounded-md border border-border p-4 lg:absolute lg:inset-0 lg:overflow-y-auto">
            {/* Feature 303 — decía «Pago a mensajeros» y «por entrega y por no entrega», y las
                dos cosas estaban mal por el mismo motivo: de los dos montos, sólo el de entrega
                se le paga al mensajero (el del rechazo es ingreso de la BODEGA, `ingreso-bodega
                .ts`), y «no entrega» abarcaba `devuelta` y `reprogramada`, que no pagan nada. */}
            <div className="flex flex-col gap-1">
              <h4 className="text-sm font-semibold">{PAGO_ZONA_TEXTO.seccion}</h4>
              <p className="max-w-prose text-xs text-muted-foreground">
                {PAGO_ZONA_TEXTO.seccionAyuda}
              </p>
            </div>

            <CobroVehiculoTarifas
              vehiculos={vehiculos}
              initial={initial?.cobro}
              onChange={setCobro}
            />
            {/* Error del GRUPO de tarifas: FieldError suelto. */}
            <FieldError messages={errors.tarifas} />
          </section>
        </div>

        {/* Sección 2: el mismo formulario de tarifa de tienda, sin el select de
            tienda: aquí la tarifa se acota a la ZONA y no a un dueño. */}
        <section className="flex flex-col gap-4 rounded-md border border-border p-4 lg:col-span-6">
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-semibold">Tarifas de zona</h4>
            <p className="max-w-prose text-xs text-muted-foreground">
              Lo que se cobra por repartir en esta zona, para cualquier tienda que
              no tenga una tarifa propia. Déjalo todo en blanco si esta zona no
              lleva tarifa propia.
            </p>
          </div>

          {/* Sin `fulfillment` (2026-08-26): el servicio de bodega es un acuerdo con una
              TIENDA, no una propiedad de la zona. El campo omitido viaja como `null` y la
              columna lo admite desde `tarifa_fulfillment_opcional`. */}
          <TarifaCamposGrid
            idPrefix="zona-tarifa"
            campos={TARIFA_CAMPOS_ZONA}
            valores={tarifaValores}
            errors={tarifaErrors}
            onChange={setCampoTarifa}
          />
        </section>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" onClick={guardar} loading={guardando}>
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

      <Modal
        open={centralConflicto !== null}
        onOpenChange={(o) => {
          if (!o) setCentralConflicto(null); // Cancelar cierra y no envía.
        }}
        title="Zona central ya asignada"
        description={
          centralConflicto
            ? `La zona ${centralConflicto.nombre} ya está marcada como Central. Esta acción reestablecerá la zona Central. ¿Desea continuar?`
            : ""
        }
        confirmLabel="Continuar"
        cancelLabel="Cancelar"
        onConfirm={async () => {
          setCentralConflicto(null);
          await enviar();
        }}
      />
    </div>
  );
}

/**
 * Mensaje de éxito del guardado. Al crear, siempre "Zona creada": crear nunca
 * reconcilia órdenes (R13). Al editar, si el guardado reubicó órdenes de otra
 * bodega (su distrito ya resolvía otra zona), lo dice con el conteo exacto;
 * con 0 el mensaje queda igual que antes de esta ficha.
 */
function mensajeGuardado(esEditar: boolean, ordenesReconciliadas: number): string {
  if (!esEditar) return "Zona creada";
  if (ordenesReconciliadas <= 0) return "Zona actualizada";
  const sustantivo =
    ordenesReconciliadas === 1 ? "orden reubicada" : "órdenes reubicadas";
  return `Zona actualizada (${ordenesReconciliadas} ${sustantivo})`;
}

/** Mensaje legible para los estados de error de crear/actualizar zona. */
function mensajeDeError(err: ZonaActionError): string {
  switch (err.status) {
    case "validation_error":
      return "Revisa los campos: el formulario está incompleto.";
    case "conflict":
      return "Ya existe una zona con ese nombre o un distrito ya está asignado.";
    case "unauthenticated":
      return "Tu sesión expiró.";
    case "forbidden":
      return "No tienes permiso para esta acción.";
    case "not_found":
      return "La zona no existe.";
    default:
      return "No se pudo guardar la zona.";
  }
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/shared/FormField";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import {
  actualizarPlantillaAction,
  crearPlantillaAction,
} from "@/lib/actions/gasto-fijo-plantilla";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import type { PeriodicidadUnidad } from "@/lib/utils/periodicidad";

import {
  PERIODICIDAD_OPTIONS,
  PERIODICIDAD_PERSONALIZADA,
  PERIODICIDAD_PRESETS,
  PERIODICIDAD_UNIDAD_OPTIONS,
  montoValido,
  presetDePeriodicidad,
  type PeriodicidadSeleccion,
} from "./wallet-labels";

// Feature 45 (T24, R22b/R24/R25) — diálogo de CREAR/EDITAR una plantilla de gasto fijo
// (solo maestro; la página ya validó el rol). Reutilizado por el panel para ambos modos.
// La plantilla es CONFIGURACIÓN (mutable, editable): el cron la lee y emite los egresos;
// este diálogo NUNCA crea un egreso a mano. Money-safe: el monto viaja como STRING y se
// valida >0 con regex (sin parseFloat/Number); el backend re-valida con Decimal. Sin
// borrado (R25): la desactivación (en el panel) es el mecanismo para dejar de generar.
//
// Feature 85 (T F.2, design §4.3) — EL DIÁLOGO PIDE EL CICLO, y lo ENVÍA SIEMPRE.
//
// Qué estaba roto: al editar mandaba `{ id, concepto, monto }` y nada más. Los tres campos
// del ciclo tenían `.default()` en el schema, así que **cambiar el monto reescribía la
// periodicidad a `meses`/`1` y movía la fecha de cobro al día de la edición**, en silencio; y
// cambiar la unidad de/hacia `meses` cambia el formato del periodo de la clave de
// idempotencia (`YYYY-MM` ↔ `YYYY-MM-DD`), que es el escenario de DOBLE COBRO documentado en
// `GeneracionGastosFijosService`. La fase B cerró el borde (una edición incompleta ya muere
// con `validation_error`); esto es la otra mitad: el formulario tiene los tres valores en la
// mano —el DTO los trae— y los reenvía TAL CUAL cuando no se tocan (R3/R15).
//
// `periodicidadCantidad` NO es dinero: es un contador y viaja como entero. El monto sigue
// siendo STRING de punta a punta (R24).

export interface GastoFijoPlantillaDialogProps {
  /** Visibilidad controlada por el panel. */
  open: boolean;
  /** Emite el cierre; el panel actualiza su estado. */
  onOpenChange: (open: boolean) => void;
  /** Plantilla a editar; `null`/ausente = crear una nueva. */
  plantilla?: GastoFijoPlantillaDTO | null;
  /** Callback tras un guardado exitoso (para que el panel recargue la lista). */
  onGuardado?: () => void;
}

/** Los campos del ciclo tal como los edita el formulario (la cantidad, como texto). */
interface CicloFormulario {
  /** Qué opción está elegida en «Cada cuánto se cobra». */
  seleccion: PeriodicidadSeleccion;
  unidad: PeriodicidadUnidad;
  /** Texto del campo «Cada N»: se valida con regex, nunca con `Number` a ciegas. */
  cantidad: string;
  /** `YYYY-MM-DD`, el formato nativo de `<input type="date">` y el de la columna. */
  fechaCobro: string;
}

/** Errores por campo; las tres claves nuevas son las MISMAS que devuelve el borde (R17). */
type ErroresFormulario = Partial<
  Record<
    "concepto" | "monto" | "periodicidadUnidad" | "periodicidadCantidad" | "fechaCobro",
    string
  >
>;

/** Cantidad válida del ciclo propio: entero >= 1, sin ceros a la izquierda (R16). */
const CANTIDAD_VALIDA = /^[1-9]\d*$/;

/**
 * El ciclo de una plantilla NUEVA: mensual y hoy en Costa Rica (R13). `fechaCalendarioCR`
 * y no `new Date().toISOString().slice(0,10)`: después de las 18:00 de CR el segundo ya
 * devuelve el día siguiente.
 */
function cicloNuevo(): CicloFormulario {
  return {
    seleccion: "mensual",
    unidad: "meses",
    cantidad: "1",
    fechaCobro: fechaCalendarioCR(),
  };
}

/** El ciclo VIGENTE de la plantilla que se edita, tal cual lo trae el DTO (R14). */
function cicloDe(plantilla: GastoFijoPlantillaDTO | null): CicloFormulario {
  if (!plantilla) return cicloNuevo();
  return {
    seleccion: presetDePeriodicidad(
      plantilla.periodicidadUnidad,
      plantilla.periodicidadCantidad,
    ),
    unidad: plantilla.periodicidadUnidad,
    cantidad: String(plantilla.periodicidadCantidad),
    fechaCobro: plantilla.fechaCobro,
  };
}

export function GastoFijoPlantillaDialog({
  open,
  onOpenChange,
  plantilla = null,
  onGuardado,
}: GastoFijoPlantillaDialogProps) {
  const router = useRouter();
  const toast = useToast();

  const modo = plantilla ? "editar" : "crear";
  const [concepto, setConcepto] = useState(plantilla?.concepto ?? "");
  const [monto, setMonto] = useState(plantilla?.monto ?? "");
  const [ciclo, setCiclo] = useState<CicloFormulario>(() => cicloDe(plantilla));
  const [errores, setErrores] = useState<ErroresFormulario>({});
  // Detecta el cambio de plantilla/modo para re-sembrar los campos cuando el panel reabre
  // el diálogo con otra fila (o pasa de editar a crear) sin desmontarlo.
  const [ultimaId, setUltimaId] = useState<string | null>(plantilla?.id ?? null);
  if ((plantilla?.id ?? null) !== ultimaId) {
    setUltimaId(plantilla?.id ?? null);
    setConcepto(plantilla?.concepto ?? "");
    setMonto(plantilla?.monto ?? "");
    setCiclo(cicloDe(plantilla));
    setErrores({});
  }

  const personalizada = ciclo.seleccion === PERIODICIDAD_PERSONALIZADA;

  /**
   * Con el ciclo elegido por preset, la cantidad y la unidad NO tienen control propio: un
   * error del servidor sobre cualquiera de los dos se pinta junto al selector, que es el único
   * campo que la persona puede corregir. En «Personalizada» cada uno tiene el suyo (R17).
   */
  const erroresDelSelector = personalizada
    ? []
    : [errores.periodicidadUnidad, errores.periodicidadCantidad].filter(
        (mensaje): mensaje is string => Boolean(mensaje),
      );

  /**
   * Aviso, NO bloqueo (decisión de producto): un ancla en el pasado es legítima —es como se
   * corrige una fecha mal puesta, y es lo que hizo el backfill de la ficha 84—, pero no genera
   * cobros atrasados, y eso hay que decirlo antes de guardar.
   */
  const fechaEnElPasado =
    ciclo.fechaCobro !== "" && ciclo.fechaCobro < fechaCalendarioCR();

  function limpiarErrores(...claves: (keyof ErroresFormulario)[]) {
    setErrores((previos) => {
      const siguiente = { ...previos };
      for (const clave of claves) delete siguiente[clave];
      return siguiente;
    });
  }

  /** Un preset FIJA el par unidad+cantidad; «Personalizada» conserva lo que hubiera. */
  function elegirPeriodicidad(valor: string) {
    const seleccion = valor as PeriodicidadSeleccion;
    const preset = PERIODICIDAD_PRESETS.find((p) => p.id === seleccion);
    setCiclo((previo) => ({
      ...previo,
      seleccion,
      unidad: preset ? preset.unidad : previo.unidad,
      cantidad: preset ? String(preset.cantidad) : previo.cantidad,
    }));
    limpiarErrores("periodicidadUnidad", "periodicidadCantidad");
  }

  async function confirmar() {
    // Validación en cliente (el backend re-valida, R24).
    const nuevosErrores: ErroresFormulario = {};
    if (concepto.trim().length === 0) {
      nuevosErrores.concepto = "El concepto es obligatorio.";
    }
    if (!montoValido(monto)) {
      nuevosErrores.monto = "El monto debe ser un número mayor que 0.";
    }
    if (!CANTIDAD_VALIDA.test(ciclo.cantidad.trim())) {
      // Mismo texto que devuelve el borde para este campo: el mensaje no cambia según quién
      // lo detecte primero.
      nuevosErrores.periodicidadCantidad = "La cantidad debe ser al menos 1.";
    }
    if (ciclo.fechaCobro.trim().length === 0) {
      nuevosErrores.fechaCobro = "La fecha de cobro es obligatoria.";
    }
    if (Object.keys(nuevosErrores).length > 0) {
      setErrores(nuevosErrores);
      return;
    }

    // Los cinco campos, SIEMPRE, tanto al crear como al editar (R15). En una edición donde
    // solo cambió el monto, estos tres valen exactamente lo que traía el DTO (R3).
    const cicloEnviado = {
      periodicidadUnidad: ciclo.unidad,
      periodicidadCantidad: Number(ciclo.cantidad.trim()),
      fechaCobro: ciclo.fechaCobro.trim(),
    };

    const result =
      modo === "editar" && plantilla
        ? await actualizarPlantillaAction({
            id: plantilla.id,
            concepto: concepto.trim(),
            monto: monto.trim(),
            ...cicloEnviado,
          })
        : await crearPlantillaAction({
            concepto: concepto.trim(),
            monto: monto.trim(),
            ...cicloEnviado,
          });

    if (result.status === "ok") {
      toast.success(
        modo === "editar" ? "Plantilla actualizada." : "Plantilla creada.",
      );
      onOpenChange(false);
      onGuardado?.();
      router.refresh();
      return;
    }
    if (result.status === "validation_error") {
      // R17: los tres campos del ciclo se mapean como concepto y monto. Descartarlos en
      // silencio dejaría el diálogo sin decir por qué no guardó.
      setErrores({
        concepto: result.fieldErrors.concepto?.[0],
        monto: result.fieldErrors.monto?.[0],
        periodicidadUnidad: result.fieldErrors.periodicidadUnidad?.[0],
        periodicidadCantidad: result.fieldErrors.periodicidadCantidad?.[0],
        fechaCobro: result.fieldErrors.fechaCobro?.[0],
      });
      return;
    }
    if (result.status === "forbidden") {
      toast.error("No tenés permiso para administrar plantillas.");
      return;
    }
    if (result.status === "not_found") {
      toast.error("La plantilla ya no existe.");
      onOpenChange(false);
      onGuardado?.();
      return;
    }
    // unauthenticated
    toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        modo === "editar"
          ? "Editar plantilla de gasto fijo"
          : "Nueva plantilla de gasto fijo"
      }
      // R22: la descripción ya no promete un cobro mensual. Lo que se cobra y cuándo lo dice
      // el ciclo de cada plantilla, que es justo lo que este diálogo configura.
      description="El sistema genera el egreso de este gasto por su cuenta, con el ciclo que elijas acá."
      confirmLabel="Guardar"
      onConfirm={confirmar}
      closeOnConfirm={false}
    >
      <div className="flex flex-col gap-4">
        <FormField id="plantilla-concepto" label="Concepto" error={errores.concepto}>
          {(control) => (
            <Input
              {...control}
              aria-required="true"
              value={concepto}
              onChange={(e) => {
                setConcepto(e.target.value);
                if (errores.concepto) limpiarErrores("concepto");
              }}
              placeholder="Ej. Alquiler de bodega"
            />
          )}
        </FormField>

        {/* R22: «Monto mensual» era falso desde que existe la periodicidad — dos plantillas
            de ₡50.000, una semanal y otra mensual, salían como filas idénticas bajo esa
            etiqueta. La ayuda dice lo que el rótulo ya no afirma. */}
        <FormField
          id="plantilla-monto"
          label="Monto"
          hint="Es lo que se cobra cada vez."
          error={errores.monto}
        >
          {(control) => (
            <Input
              {...control}
              aria-required="true"
              inputMode="decimal"
              value={monto}
              onChange={(e) => {
                setMonto(e.target.value);
                if (errores.monto) limpiarErrores("monto");
              }}
              placeholder="0.00"
            />
          )}
        </FormField>

        <FormField
          id="plantilla-periodicidad"
          label="Cada cuánto se cobra"
          error={erroresDelSelector}
        >
          {/* El `Select` no admite el spread del control (no tiene `aria-required`): se le
              cablea la accesibilidad campo a campo, como en `UsuarioForm`. */}
          {({ "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => (
            <Select
              id="plantilla-periodicidad"
              aria-label="Cada cuánto se cobra"
              aria-invalid={ariaInvalid}
              aria-describedby={ariaDescribedBy}
              value={ciclo.seleccion}
              onValueChange={elegirPeriodicidad}
              options={PERIODICIDAD_OPTIONS}
            />
          )}
        </FormField>

        {personalizada ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-3">
            <FormField
              id="plantilla-periodicidad-cantidad"
              label="Cada"
              error={errores.periodicidadCantidad}
              className="sm:flex-1"
            >
              {(control) => (
                <Input
                  {...control}
                  aria-required="true"
                  inputMode="numeric"
                  value={ciclo.cantidad}
                  onChange={(e) => {
                    const cantidad = e.target.value;
                    setCiclo((previo) => ({ ...previo, cantidad }));
                    if (errores.periodicidadCantidad)
                      limpiarErrores("periodicidadCantidad");
                  }}
                  placeholder="1"
                />
              )}
            </FormField>

            <FormField
              id="plantilla-periodicidad-unidad"
              label="Unidad"
              error={errores.periodicidadUnidad}
              className="sm:flex-1"
            >
              {({ "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => (
                <Select
                  id="plantilla-periodicidad-unidad"
                  aria-label="Unidad del ciclo"
                  aria-invalid={ariaInvalid}
                  aria-describedby={ariaDescribedBy}
                  value={ciclo.unidad}
                  onValueChange={(valor) => {
                    const unidad = valor as PeriodicidadUnidad;
                    setCiclo((previo) => ({ ...previo, unidad }));
                    if (errores.periodicidadUnidad) limpiarErrores("periodicidadUnidad");
                  }}
                  options={PERIODICIDAD_UNIDAD_OPTIONS}
                />
              )}
            </FormField>
          </div>
        ) : null}

        <FormField
          id="plantilla-fecha-cobro"
          label="Día del primer cobro"
          // Decisión de producto: mover esta fecha mueve el ciclo entero, y basta con
          // decirlo aquí — sin una confirmación extra que nadie lee.
          hint="Desde esta fecha se cuentan los cobros siguientes. Si la cambiás, se mueve todo el ciclo."
          error={errores.fechaCobro}
        >
          {(control) => (
            <Input
              {...control}
              aria-required="true"
              type="date"
              value={ciclo.fechaCobro}
              onChange={(e) => {
                const fechaCobro = e.target.value;
                setCiclo((previo) => ({ ...previo, fechaCobro }));
                if (errores.fechaCobro) limpiarErrores("fechaCobro");
              }}
            />
          )}
        </FormField>

        {fechaEnElPasado ? (
          <p role="status" className="text-sm text-muted-foreground">
            Esa fecha ya pasó. No se generan cobros atrasados: el primero será el que toque
            de aquí en adelante.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

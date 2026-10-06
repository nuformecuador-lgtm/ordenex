"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/FormField";
import {
  actualizarPlantillaSchema,
  type ActualizarPlantillaResult,
  type PlantillaListItemDTO,
} from "@/lib/types/plantilla-mensaje";
import { actualizarPlantilla } from "@/lib/actions/plantillas";

import { PlantillaTiendaField } from "./PlantillaTiendaField";
import { VariablesInsert } from "./VariablesInsert";
import { PlantillaInformeFields, type InformeParaPlantilla } from "./PlantillaInformeFields";

type FieldErrors = Record<string, string[]>;

/** Referencia estable para cuando el módulo no recibe informes (tests anteriores a la 474). */
const SIN_INFORMES: readonly InformeParaPlantilla[] = [];

/** Clases del textarea del cuerpo, alineadas al `Input` del sistema de diseño. */
const TEXTAREA_CLASS =
  "w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30";

/** Handle imperativo: el Modal anfitrión dispara el submit async. */
export interface EditarPlantillaFormHandle {
  submit: () => Promise<ActualizarPlantillaResult>;
  /**
   * Valor ACTUAL del interruptor "Plantilla de tienda", que no tiene por qué ser el de la
   * fila: el maestro puede haberlo encendido en esta misma edición. El módulo lo consulta
   * para decidir si el guardado necesita la confirmación de "esto vuelve a Meta" — una
   * plantilla de tienda no la necesita porque no sale de casa.
   */
  esPlantillaTienda: () => boolean;
}

export interface EditarPlantillaFormProps {
  /** Plantilla a editar (precarga los campos). */
  plantilla: PlantillaListItemDTO;
  /** Ficha 474: el catálogo de informes (de `listarInformesWhatsapp()`). */
  informes?: readonly InformeParaPlantilla[];
}

/**
 * Ficha 474 (R7): una plantilla que ya salió hacia Meta —tiene template enlazado o su estado no es
 * «guardada sin aprobación»— no cambia de informe ni de documento. Espejo del service, que es quien
 * manda; aquí solo evita ofrecer un cambio que se va a rechazar.
 */
export function tipoBloqueado(p: Pick<PlantillaListItemDTO, "templateId" | "estado">): boolean {
  return p.templateId !== null || p.estado !== "saved_not_aprobation";
}

/**
 * Formulario de edición de plantilla (feature 107/R20). Mismas validaciones que
 * la creación (R22) reusando `actualizarPlantillaSchema`; delega en la Server
 * Action `actualizarPlantilla`. El error de llave malformada (R16) llega como
 * `fieldErrors.cuerpo`; el conflicto de nombre (R10, excluyendo la propia) se
 * pinta en el campo `nombre`.
 *
 * Ficha 474 (T10.1): tipo y documento (R3, R6, R7). Con el tipo bloqueado (R7) esos dos campos NO
 * viajan —omitidos = «no se tocan» en el contrato—, así que guardar el texto nunca los cambia.
 */
export const EditarPlantillaForm = forwardRef<
  EditarPlantillaFormHandle,
  EditarPlantillaFormProps
>(function EditarPlantillaForm({ plantilla, informes = SIN_INFORMES }, ref) {
  const [nombre, setNombre] = useState(plantilla.nombre);
  const [cuerpo, setCuerpo] = useState(plantilla.cuerpo);
  const [plantillaTienda, setPlantillaTienda] = useState(plantilla.plantillaTienda);
  const [informeClave, setInformeClave] = useState<string | null>(plantilla.informeClave ?? null);
  const [llevaDocumento, setLlevaDocumento] = useState(plantilla.llevaDocumento === true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bloqueado = tipoBloqueado(plantilla);
  const informe = informes.find((i) => i.clave === informeClave);

  async function submit(): Promise<ActualizarPlantillaResult> {
    const tipo = bloqueado || informes.length === 0 ? {} : { informeClave, llevaDocumento: informeClave ? llevaDocumento : false };
    const parsed = actualizarPlantillaSchema.safeParse({
      nombre,
      cuerpo,
      plantillaTienda: informeClave ? false : plantillaTienda,
      ...tipo,
    });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors as FieldErrors;
      setErrors(fieldErrors);
      return { status: "validation_error", fieldErrors };
    }

    const res = await actualizarPlantilla(plantilla.id, parsed.data);

    if (res.status === "validation_error") {
      setErrors(res.fieldErrors); // R16: fieldErrors.cuerpo (llave malformada)
    } else if (res.status === "conflict") {
      setErrors({ nombre: ["Ya existe una plantilla con ese nombre"] });
    } else {
      setErrors({});
    }
    return res;
  }

  useImperativeHandle(ref, () => ({ submit, esPlantillaTienda: () => plantillaTienda && !informeClave }));

  return (
    <div className="flex flex-col gap-4">
      <FormField id="plantilla-nombre-edit" label="Nombre" error={errors.nombre}>
        <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </FormField>

      {informes.length > 0 && !plantillaTienda ? (
        <PlantillaInformeFields
          idBase="plantilla-informe-edit"
          informes={informes}
          informeClave={informeClave}
          onInformeClave={setInformeClave}
          llevaDocumento={llevaDocumento}
          onLlevaDocumento={setLlevaDocumento}
          bloqueado={bloqueado}
          errores={{ informeClave: errors.informeClave, llevaDocumento: errors.llevaDocumento }}
        />
      ) : null}

      <FormField id="plantilla-cuerpo-edit" label="Cuerpo" error={errors.cuerpo}>
        <textarea
          ref={textareaRef}
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          rows={5}
          className={TEXTAREA_CLASS}
        />
      </FormField>

      {informeClave === null ? (
        <PlantillaTiendaField
          id="plantilla-tienda-edit"
          checked={plantillaTienda}
          onCheckedChange={setPlantillaTienda}
          disabled={plantilla.plantillaTienda}
        />
      ) : null}

      <VariablesInsert
        textareaRef={textareaRef}
        value={cuerpo}
        onInsert={(next) => setCuerpo(next)}
        variablesNombres={plantilla.variablesNombres}
        variablesInforme={informe?.variables}
      />
    </div>
  );
});

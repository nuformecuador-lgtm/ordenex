"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/FormField";
import {
  crearPlantillaSchema,
  type CrearPlantillaResult,
} from "@/lib/types/plantilla-mensaje";
import { crearPlantilla } from "@/lib/actions/plantillas";

import { PlantillaTiendaField } from "./PlantillaTiendaField";
import { VariablesInsert } from "./VariablesInsert";
import { PlantillaInformeFields, type InformeParaPlantilla } from "./PlantillaInformeFields";

type FieldErrors = Record<string, string[]>;

/** Referencia estable: una plantilla nueva no tiene snapshot persistido (feature 282). */
const SIN_VARIABLES_NOMBRES: Record<string, string> = {};

/** Referencia estable para cuando el módulo no recibe informes (tests anteriores a la 474). */
const SIN_INFORMES: readonly InformeParaPlantilla[] = [];

/** Clases del textarea del cuerpo, alineadas al `Input` del sistema de diseño. */
const TEXTAREA_CLASS =
  "w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30";

/** Handle imperativo: el Modal anfitrión dispara el submit async. */
export interface CrearPlantillaFormHandle {
  submit: () => Promise<CrearPlantillaResult>;
}

export interface CrearPlantillaFormProps {
  /** Ficha 474: el catálogo de informes (de `listarInformesWhatsapp()`) para «Tipo de plantilla». */
  informes?: readonly InformeParaPlantilla[];
}

/**
 * Formulario de creación de plantilla (feature 107/R8). Molde de
 * `GenerarApiKeyForm`: valida en cliente reusando `crearPlantillaSchema` (nombre y
 * cuerpo no vacíos, R11) y delega en la Server Action `crearPlantilla`. Los
 * `fieldErrors` del backend se pintan por campo; el error de llave malformada
 * (R16) llega como `fieldErrors.cuerpo`. La botonera `VariablesInsert` inserta
 * `{{clave}}` en el cursor (R17) y ofrece vista previa (R18).
 *
 * Ficha 474 (T10.1): «Tipo de plantilla» (de orden / de informe) y «Lleva documento adjunto». Una
 * plantilla de informe no es «de tienda» (R8: no se ofrece en el chat): el interruptor de tienda
 * desaparece y el selector de variables pasa a ser el del informe (R4, R53).
 */
export const CrearPlantillaForm = forwardRef<CrearPlantillaFormHandle, CrearPlantillaFormProps>(
  function CrearPlantillaForm({ informes = SIN_INFORMES }, ref) {
    const [nombre, setNombre] = useState("");
    const [cuerpo, setCuerpo] = useState("");
    const [plantillaTienda, setPlantillaTienda] = useState(false);
    const [informeClave, setInformeClave] = useState<string | null>(null);
    const [llevaDocumento, setLlevaDocumento] = useState(false);
    const [errors, setErrors] = useState<FieldErrors>({});
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const informe = informes.find((i) => i.clave === informeClave);

    async function submit(): Promise<CrearPlantillaResult> {
      const datos = informeClave
        ? { nombre, cuerpo, plantillaTienda: false, informeClave, llevaDocumento }
        : { nombre, cuerpo, plantillaTienda };
      const parsed = crearPlantillaSchema.safeParse(datos);
      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors as FieldErrors;
        setErrors(fieldErrors);
        return { status: "validation_error", fieldErrors };
      }

      const res = await crearPlantilla(parsed.data);

      if (res.status === "validation_error") {
        setErrors(res.fieldErrors); // R16: fieldErrors.cuerpo (llave malformada)
      } else if (res.status === "conflict") {
        setErrors({ nombre: ["Ya existe una plantilla con ese nombre"] });
      } else {
        setErrors({});
      }
      return res;
    }

    useImperativeHandle(ref, () => ({ submit }));

    return (
      <div className="flex flex-col gap-4">
        <FormField id="plantilla-nombre" label="Nombre" error={errors.nombre}>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </FormField>

        {informes.length > 0 && !plantillaTienda ? (
          <PlantillaInformeFields
            idBase="plantilla-informe"
            informes={informes}
            informeClave={informeClave}
            onInformeClave={setInformeClave}
            llevaDocumento={llevaDocumento}
            onLlevaDocumento={setLlevaDocumento}
            bloqueado={false}
            errores={{ informeClave: errors.informeClave, llevaDocumento: errors.llevaDocumento }}
          />
        ) : null}

        <FormField id="plantilla-cuerpo" label="Cuerpo" error={errors.cuerpo}>
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
            id="plantilla-tienda"
            checked={plantillaTienda}
            onCheckedChange={setPlantillaTienda}
          />
        ) : null}

        <VariablesInsert
          textareaRef={textareaRef}
          value={cuerpo}
          onInsert={(next) => setCuerpo(next)}
          variablesNombres={SIN_VARIABLES_NOMBRES}
          variablesInforme={informe?.variables}
        />
      </div>
    );
  },
);

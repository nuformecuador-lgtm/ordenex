"use client";

import { useEffect, useMemo, useRef, type ChangeEvent } from "react";
import { Camera, ImagePlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { GESTION_ALLOWED_MIME, gestionConfig } from "@/lib/config/gestion";

// =================================================================================================
// CAMPO DE FOTOS DE EVIDENCIA — UNA SOLA IMPLEMENTACION PARA LAS TRES SUPERFICIES
// =================================================================================================
//
// Nace de fundir tres subcomponentes locales que eran el mismo componente escrito tres veces:
//   · `EvidenciasField`     — `mis-asignaciones/_components/GestionarOrdenPanel.tsx` (119/158)
//   · `EvidenciasIncidente` — `ordenes/_components/ReportarIncidenteModal.tsx` (158)
//   · `EvidenciasDesdeAyuda`— `novedades/_components/GestionarDesdeAyudaModal.tsx` (237)
//
// Los dos ultimos se diferenciaban en 14 lineas de 70, y casi todas eran constantes de texto.
// La promocion a `components/shared/` cumple la regla de `docs/architecture.md` («solo cuando al
// menos DOS features lo necesitan con la misma API»): son TRES, y la API ya era la misma —el
// primero solo tenia, de mas, los textos que los otros dos llevaban incrustados—.
//
// ── POR QUE HAY DOS INPUTS Y NO UNO CON `capture`
// El encargo es que el mensajero pueda TOMAR la foto sin salir de la app. La solucion evidente
// —anadir `capture="environment"` al input que ya existia— cambia un problema por otro: con
// `capture` el movil abre la camara DIRECTAMENTE y desaparece la via de elegir una foto ya hecha.
// Quien fotografio el paquete antes de subir al ascensor se quedaria sin poder adjuntarla.
//
// Por eso se sigue el patron que este repo YA resolvio en el chat saliente
// (`mis-asignaciones/_components/chat/ChatConversacion.tsx`): DOS inputs ocultos que comparten
// `accept`, `multiple` y el MISMO `onChange`, disparados por dos botones distintos. La lista de
// evidencias, el tope, la compresion y la previsualizacion son las mismas para las dos vias
// porque literalmente es el mismo manejador del padre.
//
// `capture` solo tiene efecto en movil; en escritorio el navegador lo ignora y abre el selector
// de archivos normal. Es degradacion aceptable: el boton sigue anadiendo una foto.
// =================================================================================================

/** Textos visibles, fuera de la logica (i18n-ready, como el resto del modulo). */
export const EVIDENCIAS_BOTON_CAMARA = "Tomar foto";
export const EVIDENCIAS_BOTON_GALERIA = "Elegir de la galería";
/**
 * Nombre accesible del grupo de las dos vias. NO puede ser igual a `label` («Fotos de evidencia»):
 * ese texto ya nombra al input, y duplicarlo haria ambiguo el `getByLabelText` de las pantallas
 * que lo localizan asi.
 */
export const EVIDENCIAS_GRUPO_ARIA = "Añadir fotos de evidencia";
/** Nombre accesible del input de camara, derivado del del input de galeria para no colisionar. */
export function evidenciasAriaLabelCamara(ariaLabel: string): string {
  return `${EVIDENCIAS_BOTON_CAMARA} con la cámara — ${ariaLabel}`;
}

/** Lista blanca de MIME, en el formato que espera el atributo `accept`. */
const ACCEPT_MIME = GESTION_ALLOWED_MIME.join(",");

/**
 * Formatos admitidos, en la letra del usuario y DERIVADOS del mismo catalogo que valida el borde
 * (`GESTION_ALLOWED_MIME`). Escritos a mano se desincronizarian el dia que entre —o salga— un
 * formato, y la zona de carga prometeria algo que el servidor rechaza.
 */
const FORMATOS_EVIDENCIA = GESTION_ALLOWED_MIME.map((mime) =>
  mime.replace("image/", "").toUpperCase(),
).join(" · ");

/**
 * Tope de fotos por gestion. El schema (cliente y servidor) usa el mismo
 * `gestionConfig.MAX_EVIDENCIAS_POR_GESTION`; en el navegador la env no es visible (no lleva
 * `NEXT_PUBLIC_`), asi que cae al default 3, igual que el schema en cliente.
 */
export const MAX_EVIDENCIAS = gestionConfig.MAX_EVIDENCIAS_POR_GESTION;

export interface EvidenciasFieldProps {
  /** Id del input de GALERIA. El de camara deriva de el (`<inputId>-camara`). */
  inputId: string;
  /** Rotulo visible del campo. */
  label: string;
  /** Nombre accesible del input de galeria. Es el contrato por el que lo localizan las pantallas. */
  ariaLabel: string;
  files: File[];
  error: string | undefined;
  /** MISMO manejador para las dos vias: la camara no tiene reglas propias que puedan divergir. */
  onSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
  /**
   * Texto de ayuda de la rama que lo necesite, ENCIMA del selector. Existe porque el incidente
   * exige foto tambien cuando no hay paquete que fotografiar y quien reporta necesita saber que
   * se espera de el, no solo que el campo es obligatorio. Omitido → no se pinta.
   */
  ayuda?: string;
}

export function EvidenciasField({
  inputId,
  label,
  ariaLabel,
  files,
  error,
  onSelect,
  onRemove,
  ayuda,
}: Readonly<EvidenciasFieldProps>) {
  // Una object URL por foto para la previsualizacion. Se derivan con `useMemo` (sin `setState` en
  // efecto) y solo se recalculan cuando cambia `files` —que solo cambia de referencia cuando el
  // padre agrega/quita una foto, no en cada re-render—. El efecto de limpieza REVOCA el lote
  // anterior al cambiar la lista (quitar una foto) y al desmontar, para no fugar memoria.
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => {
    return () => previews.forEach((u) => URL.revokeObjectURL(u));
  }, [previews]);

  const inputCamaraRef = useRef<HTMLInputElement>(null);
  const inputGaleriaRef = useRef<HTMLInputElement>(null);

  const limiteId = `${inputId}-limite`;
  const ayudaId = `${inputId}-ayuda`;
  const describedBy = `${limiteId}${ayuda ? ` ${ayudaId}` : ""}`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      {ayuda ? (
        <p id={ayudaId} className="text-xs text-muted-foreground">
          {ayuda}
        </p>
      ) : null}
      {previews.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Fotos de evidencia seleccionadas">
          {previews.map((url, i) => (
            <li key={url} className="relative">
              {/* Vista previa local de un object URL: next/image no aplica a un blob del cliente. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Evidencia ${i + 1}`}
                className="size-20 rounded-md border border-border object-cover"
              />
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={`Quitar evidencia ${i + 1}`}
                className="absolute -right-1.5 -top-1.5 rounded-full border border-background bg-destructive p-0.5 text-destructive-foreground shadow-xs hover:bg-destructive/90"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Zona de carga. Los inputs no son la superficie visible —un `input[type=file]` crudo pinta
          un boton gris de sistema que en el movil no se lee como «aqui van las fotos»— sino dos
          botones de verdad, que ademas son los que dan el foco y el teclado. */}
      <div
        className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
          error ? "border-destructive/60 bg-destructive/5" : "border-input bg-muted/30"
        }`}
      >
        <div
          role="group"
          aria-label={EVIDENCIAS_GRUPO_ARIA}
          className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"
        >
          <Button
            type="button"
            variant="outline"
            onClick={() => inputCamaraRef.current?.click()}
            aria-describedby={describedBy}
          >
            <Camera aria-hidden="true" />
            {EVIDENCIAS_BOTON_CAMARA}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => inputGaleriaRef.current?.click()}
            aria-describedby={describedBy}
          >
            <ImagePlus aria-hidden="true" />
            {EVIDENCIAS_BOTON_GALERIA}
          </Button>
        </div>
        <p id={limiteId} className="text-xs text-muted-foreground">
          {`${FORMATOS_EVIDENCIA} · hasta ${MAX_EVIDENCIAS} fotos (${files.length}/${MAX_EVIDENCIAS})`}
        </p>
      </div>

      {/* Las DOS vias, ocultas y disparadas por los botones de arriba (patron de `ChatConversacion`).
          Comparten `accept`, `multiple` y `onChange`: misma lista, mismo tope, misma compresion.
          El de camara va PRIMERO en el DOM porque es la via principal de quien esta en la calle. */}
      <input
        ref={inputCamaraRef}
        id={`${inputId}-camara`}
        type="file"
        accept={ACCEPT_MIME}
        // `environment` = camara TRASERA: se fotografia el paquete o la puerta, no al mensajero.
        capture="environment"
        multiple
        onChange={onSelect}
        aria-invalid={error ? true : undefined}
        aria-label={evidenciasAriaLabelCamara(ariaLabel)}
        aria-describedby={describedBy}
        className="hidden"
      />
      <input
        ref={inputGaleriaRef}
        id={inputId}
        type="file"
        accept={ACCEPT_MIME}
        multiple
        onChange={onSelect}
        aria-invalid={error ? true : undefined}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        className="hidden"
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

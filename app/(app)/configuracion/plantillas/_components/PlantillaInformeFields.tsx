"use client";

import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FieldError } from "@/components/shared/FieldError";
import { estadoAppMeta } from "@/lib/actions/plantillas";
import type { VariableDeInforme } from "@/lib/utils/vista-previa-informe";

/** Lo que la pantalla de plantillas necesita de un informe (llega de `listarInformesWhatsapp()`). */
export interface InformeParaPlantilla {
  clave: string;
  nombre: string;
  generaDocumento: boolean;
  variables: VariableDeInforme[];
}

/** Valor del selector para «plantilla de orden» (la de siempre). */
const DE_ORDEN = "";

export const AYUDA_TIPO_BLOQUEADO =
  "Esta plantilla ya se envió a WhatsApp: el tipo y el documento adjunto no se pueden cambiar. Crea una nueva si necesitas otro.";
export const AYUDA_SIN_DOCUMENTO = "Este informe no genera documento: sus plantillas van sin PDF.";
export const AYUDA_CON_DOCUMENTO =
  "WhatsApp solo deja adjuntar el PDF del informe si la plantilla aprobada tiene cabecera de documento.";

export interface PlantillaInformeFieldsProps {
  idBase: string;
  informes: readonly InformeParaPlantilla[];
  informeClave: string | null;
  onInformeClave: (clave: string | null) => void;
  llevaDocumento: boolean;
  onLlevaDocumento: (v: boolean) => void;
  /** R7: la plantilla ya salió hacia Meta: ni el informe ni el documento se pueden cambiar. */
  bloqueado: boolean;
  errores: { informeClave?: string[]; llevaDocumento?: string[] };
}

/**
 * Ficha 474 (T10.1) — «Tipo: de orden / de informe» y el interruptor «Lleva documento adjunto»
 * (design §3). Lo que vigila, y que el service vuelve a vigilar:
 *  - R6: el interruptor solo se puede encender en una plantilla de un informe que GENERA documento.
 *  - R7: una plantilla que ya salió hacia Meta no cambia de informe ni de documento.
 *  - R48: al ENCENDER el interruptor se pregunta al servidor si identificó la app de Meta; si no, el
 *    motivo se pinta justo debajo —sin bloquear nada más del formulario—. Nunca el ID ni el token.
 */
export function PlantillaInformeFields({
  idBase,
  informes,
  informeClave,
  onInformeClave,
  llevaDocumento,
  onLlevaDocumento,
  bloqueado,
  errores,
}: PlantillaInformeFieldsProps) {
  const [avisoAppMeta, setAvisoAppMeta] = useState<string | null>(null);
  const informe = informes.find((i) => i.clave === informeClave) ?? null;
  const tipoId = `${idBase}-tipo`;
  const docId = `${idBase}-documento`;
  const docAyudaId = `${docId}-ayuda`;
  const docAvisoId = `${docId}-aviso`;

  async function alternarDocumento(v: boolean) {
    onLlevaDocumento(v);
    setAvisoAppMeta(null);
    if (!v) return;
    const r = await estadoAppMeta();
    if (r.status === "ok") {
      if (r.estado === "no_identificada") setAvisoAppMeta(r.mensaje);
    } else {
      setAvisoAppMeta("No se pudo comprobar si WhatsApp está listo para plantillas con documento.");
    }
  }

  const docDeshabilitado = bloqueado || informe === null || !informe.generaDocumento;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={tipoId}>Tipo de plantilla</Label>
        <Select
          id={tipoId}
          aria-label="Tipo de plantilla"
          aria-invalid={errores.informeClave ? true : undefined}
          aria-describedby={errores.informeClave ? `${tipoId}-error` : undefined}
          value={informeClave ?? DE_ORDEN}
          disabled={bloqueado}
          onValueChange={(v) => {
            const clave = v === DE_ORDEN ? null : v;
            onInformeClave(clave);
            const nuevo = informes.find((i) => i.clave === clave);
            // R6: un informe sin documento no admite el interruptor; se apaga solo.
            if (!nuevo || !nuevo.generaDocumento) {
              onLlevaDocumento(false);
              setAvisoAppMeta(null);
            }
          }}
          options={[
            { value: DE_ORDEN, label: "De orden (datos de una orden)" },
            ...informes.map((i) => ({ value: i.clave, label: `De informe: ${i.nombre}` })),
          ]}
        />
        <p className="text-sm text-muted-foreground">
          {bloqueado
            ? AYUDA_TIPO_BLOQUEADO
            : "Una plantilla de informe la usan los envíos automáticos; no se ofrece en el chat ni como bienvenida."}
        </p>
        {errores.informeClave ? <FieldError id={`${tipoId}-error`} messages={errores.informeClave} /> : null}
      </div>

      {informe !== null ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={docId}>Lleva documento adjunto</Label>
            <Switch
              id={docId}
              aria-label="Lleva documento adjunto"
              aria-describedby={[docAyudaId, avisoAppMeta ? docAvisoId : null].filter(Boolean).join(" ")}
              checked={llevaDocumento}
              disabled={docDeshabilitado}
              onCheckedChange={(v) => void alternarDocumento(v)}
            />
          </div>
          <p id={docAyudaId} className="text-sm text-muted-foreground">
            {informe.generaDocumento ? AYUDA_CON_DOCUMENTO : AYUDA_SIN_DOCUMENTO}
          </p>
          {avisoAppMeta ? (
            <p id={docAvisoId} role="alert" className="rounded-lg border border-warning/60 bg-warning-soft p-2.5 text-sm text-warning-strong">
              {avisoAppMeta}
            </p>
          ) : null}
          {errores.llevaDocumento ? <FieldError id={`${docId}-error`} messages={errores.llevaDocumento} /> : null}
        </div>
      ) : null}
    </div>
  );
}

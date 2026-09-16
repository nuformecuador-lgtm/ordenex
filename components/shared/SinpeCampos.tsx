"use client";

import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/FormField";
import {
  SINPE_CAMPO_NOMBRE,
  SINPE_CAMPO_NUMERO,
} from "@/components/shared/sinpe-textos";

/**
 * ⭑ FICHA 429 (T21/T22) — LOS DOS CAMPOS DEL SINPE DE UNA BODEGA, ESCRITOS UNA SOLA VEZ.
 *
 * POR QUE UN COMPONENTE COMPARTIDO Y NO DOS FORMULARIOS. Los pintan TRES superficies —la tarjeta
 * de `/mi-bodega`, la fila en edición de «SINPE por bodega» y el aviso del primer ingreso—, y las
 * tres tienen que pedir exactamente lo mismo, con la misma pista y con el error JUNTO A SU CAMPO.
 * Escritos tres veces, el día que alguien corrija la pista del número lo hará en una de las tres
 * y las otras dos seguirán diciendo otra cosa sobre el número al que entra el dinero.
 *
 * ⚠️ LOS DOS CAMPOS VIAJAN JUNTOS Y NO POR SEPARADO (D1). La plantilla real empareja «al número
 * {{sinpe}} a nombre de {{sinpe_nombre}}»: partirlos en dos controles sueltos en pantallas
 * distintas es lo que produce el número de una persona bajo el nombre de otra.
 *
 * ⚠️ NO VALIDA NADA. La regla del formato vive en `lib/utils/sinpe-cr.ts` (borde) y en el `CHECK`
 * de Postgres, y los errores llegan aquí ya resueltos por el servidor. Un tercer juez en el
 * navegador sería una tercera fuente del mismo formato, que es justo lo que la ficha declara
 * como precio a no volver a pagar.
 *
 * ACCESIBILIDAD: `FormField` cablea `htmlFor`, `aria-invalid`, `aria-required` y el
 * `aria-describedby` que enlaza la pista Y el error. El error es un `<p role="alert">`.
 */
export interface SinpeCamposProps {
  /** Prefijo de los `id` de los dos controles. Único por superficie y por fila. */
  idPrefijo: string;
  numero: string;
  nombre: string;
  /** `fieldErrors` tal como los devuelve la Server Action, sin aplanar. */
  errores?: Record<string, string[]>;
  /** Bloquea los dos controles mientras el guardado está en vuelo. */
  disabled?: boolean;
  /** Autofoco en el número. Solo en superficies donde el campo ES la tarea (el aviso). */
  autoFocus?: boolean;
  onNumeroChange: (valor: string) => void;
  onNombreChange: (valor: string) => void;
}

export function SinpeCampos({
  idPrefijo,
  numero,
  nombre,
  errores,
  disabled = false,
  autoFocus = false,
  onNumeroChange,
  onNombreChange,
}: Readonly<SinpeCamposProps>) {
  return (
    <>
      <FormField
        id={`${idPrefijo}-numero`}
        label={SINPE_CAMPO_NUMERO.label}
        hint={SINPE_CAMPO_NUMERO.hint}
        error={errores?.numero}
        required
      >
        <Input
          value={numero}
          inputMode="numeric"
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={SINPE_CAMPO_NUMERO.placeholder}
          className="font-mono tracking-wide focus-visible:ring-3 focus-visible:ring-ring"
          onChange={(e) => onNumeroChange(e.target.value)}
        />
      </FormField>

      <FormField
        id={`${idPrefijo}-nombre`}
        label={SINPE_CAMPO_NOMBRE.label}
        hint={SINPE_CAMPO_NOMBRE.hint}
        error={errores?.nombre}
        required
      >
        <Input
          value={nombre}
          autoComplete="off"
          disabled={disabled}
          placeholder={SINPE_CAMPO_NOMBRE.placeholder}
          className="focus-visible:ring-3 focus-visible:ring-ring"
          onChange={(e) => onNombreChange(e.target.value)}
        />
      </FormField>
    </>
  );
}

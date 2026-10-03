"use client";

import type { DescargaFilasResult } from "@/components/shared/DataTable";
import { DescargarDatasetButton } from "@/components/shared/DescargarDatasetButton";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";

import {
  AMBITO_DESCARGA_COBERTURA,
  COLUMNAS_DESCARGA_COBERTURA,
  filaCobertura,
} from "./cobertura-descarga-columnas";
import { descargarDatos } from "@/components/shared/descarga-datos";

/**
 * Ficha 465 (design §3.6, T8) — control «Descargar cobertura» de la página Tarifas.
 *
 * Envuelve el control común de descarga, que ya aporta el selector de columnas recordado por
 * navegador (R16), el aviso de «sin datos» (R19), el mensaje accionable ante un fallo (R18) y
 * el guard de doble clic (R20). La action se llama DENTRO de `obtenerFilas`, así que cada clic
 * vuelve a leer los datos (R4). Sin sesión, el mensaje propio de R3 sustituye al genérico.
 * El título fija el nombre del archivo: `cobertura-por-distrito-AAAA-MM-DD.xlsx` (R17). Solo Excel: un único formato descarga directo.
 *
 * Lo monta un Server Component que ya cortó a los no maestros (R1); la action vuelve a
 * autorizar por su cuenta (R2/R3).
 */
export const TITULO_DESCARGA_COBERTURA = "Cobertura por distrito";
export const LABEL_DESCARGA_COBERTURA = "Descargar cobertura";
export const AYUDA_DESCARGA_COBERTURA =
  "Descarga un Excel con cada distrito, si llegamos a él y con qué zona.";

/**
 * R3 — sin sesión válida el mensaje pide volver a iniciar sesión. El adaptador común diría
 * «No hay una sesion valida. Vuelve a intentarlo», que no dice QUÉ hacer: reintentar sin sesión
 * vuelve a fallar.
 */
export const MENSAJE_SESION_COBERTURA =
  "Tu sesión ya no es válida. Vuelve a iniciar sesión y descarga de nuevo.";

/** Lee al pulsar (R4) y traduce el resultado a filas o a un mensaje accionable (R3, R18). */
async function obtenerFilasCobertura(): Promise<DescargaFilasResult> {
  const resultado = await descargarDatos("listarCoberturaDistritos", undefined);
  if (resultado.status === "unauthenticated") {
    return { status: "error", mensaje: MENSAJE_SESION_COBERTURA };
  }
  return filasDesdeResultado(resultado, filaCobertura);
}

export interface DescargarCoberturaButtonProps {
  /** Texto del botón (i18n por prop). */
  label?: string;
  /** Línea de ayuda junto al botón (i18n por prop). */
  ayuda?: string;
}

const ID_AYUDA = "descarga-cobertura-ayuda";

export function DescargarCoberturaButton({
  label = LABEL_DESCARGA_COBERTURA,
  ayuda = AYUDA_DESCARGA_COBERTURA,
}: DescargarCoberturaButtonProps) {
  return (
    <div
      role="group"
      aria-describedby={ID_AYUDA}
      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
    >
      <DescargarDatasetButton
        titulo={TITULO_DESCARGA_COBERTURA}
        columnas={COLUMNAS_DESCARGA_COBERTURA}
        formatos={["xlsx"]}
        ambitoColumnas={AMBITO_DESCARGA_COBERTURA}
        label={label}
        obtenerFilas={obtenerFilasCobertura}
      />
      <p id={ID_AYUDA} className="text-sm text-muted-foreground">
        {ayuda}
      </p>
    </div>
  );
}

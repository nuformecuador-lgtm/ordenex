"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import type { DescargaTipo } from "@/lib/types/descarga";
import type { DataTableDescarga } from "@/components/shared/DataTable";

/**
 * Feature 151 (design.md §5) — control de descarga del dataset completo de un
 * `DataTable`.
 *
 * Modelado sobre `DescargarManifiestoButton` pero SIN DOMINIO: no importa nada de
 * `lib/actions/`, `lib/services/`, `lib/types/orden` ni de `app/`. Su único insumo es
 * la configuración `DataTableDescarga` que le pasa la tabla: título, columnas de export,
 * una FUNCIÓN que obtiene las filas y los formatos permitidos. Quien conoce filtros,
 * roles y acciones es el consumidor, que los encierra en `obtenerFilas` (D4).
 *
 * El binario se arma en el NAVEGADOR y se entrega con `descargarBlob`: no se sube a
 * ningún servidor ni se almacena fuera del equipo del usuario (R32). El despachador
 * `descarga-dataset` (y con él `exceljs`) se carga con un `import()` DINÁMICO dentro del
 * handler, para no entrar en el bundle inicial de todas las pantallas con tabla.
 */
export interface DescargarDatasetButtonProps extends DataTableDescarga {
  /** Texto del botón (i18n por prop, sin literal fijo en el consumidor). */
  label?: string;
  /** Clases extra, para encajar el control en la barra de acciones del consumidor. */
  className?: string;
}

const DEFAULT_LABEL = "Descargar";

/** Etiqueta visible de cada formato en el menú de elección (R28). */
const ETIQUETA_FORMATO: Record<DescargaTipo, string> = {
  xlsx: "Excel (.xlsx)",
  csv: "CSV (.csv)",
};

/** Formato aplicado cuando la configuración no declara ninguno (R28 → R2). */
const FORMATO_POR_DEFECTO: DescargaTipo = "xlsx";

/**
 * R23/R27 — Mensajes ACCIONABLES: dicen qué hacer, no solo que no hubo archivo. El
 * mensaje del propio `obtenerFilas` (ya saneado por el consumidor) tiene prioridad.
 */
const MENSAJE_SIN_DATOS =
  "No hay datos que descargar con los filtros aplicados. Ajusta los filtros y vuelve a intentarlo.";
const MENSAJE_FALLO =
  "No se pudo generar el archivo. Vuelve a intentarlo; el listado no cambió.";

export function DescargarDatasetButton({
  titulo,
  columnas,
  obtenerFilas,
  formatos,
  label,
  className,
}: DescargarDatasetButtonProps) {
  const toast = useToast();
  const [generando, setGenerando] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(false);
  // Guard de CARRERA (R26): `generando` como estado no está actualizado hasta el
  // re-render, así que dos clicks seguidos podrían colarse. El ref sí lo está.
  const enVueloRef = useRef(false);
  const contenedorRef = useRef<HTMLDivElement | null>(null);

  const disponibles = formatos && formatos.length > 0 ? formatos : [FORMATO_POR_DEFECTO];
  const eligeFormato = disponibles.length > 1;
  const nombreAccesible = `${label ?? DEFAULT_LABEL} ${titulo}`;

  // El menú se cierra al pulsar fuera; sin esto quedaría abierto tapando la tabla.
  useEffect(() => {
    if (!menuAbierto) return;
    function alPulsarFuera(evento: MouseEvent) {
      if (!contenedorRef.current?.contains(evento.target as Node)) {
        setMenuAbierto(false);
      }
    }
    document.addEventListener("mousedown", alPulsarFuera);
    return () => document.removeEventListener("mousedown", alPulsarFuera);
  }, [menuAbierto]);

  async function descargar(tipo: DescargaTipo) {
    if (enVueloRef.current) return; // R26: una sola descarga en vuelo
    enVueloRef.current = true;
    setGenerando(true);
    setMenuAbierto(false);
    try {
      const resultado = await obtenerFilas();
      if (resultado.status === "error") {
        // R27: el mensaje ya viene accionable y saneado desde el consumidor.
        toast.error(resultado.mensaje);
        return;
      }
      if (resultado.filas.length === 0) {
        toast.error(MENSAJE_SIN_DATOS); // R23: sin filas no se produce archivo
        return;
      }
      // R25 — Import DINÁMICO del generador común: mantiene `exceljs` fuera del
      // bundle inicial de todas las pantallas que montan un `DataTable`.
      const { construirDescarga } = await import("@/lib/utils/descarga-dataset");
      const archivo = await construirDescarga({
        tipo,
        titulo,
        columnas,
        filas: resultado.filas,
      });
      // R32: el archivo nace y muere en el navegador; ni subida ni almacenamiento.
      descargarBlob(archivo.contenido, archivo.mime, archivo.nombreArchivo);
    } catch {
      // R27 + docs/conventions: nada de catch vacío. Se avisa y NO se reintenta.
      toast.error(MENSAJE_FALLO);
    } finally {
      enVueloRef.current = false;
      setGenerando(false);
    }
  }

  function alPulsarDisparador() {
    if (eligeFormato) {
      setMenuAbierto((abierto) => !abierto);
      return;
    }
    // R28: con uno o ningún formato declarado se descarga directo, sin elección.
    void descargar(disponibles[0]);
  }

  return (
    <div
      ref={contenedorRef}
      className={cn("relative inline-block", className)}
      onKeyDown={(evento) => {
        if (evento.key === "Escape" && menuAbierto) setMenuAbierto(false);
      }}
    >
      <Button
        type="button"
        variant="brand-outline"
        onClick={alPulsarDisparador}
        disabled={generando}
        loading={generando}
        aria-label={nombreAccesible} // R30
        aria-haspopup={eligeFormato ? "menu" : undefined}
        aria-expanded={eligeFormato ? menuAbierto : undefined}
      >
        {generando ? null : <Download aria-hidden="true" />}
        {label ?? DEFAULT_LABEL}
      </Button>

      {eligeFormato && menuAbierto ? (
        <div
          role="menu"
          aria-label={nombreAccesible}
          className="absolute right-0 z-30 mt-1 min-w-40 rounded-lg border border-border bg-background p-1 shadow-md"
        >
          {disponibles.map((tipo) => (
            <button
              key={tipo}
              type="button"
              role="menuitem"
              onClick={() => void descargar(tipo)}
              className="flex w-full cursor-pointer items-center rounded px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
            >
              {ETIQUETA_FORMATO[tipo]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

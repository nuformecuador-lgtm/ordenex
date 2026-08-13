"use client";

import { useId } from "react";
import { Popover } from "@base-ui/react/popover";
import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { usePreferenciaColumnasManifiesto } from "@/hooks/usePreferenciaColumnasManifiesto";
import { COLUMNAS_MANIFIESTO } from "@/lib/manifiesto/columnas-publicadas";
import { etiquetaColumna } from "@/lib/manifiesto/etiquetas-columnas";
import type { ManifiestoFlujo } from "@/lib/types/manifiesto";

export interface ColumnasManifiestoPopoverProps {
  /** Flujo cuya preferencia se edita. Cada flujo tiene la suya (R14, R16). */
  flujo: ManifiestoFlujo;
}

/**
 * Selector de columnas del manifiesto (design §5). Control PARALELO al botón de descarga, no
 * un paso de su camino: abrirlo no descarga nada y el botón sigue descargando en un click con
 * lo ya guardado (R10).
 *
 * Se itera `COLUMNAS_MANIFIESTO`, que es la única fuente de verdad de qué columnas existen y en
 * qué orden (R2, R8). Ni este componente ni sus pruebas afirman un número de columnas: el
 * conjunto es ABIERTO (feature 160/R28, 194/R23) y una columna publicada mañana aparecerá aquí
 * sola, marcada, sin tocar este archivo.
 *
 * Cada opción muestra `Etiqueta legible (clave_maquina)` (requirements D-A): el ARCHIVO sigue
 * emitiendo solo la clave máquina (R9), pero la pantalla es una vista y el usuario necesita
 * casar casilla y columna sin adivinar (R4). Una columna sin etiqueta declarada cae al fallback
 * de `etiquetaColumna` y se muestra con su propia clave (R5).
 *
 * Mínimo (R12, requirements D-B): la última casilla marcada se rinde `disabled` y el aviso se
 * muestra en el pie. El límite se ve ANTES de chocar con él: es un estado, no un fallo.
 */
export function ColumnasManifiestoPopover({
  flujo,
}: Readonly<ColumnasManifiestoPopoverProps>) {
  const { clavesVisibles, alternar, restablecer } =
    usePreferenciaColumnasManifiesto(flujo);
  const idBase = useId();

  const enElMinimo = clavesVisibles.length <= 1;

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            type="button"
            variant="brand-outline"
            size="icon"
            aria-label="Elegir columnas del manifiesto"
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
          </Button>
        }
      />

      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="z-50">
          {/* Feature 208: `bg-background text-navy` no giraba con el tema (el popover
              oscuro con tinta navy quedaba en 1.06:1). Los tokens del popover sí. */}
          <Popover.Popup className="flex w-72 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none">
            <div className="border-b border-border px-4 py-3">
              <span className="text-sm font-semibold">
                Columnas del manifiesto
              </span>
            </div>

            <div className="flex max-h-72 flex-col gap-2 overflow-y-auto px-4 py-3">
              {COLUMNAS_MANIFIESTO.map((columna) => {
                const marcada = clavesVisibles.includes(columna.key);
                const idCasilla = `${idBase}-${columna.key}`;
                const idEtiqueta = `${idCasilla}-etiqueta`;
                return (
                  <div key={columna.key} className="flex items-center gap-2">
                    <Checkbox
                      id={idCasilla}
                      checked={marcada}
                      // R12: solo se bloquea la ÚLTIMA marcada; las desmarcadas siguen
                      // disponibles para volver a activarse.
                      disabled={marcada && enElMinimo}
                      aria-labelledby={idEtiqueta}
                      onCheckedChange={() => alternar(columna.key)}
                    />
                    <Label
                      id={idEtiqueta}
                      htmlFor={idCasilla}
                      className="cursor-pointer text-sm font-normal"
                    >
                      {`${etiquetaColumna(columna.header)} (${columna.header})`}
                    </Label>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
              {enElMinimo ? (
                <span className="text-xs text-muted-foreground">
                  Debe quedar al menos una columna
                </span>
              ) : (
                <span />
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={restablecer}
              >
                Restablecer
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

"use client";

import { useEffect, useId, useRef } from "react";
import { Popover } from "@base-ui/react/popover";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { usePreferenciaColumnas } from "@/hooks/usePreferenciaColumnas";
import type { DireccionMovimiento } from "@/lib/columnas/preferencia-columnas";

export interface ColumnasPopoverProps<T> {
  /** Clave de almacenamiento del ámbito. Quien monta el selector ya decidió que hay ámbito. */
  claveAlmacenamiento: string;
  /** Catálogo del ámbito. El componente no lo importa ni lo cuenta (R35). */
  publicadas: readonly T[];
  /** Accesor de clave. Debe estar declarado a nivel de módulo (design §5). */
  claveDe: (columna: T) => string;
  /** Texto de cada opción. Aquí se resuelve R3 sin bifurcar el componente. */
  etiquetaDe: (columna: T) => string;
  /** Encabezado del popup. */
  titulo: string;
  /** Nombre accesible del botón que lo abre. */
  etiquetaDisparador: string;
}

/**
 * Ficha 314 (design §6) — selector de columnas de una descarga, GENÉRICO y con REORDENAR.
 *
 * Es el selector que la feature 194 escribió para el manifiesto, con el ámbito por parámetro:
 * el mismo componente sirve al manifiesto y a la descarga de órdenes, y por eso reordenar
 * aparece en los dos a la vez (R21, decisión 3 del humano del 2026-08-28). Un selector con dos
 * comportamientos según quién lo monta es la clase de bifurcación que nadie recuerda al mes.
 *
 * Control PARALELO al botón de descarga, no un paso de su camino: abrirlo no descarga nada y
 * el botón sigue descargando en un click con lo ya guardado (R6).
 *
 * Se itera el ORDEN EFECTIVO del ámbito —todas las publicadas, marcadas y desmarcadas—, que es
 * lo que permite mover también una columna oculta (R25). Ni este componente ni sus pruebas
 * afirman un número de columnas: el conjunto es ABIERTO y una columna publicada mañana aparece
 * aquí sola, marcada y en su sitio, sin tocar este archivo (R26, R27).
 *
 * REORDENAR CON BOTONES Y NO ARRASTRANDO (design §10/A5): no hay biblioteca de drag-and-drop en
 * el repo, arrastrar no es operable con teclado sin trabajo extra y no se puede ejercitar en
 * jsdom, que es donde vive la verificación de esta ficha. Dos botones se prueban de verdad y se
 * usan con teclado desde el primer día.
 *
 * Mínimo (R7): la última casilla marcada se rinde `disabled` y el aviso se muestra en el pie.
 * El límite se ve ANTES de chocar con él: es un estado, no un fallo.
 */
export function ColumnasPopover<T>({
  claveAlmacenamiento,
  publicadas,
  claveDe,
  etiquetaDe,
  titulo,
  etiquetaDisparador,
}: Readonly<ColumnasPopoverProps<T>>) {
  const { ordenadas, clavesVisibles, alternar, mover, restablecer } =
    usePreferenciaColumnas(claveAlmacenamiento, publicadas, claveDe);
  const idBase = useId();

  // Foco tras mover (design §6). Si el botón pulsado queda deshabilitado por haber llegado al
  // extremo, el foco se pasa al botón contrario de la MISMA fila: sin esto, mover una columna
  // hasta el final devuelve el foco al `body` y quien navega con teclado se pierde.
  const focoPendiente = useRef<{
    clave: string;
    direccion: DireccionMovimiento;
  } | null>(null);

  const idBoton = (clave: string, direccion: DireccionMovimiento) =>
    `${idBase}-${clave}-${direccion}`;

  // Sin lista de dependencias a propósito: corre tras CADA render y sale enseguida si no hay
  // nada pendiente. No fija estado, así que no entra en `react-hooks/set-state-in-effect`.
  useEffect(() => {
    const pendiente = focoPendiente.current;
    if (pendiente === null) return;
    focoPendiente.current = null;
    const preferido = document.getElementById(
      idBoton(pendiente.clave, pendiente.direccion),
    );
    const contrario = document.getElementById(
      idBoton(
        pendiente.clave,
        pendiente.direccion === "arriba" ? "abajo" : "arriba",
      ),
    );
    const destino =
      preferido instanceof HTMLButtonElement && !preferido.disabled
        ? preferido
        : contrario;
    if (destino instanceof HTMLElement) destino.focus();
  });

  const enElMinimo = clavesVisibles.length <= 1;

  function alMover(clave: string, direccion: DireccionMovimiento) {
    focoPendiente.current = { clave, direccion };
    mover(clave, direccion);
  }

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            type="button"
            variant="brand-outline"
            size="icon"
            aria-label={etiquetaDisparador}
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
          </Button>
        }
      />

      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="z-50">
          {/* Feature 208: `bg-background text-navy` no giraba con el tema (el popover
              oscuro con tinta navy quedaba en 1.06:1). Los tokens del popover sí. */}
          <Popover.Popup className="flex w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none">
            <div className="border-b border-border px-4 py-3">
              <span className="text-sm font-semibold">{titulo}</span>
            </div>

            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto px-4 py-3">
              {ordenadas.map((columna, indice) => {
                const clave = claveDe(columna);
                const etiqueta = etiquetaDe(columna);
                const marcada = clavesVisibles.includes(clave);
                const idCasilla = `${idBase}-${clave}`;
                const idEtiqueta = `${idCasilla}-etiqueta`;
                const esPrimera = indice === 0;
                const esUltima = indice === ordenadas.length - 1;
                return (
                  <li key={clave} className="flex items-center gap-2">
                    <Checkbox
                      id={idCasilla}
                      checked={marcada}
                      // R7: solo se bloquea la ÚLTIMA marcada; las desmarcadas siguen
                      // disponibles para volver a activarse.
                      disabled={marcada && enElMinimo}
                      aria-labelledby={idEtiqueta}
                      onCheckedChange={() => alternar(clave)}
                    />
                    <Label
                      id={idEtiqueta}
                      htmlFor={idCasilla}
                      className="min-w-0 flex-1 cursor-pointer text-sm font-normal"
                    >
                      {etiqueta}
                    </Label>
                    <Button
                      id={idBoton(clave, "arriba")}
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      // R22: la primera de la lista no sube.
                      disabled={esPrimera}
                      aria-label={`Subir ${etiqueta}`}
                      onClick={() => alMover(clave, "arriba")}
                    >
                      <ChevronUp aria-hidden="true" />
                    </Button>
                    <Button
                      id={idBoton(clave, "abajo")}
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      // R23: la última de la lista no baja.
                      disabled={esUltima}
                      aria-label={`Bajar ${etiqueta}`}
                      onClick={() => alMover(clave, "abajo")}
                    >
                      <ChevronDown aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>

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

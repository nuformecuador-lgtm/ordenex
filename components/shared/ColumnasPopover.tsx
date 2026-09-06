"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
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
  /**
   * Bloque fijo POR ENCIMA de la lista de columnas, dentro del mismo popup.
   *
   * Existe para la descarga de cierres, donde lo PRIMERO que se elige no es una columna sino el
   * NIVEL DE DETALLE del archivo (una fila por cierre o una por gestión), y las columnas que se
   * listan debajo son las de ese nivel. Va aquí y no en un segundo control porque son la misma
   * decisión: elegir el nivel cambia el juego de columnas entero, y separarlos dejaría al
   * usuario marcando casillas de una hoja que no es la que va a bajar.
   *
   * El componente no interpreta el nodo ni sabe qué hay dentro: quien lo pasa es dueño de su
   * estado. Sin este prop, el popover es exactamente el de antes.
   */
  encabezado?: ReactNode;
  /**
   * `false` ⇒ el selector OCULTA pero NO REORDENA. Por defecto `true`.
   *
   * ── POR QUÉ ESTA PROP EXISTE (y por qué no es una bifurcación gratuita) ────────────────────
   * R21 (decisión del humano del 2026-08-28) juntó ocultar y reordenar a propósito: un selector
   * con dos comportamientos según quién lo monta es la bifurcación que nadie recuerda al mes. Se
   * mantiene el fondo de esa decisión —el DEFECTO sigue siendo «las dos cosas»— y se abre una
   * sola excepción, declarada por quien la necesita en vez de deducida de su ámbito.
   *
   * La excepción es la hoja FUNDIDA de gestiones de cierres. Esa hoja emite SIEMPRE sus columnas
   * y solo el resultado de cada fila decide cuáles se pueblan: su orden ES el agrupado que la
   * hace legible —las que siempre traen dato primero, las condicionales después—. Intercalarlas
   * deja celdas vacías que ya no dicen «este resultado no tiene ese dato», sino nada. Ocultar
   * ahí es seguro; reordenar, no.
   *
   * Y el daño de permitirlo sería MUDO: la preferencia vive en el `localStorage` del usuario, así
   * que ninguna prueba de la hoja se pondría roja — solo se degradaría el archivo de quien
   * reordenó. Por eso la capacidad se apaga en el COMPONENTE, con esta prop, y no duplicando el
   * selector: dos copias divergen, y la copia sin arreglar sería justo la del archivo de dinero.
   */
  permitirReordenar?: boolean;
  /**
   * Nota al pie que explica por qué el orden es fijo. Se muestra solo cuando `permitirReordenar`
   * es `false`: una capacidad que falta sin decir por qué se lee como un fallo del selector.
   * El texto lo pone quien monta —el motivo es suyo—, igual que `titulo`.
   */
  notaOrden?: ReactNode;
}

/**
 * Ficha 314 (design §6) — selector de columnas de una descarga, GENÉRICO y con REORDENAR.
 *
 * Es el selector que la feature 194 escribió para el manifiesto, con el ámbito por parámetro:
 * el mismo componente sirve al manifiesto y a la descarga de órdenes, y por eso reordenar
 * aparece en los dos a la vez (R21, decisión 3 del humano del 2026-08-28). Un selector con dos
 * comportamientos según quién lo monta es la clase de bifurcación que nadie recuerda al mes.
 *
 * Reordenar sigue siendo el DEFECTO, y hoy tiene UNA excepción: `permitirReordenar={false}` deja
 * el selector en solo-ocultar para las hojas cuyo orden de columnas es contrato de legibilidad
 * (la fundida de gestiones de cierres). El porqué completo está en la prop; lo que importa aquí
 * es que la excepción la declara quien monta, se ve en el JSX, y no se deduce del ámbito.
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
  encabezado,
  permitirReordenar = true,
  notaOrden,
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

            {encabezado === undefined ? null : (
              <div className="border-b border-border px-4 py-3">{encabezado}</div>
            )}

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
                    {/* Sin `permitirReordenar` no se pintan: la columna se puede ocultar y su
                        SITIO es el que el catálogo le dio. No se rinden `disabled` porque un
                        botón apagado en todas las filas invita a buscar cómo encenderlo. */}
                    {permitirReordenar ? (
                      <>
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
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {!permitirReordenar && notaOrden !== undefined ? (
              <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                {notaOrden}
              </p>
            ) : null}

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

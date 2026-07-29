"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  opcionesVisibles,
  podarSeleccion,
} from "@/lib/utils/filter-dependencies";

import { DateRangeFilter } from "./DateRangeFilter";
import { MultiSelectFilter } from "./MultiSelectFilter";

/**
 * Tipos de control soportados (decision (k) del spec). `boolean` es un INTERRUPTOR:
 * o el filtro esta puesto o no esta, sin opciones que elegir.
 */
export type FilterKind = "multi" | "single" | "dateRange" | "boolean";

export interface FilterOption {
  /** Valor emitido TAL CUAL (R5): id de catalogo, o valor de atajo en `dateRange`. */
  value: string;
  /** Texto visible y texto sobre el que busca el buscador interno. */
  label: string;
  /**
   * Valor del filtro PADRE al que pertenece esta opcion. Solo lo leen los filtros
   * que declaran `dependsOn` (R23/R24). El componente NO sabe que significa.
   */
  parentValue?: string;
  /** Grupo al que pertenece la opcion (R28). Puro contrato de opciones. */
  group?: string;
  /**
   * Solo en `dateRange`: el RANGO de fechas calendario (`YYYY-MM-DD`) que este atajo
   * representa. El control no lo calcula ni lo interpreta: pinta ese rango en el
   * calendario y emite sus dos extremos. Sin el, el atajo no se ofrece.
   */
  defaultRange?: { desde: string; hasta: string };
}

export interface FilterDef {
  /** Clave con la que este filtro aparece en la salida (R2). */
  key: string;
  /** Etiqueta visible y nombre accesible del control (R2, R29). */
  label: string;
  kind: FilterKind;
  /**
   * `multi`/`single`: las opciones seleccionables.
   * `dateRange`: los ATAJOS ofrecidos dentro del control (R9). Vacio/ausente = solo
   * desde/hasta.
   * `boolean`: no lleva opciones; su unico valor es el de `BOOLEAN_MARCADO`.
   */
  options?: FilterOption[];
  /** Clave del UNICO filtro padre del que depende (R23). No aplica a `dateRange`. */
  dependsOn?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
}

/** Salida agnostica y uniforme (R16/R18/R19/R20). */
export type FilterSelection = Record<string, string[]>;

export interface FilterComponentProps {
  /** Filtros a montar, EN EL ORDEN en que deben renderizarse (R3). */
  filters: FilterDef[];
  /** Recibe la seleccion COMPLETA y agregada en cada cambio de valor (R16). */
  onChange: (selection: FilterSelection) => void;
  /** Ofrece la accion "Limpiar todo" (R22). Default: `false`. */
  showClearAll?: boolean;
  /** Deshabilita TODOS los controles; ninguno emite (R15). */
  disabled?: boolean;
  /**
   * Espera (ms) entre el último cambio y la emisión de `onChange`. Los controles
   * responden al instante; lo que se aplaza es AVISAR al consumidor, para que marcar
   * cuatro casillas seguidas no dispare cuatro consultas. `0` emite en el acto (útil
   * en tests y en consumidores que no consultan nada).
   */
  debounceMs?: number;
  className?: string;
}

const KINDS_SOPORTADOS = new Set<string>([
  "multi",
  "single",
  "dateRange",
  "boolean",
]);

/**
 * Valor UNICO que emite un filtro `boolean` marcado (R19: la salida siempre es una
 * lista de cadenas por clave). Desmarcado no emite `["false"]`: la clave DESAPARECE,
 * como cualquier otro filtro sin seleccion (R18).
 */
export const BOOLEAN_MARCADO = "true";

/** Espera por defecto entre el último cambio y la emisión (ms). */
export const DEBOUNCE_MS_DEFAULT = 500;
/** Los tipos basados en opciones: sin opciones ofrecidas, su control va deshabilitado (R14). */
const KINDS_CON_OPCIONES = new Set<string>(["multi", "single"]);

/**
 * # `FilterComponent` — barra de filtros GENERICA y parametrizable
 *
 * Monta y coordina **N filtros declarados por props** (R1) y es dueño del estado
 * agregado (no controlado): el consumidor solo declara QUE filtros hay y recibe por
 * `onChange` la seleccion completa. Es el hermano un nivel arriba de
 * `MultiSelectFilter`: aquel es UN control, este ORQUESTA N.
 *
 * **Vive en `components/shared/` por decision (n) del gate F1.4**, como excepcion
 * explicita a la regla de "dos superficies antes de promover" de
 * `docs/architecture.md`: nace generico por peticion del humano y la feature 145
 * (`depends_on: 144`) es su segundo consumidor declarado. **No es un hallazgo.**
 *
 * ## Lo que NO hace
 * - **No hace fetch** (R4): todas las opciones llegan por props, sea cual sea el
 *   transporte con que el consumidor las consiguio.
 * - **No interpreta ni transforma los valores** (R5): emite exactamente los valores
 *   declarados en las opciones, o las fechas que introdujo el usuario.
 * - **No construye el objeto de consulta de ningun endpoint ni Server Action** (R20):
 *   **la traduccion al transporte es responsabilidad del consumidor**.
 * - No sabe nada de dominio: ni ordenes, ni geografia, ni fechas con huso.
 *
 * ## Contrato de props
 * `filters: FilterDef[]` (clave, etiqueta, `kind` y —si es de opciones— su lista),
 * `onChange`, `showClearAll`, `disabled`, `debounceMs`.
 *
 * ## Emision con debounce
 * Los controles responden al instante; `onChange` se emite `debounceMs` despues del
 * ultimo cambio (500 ms por defecto), de modo que una racha de clics produce UNA sola
 * emision —la del estado final— y no una consulta por clic. `debounceMs={0}` emite
 * en el acto.
 *
 * ## `dependsOn` / `parentValue` (R23-R27)
 * Un filtro declara `dependsOn: "<key de otro filtro>"` y cada opcion suya trae
 * `parentValue` = el valor del padre al que pertenece. Las opciones ofrecidas se
 * acotan a la **seleccion efectiva** del padre (su seleccion, o todas sus opciones
 * visibles si esta vacia), de forma **transitiva**; al cambiar un padre, los valores
 * que dejan de estar ofrecidos se **podan** antes de emitir, de modo que nunca se
 * emite una combinacion incoherente. `dependsOn` a una clave no declarada (o un
 * ciclo) se trata como filtro independiente.
 *
 * ## `group` (R28)
 * Una opcion puede declarar `group`; las opciones se presentan bajo la cabecera
 * accesible de su grupo. Sin grupos, la lista es plana.
 *
 * ## Salida: `Record<string, string[]>` para los tres tipos
 * Las claves sin seleccion **se omiten** (R18), de modo que "sin filtros" es `{}`.
 *
 * | `kind` | Emite |
 * | --- | --- |
 * | `multi` | N valores |
 * | `single` | exactamente 1 valor |
 * | `dateRange` | exactamente 3 posiciones `[atajo, desde, hasta]`, **sin compactar** |
 * | `boolean` | `["true"]` marcado; **clave ausente** desmarcado (nunca `["false"]`) |
 *
 * ### Que emite el filtro de tiempo en cada caso (R19)
 *
 * | Estado del control | Emite |
 * | --- | --- |
 * | nada elegido | **clave ausente** |
 * | atajo `30d` | `["30d","",""]` |
 * | rango completo | `["","2026-07-01","2026-07-28"]` |
 * | solo desde | `["","2026-07-01",""]` |
 * | solo hasta | `["","","2026-07-28"]` |
 * | rango invertido | **no emite** (control invalido, R12) |
 * | atajo + rango | **imposible**: son mutuamente excluyentes (R10) |
 *
 * La posicion ES el significado: `["30d"]` seria ambiguo con `["2026-07-01"]`.
 */
export function FilterComponent({
  filters,
  onChange,
  showClearAll = false,
  disabled = false,
  debounceMs = DEBOUNCE_MS_DEFAULT,
  className,
}: FilterComponentProps) {
  const [seleccion, setSeleccion] = useState<FilterSelection>({});
  // Contador de "Limpiar todo": los controles con estado interno (fechas) lo miran
  // para vaciarse sin que el orquestador tenga que controlarlos.
  const [resetSignal, setResetSignal] = useState(0);

  // R13: un `kind` no soportado no se renderiza ni entra en la salida, y el resto de
  // filtros sigue funcionando.
  const montados = useMemo(
    () => filters.filter((f) => KINDS_SOPORTADOS.has(f.kind)),
    [filters],
  );

  // `onChange` cambia de identidad en cada render del consumidor; se lee por ref para
  // que el temporizador pendiente use SIEMPRE la version fresca sin reprogramarse.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Al desmontar se cancela lo pendiente: emitir sobre un consumidor que ya no esta
  // seria un setState en un arbol muerto.
  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  /**
   * Emite la seleccion agregada con el retardo configurado. Cada cambio CANCELA el
   * anterior: una racha de clics se resuelve en UNA sola emision, la del estado final.
   */
  function emitir(seleccionFinal: FilterSelection) {
    if (temporizador.current) {
      clearTimeout(temporizador.current);
      temporizador.current = null;
    }
    if (debounceMs <= 0) {
      onChange(seleccionFinal);
      return;
    }
    temporizador.current = setTimeout(() => {
      temporizador.current = null;
      onChangeRef.current(seleccionFinal);
    }, debounceMs);
  }

  /** Aplica la poda (R26) y emite la seleccion agregada ya coherente (R16/R18). */
  function aplicar(siguiente: FilterSelection) {
    const podada = podarSeleccion(montados, siguiente);
    setSeleccion(podada);
    emitir(podada);
  }

  function fijar(key: string, valores: string[]) {
    const siguiente: FilterSelection = { ...seleccion };
    if (valores.length === 0) delete siguiente[key];
    else siguiente[key] = valores;
    aplicar(siguiente);
  }

  function limpiarTodo() {
    setSeleccion({});
    setResetSignal((n) => n + 1);
    emitir({}); // R22: una sola emision, vacia
  }

  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      {montados.map((filtro) => {
        const visibles =
          filtro.kind === "dateRange"
            ? (filtro.options ?? [])
            : opcionesVisibles(montados, seleccion, filtro.key);
        const sinOpciones =
          KINDS_CON_OPCIONES.has(filtro.kind) && visibles.length === 0;
        // R14 + R15: sin opciones ofrecidas, o con el consumidor deshabilitando.
        const inhabilitado = disabled || filtro.disabled === true || sinOpciones;
        const valores = seleccion[filtro.key] ?? [];

        if (filtro.kind === "multi") {
          return (
            <MultiSelectFilter
              key={filtro.key}
              label={filtro.label}
              options={visibles}
              value={valores}
              onChange={(v) => fijar(filtro.key, v)}
              placeholder={filtro.placeholder}
              searchPlaceholder={filtro.searchPlaceholder}
              emptyMessage={filtro.emptyMessage}
              disabled={inhabilitado}
            />
          );
        }

        if (filtro.kind === "boolean") {
          const marcado = valores[0] === BOOLEAN_MARCADO;
          return (
            <label
              key={filtro.key}
              className={cn(
                "flex h-8 items-center gap-2 rounded-lg border border-border px-2.5 text-sm select-none",
                inhabilitado
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer hover:bg-muted",
              )}
            >
              <Checkbox
                checked={marcado}
                disabled={inhabilitado}
                // R18: desmarcado NO emite `["false"]`, deja la clave fuera.
                onCheckedChange={(v) =>
                  fijar(filtro.key, v ? [BOOLEAN_MARCADO] : [])
                }
              />
              {filtro.label}
            </label>
          );
        }

        if (filtro.kind === "single") {
          return (
            <Select
              key={filtro.key}
              aria-label={filtro.label}
              className="min-w-56"
              value={valores[0] ?? ""}
              // R7: elegir un valor SUSTITUYE al anterior (nunca coexisten dos).
              onValueChange={(v) => fijar(filtro.key, v ? [v] : [])}
              options={visibles}
              placeholder={filtro.placeholder}
              disabled={inhabilitado}
            />
          );
        }

        return (
          <DateRangeFilter
            key={filtro.key}
            label={filtro.label}
            // Solo son atajos ofrecibles los que declaran QUE rango representan.
            shortcuts={visibles.flatMap((o) =>
              o.defaultRange
                ? [{ value: o.value, label: o.label, ...o.defaultRange }]
                : [],
            )}
            resetSignal={resetSignal}
            disabled={inhabilitado}
            placeholder={filtro.placeholder}
            // R18: un rango sin atajo y sin extremos es "sin seleccion" -> clave ausente.
            onChange={(terna) =>
              fijar(filtro.key, terna.some((p) => p !== "") ? [...terna] : [])
            }
          />
        );
      })}

      {/* R22: "Limpiar todo" solo existe cuando hay algo que limpiar. Sin ningun
          filtro activo no ocupa sitio ni ofrece una accion que no haria nada. */}
      {showClearAll && Object.keys(seleccion).length > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={limpiarTodo}
        >
          Limpiar todo
        </Button>
      ) : null}
    </div>
  );
}

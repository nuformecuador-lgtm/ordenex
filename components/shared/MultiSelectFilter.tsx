"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Minus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  /** Valor estable de la opcion (lo que se emite en `onChange`). */
  value: string;
  /** Texto visible de la opcion (y lo que se busca al filtrar). */
  label: string;
  /**
   * Feature 144 (R28): grupo al que pertenece la opcion. Es puro CONTRATO DE
   * OPCIONES —el control no sabe que significa el grupo—, asi que cualquier
   * consumidor puede agrupar lo que quiera. MIENTRAS ninguna opcion declare grupo,
   * la lista se pinta PLANA, con el mismo markup y el mismo ARIA que antes de esta
   * feature (sin regresion para el filtro de estado de la 63).
   */
  group?: string;
}

export interface MultiSelectFilterProps {
  /** Opciones disponibles, en el orden en que deben mostrarse. */
  options: MultiSelectOption[];
  /** Valores marcados (controlado). Vacio = "sin filtro". */
  value: string[];
  /** Se emite con la lista completa de valores marcados en cada cambio. */
  onChange: (value: string[]) => void;
  /** Etiqueta visible del control (y nombre accesible del boton). */
  label: string;
  /** Texto del boton cuando NO hay nada marcado. Default: "Todos". */
  placeholder?: string;
  /** Placeholder del buscador interno. Default: "Buscar…". */
  searchPlaceholder?: string;
  /** Mensaje cuando la busqueda no deja opciones. Default: "Sin coincidencias". */
  emptyMessage?: string;
  /**
   * Pedido humano del 2026-08-19 — texto de la opcion que marca/desmarca TODAS.
   * Default: "Todos". Se ofrece siempre que haya opciones que marcar; ponerlo a `null`
   * la retira (un filtro donde marcarlo todo no signifique nada util).
   */
  todosLabel?: string | null;
  disabled?: boolean;
  className?: string;
}

/**
 * Filtro de seleccion multiple: un boton que despliega la lista de opciones con
 * casilla por opcion y un buscador para acotarlas. Es UI pura y controlada — no
 * conoce el dominio ni la tabla: solo emite el array de valores marcados.
 *
 * Se implementa con un panel propio (no hay Popover/Command en `components/ui`)
 * y `role="listbox"` + `role="option"` con `aria-selected`, de modo que la
 * seleccion es legible por lector de pantalla y por test. Cierra al hacer clic
 * fuera y con `Escape`.
 */
export function MultiSelectFilter({
  options,
  value,
  onChange,
  label,
  placeholder = "Todos",
  searchPlaceholder = "Buscar…",
  emptyMessage = "Sin coincidencias",
  todosLabel = "Todos",
  disabled = false,
  className,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const contenedorRef = useRef<HTMLDivElement>(null);

  // Cierre por clic fuera / Escape. Solo se suscribe mientras el panel esta abierto.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      const nodo = contenedorRef.current;
      if (nodo && !nodo.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const seleccion = useMemo(() => new Set(value), [value]);

  const visibles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  /**
   * Secciones por grupo (R28). `null` = ninguna opcion visible declara grupo, y
   * entonces la lista se pinta plana EXACTAMENTE como antes de esta feature. Con
   * grupos se preserva el ORDEN DE APARICION de cada grupo en `options`; las
   * opciones sin grupo caen en una seccion sin cabecera.
   */
  const secciones = useMemo(() => {
    if (!visibles.some((o) => o.group)) return null;
    const orden: string[] = [];
    const porGrupo = new Map<string, MultiSelectOption[]>();
    for (const opcion of visibles) {
      const grupo = opcion.group ?? "";
      const acumulado = porGrupo.get(grupo);
      if (acumulado) acumulado.push(opcion);
      else {
        porGrupo.set(grupo, [opcion]);
        orden.push(grupo);
      }
    }
    return orden.map((grupo) => ({
      grupo,
      opciones: porGrupo.get(grupo) as MultiSelectOption[],
    }));
  }, [visibles]);

  function alternar(v: string) {
    onChange(
      seleccion.has(v) ? value.filter((x) => x !== v) : [...value, v],
    );
  }

  /**
   * Pedido humano del 2026-08-19 — estado de la opcion "Todos": `"todas"`, `"algunas"`
   * o `"ninguna"`. Se mide sobre las opciones VISIBLES, no sobre `options`: con el
   * buscador puesto, "Todos" es "todos los que estoy viendo", que es lo unico que el
   * usuario puede comprobar de un vistazo. Un tri-estado y no un booleano porque
   * "algunas marcadas" no es lo mismo que "ninguna", y pintarlo igual haria que el
   * primer clic pareciera aleatorio.
   */
  const estadoTodos: "todas" | "algunas" | "ninguna" = useMemo(() => {
    if (visibles.length === 0) return "ninguna";
    const marcadas = visibles.filter((o) => seleccion.has(o.value)).length;
    if (marcadas === 0) return "ninguna";
    return marcadas === visibles.length ? "todas" : "algunas";
  }, [visibles, seleccion]);

  /**
   * Marca las visibles que falten, o las desmarca TODAS si ya estaban todas. Con la
   * lista acotada por el buscador se toca solo lo visible: lo marcado fuera de la
   * busqueda se conserva —desmarcar a ciegas seleccion que no esta en pantalla es
   * justo lo que convierte este atajo en una trampa.
   */
  function alternarTodos() {
    const visiblesValues = visibles.map((o) => o.value);
    if (estadoTodos === "todas") {
      const fuera = new Set(visiblesValues);
      onChange(value.filter((v) => !fuera.has(v)));
      return;
    }
    // Se AÑADEN las que faltan al final, igual que hace `alternar` con una sola: lo ya
    // marcado no se reordena y nada que estuviera en `value` desaparece por el camino.
    onChange([...value, ...visiblesValues.filter((v) => !seleccion.has(v))]);
  }

  // Resumen del boton: nada marcado -> placeholder; 1 -> su etiqueta; N -> conteo.
  const resumen =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? "1 seleccionado")
        : `${value.length} seleccionados`;

  /** Una opcion de la lista. Identica con y sin grupos: `role="option"` + `aria-selected`. */
  function renderOpcion(opcion: MultiSelectOption) {
    const marcada = seleccion.has(opcion.value);
    return (
      <li key={opcion.value}>
        {/* `option` como boton: un clic marca/desmarca sin cerrar el
            panel (seleccion multiple encadenada). */}
        <button
          type="button"
          role="option"
          aria-selected={marcada}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
            "hover:bg-accent hover:text-accent-foreground",
            marcada && "font-medium",
          )}
          onClick={() => alternar(opcion.value)}
        >
          <span
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary",
              marcada ? "bg-primary text-primary-foreground" : "opacity-50",
            )}
            aria-hidden
          >
            {marcada ? <Check className="h-3 w-3" /> : null}
          </span>
          <span className="truncate">{opcion.label}</span>
        </button>
      </li>
    );
  }

  return (
    <div ref={contenedorRef} className={cn("relative", className)}>
      <div className="relative flex items-center">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${label}: ${resumen}`}
          className="justify-between gap-2 min-w-56"
          onClick={() => setOpen((prev) => !prev)}
        >
          <span className="truncate">
            <span className="text-muted-foreground">{label}: </span>
            {resumen}
          </span>
          {/* Con seleccion, el hueco de la derecha lo ocupa la X que limpia; sin ella,
              la flecha que anuncia el desplegable. */}
          {value.length > 0 ? (
            <span className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
          )}
        </Button>
        {/* La X NO puede vivir dentro del disparador (un boton no anida otro): va
            superpuesta sobre su borde derecho, dentro del mismo control. */}
        {value.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled}
            aria-label={`Limpiar ${label}`}
            className="absolute right-1 hover:bg-transparent hover:text-foreground"
            onClick={() => onChange([])}
          >
            <X className="h-4 w-4 opacity-60" aria-hidden />
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="absolute z-20 mt-1 w-72 rounded-md border border-border bg-popover p-1 shadow-md">
          <div className="p-1">
            <Input
              type="search"
              value={query}
              aria-label={`Buscar en ${label}`}
              placeholder={searchPlaceholder}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <ul role="listbox" aria-label={label} aria-multiselectable className="max-h-64 overflow-y-auto p-1">
            {/* Pedido humano del 2026-08-19: "Todos" encabeza la lista y marca o desmarca
                de una vez lo que hay debajo. Va DENTRO del listbox y como una opcion mas
                —`role="option"` con su `aria-selected`— para que un lector de pantalla la
                anuncie con el mismo idioma que las demas; separada por una linea porque
                no es una opcion del dominio, es un atajo sobre ellas. */}
            {todosLabel !== null && visibles.length > 0 ? (
              <li className="mb-1 border-b border-border pb-1">
                <button
                  type="button"
                  role="option"
                  aria-selected={estadoTodos === "todas"}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                    "hover:bg-accent hover:text-accent-foreground",
                    estadoTodos !== "ninguna" && "font-medium",
                  )}
                  onClick={alternarTodos}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary",
                      estadoTodos === "ninguna"
                        ? "opacity-50"
                        : "bg-primary text-primary-foreground",
                    )}
                    aria-hidden
                  >
                    {estadoTodos === "todas" ? (
                      <Check className="h-3 w-3" />
                    ) : estadoTodos === "algunas" ? (
                      // Parcial: ni marcado ni vacio. El guion dice "hay algo debajo
                      // marcado, pero no todo", que es lo que decide si el clic marca o
                      // desmarca.
                      <Minus className="h-3 w-3" />
                    ) : null}
                  </span>
                  <span className="truncate">{todosLabel}</span>
                </button>
              </li>
            ) : null}
            {visibles.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">
                {emptyMessage}
              </li>
            ) : secciones ? (
              // R28: `listbox > group > option` es una composicion ARIA valida. La
              // `ul` interna va como `presentation` para que las opciones sigan
              // siendo hijas directas del grupo a ojos del lector de pantalla.
              secciones.map(({ grupo, opciones }, i) =>
                grupo === "" ? (
                  opciones.map(renderOpcion)
                ) : (
                  <li
                    key={`grupo:${grupo}`}
                    role="group"
                    aria-label={grupo}
                    // Una linea separa un grupo del anterior; el primero no la lleva
                    // (no hay nada de lo que separarlo).
                    className={cn(i > 0 && "mt-1 border-t border-border pt-1")}
                  >
                    <div
                      className="px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground"
                      aria-hidden
                    >
                      {grupo}
                    </div>
                    <ul role="presentation">{opciones.map(renderOpcion)}</ul>
                  </li>
                ),
              )
            ) : (
              visibles.map(renderOpcion)
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

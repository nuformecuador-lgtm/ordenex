"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DEBOUNCE_MS_DEFAULT } from "@/components/shared/FilterComponent";
import { cn } from "@/lib/utils";

// Ficha 458-A (TA.4, design §5.1, R2/R10) — la primitiva de SELECTOR CON BUSQUEDA: un popover con
// un campo de busqueda y una lista de opciones. No habia combobox en el repo (design §5.1); este es
// el molde para el cierre de los desgloses (458-A) y, mas adelante, la cuenta y «A quien» (458-C/E).
//
// Patron WAI-ARIA «combobox con listbox» (APG): el campo de busqueda tiene `role="combobox"`, la
// lista `role="listbox"` y la opcion activa se anuncia con `aria-activedescendant`, asi el foco NO
// sale del campo mientras se recorre la lista con las flechas. Teclado: ↓/↑ recorren, Inicio/Fin
// saltan a los extremos, Intro elige, Escape cierra (y el foco vuelve al disparador).
//
// Reglas de la wallet que esta primitiva hace cumplir por construccion:
//  - NUNCA pinta `value`: el disparador y la lista enseñan `label` (R1). El valor viaja al padre.
//  - Nadie teclea un identificador (R2): se busca por lo que la persona SABE (un dia, un nombre).
//  - Los cuatro estados de la lectura se dicen en palabras: cargando, error, vacio y «solo los mas
//    recientes» (`hayMas`). Un selector vacio y mudo es una promesa incumplida.

export interface SelectorBuscableOpcion {
  value: string;
  label: string;
}

export type SelectorBuscableEstado = "listo" | "cargando" | "error" | "vacio";

/** Los textos del selector. Llegan por props: la primitiva no trae ningun texto de producto. */
export interface SelectorBuscableTextos {
  /** Lo que dice el disparador sin eleccion, y la primera opcion (quitar el filtro). */
  todos: string;
  /** Nombre accesible del campo de busqueda. */
  buscar: string;
  /** Marcador del campo de busqueda: que se puede escribir. */
  buscarMarcador: string;
  cargando: string;
  error: string;
  vacio: string;
  /** Aviso cuando la lista esta recortada (solo los mas recientes). */
  hayMas: string;
}

export interface SelectorBuscableProps {
  /** Id del disparador (para el `htmlFor` de su rotulo visible). */
  id: string;
  /** Nombre accesible del control («Cierre»). */
  etiqueta: string;
  opciones: readonly SelectorBuscableOpcion[];
  /** El valor elegido; `null` = sin filtro. */
  valor: string | null;
  onCambiar: (valor: string | null) => void;
  /**
   * Busqueda EN EL SERVIDOR. Se llama al abrir (con `""`) y, con retardo, al escribir. Sin ella,
   * la lista se filtra en el cliente por el rotulo.
   */
  onBuscar?: (texto: string) => void;
  estado: SelectorBuscableEstado;
  /** La lectura tiene mas de lo que se ofrece: se avisa que solo estan los mas recientes. */
  hayMas?: boolean;
  textos: SelectorBuscableTextos;
  disabled?: boolean;
  className?: string;
  /** Espera entre la ultima tecla y `onBuscar`. Inyectable para los tests. */
  esperaMs?: number;
}

/** Minusculas y sin tildes: «dia» encuentra «Día». */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function SelectorBuscable({
  id,
  etiqueta,
  opciones,
  valor,
  onCambiar,
  onBuscar,
  estado,
  hayMas = false,
  textos,
  disabled = false,
  className,
  esperaMs = DEBOUNCE_MS_DEFAULT,
}: Readonly<SelectorBuscableProps>) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [activo, setActivo] = useState(0);
  /**
   * El rotulo de lo elegido, recordado al elegir: tras una busqueda la lista puede ya no traer la
   * opcion elegida, y el disparador no puede quedarse sin decir que filtra.
   */
  const [rotuloElegido, setRotuloElegido] = useState<string | null>(null);
  const campoRef = useRef<HTMLInputElement>(null);
  const base = useId();
  const listaId = `${base}-lista`;
  const opcionId = (i: number) => `${base}-opcion-${i}`;

  // La busqueda del servidor, con retardo: teclear «2026-09-12» no son diez lecturas.
  const onBuscarRef = useRef(onBuscar);
  useEffect(() => {
    onBuscarRef.current = onBuscar;
  }, [onBuscar]);
  useEffect(() => {
    if (!abierto || texto === "") return;
    const t = setTimeout(() => onBuscarRef.current?.(texto.trim()), esperaMs);
    return () => clearTimeout(t);
  }, [texto, abierto, esperaMs]);

  const visibles =
    onBuscar || texto.trim() === ""
      ? opciones
      : opciones.filter((o) => normalizar(o.label).includes(normalizar(texto.trim())));
  // La primera fila de la lista siempre es «quitar el filtro» (valor `null`).
  const filas: { value: string | null; label: string }[] = [
    { value: null, label: textos.todos },
    ...(estado === "listo" ? visibles : []),
  ];

  const elegida = valor === null ? null : (opciones.find((o) => o.value === valor)?.label ?? rotuloElegido);
  const rotuloDisparador = elegida ?? textos.todos;

  function cambiarAbierto(siguiente: boolean) {
    setAbierto(siguiente);
    if (siguiente) {
      setTexto("");
      setActivo(0);
      onBuscar?.("");
    }
  }

  function elegir(fila: { value: string | null; label: string }) {
    setRotuloElegido(fila.value === null ? null : fila.label);
    onCambiar(fila.value);
    setAbierto(false);
  }

  function alTeclear(e: KeyboardEvent<HTMLInputElement>) {
    const ultimo = filas.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActivo((i) => Math.min(i + 1, ultimo));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActivo((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setActivo(0);
        break;
      case "End":
        e.preventDefault();
        setActivo(ultimo);
        break;
      case "Enter":
        e.preventDefault();
        if (filas[activo]) elegir(filas[activo]);
        break;
      default:
        break;
    }
  }

  const aviso =
    estado === "cargando" ? (
      <p role="status" className="px-2 py-1.5 text-sm text-muted-foreground">
        {textos.cargando}
      </p>
    ) : estado === "error" ? (
      <p role="alert" className="px-2 py-1.5 text-sm text-destructive">
        {textos.error}
      </p>
    ) : estado === "vacio" || visibles.length === 0 ? (
      <p role="status" className="px-2 py-1.5 text-sm text-muted-foreground">
        {textos.vacio}
      </p>
    ) : hayMas ? (
      <p className="px-2 py-1.5 text-xs text-muted-foreground">{textos.hayMas}</p>
    ) : null;

  return (
    <Popover open={abierto} onOpenChange={cambiarAbierto}>
      <PopoverTrigger
        id={id}
        disabled={disabled}
        aria-label={`${etiqueta}: ${rotuloDisparador}`}
        aria-haspopup="listbox"
        className={cn(
          "flex h-9 w-full min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input bg-background px-2.5 py-1 text-left text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span className={cn("min-w-0 truncate", elegida === null && "text-muted-foreground")}>
          {rotuloDisparador}
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        initialFocus={campoRef}
        className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-1 bg-background p-1"
      >
        <input
          ref={campoRef}
          type="search"
          role="combobox"
          aria-label={textos.buscar}
          aria-expanded="true"
          aria-controls={listaId}
          aria-autocomplete="list"
          aria-activedescendant={filas[activo] ? opcionId(activo) : undefined}
          placeholder={textos.buscarMarcador}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setActivo(0);
            if (e.target.value === "") onBuscar?.("");
          }}
          onKeyDown={alTeclear}
          className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring"
        />
        <ul id={listaId} role="listbox" aria-label={etiqueta} className="max-h-64 overflow-auto">
          {filas.map((fila, i) => {
            const seleccionada = fila.value === valor;
            return (
              <li
                key={fila.value ?? ""}
                id={opcionId(i)}
                role="option"
                aria-selected={seleccionada}
                // El foco se queda en el campo (patron `aria-activedescendant`): el raton no lo roba.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActivo(i)}
                onClick={() => elegir(fila)}
                className={cn(
                  "flex cursor-default items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm",
                  i === activo && "bg-accent text-accent-foreground",
                )}
              >
                <span className="min-w-0">{fila.label}</span>
                {seleccionada ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
              </li>
            );
          })}
        </ul>
        {aviso}
      </PopoverContent>
    </Popover>
  );
}

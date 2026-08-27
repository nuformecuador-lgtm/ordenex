"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  CAMPOS_PLANTILLA_OFRECIDOS,
  type CampoPlantilla,
} from "@/lib/types/plantilla-datos";

/**
 * Listbox filtrable PERMANENTE para elegir una CLAVE del catálogo de campos de
 * plantilla. Ya no es un combobox que abre/cierra (ver historial de este archivo para el
 * patrón anterior): la lista se pinta siempre, con un input de filtro encima que la
 * recorta en vivo. Con ~39 campos en pantalla no hay nada que "colapsar": abrir y cerrar
 * era ceremonia sin función.
 *
 * POR QUÉ A MANO Y NO `shadcn/ui Command` (design §5.1): `components/ui/` no tiene
 * `command` ni `popover`; añadirlos arrastraría `cmdk` + `@radix-ui/react-popover` para
 * filtrar una lista de ~39 elementos en una sola pantalla de configuración. Si el
 * patrón se repite en una segunda feature, se promueve a `components/shared/`.
 *
 * ARIA — por qué esto NO es un combobox: `role="combobox"` + `aria-expanded` describen
 * un widget que se expande y colapsa; aquí no hay nada que expandir, así que ese par de
 * atributos mentiría. El patrón honesto es "input de filtro que controla un listbox
 * persistente": el `<input>` es un textbox normal (sin `role`, sin `aria-expanded`) que
 * SÍ conserva `aria-controls` (apunta al listbox) y `aria-activedescendant` (apunta a la
 * opción activa). El nombre accesible sale de un `<span>` VISIBLE + `aria-labelledby`
 * — no de `aria-label` — porque en este repo ya nos mordió que el texto visible gana
 * sobre `aria-label` para el nombre accesible calculado por los navegadores/RTL.
 * La lista sigue siendo `role="listbox"` con filas `role="option"` + `aria-selected`.
 * Esto satisface R30 igual (nombre accesible estable + lista que se anuncia como tal +
 * opción activa señalada); lo que se deroga es la PRESCRIPCIÓN de patrón combobox de
 * `design.md §5.1`, no el requisito.
 */

/**
 * El predicado NO se reimplementa aqui: se consume `CAMPOS_PLANTILLA_OFRECIDOS`, que ya excluye
 * alias (feature 282, R4) y campos con `ocultoEnSelector` (feature 288). Asi la UI y los tests
 * afirman sobre LA MISMA lista, y ampliar/reducir la oferta es tocar el catalogo, no el picker.
 */
const CAMPOS_POR_DEFECTO: CampoPlantilla[] = CAMPOS_PLANTILLA_OFRECIDOS;

/** minúsculas + sin diacríticos, para que "GUIA" y "guía" filtren el mismo conjunto (R3). */
function normalizar(texto: string): string {
  return texto
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function idDeOpcion(clave: string): string {
  return `campo-opcion-${clave}`;
}

export interface CampoVariablePickerProps {
  /** Se dispara con la CLAVE del catálogo elegida. El anfitrión decide dónde insertarla. */
  onSeleccionar: (clave: string) => void;
  /** Catálogo inyectable para test; por defecto los campos OFRECIDOS (sin alias ni ocultos). */
  campos?: CampoPlantilla[];
}

export function CampoVariablePicker({
  onSeleccionar,
  campos = CAMPOS_POR_DEFECTO,
}: CampoVariablePickerProps) {
  const [filtro, setFiltro] = useState("");
  const [activo, setActivo] = useState(0);

  const labelId = useId();
  const listboxId = useId();

  const opciones = useMemo(() => {
    const q = normalizar(filtro.trim());
    if (q === "") return campos;
    return campos.filter((campo) => {
      const haystack = normalizar(`${campo.nombre} ${campo.descripcion} ${campo.clave}`);
      return haystack.includes(q);
    });
  }, [campos, filtro]);

  const activoClamp = opciones.length === 0 ? -1 : Math.min(activo, opciones.length - 1);
  const activeDescendant = activoClamp >= 0 ? idDeOpcion(opciones[activoClamp].clave) : undefined;

  function elegir(campo: CampoPlantilla) {
    onSeleccionar(campo.clave);
    // R8, media derogación: se vacía el filtro y se resetea la activa a la primera —esa es
    // la intención de "la siguiente búsqueda parte de cero"—. La otra mitad del requisito
    // ("cerrar la lista") se deroga: la lista ya no es algo que se pueda cerrar.
    setFiltro("");
    setActivo(0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActivo((prev) =>
        opciones.length === 0 ? 0 : Math.min(prev + 1, opciones.length - 1),
      );
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActivo((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (activoClamp < 0) return;
      elegir(opciones[activoClamp]);
      return;
    }
    // `Escape` NO se captura aquí a propósito: ya no hay lista que cerrar, y el Sheet
    // anfitrión necesita que el evento le llegue sin `preventDefault` para poder cerrarse
    // con la tecla Escape. Dejarlo burbujear es la decisión correcta, no un olvido.
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium" id={labelId}>
        Campo a insertar
      </span>
      <Input
        aria-labelledby={labelId}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendant}
        placeholder="Buscar por nombre, descripción o clave…"
        value={filtro}
        onChange={(e) => {
          setFiltro(e.target.value);
          setActivo(0);
        }}
        onKeyDown={handleKeyDown}
      />
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Campos del catálogo"
        className="max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-sm"
      >
        {opciones.length === 0 ? (
          <li className="px-2.5 py-1.5 text-sm text-muted-foreground">
            Ningún campo coincide con la búsqueda.
          </li>
        ) : (
          opciones.map((campo, indice) => {
            const esActiva = indice === activoClamp;
            return (
              <li
                key={campo.clave}
                id={idDeOpcion(campo.clave)}
                role="option"
                aria-selected={esActiva}
                className={`flex cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-1.5 ${
                  esActiva ? "bg-accent text-accent-foreground" : ""
                }`}
                onMouseEnter={() => setActivo(indice)}
                onMouseDown={(e) => {
                  // evita que el input pierda el foco antes del click.
                  e.preventDefault();
                }}
                onClick={() => elegir(campo)}
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{campo.nombre}</span>
                  {campo.sensible === true ? (
                    <Badge variant="warning">Dato sensible</Badge>
                  ) : null}
                </span>
                <span className="text-sm text-muted-foreground">{campo.descripcion}</span>
                <span className="text-xs text-muted-foreground/70">
                  {`{{${campo.clave}}}`}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CAMPOS_PLANTILLA, type CampoPlantilla } from "@/lib/types/plantilla-datos";

/**
 * Combobox accesible para elegir una CLAVE del catálogo de campos de plantilla.
 *
 * POR QUÉ A MANO Y NO `shadcn/ui Command` (design §5.1): `components/ui/` no tiene
 * `command` ni `popover`; añadirlos arrastraría `cmdk` + `@radix-ui/react-popover` para
 * filtrar una lista de ~39 elementos en una sola pantalla de configuración. Si el
 * patrón combobox se repite en una segunda feature, se promueve a `components/shared/`.
 *
 * Patrón de accesibilidad: el `<input>` de filtro es el propio `role="combobox"`
 * (`aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, `aria-activedescendant`),
 * la lista es `role="listbox"` y cada fila es `role="option"`. El nombre accesible del
 * combobox sale de un `<span>` VISIBLE referenciado por `aria-labelledby` — no de un
 * `aria-label` — porque en este repo ya nos mordió que el texto visible gana sobre
 * `aria-label` para el nombre accesible calculado por los navegadores/testing-library.
 *
 * Comportamiento de apertura, documentado porque es una decisión deliberada y simple:
 * la lista se abre al enfocar el input o al escribir en él (`onFocus`/`onChange`), y
 * también con `ArrowDown` si estuviera cerrada. Al montar, la lista permanece cerrada.
 */

const CAMPOS_POR_DEFECTO: CampoPlantilla[] = CAMPOS_PLANTILLA.filter(
  (c) => c.aliasDe === undefined,
);

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
  /** Catálogo inyectable para test; por defecto CAMPOS_PLANTILLA sin alias. */
  campos?: CampoPlantilla[];
}

export function CampoVariablePicker({
  onSeleccionar,
  campos = CAMPOS_POR_DEFECTO,
}: CampoVariablePickerProps) {
  const [filtro, setFiltro] = useState("");
  const [abierto, setAbierto] = useState(false);
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
  const activeDescendant =
    abierto && activoClamp >= 0 ? idDeOpcion(opciones[activoClamp].clave) : undefined;

  function abrir() {
    setAbierto(true);
  }

  function cerrar() {
    setAbierto(false);
  }

  function elegir(campo: CampoPlantilla) {
    onSeleccionar(campo.clave);
    setFiltro("");
    setActivo(0);
    cerrar();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!abierto) {
        abrir();
        return;
      }
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
      if (!abierto || activoClamp < 0) return;
      elegir(opciones[activoClamp]);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cerrar();
      return;
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium" id={labelId}>
        Campo a insertar
      </span>
      <div className="relative">
        <Input
          role="combobox"
          aria-labelledby={labelId}
          aria-expanded={abierto}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendant}
          placeholder="Buscar por nombre, descripción o clave…"
          value={filtro}
          onFocus={abrir}
          onChange={(e) => {
            setFiltro(e.target.value);
            setActivo(0);
            abrir();
          }}
          onKeyDown={handleKeyDown}
        />
        {abierto ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Campos del catálogo"
            className="absolute z-10 mt-1 max-h-72 w-full min-w-max overflow-auto rounded-lg border border-border bg-popover p-1 shadow-md"
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
                    <span className="text-sm text-muted-foreground">
                      {campo.descripcion}
                    </span>
                    <span className="text-xs text-muted-foreground/70">
                      {`{{${campo.clave}}}`}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

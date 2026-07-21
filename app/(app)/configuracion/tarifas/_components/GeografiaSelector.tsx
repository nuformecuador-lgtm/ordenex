"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ProvinciaArbolDTO } from "@/lib/actions/geografia";

// Normaliza para buscar sin distinguir mayusculas/acentos.
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Estado derivado de un grupo (provincia/canton) a partir de sus distritos hoja.
interface TriState {
  checked: boolean;
  indeterminate: boolean;
}

interface SeleccionData {
  provincias: { id: string; nombre: string }[]; // completas (todos sus distritos)
  cantones: { id: string; nombre: string }[]; // completos
  distritos: { id: string; nombre: string; zonaNombre: string | null }[];
}

export function GeografiaSelector({
  provincias,
  onSelectedChange,
  initialSelected,
}: Readonly<{
  provincias: ProvinciaArbolDTO[];
  /** Reporta al padre los distritos (hojas) seleccionados en cada cambio. */
  onSelectedChange?: (distritoIds: string[]) => void;
  /** Distritos pre-seleccionados (edición de zona). Se lee al montar. */
  initialSelected?: string[];
}>) {
  const [query, setQuery] = useState("");
  // Fuente de verdad UNICA: distritos (hojas) seleccionados. Provincia y canton
  // derivan su estado (marcado / indeterminado / vacio) de estos.
  const [selDist, setSelDist] = useState<Set<string>>(
    () => new Set(initialSelected ?? []),
  );

  // Mapas id -> distritos hoja de cada grupo (sobre el arbol COMPLETO, no el
  // filtrado, para que la cascada abarque también lo oculto por la búsqueda).
  const { provDistIds, cantDistIds } = useMemo(() => {
    const prov = new Map<string, string[]>();
    const cant = new Map<string, string[]>();
    for (const p of provincias) {
      const pIds: string[] = [];
      for (const c of p.cantones) {
        const cIds = c.distritos.map((d) => d.id);
        cant.set(c.id, cIds);
        pIds.push(...cIds);
      }
      prov.set(p.id, pIds);
    }
    return { provDistIds: prov, cantDistIds: cant };
  }, [provincias]);

  // Log del arbol completo una sola vez, al montar (dato crudo recibido).
  useEffect(() => {
    console.log("[Tarifas] Arbol geografico:", provincias);
  }, [provincias]);

  function stateFor(ids: string[]): TriState {
    if (ids.length === 0) return { checked: false, indeterminate: false };
    let n = 0;
    for (const id of ids) if (selDist.has(id)) n++;
    return { checked: n === ids.length, indeterminate: n > 0 && n < ids.length };
  }

  // Marca/desmarca un conjunto de distritos hoja de una vez (cascada).
  function setMany(ids: string[], on: boolean) {
    setSelDist((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  // Click en provincia/canton: si estaba completo lo vacia; si estaba vacio o
  // parcial (indeterminado), lo completa.
  function toggleGrupo(ids: string[]) {
    const { checked } = stateFor(ids);
    setMany(ids, !checked);
  }

  function toggleDistrito(id: string) {
    setMany([id], !selDist.has(id));
  }

  // Arbol filtrado por texto (una rama sobrevive si provincia, algun canton o
  // algun distrito coincide). No afecta la selección ni la cascada.
  const filtradas = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return provincias;
    return provincias
      .map((p) => {
        const provMatch = norm(p.nombre).includes(q);
        const cantones = p.cantones
          .map((c) => {
            const cantMatch = norm(c.nombre).includes(q);
            const distritos = c.distritos.filter(
              (d) => provMatch || cantMatch || norm(d.nombre).includes(q),
            );
            if (cantMatch || distritos.length > 0) {
              return { ...c, distritos: provMatch ? c.distritos : distritos };
            }
            return null;
          })
          .filter((c): c is NonNullable<typeof c> => c !== null);
        if (provMatch || cantones.length > 0) {
          return { ...p, cantones: provMatch ? p.cantones : cantones };
        }
        return null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [provincias, query]);

  // Selección derivada para el console.log: distritos hoja + padres COMPLETOS.
  const seleccion = useMemo<SeleccionData>(() => {
    const data: SeleccionData = { provincias: [], cantones: [], distritos: [] };
    for (const p of provincias) {
      if (stateFor(provDistIds.get(p.id) ?? []).checked && (provDistIds.get(p.id)?.length ?? 0) > 0) {
        data.provincias.push({ id: p.id, nombre: p.nombre });
      }
      for (const c of p.cantones) {
        if (stateFor(cantDistIds.get(c.id) ?? []).checked && (cantDistIds.get(c.id)?.length ?? 0) > 0) {
          data.cantones.push({ id: c.id, nombre: c.nombre });
        }
        for (const d of c.distritos) {
          if (selDist.has(d.id)) {
            data.distritos.push({ id: d.id, nombre: d.nombre, zonaNombre: d.zonaNombre });
          }
        }
      }
    }
    return data;
    // stateFor depende de selDist; lo listamos como dep explícita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provincias, provDistIds, cantDistIds, selDist]);

  useEffect(() => {
    if (selDist.size > 0) console.log("[Tarifas] Seleccion actual:", seleccion);
  }, [seleccion, selDist]);

  // Reporta la selección de distritos al formulario contenedor (crear zona).
  useEffect(() => {
    onSelectedChange?.([...selDist]);
    // onSelectedChange se toma fresco en cada corrida; dep solo en selDist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selDist]);

  return (
    <div className="flex flex-col gap-4">
      <Input
        type="search"
        placeholder="Buscar provincia, cantón o distrito…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Buscar en el catálogo geográfico"
      />

      <p className="text-sm text-muted-foreground">
        {selDist.size > 0
          ? `Distritos seleccionados: ${selDist.size}. Revisa la consola.`
          : "Selecciona una provincia o cantón para marcar todos sus distritos, o marca distritos sueltos. La selección se imprime en la consola."}
      </p>

      <div className="flex flex-col gap-1 rounded-md border border-border p-2">
        {filtradas.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">Sin resultados.</p>
        ) : (
          filtradas.map((p) => {
            const pState = stateFor(provDistIds.get(p.id) ?? []);
            return (
              <Collapsible
                key={`${p.id}:${query.trim().length > 0}`}
                defaultOpen={query.trim().length > 0}
                className="group/prov"
              >
                <div className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-accent">
                  <Checkbox
                    checked={pState.checked}
                    indeterminate={pState.indeterminate}
                    onCheckedChange={() => toggleGrupo(provDistIds.get(p.id) ?? [])}
                    aria-label={`Seleccionar todos los distritos de ${p.nombre}`}
                  />
                  <CollapsibleTrigger className="flex flex-1 items-center gap-1.5 text-left text-sm font-medium">
                    <ChevronRight className="size-4 shrink-0 transition-transform duration-200 group-data-[open]/prov:rotate-90" />
                    <span>{p.nombre}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      ({p.cantones.length} cantón{p.cantones.length === 1 ? "" : "es"})
                    </span>
                  </CollapsibleTrigger>
                </div>

                <CollapsibleContent className="ml-5 border-l border-border pl-2">
                  {p.cantones.map((c) => {
                    const cState = stateFor(cantDistIds.get(c.id) ?? []);
                    return (
                      <Collapsible
                        key={`${c.id}:${query.trim().length > 0}`}
                        defaultOpen={query.trim().length > 0}
                        className="group/cant"
                      >
                        <div className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-accent">
                          <Checkbox
                            checked={cState.checked}
                            indeterminate={cState.indeterminate}
                            onCheckedChange={() => toggleGrupo(cantDistIds.get(c.id) ?? [])}
                            aria-label={`Seleccionar todos los distritos de ${c.nombre}`}
                          />
                          <CollapsibleTrigger className="flex flex-1 items-center gap-1.5 text-left text-sm">
                            <ChevronRight className="size-4 shrink-0 transition-transform duration-200 group-data-[open]/cant:rotate-90" />
                            <span>{c.nombre}</span>
                            <span className="text-xs text-muted-foreground">
                              ({c.distritos.length} distrito{c.distritos.length === 1 ? "" : "s"})
                            </span>
                          </CollapsibleTrigger>
                        </div>

                        <CollapsibleContent className="ml-5 border-l border-border pl-2">
                          {c.distritos.map((d) => (
                            <label
                              key={d.id}
                              className={cn(
                                "flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent",
                              )}
                            >
                              <Checkbox
                                checked={selDist.has(d.id)}
                                onCheckedChange={() => toggleDistrito(d.id)}
                                aria-label={`Seleccionar distrito ${d.nombre}`}
                              />
                              <span>{d.nombre}</span>
                              {d.zonaNombre ? (
                                <span className="text-xs text-muted-foreground">
                                  (zona: {d.zonaNombre})
                                </span>
                              ) : null}
                            </label>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            );
          })
        )}
      </div>
    </div>
  );
}

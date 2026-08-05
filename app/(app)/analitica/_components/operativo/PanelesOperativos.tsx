"use client";

// Feature 131 (T3.2) — la REJILLA de paneles: el slot `operativo` del shell de la 129.
//
// Tres cosas viven aqui y no en el panel:
//   D1/R5/R6 — el aviso de cobertura, UNO para todo el tablero. Un aviso por grafica
//              repetiria el mismo texto seis veces hasta volverlo invisible.
//   R23      — el control explicito de actualizacion: revalida TODAS las claves del
//              tablero sin tocar el filtro y sin recargar la pagina.
//   R12/R13  — la lectura del filtro desde la URL, que es donde los dos slots hermanos
//              del shell se sincronizan sin necesitar un provider comun (design §4.2).
//
// R21 — la lista de paneles se recorre TAL CUAL viene del catalogo declarativo. Aqui no
// hay ningun `filter`: filtrar por `estadoProduccion` borraria `incidentes` y
// `sin_gestionar`, que la 126 SI sirve, sin excepcion, sin log y sin hueco visible.

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useSWRConfig } from "swr";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Cobertura } from "@/lib/types/analitica-operativa";
// Feature 133 (T4.4) — SOLO EL TIPO (`import type` se borra en compilacion): este modulo
// de cliente no arrastra `lib/analytics/presentacion` ni su cierre transitivo al bundle.
// Se tipa contra el retorno del recorte —en vez de repetir la union a mano— para que
// anadir un tipo de alcance nuevo alli rompa el typecheck aqui, en `textoAlcance`, en vez
// de pintar un tablero sin rotulo en silencio.
import type { RecortePresentacion } from "@/lib/analytics/presentacion";

import { PANELES_OPERATIVOS } from "./catalogo-paneles";
import { desdeSearchParams } from "./filtro-tablero";
import { CLAVE_TABLERO, CoberturaProvider, PanelOperativo } from "./PanelOperativo";
import {
  DESCRIPCION_ACTUALIZAR,
  ETIQUETA_ACTUALIZAR,
  ETIQUETA_ALCANCE,
  ETIQUETA_REJILLA,
  TEXTO_PENUMBRA,
  TITULO_COBERTURA,
  textoAlcance,
  textoCobertura,
} from "./textos";

/**
 * D1/R5 — funde en UNA lista las `fechasNoComparables` que reporto cada panel. Todas
 * hablan del mismo rango, asi que en la practica son la misma lista; se unen por si un
 * panel llego antes que otro. El orden ascendente se conserva porque el servicio las
 * deriva de `fechasDelRango`.
 */
export function unirCobertura(
  reportes: Readonly<Record<string, Cobertura | null>>,
): readonly string[] {
  const fechas = new Set<string>();
  for (const cobertura of Object.values(reportes)) {
    for (const fecha of cobertura?.fechasNoComparables ?? []) fechas.add(fecha);
  }
  return [...fechas].sort();
}

export interface PanelesOperativosProps {
  /**
   * Feature 133 (T4.4) — el tipo de alcance con el que el borde calcula estas cifras.
   * Ausente = `global`, para que el componente siga montandose sin props (contrato de
   * `design.md §D6`). Es un ENUM, no un dato: aqui no llega ningun id ni ningun nombre.
   */
  readonly alcance?: RecortePresentacion["alcance"];
}

export function PanelesOperativos({ alcance = "global" }: PanelesOperativosProps = {}) {
  // R24 — UN rotulo para todo el tablero, no uno por panel: repetido seis veces se
  // volveria invisible, igual que ya razona D1 con el aviso de cobertura.
  const rotuloAlcance = textoAlcance(alcance);

  // El filtro vive en la URL: `FiltrosOperativos` escribe y esta rejilla lee (design §4.2).
  const params = useSearchParams();
  const filtro = useMemo(() => desdeSearchParams(params), [params]);

  const [reportes, setReportes] = useState<Record<string, Cobertura | null>>({});
  const reportar = useCallback((panelId: string, cobertura: Cobertura | null) => {
    setReportes((previo) => {
      if (previo[panelId] === cobertura) return previo;
      return { ...previo, [panelId]: cobertura };
    });
  }, []);

  const fechasNoComparables = useMemo(() => unirCobertura(reportes), [reportes]);

  // R23 — revalida por PREFIJO de clave: todos los paneles, con el filtro que ya esta
  // puesto. No toca la URL, no recarga la pagina y no conoce ninguna etiqueta de cache
  // (eso es de la 128, design §9).
  const { mutate } = useSWRConfig();
  const actualizar = useCallback(() => {
    void mutate((clave) => Array.isArray(clave) && clave[0] === CLAVE_TABLERO);
  }, [mutate]);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-end">
        <Button type="button" variant="outline" onClick={actualizar} title={DESCRIPCION_ACTUALIZAR}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          {ETIQUETA_ACTUALIZAR}
        </Button>
      </div>

      {/* R24/R25 — el rotulo de alcance: presente MIENTRAS el alcance no sea global,
          ausente cuando lo es. Es una frase sobre el universo de las cifras, sin ningun
          identificador: ni uuid, ni nombre de tienda, zona o persona. */}
      {rotuloAlcance !== null ? (
        <p role="note" aria-label={ETIQUETA_ALCANCE} className="text-sm text-muted-foreground">
          {rotuloAlcance}
        </p>
      ) : null}

      {/* R5/R6/D1 — el aviso UNICO. Aparece si y solo si hay al menos una fecha no
          comparable, con su RECUENTO y sus EXTREMOS, y siempre con la penumbra: un cero
          que en realidad es «no hay dato» pintado como un cero normal es una mentira. */}
      {fechasNoComparables.length > 0 ? (
        <Alert>
          <AlertTitle>{TITULO_COBERTURA}</AlertTitle>
          <AlertDescription>
            <span>{textoCobertura(fechasNoComparables)}</span> <span>{TEXTO_PENUMBRA}</span>
          </AlertDescription>
        </Alert>
      ) : null}

      <CoberturaProvider value={reportar}>
        <div
          role="group"
          aria-label={ETIQUETA_REJILLA}
          className="grid grid-cols-1 gap-6 lg:grid-cols-2"
        >
          {PANELES_OPERATIVOS.map((panel) => (
            <PanelOperativo key={panel.id} panel={panel} filtro={filtro} />
          ))}
        </div>
      </CoberturaProvider>
    </div>
  );
}

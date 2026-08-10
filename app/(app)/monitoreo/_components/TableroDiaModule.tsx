"use client";

// Feature 192 (F2.1/F2.5/F6.1/F6.3, design.md §7.1 y §7.3) — EL MÓDULO DEL TABLERO.
//
// Es el único componente de la feature que habla con el servidor, y lo hace por **Server
// Action + SWR**, nunca con `fetch` a una ruta de API interna (alternativa 6 del diseño): una
// ruta API sería una superficie pública nueva que habría que autenticar por su cuenta.
//
// Tres cosas viven aquí y en ningún otro sitio:
//
//  1. **El ciclo de refresco** (R31): 30 s, con `keepPreviousData` para que un fallo no borre
//     lo que ya se está leyendo (R32).
//  2. **La selección**, que vive en la URL (`?mensajero=<id>`, R50) y no en un `useState`: así
//     la vista es enlazable y compartible. Se escribe con `router.replace` para no llenar el
//     historial de pasos atrás por cada tarjeta pulsada.
//  3. **La coherencia entre el tablero y el panel** (R52): el tablero sigue refrescándose con
//     el panel abierto, y si la tarjeta que se está mirando desaparece de un refresco, el
//     panel se cierra CON AVISO en vez de quedarse enseñando un detalle sin tarjeta detrás.
//
// ⛔ **El detalle NO se pide desde aquí** (R56). El tablero carga sólo los conteos; la consulta
// del detalle la dispara el panel, y sólo cuando hay un mensajero seleccionado. Cargarlo "por
// si acaso" para las 15 tarjetas sería exactamente la deuda que R55/R56 evitan.

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { leerTableroDia } from "@/lib/actions/tablero-dia";
import type { FilaTableroDia } from "@/lib/types/tablero-dia";

import { DetalleMensajeroPanel } from "./DetalleMensajeroPanel";
import { TableroDiaCabecera, useAhoraCadaSegundo } from "./TableroDiaCabecera";
import {
  TableroDiaAvisoRefresco,
  TableroDiaSkeleton,
  TableroDiaVacio,
} from "./TableroDiaEstados";
import { TableroDiaRejilla } from "./TableroDiaRejilla";
import { TableroDiaTotales } from "./TableroDiaTotales";

/** R31 — decisión humana: 30 s. Vive junto al `useSWR` que lo consume, no esparcido. */
const REFRESCO_MS = 30_000;

/** R50 — el nombre del parámetro de la URL. Un solo literal: lo leen y lo escriben los dos. */
export const PARAM_MENSAJERO = "mensajero";

const DENEGADO_TITULO = "No tenés acceso a este tablero";
const DENEGADO_DESCRIPCION =
  "Tu cuenta no puede consultar las órdenes por mensajero del día. Si creés que debería, pedí acceso a un administrador.";

const DESAPARECIDO_TITULO = "Se cerró el detalle";
const DESAPARECIDO_DESCRIPCION =
  "El mensajero que estabas viendo ya no tiene órdenes asignadas hoy dentro de tu alcance, así que su tarjeta salió del tablero.";

/**
 * R2/R3 — un denegado se dice, NUNCA se pinta como un tablero de ceros. Son dos cosas
 * distintas y confundirlas hace que un supervisor crea que hoy no hay trabajo asignado.
 */
function AvisoDenegado() {
  return (
    <Alert data-slot="tablero-dia-denegado" variant="destructive">
      <AlertTitle>{DENEGADO_TITULO}</AlertTitle>
      <AlertDescription>{DENEGADO_DESCRIPCION}</AlertDescription>
    </Alert>
  );
}

/** R52 — el panel se cerró solo porque su tarjeta desapareció. Se dice; no se cierra a secas. */
function AvisoTarjetaDesaparecida() {
  return (
    <Alert data-slot="tablero-dia-aviso-desaparecido">
      <AlertTitle>{DESAPARECIDO_TITULO}</AlertTitle>
      <AlertDescription>{DESAPARECIDO_DESCRIPCION}</AlertDescription>
    </Alert>
  );
}

export function TableroDiaModule() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ahora = useAhoraCadaSegundo();

  // R50 — la selección SALE de la URL. No hay un `useState` espejo que pueda desincronizarse:
  // pulsar una tarjeta escribe el parámetro, y lo que se pinta es siempre lo que dice la URL.
  const mensajeroSeleccionadoId = searchParams.get(PARAM_MENSAJERO);

  const [avisoDesaparecido, setAvisoDesaparecido] = useState(false);

  const { data, error } = useSWR("tablero-dia", () => leerTableroDia(), {
    refreshInterval: REFRESCO_MS, // R31
    keepPreviousData: true, // R32
  });

  const tablero = data?.estado === "ok" ? data.tablero : undefined;

  // R52/R63 — la memoria de qué tarjetas SE HAN VISTO, y por qué hace falta.
  //
  // Hay dos situaciones que se parecen y que exigen respuestas opuestas:
  //   - la tarjeta estaba y DESAPARECIÓ en un refresco → el panel se cierra con aviso (R52);
  //   - la tarjeta NUNCA estuvo, porque el id llegó en la URL compartida y no existe, es de
  //     otra zona o no tiene órdenes hoy → el panel se queda ABIERTO y vacío, con el aviso
  //     genérico del propio panel (R62/R63). Cerrarlo aquí sería contarle al visitante que
  //     "eso no está", que es la mitad de la fuga que R42 persigue.
  // Un `ref` y no un `state`: es memoria entre renders, no algo que se pinte.
  const vistas = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!mensajeroSeleccionadoId || !tablero) return;
    const presente = tablero.filas.some(
      (fila: FilaTableroDia) => fila.mensajeroId === mensajeroSeleccionadoId,
    );
    if (presente) {
      vistas.current.add(mensajeroSeleccionadoId);
      return;
    }
    if (!vistas.current.has(mensajeroSeleccionadoId)) return;
    // La marca NO se retira: una tarjeta que ya se vio en esta sesión no puede volver a
    // comportarse como "id desconocido de la URL", porque su existencia ya no es un secreto
    // para quien está mirando. (Y el guardia de R59 censa `.delete(` en todo el árbol de la
    // feature: aquí sería un falso positivo, pero la alternativa correcta es no necesitarlo.)
    setAvisoDesaparecido(true);
    router.replace(pathname, { scroll: false });
  }, [mensajeroSeleccionadoId, tablero, router, pathname]);

  const seleccionar = (mensajeroId: string) => {
    setAvisoDesaparecido(false);
    const parametros = new URLSearchParams(searchParams.toString());
    parametros.set(PARAM_MENSAJERO, mensajeroId);
    // `replace` y no `push`: la selección es un estado de la vista, no un paso de navegación.
    // Con `push`, cerrar el panel con el botón "atrás" del navegador dejaría la URL a medias.
    router.replace(`${pathname}?${parametros.toString()}`, { scroll: false });
  };

  const cerrarDetalle = () => {
    // Se reconstruye sin la clave en vez de borrarla del objeto: el resto de parámetros de la
    // URL (los que traiga el enlace) sobreviven, que es lo que hace que cerrar el panel sea
    // volver al tablero y no perder la vista.
    const parametros = new URLSearchParams(
      [...searchParams.entries()].filter(([clave]) => clave !== PARAM_MENSAJERO),
    );
    const cadena = parametros.toString();
    router.replace(cadena ? `${pathname}?${cadena}` : pathname, { scroll: false });
  };

  // El nombre del mensajero sale del tablero YA CARGADO, no de una consulta aparte: el panel
  // no necesita pedir nada para titularse. Si la tarjeta no está (entrada por URL, R63), el
  // panel se titula en genérico y no revela nada.
  const filaSeleccionada = tablero?.filas.find(
    (fila: FilaTableroDia) => fila.mensajeroId === mensajeroSeleccionadoId,
  );

  if (data?.estado === "denegado") {
    return <AvisoDenegado />;
  }

  // Todavía no hay NADA que pintar. Distinto de "hay dato y está vacío" (R33), que se dice con
  // su propio estado, y de "el refresco falló" (R32), que conserva las tarjetas de antes.
  if (!tablero) {
    return error ? <TableroDiaAvisoRefresco /> : <TableroDiaSkeleton />;
  }

  return (
    <div className="flex flex-col gap-4" data-slot="tablero-dia">
      {/* R34 — la antigüedad se mide contra `generadoAt` (cuándo se leyó el dato de la base),
          nunca contra el instante del render: con caché de 15 s sobre refresco de 30 s el peor
          caso real es de ~45 s, y la pantalla tiene que decirlo. */}
      <TableroDiaCabecera
        fecha={tablero.fecha}
        generadoAt={tablero.generadoAt}
        ahora={ahora}
      />

      {/* R32 — el aviso ACOMPAÑA a los datos viejos; no los sustituye ni los pone a cero. */}
      {error ? <TableroDiaAvisoRefresco /> : null}
      {avisoDesaparecido ? <AvisoTarjetaDesaparecida /> : null}

      {tablero.filas.length === 0 ? (
        <TableroDiaVacio />
      ) : (
        <>
          <TableroDiaTotales totales={tablero.totales} />
          <TableroDiaRejilla
            filas={tablero.filas}
            onSeleccionar={seleccionar}
            mensajeroSeleccionadoId={mensajeroSeleccionadoId}
          />
        </>
      )}

      {/* El panel se monta SIEMPRE, y su consulta sólo arranca cuando hay selección (R56).
          Montarlo aquí —hermano del tablero, no encima— es lo que hace que abrirlo y cerrarlo
          no desmonte el módulo ni reinicie el ciclo de SWR (R50). */}
      <DetalleMensajeroPanel
        mensajeroId={mensajeroSeleccionadoId}
        mensajeroNombre={filaSeleccionada?.mensajeroNombre}
        onCerrar={cerrarDetalle}
      />
    </div>
  );
}

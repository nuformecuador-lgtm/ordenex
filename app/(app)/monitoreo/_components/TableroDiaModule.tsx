"use client";

// Feature 192 (F2.1/F2.5/F6.1/F6.3) + Feature 258 (F2.2/F4.3/F4.4) — EL MÓDULO DEL TABLERO.
//
// Es el único componente de la feature que habla con el servidor, y lo hace por **Server
// Action + SWR**, nunca con `fetch` a una ruta de API interna: una ruta API sería una
// superficie pública nueva que habría que autenticar por su cuenta.
//
// Cinco cosas viven aquí y en ningún otro sitio:
//
//  1. **El ciclo de refresco** (R8): 30 s, con `keepPreviousData` para que un fallo no borre
//     lo que ya se está leyendo (R9).
//  2. **La selección**, que vive en la URL (`?mensajero=<id>`, R7) y no en un `useState`: así
//     la vista es enlazable y compartible. Se escribe con `router.replace` para no llenar el
//     historial de pasos atrás por cada tarjeta pulsada.
//  3. **La coherencia entre el tablero y el detalle** (R38): el tablero sigue refrescándose con
//     el modal abierto, y si la tarjeta que se está mirando desaparece de un refresco, el
//     modal se cierra CON AVISO en vez de quedarse enseñando un detalle sin tarjeta detrás.
//  4. **El filtro por nombre y la densidad** (Feature 258, R39–R45). Son estado de
//     PRESENTACIÓN: ni uno ni otro consultan, reordenan ni cambian una cifra.
//     ⛔ **El filtro NO va a la URL** (R73): el único parámetro de la ruta sigue siendo
//     `?mensajero=`.
//  5. **El recálculo de los totales cuando hay filtro** (R43/R65), con la MISMA
//     `sumarTotalesTablero` que usa el servicio. Aquí no se escribe una segunda suma.
//
// ⛔ **El detalle NO se pide desde aquí** (R11). El tablero carga sólo los conteos; la consulta
// del detalle la dispara el panel, y sólo cuando hay un mensajero seleccionado. Cargarlo "por
// si acaso" para las 15 tarjetas sería exactamente la deuda que R11/R12 evitan.

import { Info, Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { leerTableroDia } from "@/lib/actions/tablero-dia";
import { sumarTotalesTablero, type FilaTableroDia } from "@/lib/types/tablero-dia";

import { DENSIDAD_INICIAL, type DensidadTablero } from "./densidad";
import { DetalleMensajeroPanel } from "./DetalleMensajeroPanel";
import { filtrarFilas, hayFiltroActivo } from "./filtrar-mensajeros";
import { TableroDiaCabecera, useAhoraCadaSegundo } from "./TableroDiaCabecera";
import { TableroDiaControles } from "./TableroDiaControles";
import {
  TableroDiaAvisoRefresco,
  TableroDiaSinCoincidencias,
  TableroDiaSkeleton,
  TableroDiaVacio,
} from "./TableroDiaEstados";
import { ordenarFilasTablero, TableroDiaRejilla } from "./TableroDiaRejilla";
import { TableroDiaTotales } from "./TableroDiaTotales";

/** R8 — decisión humana: 30 s. Vive junto al `useSWR` que lo consume, no esparcido. */
const REFRESCO_MS = 30_000;

/** R7 — el nombre del parámetro de la URL. Un solo literal: lo leen y lo escriben los dos. */
export const PARAM_MENSAJERO = "mensajero";

const DENEGADO_TITULO = "No tenés acceso a este tablero";
const DENEGADO_DESCRIPCION =
  "Tu cuenta no puede consultar las órdenes por mensajero del día. Si creés que debería, pedí acceso a un administrador.";

const DESAPARECIDO_TITULO = "Se cerró el detalle";
// FEATURE 259 (T7.2) — R24/R25: «asignadas hoy» → «asignadas PARA hoy». Este es el CUARTO sitio,
// el que no estaba en la pregunta original: dejarlo haría que la misma pantalla dijera dos cosas
// distintas —el vacío y la tarjeta hablando del día para el que se asignó, y este aviso del día
// en que se asignó— sobre exactamente el mismo conteo.
const DESAPARECIDO_DESCRIPCION =
  "El mensajero que estabas viendo ya no tiene órdenes asignadas para hoy dentro de tu alcance, así que su tarjeta salió del tablero.";

/**
 * R2/R3 — un denegado se dice, NUNCA se pinta como un tablero de ceros. Son dos cosas
 * distintas y confundirlas hace que un supervisor crea que hoy no hay trabajo asignado.
 *
 * Icono `Lock` (R24/R25): es un NO cerrado y sin remedio desde aquí. No es un aviso de cuidado
 * (el triángulo del refresco fallido) ni una explicación (la «i» del detalle que se cerró).
 * Va como PRIMER HIJO del `Alert` para que la primitiva forme su rejilla de dos columnas (R27).
 */
export function AvisoDenegado() {
  return (
    <Alert data-slot="tablero-dia-denegado" variant="destructive">
      <Lock aria-hidden="true" />
      <AlertTitle>{DENEGADO_TITULO}</AlertTitle>
      <AlertDescription>{DENEGADO_DESCRIPCION}</AlertDescription>
    </Alert>
  );
}

/**
 * R38 — el detalle se cerró solo porque su tarjeta desapareció. Se dice; no se cierra a secas.
 *
 * Icono `Info` y `Alert` por DEFECTO, no `destructive`: no pasó nada malo, se explica POR QUÉ
 * se cerró. En rojo, el supervisor creería que perdió algo.
 */
export function AvisoTarjetaDesaparecida() {
  return (
    <Alert data-slot="tablero-dia-aviso-desaparecido">
      <Info aria-hidden="true" />
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

  // R7 — la selección SALE de la URL. No hay un `useState` espejo que pueda desincronizarse:
  // pulsar una tarjeta escribe el parámetro, y lo que se pinta es siempre lo que dice la URL.
  const mensajeroSeleccionadoId = searchParams.get(PARAM_MENSAJERO);

  const [avisoDesaparecido, setAvisoDesaparecido] = useState(false);

  // R73 — el filtro y la densidad NO son estado de la ruta: viven aquí y sólo aquí.
  const [filtro, setFiltro] = useState("");
  const [densidad, setDensidad] = useState<DensidadTablero>(DENSIDAD_INICIAL);

  const { data, error } = useSWR("tablero-dia", () => leerTableroDia(), {
    refreshInterval: REFRESCO_MS, // R8
    keepPreviousData: true, // R9
  });

  const tablero = data?.estado === "ok" ? data.tablero : undefined;

  // R38/R13 — la memoria de qué tarjetas SE HAN VISTO, y por qué hace falta.
  //
  // Hay dos situaciones que se parecen y que exigen respuestas opuestas:
  //   - la tarjeta estaba y DESAPARECIÓ en un refresco → el detalle se cierra con aviso (R38);
  //   - la tarjeta NUNCA estuvo, porque el id llegó en la URL compartida y no existe, es de
  //     otra zona o no tiene órdenes hoy → el modal se queda ABIERTO y vacío, con el aviso
  //     genérico del propio panel (R13/R38). Cerrarlo aquí sería contarle al visitante que
  //     "eso no está", que es la mitad de la fuga que el borde persigue.
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
    // para quien está mirando.
    setAvisoDesaparecido(true);
    router.replace(pathname, { scroll: false });
  }, [mensajeroSeleccionadoId, tablero, router, pathname]);

  const seleccionar = (mensajeroId: string) => {
    setAvisoDesaparecido(false);
    const parametros = new URLSearchParams(searchParams.toString());
    parametros.set(PARAM_MENSAJERO, mensajeroId);
    // `replace` y no `push`: la selección es un estado de la vista, no un paso de navegación.
    // Con `push`, cerrar el detalle con el botón "atrás" del navegador dejaría la URL a medias.
    router.replace(`${pathname}?${parametros.toString()}`, { scroll: false });
  };

  const cerrarDetalle = () => {
    // Se reconstruye sin la clave en vez de borrarla del objeto: el resto de parámetros de la
    // URL (los que traiga el enlace) sobreviven, que es lo que hace que cerrar el detalle sea
    // volver al tablero y no perder la vista.
    const parametros = new URLSearchParams(
      [...searchParams.entries()].filter(([clave]) => clave !== PARAM_MENSAJERO),
    );
    const cadena = parametros.toString();
    router.replace(cadena ? `${pathname}?${cadena}` : pathname, { scroll: false });
  };

  // El nombre del mensajero sale del tablero YA CARGADO, no de una consulta aparte: el detalle
  // no necesita pedir nada para titularse. Si la tarjeta no está (entrada por URL), se titula
  // en genérico y no revela nada.
  const filaSeleccionada = tablero?.filas.find(
    (fila: FilaTableroDia) => fila.mensajeroId === mensajeroSeleccionadoId,
  );

  // R6/R40 — se ORDENA primero y se FILTRA después. Nunca al revés: el orden es del dato y no
  // puede depender de qué se esté buscando.
  const filtroActivo = hayFiltroActivo(filtro);
  // El `?? []` va DENTRO del `useMemo` a propósito: fuera crearía un array nuevo en cada
  // render mientras el tablero no ha llegado, y la memoización no memoizaría nada.
  const filasVisibles = useMemo(
    () => filtrarFilas(ordenarFilasTablero(tablero?.filas ?? []), filtro),
    [tablero, filtro],
  );

  // R43/R65 — con filtro, los totales son los de las tarjetas VISIBLES, sumados con la MISMA
  // función que usa el servicio. Sin filtro se conservan los del servidor tal cual: son el
  // mismo número por construcción, y no recalcularlos deja el camino de siempre intacto.
  const totales =
    filtroActivo && tablero ? sumarTotalesTablero(filasVisibles) : tablero?.totales;

  if (data?.estado === "denegado") {
    return <AvisoDenegado />;
  }

  // Todavía no hay NADA que pintar. Distinto de "hay dato y está vacío", que se dice con su
  // propio estado, y de "el refresco falló", que conserva las tarjetas de antes.
  if (!tablero || !totales) {
    return error ? <TableroDiaAvisoRefresco /> : <TableroDiaSkeleton />;
  }

  return (
    <div className="flex flex-col gap-4" data-slot="tablero-dia">
      {/* R10 — la antigüedad se mide contra `generadoAt` (cuándo se leyó el dato de la base),
          nunca contra el instante del render: con caché de 15 s sobre refresco de 30 s el peor
          caso real es de ~45 s, y la pantalla tiene que decirlo. */}
      <TableroDiaCabecera
        fecha={tablero.fecha}
        generadoAt={tablero.generadoAt}
        ahora={ahora}
      />

      {/* R9 — el aviso ACOMPAÑA a los datos viejos; no los sustituye ni los pone a cero. */}
      {error ? <TableroDiaAvisoRefresco /> : null}
      {avisoDesaparecido ? <AvisoTarjetaDesaparecida /> : null}

      {tablero.filas.length === 0 ? (
        <TableroDiaVacio />
      ) : (
        <>
          <TableroDiaControles
            filtro={filtro}
            onFiltroChange={setFiltro}
            densidad={densidad}
            onDensidadChange={setDensidad}
          />

          <TableroDiaTotales
            totales={totales}
            ritmoEntregas={tablero.ritmoEntregas}
            filtrado={filtroActivo}
            visibles={filasVisibles.length}
            total={tablero.filas.length}
            densidad={densidad}
          />

          {/* R42 — el vacío del FILTRO es suyo, no el del día: otro texto, otro `data-slot` y
              una salida para quitarlo. El día sí tiene órdenes; lo que no encuentra nada es
              lo que se escribió. */}
          {filasVisibles.length === 0 ? (
            <TableroDiaSinCoincidencias onQuitarFiltro={() => setFiltro("")} />
          ) : (
            <TableroDiaRejilla
              filas={filasVisibles}
              onSeleccionar={seleccionar}
              mensajeroSeleccionadoId={mensajeroSeleccionadoId}
              densidad={densidad}
            />
          )}
        </>
      )}

      {/* El detalle se monta SIEMPRE, y su consulta sólo arranca cuando hay selección (R11).
          Montarlo aquí —hermano del tablero, no encima— es lo que hace que abrirlo y cerrarlo
          no desmonte el módulo ni reinicie el ciclo de SWR (R33). */}
      <DetalleMensajeroPanel
        mensajeroId={mensajeroSeleccionadoId}
        mensajeroNombre={filaSeleccionada?.mensajeroNombre}
        onCerrar={cerrarDetalle}
      />
    </div>
  );
}

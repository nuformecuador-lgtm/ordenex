"use client";

import { useMemo, useState } from "react";

import type { MensajeroFiltroDTO } from "@/lib/types/filtros-ordenes";
import type {
  FiltroHilosHistorico,
  HiloHistoricoDTO,
  ListarHilosHistoricoInput,
  ListarHilosHistoricoResult,
  ListarMensajesHistoricoInput,
  ListarMensajesHistoricoResult,
} from "@/lib/types/historico-conversaciones";
import {
  listarHilosHistorico,
  listarMensajesHistorico,
} from "@/lib/actions/historico-conversaciones";

import { HilosLista, claveHilo } from "./HilosLista";
import { HistoricoFiltrosBar } from "./HistoricoFiltrosBar";
import { HistoricoHilo } from "./HistoricoHilo";

// Feature 321 / bloques 5 y 6 (design §5.1) — el MÓDULO de cliente del histórico.
//
//   page.tsx (server, gate)
//     └─ HistoricoConversacionesModule   ← esto
//          ├─ HistoricoFiltrosBar
//          ├─ HilosLista        (scroll infinito, R13/R41)
//          └─ HistoricoHilo     (burbujas + separador de día + scroll inverso, R18-R23)
//
// QUÉ VIVE AQUÍ Y POR QUÉ:
//
//   - **El `filtro` completo.** La barra emite por dos caminos (el término del campo y la
//     selección de los controles) porque son dos controles con debounce y reglas propias;
//     juntarlos es responsabilidad del dueño del filtro, que es este módulo.
//   - **El hilo abierto.** Arranca en `null`, y eso NO es una precaución: es R41. Con `null`,
//     la clave de SWR de `HistoricoHilo` es `null` y no se pide ni un mensaje.
//   - **`ahora`.** Se fija UNA vez por montaje y se pasa hacia abajo. Un separador que lee el
//     reloj en cada render cambiaría de «hoy» a «ayer» a media lectura, a medianoche de CR, y
//     además haría imposible fijar la frontera en un test.
//
// LAS REMONTADAS SON DELIBERADAS. `HilosLista` lleva `key` derivada del filtro y
// `HistoricoHilo` lleva `key` del par `(orden, mensajero)`: al cambiar cualquiera de los dos,
// el componente se remonta y sus páginas acumuladas se van solas. La alternativa —un
// `useEffect` que vigile el filtro para vaciar el estado— es exactamente lo que el lint del
// repo desaconseja y donde se cuelan los estados a medias (design §5.4).
//
// SOLO LECTURA (R24/R25): este módulo no importa `lib/actions/chat-whatsapp` —ni sus tipos:
// los que necesita están en `lib/types/chat-whatsapp`—, no monta formulario alguno y las dos
// únicas acciones que conoce son las DOS LECTURAS del histórico.

/** Las dos lecturas del histórico. Se inyectan para poder doblarlas en test. */
export interface HistoricoConversacionesAcciones {
  listarHilos: (input: ListarHilosHistoricoInput) => Promise<ListarHilosHistoricoResult>;
  listarMensajes: (
    input: ListarMensajesHistoricoInput,
  ) => Promise<ListarMensajesHistoricoResult>;
}

export interface HistoricoConversacionesModuleProps {
  /** Catálogo de mensajeros pre-cargado por la página (design §5.1). */
  mensajeros: MensajeroFiltroDTO[];
  /**
   * Dobles de las dos Server Actions. La página NUNCA las pasa —una función no cruza la
   * frontera RSC—, así que en producción siempre son las reales.
   */
  acciones?: Partial<HistoricoConversacionesAcciones>;
  /** Instante de lectura. Sólo lo pasan los tests, para fijar «hoy»/«ayer» (R23). */
  ahora?: Date;
  /** Espera de la barra de filtros. Sólo lo pasan los tests. */
  debounceMs?: number;
}

export function HistoricoConversacionesModule({
  mensajeros,
  acciones,
  ahora,
  debounceMs,
}: Readonly<HistoricoConversacionesModuleProps>) {
  const listarHilos = acciones?.listarHilos ?? listarHilosHistorico;
  const listarMensajes = acciones?.listarMensajes ?? listarMensajesHistorico;

  // Fijado AL MONTAR con el inicializador perezoso de `useState`: nadie lo cambia después, y
  // leerlo de una ref durante el render es un error de lint en este repo (`react-hooks/refs`).
  const [instanteMontaje] = useState(() => ahora ?? new Date());
  const instante = ahora ?? instanteMontaje;

  const [termino, setTermino] = useState("");
  const [filtrosControles, setFiltrosControles] = useState<FiltroHilosHistorico>({});
  const [seleccionado, setSeleccionado] = useState<{
    ordenId: string;
    mensajeroId: string;
  } | null>(null);

  /**
   * El filtro que viaja al servidor. El término manda sobre `q` —lo emite el campo, no los
   * controles— y por debajo del mínimo la clave sencillamente no existe: el propio
   * `BuscadorFiltros` emite `""` mientras no llega al mínimo (R37).
   */
  const filtro = useMemo<FiltroHilosHistorico>(() => {
    const compuesto: FiltroHilosHistorico = { ...filtrosControles };
    delete compuesto.q;
    if (termino !== "") compuesto.q = termino;
    return compuesto;
  }, [filtrosControles, termino]);

  /** R39 — hay rango de fecha puesto en el LISTADO (el hilo abierto no se recorta, R17). */
  const rangoFechaAplicado =
    filtro.fecha_desde !== undefined || filtro.fecha_hasta !== undefined;

  function abrirHilo(hilo: HiloHistoricoDTO) {
    setSeleccionado({ ordenId: hilo.ordenId, mensajeroId: hilo.mensajeroId });
  }

  return (
    <div
      data-testid="historico-conversaciones"
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      <HistoricoFiltrosBar
        mensajeros={mensajeros}
        onBuscar={setTermino}
        onFiltrosChange={setFiltrosControles}
        ahora={instante}
        debounceMs={debounceMs}
      />

      {/* ALTO FIJO (pedido humano 2026-08-31). `flex-1` + `min-h-0` NO acotan nada aqui: la
          cadena de padres hasta el `<body>` no tiene ninguna altura fija, asi que `flex-1` se
          resolvia por el CONTENIDO y los dos paneles crecian con cada pagina cargada —el alto
          de la pantalla iba aumentando sin limite y el scroll era el de la pagina entera—.
          Aqui se fija el alto de la fila UNA vez, con el hueco que queda bajo el encabezado y
          la barra de filtros, y a partir de ahi lo que se mueve es el CONTENIDO de cada panel:
          la lista de hilos y el hilo abierto scrollean cada uno por dentro. `min-h` para que en
          una pantalla muy baja el hilo no quede reducido a dos lineas. */}
      <div className="grid h-[calc(100dvh-16rem)] min-h-[24rem] gap-3 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <HilosLista
          key={JSON.stringify(filtro)}
          filtro={filtro}
          listar={listarHilos}
          seleccionado={seleccionado}
          onSeleccionar={abrirHilo}
          ahora={instante}
        />
        <HistoricoHilo
          key={seleccionado === null ? "sin-hilo" : claveHilo(seleccionado)}
          hilo={seleccionado}
          listar={listarMensajes}
          ahora={instante}
          rangoFechaAplicado={rangoFechaAplicado}
        />
      </div>
    </div>
  );
}

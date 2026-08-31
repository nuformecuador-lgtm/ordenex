"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FiltroDisponible } from "@/components/shared/BuscadorFiltros";
import type { FilterDef, FilterSelection } from "@/components/shared/FilterComponent";
import type { ListarNovedadesCompletoActionResult } from "@/lib/actions/novedades";
import type { NovedadDTO } from "@/lib/types/novedad";
import type { GrupoNovedad } from "@/lib/types/novedad-grupo";

import {
  construirFiltrosNovedades,
  filtrarNovedades,
  hayValoresSeleccionados,
} from "./novedades-filtros";

// FICHA 325 — EL ESTADO DE LA BARRA DE `/novedades`, Y DONDE SE FILTRA.
//
// ⚠️ **SE FILTRA EN EL CLIENTE, SOBRE EL CONJUNTO ENTERO. NO SOBRE LA PAGINA VISIBLE.** Es LA
// decision de esta ficha y se toma sobre una medicion del codigo, no sobre una impresion:
//
//  - `lib/actions/novedades.ts` fija `PAGE_SIZE = 10` y las cuatro lecturas de pagina lo pasan al
//    servicio, que recorta con `skip`/`take`;
//  - `app/(app)/novedades/page.tsx` pre-carga UNICAMENTE la pagina 1 de cada grupo;
//  - `NovedadesModule` relee pagina a pagina por Server Action.
//
// Es decir: `items` son DIEZ de `total`. Filtrar `items` habria dicho «ninguna coincide» con la
// orden buscada esperando en la pagina 3, que es exactamente la clase de mentira que este repo
// persigue. Y filtrar en SERVIDOR habria pedido un termino nuevo en el borde, en el servicio y en
// el repositorio: backend, y esta ficha es de presentacion.
//
// La salida es la lectura que YA EXISTE y que esta misma pantalla ya dispara: `listarCompleto`, la
// del boton de descarga. Su contrato dice literalmente que es «el MISMO listado que `listar`, SIN
// recorte por pagina… mismo predicado, mismo alcance, mismo orden y la MISMA proyeccion a DTO que
// la pagina», asi que el conjunto sobre el que filtramos no puede divergir de lo que la pantalla
// pagina. El tope lo evalua el SERVIDOR (`descargaConfig.MAX_FILAS`, 5000) y aqui se respeta: si lo
// supera, la barra lo DICE y no filtra — jamas sobre un conjunto truncado.
//
// ⚠️ **PEREZOSO A PROPOSITO, Y DISPARADO POR EL GESTO, NO POR UN EFECTO.** El conjunto se pide la
// PRIMERA vez que alguien usa la barra (teclea algo o pide un filtro desde el selector), desde el
// propio manejador del evento. Una visita que no busca nada —que son casi todas— cuesta exactamente
// lo que costaba ayer: cero lecturas nuevas, y la pantalla sin filtro sigue siendo la de siempre,
// paginada por el servidor. Pedirlo al montar habria añadido DOS lecturas completas a cada visita
// de `/novedades` (las dos pestañas viven montadas a la vez, `keepMounted`) para una capacidad que
// la mayoria no usa en esa visita.
//
// ⚠️ **EL ESTADO ES DE CADA PESTAÑA, NO COMPARTIDO**, y tampoco es casualidad. El modulo se monta
// DOS VECES (una por grupo) y cada instancia tiene su propio hook, asi que cambiar de pestaña
// nunca arrastra el filtro de la otra. Compartirlo habria producido justo el fallo a evitar:
// filtrar «Causa de devolución = Dirección errada» y pasar a «Ayuda solicitada» —donde la causa es
// SIEMPRE `null` por contrato— habria dejado una lista vacia sin nada en pantalla que lo
// explicara. Y ni siquiera son los mismos campos: cada grupo declara un filtro propio.

/**
 * En que punto esta la lectura del conjunto completo.
 *
 *  - `ocioso`: nadie ha usado la barra todavia; no se ha pedido nada.
 *  - `cargando`: pedida y en vuelo.
 *  - `listo`: en memoria; la barra filtra de verdad.
 *  - `excedido`: el servidor dice que hay mas filas que el tope; NO llegaron filas y no se filtra.
 *  - `error`: la lectura fallo (sesion, permiso, red); no se filtra.
 */
export type EstadoConjunto = "ocioso" | "cargando" | "listo" | "excedido" | "error";

export interface NovedadesFiltro {
  /** Lo que el selector OFRECE, por clave y etiqueta. */
  ofrecidos: FiltroDisponible[];
  /** Los controles de los filtros PEDIDOS, ya declarados y en el orden en que se ofrecen. */
  montados: FilterDef[];
  /** Claves pedidas desde el selector (controladas por el consumidor). */
  activos: string[];
  onActivosChange: (keys: string[]) => void;
  /** Termino ya recortado que emite `BuscadorFiltros` (`""` = sin busqueda). */
  onTerminoChange: (termino: string) => void;
  onSeleccionChange: (seleccion: FilterSelection) => void;
  /** Contador de remonte: cambia con «Limpiar todo» para dejar los controles vacios. */
  reset: number;
  /** ¿Hay algo que limpiar? (control pedido o valor elegido; el texto lo sabe la propia barra). */
  hayFiltrosAplicados: boolean;
  /** Deja la barra como recien abierta. */
  limpiar: () => void;
  /** ¿La barra esta ACOTANDO la lista ahora mismo? Un control pedido y sin marcar NO acota. */
  filtrando: boolean;
  /**
   * ¿Alguien ha TOCADO la barra? Mas ancho que `filtrando`: incluye pedir un control y no marcarlo.
   * Lo lee el estado vacio, que con la barra en uso NO puede seguir diciendo «no tenés órdenes».
   */
  barraEnUso: boolean;
  estado: EstadoConjunto;
  /** El conjunto completo YA filtrado. Solo significa algo con `filtrando` y `estado === "listo"`. */
  resultados: NovedadDTO[];
  /** Pagina del resultado filtrado (1-based). */
  pagina: number;
  irAPagina: (pagina: number) => void;
  /** Quita una orden del conjunto en memoria: espejo de `sacarDeLaLista` de la pagina. */
  quitar: (ordenId: string) => void;
  /** Relee el conjunto completo si ya estaba cargado; si no, no hace nada. */
  recargar: () => Promise<void>;
  /** Vuelve a intentar la lectura que fallo. Sin efecto si no hubo fallo. */
  reintentar: () => void;
  /** Conteos del tope, cuando el servidor devolvio `limite_excedido`. */
  limite: { total: number; limite: number } | null;
}

export function useNovedadesFiltro(
  grupo: GrupoNovedad,
  listarCompleto: () => Promise<ListarNovedadesCompletoActionResult>,
): NovedadesFiltro {
  const [termino, setTermino] = useState("");
  const [seleccion, setSeleccion] = useState<FilterSelection>({});
  const [activos, setActivos] = useState<string[]>([]);
  const [reset, setReset] = useState(0);
  const [pagina, setPagina] = useState(1);

  const [conjunto, setConjunto] = useState<NovedadDTO[] | null>(null);
  const [estado, setEstado] = useState<EstadoConjunto>("ocioso");
  const [limite, setLimite] = useState<{ total: number; limite: number } | null>(null);

  // Resolver sobre un arbol ya desmontado seria un setState en la nada. El unico efecto del hook
  // no toca estado: solo baja esta bandera al desmontar.
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  /**
   * ¿Ya se pidio el conjunto? Vive en un REF y no en el estado porque su unico trabajo es evitar
   * una segunda peticion dentro del mismo ciclo de eventos: la primera pulsacion pone el termino y
   * dispara la lectura, y la segunda —que llega antes de que React repinte— no debe disparar otra.
   * Comparar contra `estado` no serviria: ahi todavia diria `ocioso`.
   */
  const pedido = useRef(false);

  const aplicarResultado = useCallback((res: ListarNovedadesCompletoActionResult) => {
    if (!montado.current) return;
    if (res.status === "ok") {
      setConjunto(res.items);
      setEstado("listo");
      return;
    }
    setConjunto(null);
    if (res.status === "limite_excedido") {
      // R27/R28 del contrato: llegan CONTEOS, nunca filas ni un conjunto truncado. Filtrar sobre
      // lo que no vino seria inventar el resultado.
      setLimite({ total: res.total, limite: res.limite });
      setEstado("excedido");
      return;
    }
    setEstado("error");
  }, []);

  /**
   * Pide el conjunto entero UNA vez. Se llama desde los manejadores de la barra —no desde un
   * efecto—: la lectura es la respuesta a un gesto del usuario, no una sincronizacion con un
   * sistema externo.
   */
  const pedirConjunto = useCallback(() => {
    if (pedido.current) return;
    pedido.current = true;
    setEstado("cargando");
    listarCompleto()
      .then(aplicarResultado)
      .catch(() => {
        // Una Server Action puede lanzar (red caida, despliegue en curso). No se traga en
        // silencio: el estado `error` es lo que hace que la barra lo diga en pantalla.
        if (montado.current) setEstado("error");
      });
  }, [listarCompleto, aplicarResultado]);

  const onTerminoChange = useCallback(
    (siguiente: string) => {
      setTermino(siguiente);
      if (siguiente !== "") pedirConjunto();
    },
    [pedirConjunto],
  );

  /**
   * Pedir un control desde el selector YA dispara la lectura, aunque todavia no acote nada: el
   * control necesita SUS OPCIONES y las opciones salen del conjunto. Si se esperara a que el
   * usuario marcara a alguien, el desplegable se abriria vacio.
   */
  const onActivosChange = useCallback(
    (keys: string[]) => {
      setActivos(keys);
      if (keys.length > 0) pedirConjunto();
    },
    [pedirConjunto],
  );

  const filtrando = termino !== "" || hayValoresSeleccionados(seleccion);
  const barraEnUso = termino !== "" || activos.length > 0;

  const resultados = useMemo(
    () => (conjunto === null ? [] : filtrarNovedades(conjunto, termino, seleccion)),
    [conjunto, termino, seleccion],
  );

  // Cambiar lo buscado devuelve a la primera pagina del resultado: quedarse en la 3 de un
  // resultado que ahora tiene una pagina enseñaria una lista vacia con la paginacion detras.
  //
  // Se ajusta DURANTE el render y no en un efecto, que es el mismo patron —y por el mismo motivo—
  // que usan `TextFilter` y `DateRangeFilter` para su limpieza externa: un efecto pintaria primero
  // la pagina vieja sobre el resultado nuevo y corregiria despues.
  const [filtroPrevio, setFiltroPrevio] = useState({ termino, seleccion });
  if (filtroPrevio.termino !== termino || filtroPrevio.seleccion !== seleccion) {
    setFiltroPrevio({ termino, seleccion });
    setPagina(1);
  }

  const declarados = useMemo(
    () => construirFiltrosNovedades(grupo, conjunto),
    [grupo, conjunto],
  );
  const ofrecidos = useMemo(
    () => declarados.map((f) => ({ key: f.key, label: f.label })),
    [declarados],
  );
  // En el orden en que se DECLARAN, no en el de los clics: asi los controles no bailan de sitio
  // segun como se hayan ido pidiendo.
  const montados = useMemo(
    () => declarados.filter((f) => activos.includes(f.key)),
    [declarados, activos],
  );

  const limpiar = useCallback(() => {
    setTermino("");
    setSeleccion({});
    // Tambien se retiran los controles PEDIDOS: «limpiar todo» es volver al punto de partida, y
    // una barra que se queda con cuatro controles vacios no lo es.
    setActivos([]);
    setReset((n) => n + 1);
  }, []);

  const quitar = useCallback((ordenId: string) => {
    setConjunto((prev) => (prev === null ? prev : prev.filter((n) => n.id !== ordenId)));
  }, []);

  const recargar = useCallback(async () => {
    if (!pedido.current || estado !== "listo") return;
    try {
      aplicarResultado(await listarCompleto());
    } catch {
      if (montado.current) setEstado("error");
    }
  }, [estado, listarCompleto, aplicarResultado]);

  /** Vuelve a permitir la peticion y la lanza. Solo tiene sentido tras un fallo. */
  const reintentar = useCallback(() => {
    if (estado !== "error") return;
    pedido.current = false;
    setEstado("ocioso");
    pedirConjunto();
  }, [estado, pedirConjunto]);

  return {
    ofrecidos,
    montados,
    activos,
    onActivosChange,
    onTerminoChange,
    onSeleccionChange: setSeleccion,
    reset,
    hayFiltrosAplicados: activos.length > 0 || hayValoresSeleccionados(seleccion),
    limpiar,
    filtrando,
    barraEnUso,
    estado,
    resultados,
    pagina,
    irAPagina: setPagina,
    quitar,
    recargar,
    reintentar,
    limite,
  };
}

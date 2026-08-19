"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Deja un texto comparable: sin mayusculas, sin acentos y sin espacios sobrantes.
 *
 * Los acentos se quitan a proposito (`NFD` + poda de diacriticos): en un tablero con
 * «Analitica» y «Cantón» a nadie se le puede exigir que teclee la tilde para encontrar
 * su seccion, y sin esto «canton» no encontraria «Cantón».
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

/**
 * ¿Este titulo responde a lo tecleado? Subcadena, no prefijo: quien escribe «operativos»
 * espera encontrar «Indicadores operativos», que es como se busca de verdad.
 *
 * Termino vacio = TODO coincide. No es un detalle: es lo que hace que la pagina sin nada
 * escrito se vea exactamente igual que antes de existir este filtro.
 */
export function coincideSeccion(titulo: string, termino: string): boolean {
  const buscado = normalizar(termino);
  return buscado === "" || normalizar(titulo).includes(buscado);
}

interface FiltroSeccionesValor {
  readonly termino: string;
  readonly setTermino: (termino: string) => void;
  /** Titulos de las secciones montadas AHORA. Alta y baja las declara cada seccion. */
  readonly titulos: readonly string[];
  readonly registrar: (titulo: string) => () => void;
}

const SIN_PROVEEDOR: FiltroSeccionesValor = {
  termino: "",
  setTermino: () => {},
  titulos: [],
  registrar: () => () => {},
};

/**
 * Sin proveedor el contexto vale «no hay filtro»: termino vacio y altas que no hacen
 * nada. Asi una `SeccionFiltrable` montada fuera de un proveedor —el panel maestro, un
 * test— se pinta siempre, en vez de desaparecer sin que nadie sepa por que.
 */
const FiltroSeccionesContexto = createContext<FiltroSeccionesValor>(SIN_PROVEEDOR);

export function useFiltroSecciones(): FiltroSeccionesValor {
  return useContext(FiltroSeccionesContexto);
}

/**
 * Dueño del termino que filtra las SECCIONES de una pagina.
 *
 * Envuelve el arbol entero —no solo la barra— porque quien teclea y quien se oculta
 * viven en ramas distintas: en analitica la barra cuelga del slot `destacado` del shell
 * y las secciones cuelgan de los otros slots. Un proveedor que solo envolviera la barra
 * no seria ancestro de nadie a quien filtrar.
 */
export function FiltroSeccionesProvider({ children }: { readonly children: ReactNode }) {
  const [termino, setTermino] = useState("");
  const [titulos, setTitulos] = useState<readonly string[]>([]);

  // Alta al montar, baja al desmontar. El `includes` evita duplicar el titulo cuando
  // React monta dos veces el mismo efecto (StrictMode en desarrollo).
  const registrar = useCallback((titulo: string) => {
    setTitulos((previos) => (previos.includes(titulo) ? previos : [...previos, titulo]));
    return () => setTitulos((previos) => previos.filter((t) => t !== titulo));
  }, []);

  const valor = useMemo<FiltroSeccionesValor>(
    () => ({ termino, setTermino, titulos, registrar }),
    [termino, titulos, registrar],
  );

  return (
    <FiltroSeccionesContexto.Provider value={valor}>
      {children}
    </FiltroSeccionesContexto.Provider>
  );
}

export interface SeccionFiltrableProps {
  /**
   * Nombre por el que se la encuentra. Es el MISMO texto que la seccion pinta en su
   * encabezado: quien teclea lo que lee en pantalla espera que eso baste.
   */
  readonly titulo: string;
  readonly children: ReactNode;
}

/**
 * Una seccion que el buscador puede esconder. Envuelve el bloque ya montado —incluidos
 * los renderizados en el servidor, que cruzan como `children`— y lo retira del arbol
 * cuando el titulo no responde a lo tecleado.
 *
 * Se DESMONTA en vez de ocultarse con CSS: una seccion escondida con `hidden` sigue
 * consultando, sigue en el orden de tabulacion y sigue leyendose en un lector de
 * pantalla, que es justo lo que no quiere quien acaba de filtrarla.
 */
export function SeccionFiltrable({ titulo, children }: Readonly<SeccionFiltrableProps>) {
  const { termino, registrar } = useFiltroSecciones();

  useEffect(() => registrar(titulo), [registrar, titulo]);

  return coincideSeccion(titulo, termino) ? <>{children}</> : null;
}

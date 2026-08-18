"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";
import { guardarPreferenciaTema } from "@/lib/tema/preferencia-tema";
import {
  claseDeTema,
  resolverTemaDelSistema,
  suscribirTemaDelSistema,
  type Tema,
  type TemaElegido,
} from "@/lib/tema/tema";

/** El servidor no puede conocer `prefers-color-scheme`: declara que no sabe. */
const SIN_RESOLVER = () => null;

interface TemaContexto {
  /** `null` mientras no hay elección Y el cliente aún no ha resuelto qué pinta el CSS. */
  tema: TemaElegido;
  establecer: (tema: Tema) => void;
}

const Contexto = createContext<TemaContexto | null>(null);

/**
 * Feature 211 — dónde se estampa la clase del tema.
 *
 * Va en un ENVOLTORIO del portal, no en `<html>`: el CSS declara
 * `@custom-variant dark (&:is(.dark *))`, o sea DESCENDIENTES, así que un ancestro
 * cualquiera basta. Llevarla a `<html>` obligaría a leer la cookie en el layout raíz y
 * eso volvería dinámica también la landing pública, que hoy es estática y se cachea.
 *
 * El envoltorio es `display: contents` (`contents`): NO crea caja, así que el layout de
 * la app queda EXACTAMENTE como estaba —el `sidebar-wrapper` sigue siendo el hijo flex
 * del `<body>`— y aun así las variables CSS y el selector `.dark *` alcanzan a todo el
 * árbol. Al no crear caja tampoco pinta fondo, y por eso `globals.css` hace que el
 * `<body>` (que vive FUERA de este div) tome los mismos tokens con
 * `body:has(> .dark)`. Sin eso quedaría una franja clara alrededor de una app oscura.
 *
 * El estado vive en React, no en el DOM: pulsar el control cambia el tema en el mismo
 * frame, sin viaje al servidor. La cookie se escribe en paralelo para que la SIGUIENTE
 * carga ya llegue del servidor con la clase puesta (sin parpadeo).
 */
export function TemaProvider({
  temaInicial,
  children,
}: Readonly<{ temaInicial: TemaElegido; children: ReactNode }>) {
  // La ELECCIÓN. Inicializada con lo que resolvió el servidor desde la cookie: el primer
  // render del cliente coincide con el HTML recibido, así que no hay discrepancia de
  // hidratación. `null` = nadie ha elegido todavía.
  const [elegido, setElegido] = useState<TemaElegido>(temaInicial);

  // Lo que dice el SISTEMA OPERATIVO. `useSyncExternalStore` y no un efecto por dos
  // motivos concretos:
  //
  //  1. HIDRATACIÓN. Su tercer argumento es la respuesta del servidor (`null`, porque
  //     `prefers-color-scheme` no llega en ninguna cabecera que pidamos). React usa esa
  //     durante la hidratación y pasa a la del cliente después, sin marcar discrepancia.
  //     Resolverlo en el inicializador de `useState` sí la marcaría.
  //  2. EL SO CAMBIA SOLO. macOS y Windows giran a oscuro al anochecer. Con una lectura
  //     única, quien no ha elegido se quedaría con el tema que hubiera al abrir la
  //     pestaña; suscritos, la app le sigue.
  const delSistema = useSyncExternalStore(
    suscribirTemaDelSistema,
    resolverTemaDelSistema,
    SIN_RESOLVER,
  );

  // La elección MANDA sobre el sistema. Y mientras no haya ninguna de las dos —el HTML del
  // servidor— queda `null`, que es lo que estampa `tema-sistema` y deja decidir al CSS.
  const tema: TemaElegido = elegido ?? delSistema;

  const establecer = useCallback((siguiente: Tema) => {
    setElegido(siguiente);
    guardarPreferenciaTema(siguiente);
  }, []);

  const valor = useMemo<TemaContexto>(() => ({ tema, establecer }), [tema, establecer]);

  return (
    <Contexto.Provider value={valor}>
      <div className={cn("contents", claseDeTema(tema))} data-tema={tema ?? "sistema"}>
        {children}
      </div>
    </Contexto.Provider>
  );
}

/**
 * Sin proveedor devuelve un estado LOCAL en vez de lanzar. Motivo concreto: `PageHeader`
 * es presentación pura y hoy se monta suelto en 20 archivos de test; hacerlo obligatorio
 * convertiría un detalle de presentación en un requisito de todos ellos. En la aplicación
 * real el proveedor está siempre, y lo sostiene una guardia
 * (`tests/unit/guards/tema-envoltorio.guardia.test.ts`), no la confianza.
 */
export function useTema(): TemaContexto {
  const delProveedor = useContext(Contexto);
  const [temaLocal, setTemaLocal] = useState<TemaElegido>(null);
  const local = useMemo<TemaContexto>(
    () => ({
      tema: temaLocal,
      establecer: (siguiente: Tema) => {
        setTemaLocal(siguiente);
        guardarPreferenciaTema(siguiente);
      },
    }),
    [temaLocal],
  );
  return delProveedor ?? local;
}

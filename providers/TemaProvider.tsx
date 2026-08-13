"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";
import { guardarPreferenciaTema } from "@/lib/tema/preferencia-tema";
import { claseDeTema, TEMA_POR_DEFECTO, type Tema } from "@/lib/tema/tema";

interface TemaContexto {
  tema: Tema;
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
}: Readonly<{ temaInicial: Tema; children: ReactNode }>) {
  // `useState` inicializado con lo que resolvió el servidor: el primer render del cliente
  // coincide con el HTML recibido, así que no hay discrepancia de hidratación.
  const [tema, setTema] = useState<Tema>(temaInicial);

  const establecer = useCallback((siguiente: Tema) => {
    setTema(siguiente);
    guardarPreferenciaTema(siguiente);
  }, []);

  const valor = useMemo<TemaContexto>(() => ({ tema, establecer }), [tema, establecer]);

  return (
    <Contexto.Provider value={valor}>
      <div className={cn("contents", claseDeTema(tema))} data-tema={tema}>
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
  const [temaLocal, setTemaLocal] = useState<Tema>(TEMA_POR_DEFECTO);
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

import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { leerResumenesAyuda } from "@/lib/ayuda/catalogo";
import { documentosQuePuedeLeer, ROLES_AYUDA } from "@/lib/ayuda/documento";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

import { AyudaIndice } from "./_components/AyudaIndice";

/**
 * ⭑ FICHA 433 — el armazón del módulo de ayuda: índice a la izquierda, documento a la derecha.
 *
 * ⚠️ EL GATE LEE `ROLES_AYUDA`, LA MISMA CONSTANTE QUE EL ÍTEM DE MENÚ y que el acotamiento de
 * los documentos. El precedente es la ficha 335: dos listas de roles escritas a mano divergen
 * sin que nada se ponga rojo, y entonces hay un menú que ofrece una pantalla que devuelve 404
 * — o, peor, al revés. `apiKey` no pasa: es una cuenta de máquina y no navega la UI.
 *
 * EL `<h1>` DE LA PÁGINA ES «Ayuda», y lo pone el `PageHeader`. Los títulos del Markdown bajan
 * un nivel al renderizarse (`#` → `<h2>`) para que el esquema de encabezados sea correcto. No
 * se podía resolver ascendiendo el título del documento al `<h1>`:
 * `publico/entrar-y-recuperar-contrasena.md` tiene DOS `#` porque cubre dos pantallas.
 *
 * El índice se resuelve AQUÍ, en el layout, y no en cada página: así no se recalcula al
 * navegar entre documentos —el layout persiste entre navegaciones— y la lista no parpadea.
 *
 * ⭑ FICHA 435 — EL ÍNDICE SE LLENA CON `documentosQuePuedeLeer`, EL PREDICADO DE LECTURA, la
 * misma pregunta que el `notFound()` de `[...slug]/page.tsx`. Las dos tienen que ser LA MISMA
 * o se vuelve al modo de fallo de la 335 por otro camino: un índice que ofrece un enlace que
 * da 404, o un documento legible que no aparece en ninguna lista. Para la oficina son ahora
 * los 33 del catálogo; para los otros tres roles, exactamente los de antes.
 */
export default async function AyudaLayout({ children }: Readonly<{ children: ReactNode }>) {
  const actor = await resolveActorFromSession();
  if (actor === null || !(ROLES_AYUDA as readonly string[]).includes(actor.rol)) {
    notFound();
  }

  const documentos = documentosQuePuedeLeer(await leerResumenesAyuda(), actor.rol);

  return (
    <AppPage
      title="Ayuda"
      description="Cómo funciona cada pantalla, explicado para tu trabajo."
    >
      {/* Una sola columna en el teléfono y dos a partir de `lg`. El índice mide 17rem: cabe un
          título largo («Configuración · Plantillas») sin partirse, y deja el resto para la
          prosa. `minmax(0,…)` en las dos columnas para que una tabla ancha dentro del
          documento scrollee en su caja en vez de estirar la rejilla. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <AyudaIndice documentos={documentos} />
        {children}
      </div>
    </AppPage>
  );
}

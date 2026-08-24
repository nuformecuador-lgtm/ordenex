// FEATURE 260 (B3) — EL RECORTE DE FILAS DEL TABLERO DEL DIA, EN UN MODULO SIN DEPENDENCIAS.
//
// Este archivo declara UN tipo y no importa NADA. Las dos cosas son deliberadas.
//
// ── QUE ES ───────────────────────────────────────────────────────────────────────────────────
// El alcance del actor YA RESUELTO por la lista blanca del servicio del tablero
// (`resolverAlcance` -> `global | zona`), traducido a lo unico que un repositorio necesita
// saber: si recorta por `orden.zona_id` y con que id. NO es un `where` de Prisma ni una cadena
// SQL.
//
// Que sea una UNION DE DOS VARIANTES —y no un `zonaId: string | null` suelto— es lo que impide
// que un fallo de datos produzca una consulta sin recorte: «no se» no es representable. Esa
// decision es de la feature 192 y aqui no se toca; lo unico que cambia es DONDE vive el tipo.
//
// ── POR QUE SE MUDO AQUI, Y ESTA MEDIDO ──────────────────────────────────────────────────────
// Lo declaraba `lib/interfaces/repositories/ITableroDiaRepository.ts`, y `design.md §4.2` de la
// feature 260 daba por bueno que `IOrdenRepository` lo importara de alli: «el coste es una
// arista `import type` entre dos archivos de `lib/interfaces/repositories/`, sin runtime».
//
// **Esa premisa resulto falsa al medirla, y el guardia que lo dijo fue
// `tests/unit/guards/pagos-captura.guardia.test.ts`.** Ese guardia recorre el arbol de imports
// de un panel de CLIENTE —`GestionarOrdenPanel.tsx`— y no distingue `import type` de import de
// valor al recorrer (a proposito: lo que audita despues SI lo distingue). La arista nueva abria
// este camino, que antes no existia:
//
//   GestionarOrdenPanel.tsx -> ordenes/_components/estatus-label.ts -> lib/types/order-status.ts
//     -> IOrdenRepository.ts -> ITableroDiaRepository.ts -> lib/types/tablero-dia.ts
//     -> lib/analytics/alcance.ts -> lib/auth/acceso-total.ts   (importa `RolValue` como VALOR)
//
// Es decir: por pedir un tipo de dos lineas, el puerto del listado de ordenes pasaba a arrastrar
// el resolutor de alcance entero. Declararlo en un modulo SIN IMPORTS corta ese camino de raiz y
// conserva lo que el diseño buscaba: **una sola declaracion** de la union, no dos que puedan
// divergir (design.md §13, A7).
//
// ⛔ NO le añadas imports a este archivo. Si necesita uno, lo que hace falta es otro modulo.

/**
 * El recorte de filas, ya resuelto y validado por el servicio (192/R4/R5/R10). El repositorio
 * no lo interpreta: lo escribe en el `WHERE` sobre `orden.zona_id` y nada mas.
 */
export type FiltroAlcanceTablero =
  | { readonly tipo: "global" }
  | { readonly tipo: "zona"; readonly zonaId: string };

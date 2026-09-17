# Ficha 440 — primera mitad: taponar el 500 mudo del portal del mensajero

Rama `fix/440-borde-mudo-reparto`, nacida de `origin/prod` (`efd06fb4`). Sin migracion, sin
tocar `db/`. La causa raiz va aparte.

## El fallo, reproducido

27 respuestas 500 en `/mis-asignaciones/reparto` el 2026-09-17 (03:26-04:34 UTC), un solo
mensajero. Cadena: Postgres devuelve 25P02 -> `withErrorHandler` normaliza a `INTERNAL` ->
el `switch` de `lib/actions/mis-asignaciones.ts` lo manda al `default`, que **relanza**.

Lo que hacia que fuera **mudo** y no una pantalla de error: una Server Action que lanza no
tiene frontera que la recoja. Un `error.tsx` cubre el RENDER, no el `await` de un manejador
de evento. La promesa se rechazaba, el `finally` apagaba el spinner y no se pintaba nada.

## Archivos

Creados: ninguno. Modificados (11):

| Archivo | Que cambia |
|---|---|
| `lib/actions/mis-asignaciones.ts` | INTERNAL pasa a desenlace `error`; el `default` sigue lanzando. Lectura: deja de aplanar todo a `unauthenticated` |
| `lib/types/gestion-orden.ts` | Se anade el desenlace `error` a los 5 tipos de la action (los de SERVICIO no se tocan) |
| `app/(app)/mis-asignaciones/reparto/page.tsx` | El desenlace `error` relanza (frontera 365) en vez de `notFound()` |
| `app/(app)/mis-asignaciones/recoger/page.tsx` | Idem (lee la misma action) |
| `app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx` | Toast propio para `error` |
| `app/(app)/mis-asignaciones/_components/RepartoModule.tsx` | Toast propio para `error` |
| `app/(app)/mis-asignaciones/_components/useRecogerPorGuia.ts` | Nuevo `case` en el `switch` SIN `default` |
| `tests/unit/actions/mis-asignaciones-action.test.ts` | 9 casos nuevos + reescrito el que congelaba el bug |
| `tests/components/MisAsignacionesPage.test.tsx` | 4 casos (lectura vs 404) |
| `tests/components/RepartoModule.test.tsx` | 4 casos (escoger y gestionar) |
| `tests/components/RecogerModule.test.tsx` | 1 caso (el `switch` mudo) |

## Lo que ve el mensajero

| Cuando | Texto exacto |
|---|---|
| Falla guardar la gestion | No se pudo guardar la gestión. Intentá de nuevo. |
| Falla abrir la gestion | No se pudo abrir la gestión. Intentá de nuevo. |
| Falla recoger | No se pudo registrar la recogida. Intentá de nuevo. |
| No carga la pantalla | Frontera 365 YA existente: «No pudimos cargar esta pantalla» / «La pantalla no llegó a mostrarse» / «Probá de nuevo. Si vuelve a fallar, entrá desde el menú de la izquierda o volvé al inicio.» + boton **Reintentar** + **Ir al inicio** |

Los tres toasts usan el molde que el repo ya repite en `cierre-dia`, `cierres-admin` e
`incidentes`. No se invento pieza ni texto nuevo.

## Que se cae y que no (medido, no supuesto)

El encargo suponia que los KPIs se leen aparte. **No es asi**: `result.kpis`,
`result.porGestionar`, `result.ruta` y `result.ordenEnGestionId` salen TODOS del mismo
`await listarMisAsignaciones()`. Si esa lectura falla no queda pieza que aislar, asi que la
gramatica de la 433 (degradar la pieza que fallo) no aplica: se cae la pantalla entera, pero
con reintento. Unos KPIs en blanco sobre una lista vacia se leerian como "hoy no tenes
trabajo", que es peor que decir que fallo.

Lo que **si** se lee aparte es `estadoBloqueoMensajero`, y ya degradaba solo a `SIN_BLOQUEO`.

## Trazabilidad

| # | Requisito | Test |
|---|---|---|
| R1 | INTERNAL no relanza en las 4 mutaciones | `mis-asignaciones-action.test.ts` : recoger/escoger/gestionar/liberar, la base tropieza |
| R2 | INTERNAL no relanza en la lectura | idem : listar, la base tropieza |
| R3 | Un fallo de base no se disfraza de `unauthenticated` | idem : ya NO se disfraza |
| R4 | Sin sesion sigue siendo `unauthenticated` | idem : sin sesion SIGUE siendo unauthenticated |
| R5 | El detalle tecnico no viaja al cliente | idem : ni el 25P02 ni el texto de Postgres |
| R6 | La red sigue puesta (el `default` lanza) | idem : LA RED SIGUE PUESTA |
| R7 | Un fallo de lectura no es un 404 | `MisAsignacionesPage.test.tsx` : NO es NEXT_NOT_FOUND (x2 paginas) |
| R8 | `unauthenticated` sigue saliendo por el 404 | idem : SIGUE saliendo por el 404 (x2 paginas) |
| R9 | Escoger lo cuenta, y sin mentir | `RepartoModule.test.tsx` : NO le echa la culpa a sus permisos |
| R10 | Gestionar lo cuenta y no se da por registrada | idem : avisa, y NO se da por registrada |
| R11 | Reintentar no cuesta rehacer la captura | idem : el panel sigue abierto, con la captura intacta |
| R12 | Recoger lo cuenta (el `switch` sin `default`) | `RecogerModule.test.tsx` : avisa, e invita a reintentar |

## Mutaciones: 6 aplicadas, 6 muertas

| # | Mutacion | Rojos y mensaje real |
|---|---|---|
| 1 | Devolver el `throw` para INTERNAL | **6** — Error: mis-asignaciones: AppErrorCode inesperado INTERNAL |
| 2 | La lectura vuelve a aplanar a `unauthenticated` | **2** — expected 'unauthenticated' to be 'error' |
| 3 | Las paginas vuelven al `notFound()` | **2** — expected [Function] to throw error not including 'NEXT_NOT_FOUND' |
| 4 | Quitar la rama de escoger en RepartoModule | **1** — expected 'No puedes gestionar esta orden.' not to match /permiso.../ |
| 5 | Quitar el `case` del `switch` sin `default` | **1** — expected "vi.fn()" to be called at least once (el fallo mudo, literal) |
| 6 | Quitar la rama de gestionar en el panel | **1** — expected 'No tienes permiso para gestionar esta...' not to match /permiso.../ |

Hallazgo: **habia un test que congelaba el bug**. El caso `menor-1 > un error EXCEPCIONAL del
service NO se propaga crudo` exigia `rejects.toThrow(/AppErrorCode inesperado/)`. No fue
"faltaba un test": habia uno, y afirmaba el defecto. Reescrito conservando lo que si valia
(que el mensaje crudo no se filtra al cliente).

## Gate

`./init.sh --rapido` da **INIT_EXIT=1**, y acierta: el diff toca `lib/types/gestion-orden.ts`,
que esta en RUTAS_SENSIBLES. No fue por nacer de prod: la base comun
(`git merge-base origin/dev HEAD`) es el propio tip de prod, asi que el clasificador solo vio
mis 11 archivos.

`./init.sh` completo da **INIT_EXIT=1**. typecheck **paso**, lint **paso**, 1923 archivos y
28512 casos en verde. Los 52 archivos rojos (342 casos) son todos de `tests/integration` (8)
y `tests/integration/db` (44); ninguno importa nada de esta rama.

Causa, medida: la base de datos local ya esta migrada a dev. El error literal que se repite es
«el valor nulo en la columna sinpe_numero de la relacion zona viola la restriccion not-null».
`sinpe_numero` no existe en el `db/schema.prisma` de prod y si en el de dev (linea 528).
Codigo de prod contra una base adelantada a dev; 26 de los 52 archivos rojos crean una Zona.
No tiene arreglo desde esta rama sin revertir la base local y romper a los demas.

Nota de entorno: para llegar a medir el typecheck hubo que regenerar el cliente Prisma desde
el schema de prod y borrar `.next/dev` (traia tipos de rutas de SF-001 que no existen aqui).
Al terminar se devolvio el cliente al schema de dev, que es donde esta el arbol compartido.

## Anotado, NO arreglado (segunda mitad)

- La causa raiz sigue viva: alguien devuelve al pool una conexion con la transaccion abortada.
- `resolveActorFromSession` (`lib/auth/resolve-actor.ts`) hace DOS lecturas **fuera** de
  `withErrorHandler`, antes de que la action exista. Si la conexion envenenada la alcanza ahi,
  la pagina revienta antes de llegar a este borde; lo recoge la frontera 365 (la pantalla es
  correcta) pero sigue contando 500. No se toco: es el mismo sintoma por otra puerta.
- `listarMisAsignaciones` no abre transaccion: la conexion le llega ya abortada.

## Veredicto

El sintoma esta taponado y sujeto por 6 mutaciones muertas; el gate completo no puede dar
verde en esta rama por una base local adelantada a dev, ajeno al cambio.

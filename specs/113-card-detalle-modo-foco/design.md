# Feature 113 — Diseño técnico

> Cambio de PRESENTACIÓN en el módulo del mensajero. Sin backend, sin migraciones,
> sin nuevos endpoints, sin nuevo contrato de datos. Reusa componentes existentes.

## Alcance del cambio

Todo ocurre dentro de un único componente cliente:
`app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx`.

No se crean componentes nuevos: la card de 'En reparto' se usa en UN solo lugar y no
gana lógica reutilizable, así que vive inline en el módulo (docs/architecture.md
"Regla: sin sobre-ingeniería"). Se reutilizan `AsignacionDetalle` y `GestionarOrdenPanel`.

## Modelo de datos / contratos

Ninguno cambia. `MiAsignacionDTO`, `ordenEnGestionId`, `RutaResumenDTO`, `bloqueado` y
las Server Actions (`escogerParaGestion`, `liberarGestion`, `gestionar`) se mantienen
idénticos (`IMisAsignacionesService.ts`, `lib/actions/mis-asignaciones`). Esta feature
solo consume props que ya llegan del Server Component (`page.tsx:40-46`).

## Estado y derivación

No se introduce estado de React nuevo. Se mantiene `seleccionId` (selección del
mensajero en la grilla, para el panel en la vista NO-foco) y `detalleOrden` (derivada
existente, `MisAsignacionesModule.tsx:114-126`, que ya devuelve la orden activa cuando
`ordenEnGestionId` está fijado).

El modo foco es un **flag DERIVADO** (una sola fuente de verdad: `ordenEnGestionId`,
que vive en el backend y es robusto a recarga):

```ts
const modoFoco = !bloqueado && ordenEnGestionId !== null && detalleOrden !== null;
```

- `!bloqueado`: cuando el mensajero está bloqueado (feature 111) manda el aviso de
  bloqueo total y no hay panel de gestión (R12); no se colapsa a foco.
- `ordenEnGestionId !== null`: el puntero 1-a-1 fijado ES la señal de "estoy
  gestionando una orden".
- `detalleOrden !== null`: hay una orden que mostrar (defensa ante `porGestionar` vacío
  o puntero colgado; con la derivación existente cae a `porGestionar[0]` si el id no se
  encuentra, y a `null` solo si la lista está vacía).

Como `ordenEnGestionId` llega por props del servidor y las mutaciones hacen
`router.refresh()`, `modoFoco` se recalcula solo: al finalizar/cancelar/liberar la
gestión el puntero vuelve a `null` y la vista se restaura (R10) sin estado extra.

## Estructura de render (JSX)

Se reorganiza el `return` del módulo en dos ramas de presentación según `modoFoco`,
sin duplicar componentes (mismo `GestionarOrdenPanel`, mismos handlers):

1. **Aviso de bloqueo total** (feature 111): se mantiene arriba, igual que hoy.

2. **`modoFoco === true`** → SOLO:
   - `GestionarOrdenPanel` de `detalleOrden` con `yaActiva={true}` (R5, R9). El panel
     ya incluye `AsignacionDetalle` (detalle completo) + los controles de gestión.
   - Se OMITEN: sección "Por recoger" (input, escáner, lista) (R8); encabezado + botón
     "Sincronizar ruta" + aviso de ruta desactualizada + mapa (R7); grilla de cards (R6).

3. **`modoFoco === false`** → vista completa (comportamiento actual, con el ajuste de R1/R2):
   - Sección "Por recoger" (salvo `bloqueado`, que ya la recorta como hoy).
   - Encabezado "En reparto / por gestionar" + "Sincronizar ruta" + aviso ruta + mapa.
   - Grilla de cards: **cada card renderiza `<AsignacionDetalle orden={orden} />` inline**
     (R1) en lugar de la vista compacta actual. Se ELIMINA la rama `bloqueada` que
     ocultaba el detalle y pintaba "Termina la gestión en curso…" (`:358-382`) (R2).
   - Panel `GestionarOrdenPanel` de la orden seleccionada/primera (como hoy), donde vive
     el gate "Gestionar pedido" que fija el puntero y hace entrar en foco.

### Comportamiento de la card en vista completa (R1/R4)

- La card sigue siendo un `<button>` seleccionable que lleva la orden al panel de abajo
  (`seleccionar`, `:131-135`). Conserva `aria-pressed`, el chip "En gestión"/"En detalle"
  y el nº de secuencia de ruta.
- Debajo del encabezado de la card se monta `AsignacionDetalle` (detalle completo).
- La deshabilitación por `bloqueado` (feature 111) se mantiene (`disabled`), pero YA NO
  hay una rama que oculte el detalle: R19/R20 restringe la ACCIÓN (no se puede escoger
  otra orden), no la visibilidad. En la práctica, cuando hay una orden activa la vista
  ya está en foco (R5/R6) y las demás cards no se muestran, por lo que no existe el
  estado "card visible pero bloqueada con detalle oculto".

## Reuso de componentes

- `AsignacionDetalle` (`_components/AsignacionDetalle.tsx`): presentacional puro, ya
  usado en `PorAceptarSection` y en `GestionarOrdenPanel`. Se añade un tercer consumidor
  (la card de 'En reparto'). Sin cambios en el componente.
- `GestionarOrdenPanel` (`_components/GestionarOrdenPanel.tsx`): es el "surface" del modo
  foco. Ya recibe `yaActiva`, `onGestionarPedido`, `onCancelarGestion`, `onSuccess` y ya
  muestra `AsignacionDetalle` + el flujo de 4 resultados. Sin cambios en el componente;
  solo cambia DÓNDE/CUÁNDO lo monta el módulo.

## Interacción con features vecinas

- **Feature 111 (bloqueo total del mensajero):** `bloqueado` tiene precedencia; anula el
  foco (R12). Los controles de recogida y el panel siguen recortados como hoy.
- **Feature 92/97 (ruta + mapa):** el mapa y el botón de sincronizar son "chrome" de la
  vista de lista; en foco se ocultan (R7). Fuera de foco, intactos.
- **Features 114/115 (buscador/filtros, pendientes):** operan sobre la grilla de la vista
  de lista. No colisionan porque en foco la grilla no se muestra; fuera de foco, el
  detalle inline (R1) no afecta el filtrado por campos de `MiAsignacionDTO`.

## Alternativa descartada

**Alt A — Modo foco como ruta dedicada** (`/mis-asignaciones/[ordenId]` o
`?foco=<id>`), navegando con el router en lugar de derivar la vista de `ordenEnGestionId`.

- *Idea:* al fijar el puntero, `router.push` a una página que renderiza solo el panel.
- *Por qué se descarta:*
  1. **Doble fuente de verdad.** El backend ya persiste el puntero 1-a-1
     (`ordenEnGestionId`), robusto a recarga (spec 36 R20). Una URL de foco añadiría un
     segundo estado que puede desincronizarse del puntero (p. ej. recargar `/[id]` con el
     puntero ya liberado, o estar en la lista con el puntero fijado).
  2. **Superficie extra innecesaria.** Nueva ruta App Router = nuevo Server Component con
     su propia resolución de permisos/pre-fetch, para no aportar nada que la derivación no
     dé. Contradice "sin sobre-ingeniería" (docs/architecture.md).
  3. **Restauración gratis.** Derivando de `ordenEnGestionId`, salir de foco es
     simplemente que el puntero vuelva a `null` tras `router.refresh()` (R10); con ruta
     habría que orquestar navegación de vuelta en éxito/cancelar/liberar.

**Alt B (secundaria) — Acordeón:** dejar la grilla visible y solo colapsar/atenuar las
demás cards. Se descarta porque el brief pide OCULTAR cards, mapa y listas, y el objetivo
del foco es una vista sin distracciones en la calle (móvil): atenuar deja scroll y ruido.

## Verificación

- `tests/components/MisAsignacionesModule.test.tsx`: actualizar el test R19/R20 (ya no
  oculta detalle; ahora colapsa a foco) y añadir tests de foco (R5–R12). Ver `tasks.md`.
- `tests/components/MisAsignacionesPage.test.tsx`: usa `ordenEnGestionId=null` (vista
  completa) → debe seguir en verde sin cambios.
- `./init.sh` + suite de tests en verde (docs/verification.md).

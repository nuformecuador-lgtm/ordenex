# Impl 113 — card en reparto con detalle completo inline + modo foco al gestionar

> Zona: frontend · Rama: `feature/113-card-detalle-modo-foco` · Cambio de PRESENTACIÓN.
> Sin backend, sin migraciones, sin cambios de contrato ni de Server Actions.

## Archivos tocados

Producción (1):
- `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx`
  - Flag derivado `modoFoco = !bloqueado && ordenEnGestionId !== null && detalleOrden !== null` (T1).
  - Card de "En reparto": monta `<AsignacionDetalle orden={orden} />` inline en cada card;
    se ELIMINÓ la rama `bloqueada` que ocultaba el detalle y el texto "Termina la gestión en
    curso…" (T2). Se conservan encabezado, chip "En gestión"/"En detalle", nº de secuencia,
    `aria-pressed` y la deshabilitación por `bloqueado`.
  - `return` reorganizado en dos ramas: `modoFoco` → SOLO `GestionarOrdenPanel` (`yaActiva`)
    de la orden activa, ocultando grilla, mapa/ruta + "Sincronizar ruta" y "Por recoger"
    (T3); fuera de foco → vista completa con detalle inline (T2). El aviso de bloqueo total
    (feature 111) queda arriba con precedencia (T4). Comentarios de cabecera/inline
    actualizados (T5).

Tests (1):
- `tests/components/MisAsignacionesModule.test.tsx`
  - Reescrito el test viejo de R19/R20 (ya no oculta detalle; ahora colapsa a foco) → "R6/R2"
    (T6).
  - Añadidos R1, R2, R3, R4, R4b, R5, R7, R8, R9, R10, R11, R12 (T7–T9).

Nuevos:
- `progress/impl_113-card-detalle-modo-foco.md` (este archivo).

Sin cambios (solo reuso / deben seguir verdes): `AsignacionDetalle.tsx`,
`GestionarOrdenPanel.tsx`, `page.tsx`, `MisAsignacionesPage.test.tsx`,
`MarcarLuegoToggle.tsx`, `MarcarLuegoToggle.test.tsx`.

## Trazabilidad R1–R12 → test (`tests/components/MisAsignacionesModule.test.tsx`)

| Req | Test |
| --- | --- |
| R1  | "R1: cada card en reparto muestra el detalle COMPLETO (Pedido/Entrega/Cobro) de SU orden" |
| R2  | "R2: el texto 'Termina la gestión en curso' no aparece en NINGÚN estado" (sin gestión + en foco) |
| R3  | "R3: bloqueado sin gestión — las cards están deshabilitadas y AÚN muestran el detalle completo" |
| R4  | "R4: con una gestión activa NO se ofrece gestionar OTRA orden (sus cards no están en el DOM)" |
| R4b | "R4b: el flujo 'verificar guía → Gestionar' llama escogerParaGestion con el MISMO payload y sin llamadas nuevas" |
| R5  | "R5: con una gestión activa la vista entra en foco y el panel muestra la orden ACTIVA" |
| R6  | "R6/R2 (113): con una orden activa la vista COLAPSA a foco — las demás cards no están en el DOM…" (reescritura de R19/R20) |
| R7  | "R7: en foco NO se renderiza el mapa de ruta ni 'Sincronizar ruta'" |
| R8  | "R8: en foco se oculta la sección 'Por recoger' y sus controles de recogida" |
| R9  | "R9: en foco (yaActiva) se ven los 4 botones de resultado y 'Cancelar gestión'" |
| R10 | "R10: al volver ordenEnGestionId a null se SALE del foco y se restaura la vista completa" (rerender) |
| R11 | "R11: sin órdenes en reparto muestra el vacío y NO entra en foco (aunque haya puntero)" |
| R12 | "R12: bloqueado con puntero fijado NO entra en foco (precede el aviso de bloqueo total, sin panel)" |

## Salida de la suite

`./init.sh` en verde (typecheck + lint 0 errores + test). Suite completa:

```
Test Files  459 passed (459)
      Tests  4586 passed (4586)
```

Foco del módulo (aislado):
```
tests/components/MisAsignacionesModule.test.tsx + MarcarLuegoToggle.test.tsx
Test Files  2 passed (2)   Tests  61 passed (61)
```

## Nota — integración/preservación de la feature 115

La 115 (marcar "gestionar más tarde") ya vivía en `dev` dentro del módulo. Al reescribir el
render de la vista de lista se PRESERVÓ intacta:

- **Sort estable (R19):** `porGestionarVisual` (useMemo con `sort` estable que hunde las
  marcadas al final sin mutar `porGestionar` ni la ruta) sigue siendo la fuente del `.map`
  de la grilla en la rama fuera de foco.
- **Badge "Gestionar más tarde" (R18):** sigue DENTRO del `<button>` de la card (fila de
  badges junto a "Pendiente de optimizar"), donde el detalle inline se añadió DEBAJO.
- **Toggle `MarcarLuegoToggle` (R5/R6):** sigue como HERMANO de la card dentro del `<li>`
  (nunca anidado en el botón), disponible aunque la card esté deshabilitada.

En **modo foco** la grilla no se renderiza, así que los elementos de lista de 115 no aplican
en esa rama (solo se muestra el panel de la orden activa). Los tests de 115 que montan el
módulo (R18 badge, R19 sort, en `MarcarLuegoToggle.test.tsx`) siguen verdes SIN tocarlos,
porque usan `ordenEnGestionId=null` (vista completa) y dependen del aria-label de la card,
del badge dentro del botón y del texto "Parada N de la ruta", todos conservados.

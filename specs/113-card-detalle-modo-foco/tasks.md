# Feature 113 — Tasks

> Cambio de presentación en un solo componente cliente + su test. Sin backend, sin
> migraciones. `[P]` = paralelizable con otra task de la MISMA feature.

## Preparación

- [ ] **T0** — Releer `MisAsignacionesModule.tsx` (grilla `:291-388`, panel `:395-404`,
  handlers `:131-175`) y confirmar el punto exacto donde se deriva `detalleOrden` y se
  pinta la card. *Hecho:* identificados los bloques a tocar (rama `bloqueada`, grilla,
  render condicional del panel/mapa/Por recoger).

## Implementación (todas en `MisAsignacionesModule.tsx`)

- [ ] **T1** — Derivar el flag de foco:
  `const modoFoco = !bloqueado && ordenEnGestionId !== null && detalleOrden !== null;`
  (junto a `detalleOrden`). *Hecho:* `modoFoco` disponible en el render; sin estado nuevo.
  *Dep:* T0.

- [ ] **T2** — Card con detalle inline (R1/R2/R3). En la grilla `:296-388`: eliminar la
  rama `bloqueada` que oculta detalle y muestra "Termina la gestión en curso…"; montar
  `<AsignacionDetalle orden={orden} />` dentro de cada card (conservando encabezado,
  chip "En gestión"/"En detalle", nº de secuencia, `aria-pressed`, `disabled` por
  `bloqueado`). Quitar la variable `bloqueada` y el texto asociado.
  *Hecho:* cada card muestra Pedido/Entrega/Cobro; el string "Termina la gestión en curso"
  ya no existe en el archivo. *Dep:* T1.

- [ ] **T3** — Colapso a modo foco (R5–R9). Envolver el `return` para que, cuando
  `modoFoco === true`, se renderice SOLO `GestionarOrdenPanel` (con `yaActiva={true}`,
  `key={detalleOrden.id}`, y los handlers actuales `gestionarPedido`/`cancelarGestion`/
  `handleGestionSuccess`), omitiendo: sección "Por recoger" (input/escáner/lista),
  encabezado + "Sincronizar ruta" + aviso de ruta desactualizada + mapa, y la grilla de
  cards. Mantener arriba el aviso de bloqueo total. *Hecho:* con `ordenEnGestionId`
  fijado y `!bloqueado`, solo se ve el panel de la orden activa. *Dep:* T1, T2.

- [ ] **T4** — Restauración y bordes (R10/R11/R12). Verificar que con `ordenEnGestionId=null`
  vuelve la vista completa (deriva sola tras `router.refresh()`); que `porGestionar=[]`
  muestra el vacío sin foco; y que `bloqueado=true` NO entra en foco (precedencia del
  aviso de bloqueo total, sin panel). *Hecho:* los tres estados se comportan según R10–R12.
  *Dep:* T3.

- [ ] **T5** [P] — Actualizar el comentario-cabecera del módulo (`:28-39`) y los
  comentarios inline que describen el comportamiento viejo ("oculta los detalles de las
  demás", `:358-360`) para reflejar detalle inline + modo foco. *Hecho:* los comentarios
  ya no describen el ocultamiento eliminado. *Dep:* T2, T3.

## Tests (`tests/components/MisAsignacionesModule.test.tsx`)

- [ ] **T6** — Reescribir el test existente "R19/R20: … OCULTAN sus detalles" (`:395-418`):
  ahora con `ordenEnGestionId="g2"` la vista está en FOCO → la card de g1 NO está en el
  DOM (R6) y no aparece "Termina la gestión en curso" (R2). *Hecho:* el test refleja el
  nuevo comportamiento y pasa. *Dep:* T3.

- [ ] **T7** [P] — Tests de detalle inline: R1 (cada card muestra Pedido/Entrega/Cobro
  de su orden, sin gestión activa), R2 (el texto "Termina la gestión en curso" no existe
  en ningún estado), R3 (`bloqueado=true` sin gestión: cards deshabilitadas y con detalle
  visible). *Hecho:* 3 tests verdes. *Dep:* T2.

- [ ] **T8** [P] — Tests de modo foco: R5 (panel muestra la orden activa), R6 (otras cards
  ausentes), R7 (sin `RutaMapa`/"Mapa de ruta"/"Sincronizar ruta"), R8 (sin región/controles
  "Por recoger"), R9 (4 botones + "Cancelar gestión" visibles). *Hecho:* 5 tests verdes.
  *Dep:* T3.

- [ ] **T9** [P] — Tests de restauración/bordes: R10 (re-render con `ordenEnGestionId=null`
  restaura grilla+mapa+Por recoger), R11 (vacío sin foco), R12 (`bloqueado`+puntero → no
  foco), R4/R4b (en foco no hay control para otra orden; `escogerParaGestion` sigue con el
  mismo payload y sin llamadas nuevas). *Hecho:* tests verdes. *Dep:* T3, T4.

## Verificación final

- [ ] **T10** — `tests/components/MisAsignacionesPage.test.tsx` sigue en verde sin tocarlo
  (usa `ordenEnGestionId=null`, vista completa). *Hecho:* suite del page test pasa. *Dep:* T2, T3.

- [ ] **T11** — `./init.sh` en verde + `pnpm test` (o el runner del repo) con toda la suite
  del módulo en verde; mapa R→test documentado en `progress/impl_113.md`. *Hecho:* verde
  y trazabilidad completa (R1–R12). *Dep:* T6–T10.

## Archivos esperados (para validar conflictos de paralelismo)

Producción (editar):
- `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx` — único archivo de
  producción tocado (T1–T5).

Tests (editar):
- `tests/components/MisAsignacionesModule.test.tsx` — reescribe 1 test y añade tests de
  foco/detalle (T6–T9).

Sin cambios (solo se leen / deben seguir verdes):
- `app/(app)/mis-asignaciones/_components/AsignacionDetalle.tsx` (reuso, sin editar).
- `app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx` (reuso, sin editar).
- `app/(app)/mis-asignaciones/page.tsx` (no se toca).
- `tests/components/MisAsignacionesPage.test.tsx` (debe seguir verde, sin editar).

Nuevos:
- `progress/impl_113.md` — lo crea el implementer (mapa R→test).

> Nota de conflicto: esta feature toca SOLO `MisAsignacionesModule.tsx` y su test de
> componente. Colisiona con cualquier otra feature que edite ese módulo (p. ej. 114/115
> buscador/filtros del mismo portal); no comparte archivos con features de otras zonas.

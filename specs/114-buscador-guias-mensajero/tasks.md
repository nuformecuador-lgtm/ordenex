# Feature 114 — Mensajero: buscador de guías asignadas — tasks

> Frontend, sin backend. `[P]` = paralelizable con otras tareas del mismo bloque.
> Cada task lista su criterio de "hecho". Dependencias indicadas por task.

## Bloque 1 — Helper puro de búsqueda

- [ ] **T1. Crear el helper de matching** `app/(app)/mis-asignaciones/_components/mis-asignaciones-buscador.ts`.
  - Exporta `textoBuscable(orden)`, `coincideBusqueda(orden, queryNormalizado)` y
    `filtrarAsignaciones(ordenes, query)` con las firmas de `design.md §2`.
  - Reutiliza `normalizeName` de `lib/utils/normalize.ts` (NO duplicar normalización).
  - `numGuia` numérico → texto; `null` → `""` (R4). Query vacío/solo-espacios → lista
    sin filtrar (R5).
  - **Hecho:** el archivo compila en TS strict, sin `any`, y es importable sin arrastrar DOM.
  - Depende de: —

- [ ] **T2. [P] Test unitario del helper** `tests/unit/components/mis-asignaciones-buscador.test.ts`.
  - Casos: R3 (parcial + `perez`↔`Pérez` + `rem-0`↔`REM-001`), R4 (`numGuia` null no
    coincide por guía pero sí por remisión/destinatario; `10`↔`1001`), R5 (query `""`
    y `"   "` devuelven la lista completa).
  - **Hecho:** los tests pasan; cada uno nombrado por comportamiento (no por función).
  - Depende de: T1.

## Bloque 2 — Integración en el módulo

- [ ] **T3. Estado + input de búsqueda en `MisAsignacionesModule.tsx`.**
  - `const [query, setQuery] = useState("")`.
  - Render de una `<section aria-label="Buscar guías">` con `<label>` + `components/ui/input`
    (`type="search"`), por encima de "Por recoger" y "En reparto" (dentro del `div` raíz,
    tras el aviso de bloqueo). No pedir permisos ni tocar acciones.
  - **Hecho:** `getByRole("searchbox")` / `getByLabelText("Buscar guías")` lo encuentra (R1).
  - Depende de: —

- [ ] **T4. Derivar listas filtradas con `useMemo` (coherencia lista↔mapa↔panel).**
  - `porRecogerFiltrado = useMemo(() => filtrarAsignaciones(porRecoger, query), [porRecoger, query])`.
  - `porGestionarFiltrado`: filtra `porGestionar` por el query PERO conserva la orden
    en gestión (`o.id === ordenEnGestionId || coincideBusqueda(o, normalizeName(query))`);
    deps `[porGestionar, query, ordenEnGestionId]` (R8 + R9, ver `design.md §3`).
  - **Hecho:** ambas memos existen; `porGestionarFiltrado` mantiene la orden en
    gestión aunque no coincida.
  - Depende de: T1, T3.

- [ ] **T5. Cablear "Por recoger" al filtrado + mensaje sin resultados.**
  - `PorAceptarSection` recibe `ordenes={porRecogerFiltrado}`.
  - `vacio` dinámico: con query activo y sin coincidencias →
    "Ninguna guía por recoger coincide con la búsqueda." (R6); sin query →
    "No hay órdenes por recoger." (texto actual).
  - NO modificar `PorAceptarSection.tsx`.
  - **Hecho:** con query sin match, el grupo muestra el mensaje "coincide con la búsqueda".
  - Depende de: T4.

- [ ] **T6. Cablear "En reparto" (grilla + mapa + panel) al filtrado.**
  - La grilla mapea `porGestionarFiltrado` (reemplaza `porGestionar.map` en la grilla).
  - Recablear `paradasMapa` y `detalleOrden` para que DERIVEN de `porGestionarFiltrado`
    (hoy leen `porGestionar`, `MisAsignacionesModule.tsx:83-95` y `:114-126`) → mapa y
    panel reflejan el filtro (R8).
  - Mensaje inline de vacío dinámico: con query activo y sin coincidencias →
    "Ninguna guía en reparto coincide con la búsqueda." (R6); sin query →
    "No hay órdenes en reparto." (texto actual).
  - **Hecho:** filtrar excluye la card de la grilla Y su parada del mapa; la orden en
    gestión (`ordenEnGestionId`) permanece en grilla y mapa aunque no coincida (R9).
  - Depende de: T4.

## Bloque 3 — Tests de componente y cierre

- [ ] **T7. Tests de componente** en `tests/components/MisAsignacionesModule.test.tsx`
    (ampliar el archivo existente, no reescribirlo).
  - R1: el `searchbox` está visible sobre ambos grupos.
  - R2: teclear filtra ambos grupos por `numGuia` / `numRemision` / `destinatario`.
  - R5: query vacío muestra todas las guías (los tests existentes siguen verdes).
  - R6: query sin coincidencias muestra el mensaje "coincide con la búsqueda" en el
    grupo afectado, distinto del vacío sin búsqueda.
  - R7: una guía que coincide en un grupo no aparece en el otro.
  - R8: con query que excluye una parada, esa parada NO aparece en la grilla y
    `rutaMapaMock` NO la recibe (reusar el mock de `RutaMapa` ya presente en el archivo).
  - R9: con `ordenEnGestionId` fijado y un query que no coincide con esa orden, su card
    y su parada (en `rutaMapaMock`) siguen presentes.
  - **Hecho:** todos pasan y los tests previos del archivo siguen verdes.
  - Depende de: T3, T5, T6.

- [ ] **T8. Verificación final.**
  - `./init.sh` en verde + `pnpm test` (o el runner del repo) con la suite completa.
  - Mapa R→test completo (para `progress/impl_114.md` del implementer).
  - **Hecho:** init verde, suite verde, cada R con su test.
  - Depende de: T2, T7.

## Archivos esperados (para validar conflictos de paralelismo)

**Nuevos:**
- `app/(app)/mis-asignaciones/_components/mis-asignaciones-buscador.ts`
- `tests/unit/components/mis-asignaciones-buscador.test.ts`

**Modificados:**
- `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx`
- `tests/components/MisAsignacionesModule.test.tsx`

**Reutilizados (solo import, NO se modifican):**
- `lib/utils/normalize.ts` (`normalizeName`)
- `components/ui/input.tsx`
- `app/(app)/_components/PorAceptarSection.tsx`
- `lib/interfaces/services/IMisAsignacionesService.ts` (`MiAsignacionDTO`)

**Conflicto potencial de paralelismo:** cualquier otra feature en curso que edite
`app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx` o
`tests/components/MisAsignacionesModule.test.tsx`. No comparte archivos de producción
con features de otra zona.

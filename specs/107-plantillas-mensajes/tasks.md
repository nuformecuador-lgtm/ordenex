# Feature 107 — Tasks

Checklist ordenado y verificable. `[P]` = paralelizable con las tareas de su mismo
bloque. Cada task cita los `R<n>` que satisface, los archivos esperados (para validar
conflictos de zona) y su criterio de "hecho". La columna `R<n>→test` cierra la
trazabilidad (`docs/specs.md` §Trazabilidad).

## Zona BACKEND (datos, dominio, acciones)

### T1 — Migración: enum + tabla `plantilla_mensaje`  (R12, R23, R27, R28, R30, R31)
- Archivos: `db/schema.prisma` (add `enum PlantillaEstado`, `model PlantillaMensaje`
  con `variables String[]`, `estado @default(pending)`, `deletedAt`, inverso
  `Usuario.plantillasCreadas`); `db/migrations/<ts>_plantilla_mensaje/migration.sql`;
  `db/migrations/<ts>_plantilla_mensaje/down.sql`.
- Depende de: —
- Hecho cuando: `pnpm db:generate` tipa `PlantillaMensaje`/`PlantillaEstado`; UP crea
  tipo+tabla (`variables text[] default '{}'`, `estado default 'pending'`,
  `deleted_at` nullable)+índices+RLS; `down.sql` revierte exacto; `pnpm db:migrate` y
  `pnpm db:rollback` corren en verde.
- `R<n>→test`: R12/R23/R27/R28/R30 verificados por T5/T7; R31 revisión de `down.sql`.

### T2 — Catálogo abierto de variables + helpers puros  (R13, R14, R15, R16, R18, R19)
- Archivos: `lib/types/plantilla-variables.ts`; `lib/utils/plantilla-mensaje.ts`;
  `tests/unit/plantillas/plantilla-mensaje-utils.test.ts`.
- Depende de: — (paralelo a T1) `[P]`
- Hecho cuando: `extraerVariables`, `validarCuerpo`, `renderPlantilla` implementadas;
  catálogo data-driven (sin union cerrado) con `usuario`/`cod`.
- `R<n>→test`: R13 `el catalogo abierto incluye usuario y cod y se amplia con una fila`;
  R14 `reconoce {{ clave }} con espacios`; R15 `acepta cualquier clave bien formada y
  devuelve el array de variables deduplicado`; R16 `rechaza {{}} y clave con caracteres
  invalidos`; R18/R19 `render sustituye todas las ocurrencias, marcador para clave fuera
  del catalogo, sin tocar el resto del texto`.

### T3 — Tipos + zod + config  (R7, R9, R11, R12, R22, R25)
- Archivos: `lib/types/plantilla-mensaje.ts`; `lib/config/plantillas.ts`;
  `tests/unit/plantillas/plantilla-schemas.test.ts`.
- Depende de: T1 (tipos Prisma) `[P]` con T2
- Hecho cuando: schemas `crear/actualizar/cambiarEstado/listar` con `.strict()`;
  `cambiarEstadoPlantillaSchema = z.object({ estado: z.literal("inactivo") })`; el
  cliente NO envía `variables`.
- `R<n>→test`: R9 `crear rechaza nombre vacio`; R11 `crear rechaza cuerpo vacio`;
  R25 `cambiarEstado solo acepta destino inactivo y rechaza activo/pending/refused`.

### T4 — Interfaces + Repository  (R6, R7, R10, R15, R21, R26, R27, R28, R29)
- Archivos: `lib/interfaces/repositories/IPlantillaMensajeRepository.ts`;
  `lib/interfaces/services/IPlantillaMensajeService.ts`;
  `lib/repositories/PlantillaMensajeRepository.ts`.
- Depende de: T1, T3
- Hecho cuando: repo implementa la interfaz; `create/update` persisten `variables`;
  `softDelete` fija `deletedAt`; TODAS las lecturas filtran `deletedAt IS NULL`;
  unicidad de `nombre` traducida a error de dominio (patrón `UsuarioDuplicadoError`);
  typecheck en verde.
- `R<n>→test`: cubierto vía T5 (service con repo mock) y T7 (integración: R28 filtro,
  R27 soft delete).

### T5 — Service `PlantillaMensajeService`  (R5, R6, R8, R9, R10, R11, R12, R15, R16, R18, R20, R21, R22, R24, R26, R27, R29)
- Archivos: `lib/services/PlantillaMensajeService.ts`;
  `tests/unit/plantillas/PlantillaMensajeService.test.ts`.
- Depende de: T2, T3, T4
- Hecho cuando: `ALLOWED_ROLES={"maestro"}`; valida cuerpo y deriva `variables`; nace
  `pending`; DESACTIVAR fija `inactivo`; soft delete; tests con repo mock.
- `R<n>→test`: R5 `forbidden si el actor no es maestro`; R8 `crea con nombre y cuerpo
  validos y persiste variables`; R10 `crear devuelve conflict si el nombre existe`;
  R12 `crea con estado pending por defecto`; R15 `crear/actualizar deriva y guarda el
  array de variables del cuerpo`; R16 `validation_error de cuerpo por llave malformada`;
  R18 `preview sustituye con los ejemplos`; R20 `actualiza nombre y cuerpo y recalcula
  variables`; R21 `actualizar inexistente -> not_found`; R22 `unicidad excluye la propia
  plantilla`; R24 `desactivar mueve la plantilla a inactivo (unica transicion del
  front)`; R26 `cambiar estado inexistente/borrada -> not_found`; R27 `eliminar marca
  deletedAt (soft) y no borra la fila`; R29 `eliminar inexistente -> not_found`.

### T6 — Server Actions `lib/actions/plantillas.ts`  (R4, R5, R25)
- Archivos: `lib/actions/plantillas.ts`;
  `tests/unit/plantillas/plantillas-actions.test.ts`.
- Depende de: T5
- Hecho cuando: 7 actions (`crear/listar/obtener/actualizar/cambiarEstado/eliminar/preview`)
  con `withErrorHandler` + `resolveActorFromSession` + `deps` inyectables.
- `R<n>→test`: R4 `cada action devuelve unauthenticated sin sesion y sin tocar el
  service`; R5 `propaga forbidden del service`; R25 `cambiarEstado rechaza destino
  distinto de inactivo`.

### T7 — Test de integración Controller+DB  (R8, R10, R15, R20, R27, R28, R30)
- Archivos: `tests/integration/plantillas/plantillas.int.test.ts`.
- Depende de: T6
- Hecho cuando: crea→lista→edita→desactiva→elimina contra DB de test; verifica
  unicidad de `nombre`, persistencia del array `variables`, que el listado excluye las
  soft-deleted y que RLS está habilitada en la tabla.
- `R<n>→test`: R8/R10/R20 `flujo CRUD end-to-end`; R15 `variables persistidas en la
  fila`; R27/R28 `eliminar oculta la plantilla del listado (deletedAt)`; R30
  `plantilla_mensaje tiene RLS habilitada`.

## Zona FRONTEND (menú + UI)

### T8 — Subítem "Plantillas" en el menú  (R1, R2)
- Archivos: `lib/auth/menu-visibility.ts` (add child a "Configuración");
  `tests/unit/auth/menu-visibility.test.ts` (extiende el existente si lo hay).
- Depende de: — `[P]` (no depende del backend)
- Hecho cuando: `children` de Configuración incluye `{label:"Plantillas",
  href:"/configuracion/plantillas"}`.
- `R<n>→test`: R1 `maestro ve el subitem Plantillas`; R2 `un rol no maestro no lo ve`.

### T9 — Página server + autorización  (R3)
- Archivos: `app/(app)/configuracion/plantillas/page.tsx`.
- Depende de: T6
- Hecho cuando: Server Component autoriza `maestro` (patrón `.../api/page.tsx`),
  precarga `listarPlantillas`, cae a listado vacío si no es `ok`.
- `R<n>→test`: R3 `rol distinto de maestro no renderiza el modulo` (test de la página /
  e2e).

### T10 — Módulo cliente + tabla + acción de estado  (R6, R24)
- Archivos: `app/(app)/configuracion/plantillas/_components/PlantillasModule.tsx`;
  `.../_components/plantillas-columns.tsx`.
- Depende de: T9 `[P]` con T11
- Hecho cuando: lista con nombre/estado/cuerpo; ÚNICA acción de estado "Desactivar"
  (visible cuando el estado no es ya `inactivo`, envía destino `inactivo`) llama a
  `cambiarEstadoPlantilla`; NO hay "Activar"; `pending`/`activo`/`refused` se muestran
  como badge de solo lectura; el front nunca emite un destino distinto de `inactivo`.
- `R<n>→test`: R6 `renderiza las columnas`; R24 `Desactivar envia destino inactivo`
  (test de componente).

### T11 — Formularios + editor de variables + preview  (R8, R11, R16, R17, R18)
- Archivos: `.../_components/CrearPlantillaForm.tsx`;
  `.../_components/EditarPlantillaForm.tsx`; `.../_components/VariablesInsert.tsx`;
  `tests/unit/plantillas/VariablesInsert.test.tsx`.
- Depende de: T9, T2 `[P]` con T10
- Hecho cuando: botonera inserta `{{clave}}` en el cursor desde `PLANTILLA_VARIABLES`
  (catálogo abierto); panel de vista previa llama a `previewPlantilla`; errores de
  `fieldErrors.cuerpo` (llave malformada, R16) se muestran.
- `R<n>→test`: R17 `insertar {{usuario}} en la posicion del cursor`; R18 `la preview
  muestra el cuerpo con los ejemplos`.

## Orden sugerido y paralelismo
1. Backend: T1 → (T2 `[P]` T3) → T4 → T5 → T6 → T7.
2. Frontend: T8 `[P]` desde el inicio; T9 tras T6; luego T10 `[P]` T11.
3. Cada task = un commit `feat(107-plantillas-mensajes): <qué>` (`docs/conventions.md`).

## Cierre de trazabilidad
Todo `R1..R31` queda cubierto: R1–R2 (T8), R3 (T9), R4–R5 (T6/T5), R6–R7 (T5/T10),
R8–R12 (T5/T3), R13–R19 (T2/T11), R20–R22 (T5), R23 (T1/T5), R24 (T5/T10),
R25 (T3/T6), R26 (T5), R27–R28 (T4/T5/T7), R29 (T5), R30 (T1/T7), R31 (T1).

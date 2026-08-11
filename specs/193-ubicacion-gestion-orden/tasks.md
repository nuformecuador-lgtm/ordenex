# Feature 193 — Tareas

`[P]` = puede correr en paralelo con las de su misma tanda (no comparten archivo).
Cada tarea nombra el requisito que cierra; sin `R<n>` no entra.

## Tanda A — modelo y migración (backend)

- [ ] **A1** `db/schema.prisma`: enum `GestionUbicacionAusencia` con los cuatro valores del
  glosario (`timeout`, `no_disponible`, `no_soportado`, `contexto_inseguro`), mapeado a
  `gestion_ubicacion_ausencia`. **La denegación NO va**: su ausencia es el mecanismo de R12.
  Cierra R5, R12.

- [ ] **A2** `db/schema.prisma`: en `GestionOrden`, `ubicacionLat`/`ubicacionLng`
  `Decimal(10,7)?` y `ubicacionAusencia` del enum, nullables, con el comentario que explica
  por qué decimal y no `Float` (design §2). Cierra R1, R2, R4.

- [ ] **A3** `db/migrations/<ts>_gestion_orden_ubicacion/migration.sql` + `down.sql`:
  `CREATE TYPE` + tres `ADD COLUMN` nullable. **Sin `UPDATE` de ninguna clase** (R3). El
  `down.sql` suelta columnas y tipo. El gate verifica que todo migration tenga su `down`.
  Cierra R3.

- [ ] **A4 [P]** `tests/integration/db/gestion-orden-ubicacion-migration.test.ts`: las tres
  columnas existen, son nullable, el tipo es el decimal esperado, el enum tiene exactamente
  cuatro valores, y una fila insertada **antes** de migrar queda con los tres campos en NULL.
  Cierra R1, R2, R3, R4, R5.

## Tanda B — borde (backend)

- [ ] **B1** `lib/types/gestion-orden.ts`: la disyunción coordenadas/motivo, declarada **una
  vez** y compuesta en las cinco ramas. Reutiliza `ubicacionSchema` para los rangos (R13);
  no los redeclara. Cierra R6, R8, R9, R10, R11, R13, R14.

- [ ] **B2** `lib/actions/mis-asignaciones.ts`: leer `ubicacionAusencia` del `FormData` junto
  a los `ubicacionLat`/`ubicacionLng` que ya se leen (`:222-225`), y pasarlo por las cinco
  ramas. **No tocar** `recogerSchema` ni `sincronizarRutaSchema`. Cierra R14, R15.

- [ ] **B3 [P]** `tests/unit/types/gestion-ubicacion-borde.test.ts`: un caso por cada uno de
  R8–R13, **recorriendo las cinco ramas en tabla** para que R14 no dependa de la disciplina
  de quien añada una rama nueva. Incluye media coordenada (R6) y el motivo de denegación
  (R12). Cierra R6, R8–R14.

## Tanda C — persistencia (backend)

- [ ] **C1** `IGestionOrdenRepository` + `GestionOrdenRepository`: los tres campos en el
  input y en el `create`. Cierra R1.

- [ ] **C2** `MisAsignacionesService`: propagar los campos a la gestión **conservando** la
  llamada a `registrarUbicacion` (`:93-106`). La persistencia nueva SE SUMA. Cierra R25.

- [ ] **C3 [P]** `tests/unit/services/mis-asignaciones-gestion.test.ts`: los efectos sobre
  estado de la orden, historial e importes son idénticos a los de hoy. Cierra R23.

- [ ] **C4 [P]** `tests/unit/actions/mis-asignaciones-ubicacion.test.ts` (existe, se amplía):
  `registrarUbicacion` sigue corriendo, y recoger/sincronizar no cambian. Cierra R15, R25.

- [ ] **C5 [P]** `tests/unit/repositories/gestion-ubicacion-solo-escritura.guardia.test.ts`:
  ningún repositorio de LECTURA proyecta las columnas nuevas. Es lo que convierte «solo
  escritura» (R7) en una afirmación verificable en vez de una intención en un comentario.
  Cierra R7.

- [ ] **C6 [P]** `tests/unit/services/deshacer-asignacion-service.test.ts` (existe): anular
  una gestión no borra ni altera su ubicación. Cierra R24.

## Tanda D — frontend

- [ ] **D1** `lib/utils/capturar-ubicacion.ts`: el helper de design §4. **Nunca lanza.**
  Comprueba soporte y contexto seguro antes de llamar. `timeout` en constante propia.
  Cierra R20.

- [ ] **D2 [P]** `tests/unit/utils/capturar-ubicacion.test.ts`: un caso por cada rama de
  `GeolocationPositionError` y por cada guarda previa (sin soporte, contexto inseguro), más
  el éxito. Cierra R18, R20.

- [ ] **D3** `GestionarOrdenPanel.tsx`: capturar **antes** de `buildFormData()` (`:349`);
  `ok`/`ausente` añaden campos y siguen; `denegado` corta antes de llamar a `gestionar`
  (`:425`) y muestra cómo reactivar el permiso. Estado ocupado mientras corre. Nada se pide
  al abrir el panel. Cierra R16, R17, R18, R19, R21, R22.

- [ ] **D4 [P]** `tests/components/GestionarOrdenUbicacion.test.tsx`: con
  `navigator.geolocation` mockeado — éxito manda coords; cada fallo técnico completa la
  gestión; denegado NO llama a la acción y el aviso contiene la instrucción de reactivación;
  no se pide nada al montar; doble click no envía dos veces. Cierra R16–R19, R21, R22.

## Tanda E — cierre

- [ ] **E1** `./init.sh` completo en verde (no `--rapido`: hay migración y toca money-adjacent).
- [ ] **E2** Mapa R1–R25 → test verificado uno a uno contra `design.md §8`. Sin huérfanos.
- [ ] **E3** `progress/impl_193.md` con lo que se decidió sobre la marcha, y la ficha 193 a
  `done` **solo** si E1 está verde.

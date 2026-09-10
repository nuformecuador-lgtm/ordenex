# 407 — Tasks

**Orden obligatorio: backend (T1–T11) → frontend (T12–T16) → cierre (T17–T19).**
`[P]` = puede ir en paralelo con las tasks de su mismo bloque marcadas igual.

**Regla de esta ficha para el criterio de «hecho»:** un aserto que se pone **ROJO** si el código
está mal. Un grep sobre un comentario no cuenta. Y ojo con la familia «aserción contra su propia
fuente»: los textos de §6 se comparan contra el literal **escrito a mano en el test**, copiado del
design, **nunca** contra la constante exportada.

---

## Bloque A — Datos (nada depende de nadie, pero todo depende de esto)

### T1. Modelo Prisma + migración up/down
**Depende de:** —
**Hacer:** añadir `OrdenAsignacionSinUbicacion` a `db/schema.prisma` (§4.1 del design) con las dos
back-relations (`Orden`, `Usuario`), y crear
`db/migrations/20260910120000_orden_asignacion_sin_ubicacion/` con `migration.sql` y `down.sql`
(§4.2). Generar el SQL con `pnpm run db:migrate:create` (que **no** aplica) y escribir el
`down.sql` a mano.
**Hecho cuando:**
- `pnpm exec prisma migrate diff` (el guardia de drift del repo) no reporta diferencia entre
  `schema.prisma` y las migraciones;
- `pnpm run db:migrate` aplica la migración contra la base local sin error;
- `pnpm run db:rollback` ejecuta el `down.sql` y la tabla desaparece; volver a migrar la recrea.
**Ojo:** una migración editada después de aplicarse es *drift* — lo añadido no llega nunca a esa
base. Si hay que corregirla, se corrige **antes** de aplicarla.

### T2. Test de migración contra Postgres real
**Depende de:** T1
**Hacer:** `tests/integration/db/orden-asignacion-sin-ubicacion-migration.test.ts`, con el molde
de `tests/integration/db/orden-nota-migration.test.ts`: esquema temporal dentro de una transacción
que **siempre** se revierte, ejecutando el `migration.sql` **real** sentencia a sentencia, con
`public` en el `search_path` para que las dos FK apunten a las tablas `orden` y `usuario`
**reales**.
**Cubre:** R10, R11, R13, R28.
**Hecho cuando** las cinco aserciones pasan y cada una **falla** si se le quita su línea del SQL:
1. la tabla existe con las cinco columnas y **sin** `updated_at` ni `deleted_at`
   (`information_schema.columns`);
2. `pg_class.relrowsecurity = true` y `pg_policies` vacío para la tabla (R13);
3. las tres FK existen y son `RESTRICT` — se prueba **borrando de verdad** un usuario y una orden
   propios y comprobando que Postgres lo impide;
4. dos autorizaciones sobre la misma orden con huellas distintas dejan **dos** filas (R11);
5. el `down.sql` **real** corre al final y la tabla deja de existir (R28).
**No puede quedar verde por vacío:** crea su propia orden, su propio usuario y sus propias filas.
Si falta `DATABASE_URL`, vitest lo marca **SKIPPED**, nunca `passed` — hay que mirar los
`skipped`.

---

## Bloque B — El contrato y el gate

### T3. Contrato del gate
**Depende de:** —  `[P]` con T1
**Hacer:** en `lib/interfaces/services/IAsignabilidadCoordenadasService.ts` (§5.1):
`"asignable_sin_ubicacion_autorizada"` en `EstadoAsignabilidad` **y** en `EstadoAsignable`;
`autorizacionesSinUbicacion: readonly string[]` en `OrdenAsignabilidadRow`;
`MOTIVOS_AUTORIZABLES_SIN_UBICACION` + `esMotivoAutorizableSinUbicacion`.
**Hecho cuando:**
- `pnpm run typecheck` pasa **y** `MOTIVO_A_MENSAJE` de
  `geocodificacion-motivo-messages.ts` sigue compilando con sus **cinco** entradas (prueba de que
  el estado se clasificó como asignable y no cayó en `EstadoBloqueante`);
- **contraprueba obligatoria:** quitar el valor de `EstadoAsignable` dejando el de
  `EstadoAsignabilidad` **rompe el typecheck** con `TS2741` en ese `Record`. Se ejecuta y se
  anota en `progress/impl_407_backend.md`; si no rompe, el tripwire de la 400 está muerto y hay
  que decirlo antes de seguir.

### T4. Proyección en `findParaAsignabilidad`
**Depende de:** T1, T3
**Hacer:** `lib/repositories/OrdenRepository.ts:2763-2782` añade
`autorizacionesSinUbicacion: { select: { direccionHash: true } }` al `select` y lo aplana en el
`map`. Actualizar el docstring de `IOrdenRepository.findParaAsignabilidad`.
**Hecho cuando** el test de T2 gana un caso que **inserta** una autorización, llama a
`findParaAsignabilidad` con Prisma real y comprueba que la fila devuelta trae esa huella — y que
una orden sin autorizaciones trae `[]`. **Esto no se puede probar con dobles** (§5.5 del design):
un doble devuelve lo que le digas.
⚠️ **Solapa con la ficha 405** en este archivo (métodos distintos). Coordinar con el leader antes
de tocarlo.

### T5. El paso del gate, dentro de la rama R3
**Depende de:** T3
**Hacer:** `lib/services/AsignabilidadCoordenadasService.ts` — el `if` de §5.2, **dentro** de la
rama de `STATUS_DETERMINISTAS`, y el tercer valor en la lista de `esAsignable` (`:227`). Ampliar
la cabecera normativa del archivo con la fila nueva (patrón 368/400).
**Hecho cuando** `tests/unit/services/asignabilidad-coordenadas-autorizada.test.ts` (nuevo) pasa
con estos casos, **cada uno rojo ante su mutación**:
- huella coincidente + `ZERO_RESULTS` + sin coordenadas → `asignable_sin_ubicacion_autorizada` (R14);
- **con coordenadas** + autorización presente → `asignable` (R15) — mutación: mover el `if` fuera
  de la rama R3 lo pone rojo;
- huella de OTRA dirección → `direccion_no_geocodificable` (R16);
- los cuatro estados de cola (`en_curso`, `encolada`, `no_encolable`, `agotada`) con autorización
  presente → **no cambian** (R9);
- `esAsignable("asignable_sin_ubicacion_autorizada") === true` — caso **explícito**, porque la
  lista de `esAsignable` es un array más corto que su tipo y olvidarla **compila** (§5.1 del design).

### T6. No regresión del gate
**Depende de:** T5  `[P]` con T7
**Hacer:** correr `tests/unit/services/asignabilidad-coordenadas.test.ts` **sin tocar ninguna
expectativa**.
**Hecho cuando** pasa entero tal cual está (R27). Si hubo que cambiar una expectativa, el paso
nuevo no es aditivo y hay que volver a T5.

---

## Bloque C — La escritura de la autorización

### T7. Repositorio de autorizaciones
**Depende de:** T1  `[P]` con T6
**Hacer:** `lib/interfaces/repositories/IAutorizacionSinUbicacionRepository.ts` +
`lib/repositories/AutorizacionSinUbicacionRepository.ts` con `registrar(filas)` (§5.4). Solo
Prisma, sin lógica de negocio ni permisos.
**Hecho cuando** T2 gana un caso que llama a `registrar` con dos filas y lee **dos** filas de
vuelta con sus tres campos poblados.

### T8. Servicio de autorización
**Depende de:** T3, T5, T7
**Hacer:** `lib/interfaces/services/IAutorizarAsignacionSinUbicacionService.ts` +
`lib/services/AutorizarAsignacionSinUbicacionService.ts` (§5.3). Rol antes de leer nada; alcance
por zona para `adminSatelite`; clasificación **reusando el gate** (`evaluar`), nunca una copia de
la regla; la condición de autorizable con `esMotivoAutorizableSinUbicacion`.
**Hecho cuando** `tests/unit/services/autorizar-asignacion-sin-ubicacion.test.ts` (nuevo) pasa:
- R1: orden `ZERO_RESULTS` sin coordenadas → se llama a `registrar` **una vez** con la huella de
  su dirección (comparada contra `hashDireccion` de la dirección de la fixture);
- R2 + R9: tabla parametrizada con los cuatro estados de cola →
  `expect(repo.registrar).not.toHaveBeenCalled()`;
- R3: `maestro` y `admin` sobre orden de zona ajena → autorizada;
- R4: `adminSatelite` → su zona autorizada, otra zona `zona_ajena` **y sin escritura**;
- R5: `mensajero` y `adminTienda` → `forbidden`, y **ni una** llamada a `findByIdsForTransicion`
  (se afirma sobre el doble: el rol se comprueba antes de leer);
- R7: lote mixto de 3 → 1 autorizada + 2 rechazadas, **una** sola llamada a `registrar` con **un**
  elemento;
- R8: `resultado.items.length === ordenIds.length` y en el mismo orden;
- R12: orden ya autorizada → `ya_autorizada` y `registrar` no se llama.
**Contraprueba anti-vacío:** los dobles se construyen con `vi.fn()` y cada caso afirma también
sobre lo que **sí** se llamó; un `if (!filas) return;` que reportara verde sin comprobar nada se
caza porque las aserciones son sobre llamadas concretas, no sobre ausencia.

### T9. Borde: Server Action + tipos
**Depende de:** T8
**Hacer:** `lib/types/autorizacion-sin-ubicacion.ts` (zod `.strict()` + `.min(1)`, tipo resultado
cliente) y `lib/actions/autorizar-asignacion-sin-ubicacion.ts` (§5.7), con el molde de
`asignarDesdeBodega`: sesión **antes** del schema, `withErrorHandler`, `deps` inyectables.
**Hecho cuando** `tests/unit/actions/autorizar-asignacion-sin-ubicacion.action.test.ts` (nuevo)
pasa:
- sin actor → `{ status: "unauthenticated" }` **y** el service inyectado no se llamó (R6);
- input inválido (`ordenIds: []`, campo extra) → `validation_error` sin llamar al service;
- passthrough del resultado de dominio sin traducirlo.

---

## Bloque D — Los dos writers

### T10. `GuiaAsignacionService` cuenta la segunda cifra
**Depende de:** T5  `[P]` con T11
**Hacer:** en `gateCoordenadas` (`:197-220`) contar `asignable_sin_ubicacion_autorizada` **antes**
del `continue`, devolverlo en `GateCoordenadasResultado` y exponerlo como
`sinUbicacionAutorizada?: number` en `ok`/`partial` (solo si `> 0`). Actualizar
`IGuiaAsignacionService.ts` y `lib/types/orden-guia.ts`.
**Hecho cuando** `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts` (ampliado) pasa:
- lote con una orden `asignable_sin_ubicacion` (400) y una `..._autorizada` (407) →
  `{ sinUbicacion: 1, sinUbicacionAutorizada: 1 }`, **disjuntas** (R17);
- la orden autorizada aparece en `resultados` y **no** en `bloqueadas` (R14);
- con cero autorizadas, la clave `sinUbicacionAutorizada` **no existe** en el objeto (R18/R27) —
  se afirma con `expect(result).not.toHaveProperty("sinUbicacionAutorizada")`, no con
  `toBeUndefined()`, que pasaría igual si la clave existiera con valor `undefined`.

### T11. `AsignacionSateliteService`, espejo exacto
**Depende de:** T5  `[P]` con T10
**Hacer:** lo mismo en el bloque `4b` (`:273-290`), `IAsignacionSateliteService.ts` y
`lib/types/recepcion-satelite.ts`.
**Hecho cuando** `tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts` (ampliado)
pasa **los mismos tres casos**, espejados. Que se olvide en uno de los dos lados lo caza este par
de archivos: son la pareja que la 400 dejó puesta justo para esto.

---

## Bloque E — Frontend (NO empezar hasta que T10 y T11 estén verdes)

### T12. Los textos, en su único módulo
**Depende de:** T3
**Hacer:** en `app/(app)/_components/geocodificacion-motivo-messages.ts` añadir
`MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION` (§6.1),
`mensajeAsignadasSinUbicacionAutorizada(n)` (§6.2), el `Record<MotivoNoAutorizable, string>` de
§6.3 y el re-export de `esMotivoAutorizableSinUbicacion`. **Copiar los literales carácter a
carácter del design.**
**Hecho cuando** `tests/unit/components/geocodificacion-motivo-messages.test.ts` (ampliado) pasa:
- singular (`n === 1`), plural (`n === 3`) y `n <= 0` → cadena vacía, **con los textos escritos a
  mano en el test** (R20);
- el mapa de §6.3 devuelve un texto por cada motivo, y **añadir un motivo sin texto no compila**
  (contraprueba ejecutada y anotada);
- R22: el literal no contiene ninguna de las cadenas de una fixture de PII (dirección del caso
  medido, `"76068276"`, un uuid) — y la firma solo admite `number`.

### T13. Guardia: los modales no citan literales del gate
**Depende de:** T3  `[P]` con T12
**Hacer:** añadir `"asignable_sin_ubicacion_autorizada"` a `MOTIVOS_DEL_GATE` en
`tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts:39-47` (lista
escrita a mano, por diseño) y añadir un `it` que exija que los dos modales importen
`esMotivoAutorizableSinUbicacion` del **mismo** módulo compartido.
**Hecho cuando** el guardia pasa **y** su contraprueba nueva demuestra que caza un modal que
filtrara por `motivo === "direccion_no_geocodificable"` a mano (R24).

### T14. Guardia: el texto no miente
**Depende de:** T12
**Hacer:** `tests/unit/guards/autorizacion-texto-no-miente.guardia.test.ts` (nuevo). Lee el
**árbol real** de `geocodificacion-motivo-messages.ts` (con `quitarComentarios`) y afirma que el
literal de §6.2 **no** contiene `"no de la dirección"` ni `"problema del sistema"`, y que los dos
mensajes agregados (400 y 407) son **distintos entre sí**.
**Hecho cuando** pasa y su contraprueba demuestra que se pone rojo si alguien hiciera
`mensajeAsignadasSinUbicacionAutorizada = mensajeAsignadasSinUbicacion` (R19).
**Por qué un guardia y no solo un test de comportamiento:** lo que se vigila es que **no vuelva**
un texto retirado; eso se lee del árbol, no de una salida.

### T15. `AsignarBodegaModal`
**Depende de:** T9, T10, T12, T13
**Hacer:** §7.1–§7.3. El `setState` de `autorizables` va **antes** del `throw` existente; el panel
con el literal de §6.1, la lista por `numRemision`, el control y los desenlaces; el aviso agregado
concatenado a la frase que ya existe (`:204-212`).
**Hecho cuando** `tests/components/AsignarBodegaModal.autorizacion.test.tsx` (nuevo) pasa:
- R23-a: la acción devuelve `conflict` con un motivo autorizable → el panel se pinta **y** el
  toast de error sigue saliendo (el comportamiento viejo no se rompe);
- R23-b: la acción devuelve `partial` → el panel se pinta junto a la lista de bloqueadas;
- `conflict` con un motivo **no** autorizable (`geocodificacion_en_curso`) → **no** hay panel;
- R21: el literal de §6.1 está en el documento **antes** de pulsar el control (texto a mano);
- R25: se ve el `numRemision` y **no** aparece el uuid de la orden en el DOM;
- R26: tras autorizar, `asignarDesdeBodega` tiene **una** sola llamada en total (la del intento
  inicial);
- R18: con `sinUbicacionAutorizada: 2` en la respuesta, el mensaje de éxito contiene el texto de
  §6.2 (a mano) y **no** el de la 400.

### T16. `AsignarSateliteModal`
**Depende de:** T9, T11, T12, T13  `[P]` con T15 solo si los dos los hace la misma persona **en
serie**; si no, T16 después de T15 (comparten el módulo de textos).
**Hacer:** espejo exacto de T15 sobre
`app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx`.
**Hecho cuando** `tests/components/AsignarSateliteModal.autorizacion.test.tsx` (nuevo) pasa con
los **mismos siete casos**, y además el caso `zona_ajena`: un desenlace con ese motivo pinta el
texto de §6.3 correspondiente.

---

## Bloque F — Cierre

### T17. Mapa `R<n> → test` y evidencia
**Depende de:** T1–T16
**Hacer:** escribir `progress/impl_407.md` con el mapa completo de `requirements.md` (28 filas),
la salida real de los tests y las **tres contrapruebas ejecutadas** (T3, T12, T14).
**Hecho cuando** ninguna fila del mapa está vacía. Un requisito sin test es hallazgo bloqueante.
⚠️ **Commitear el informe.** Escribirlo y no commitearlo ha pasado tres veces en un día en este
repo, y un `git checkout` se lo lleva.

### T18. Gate completo
**Depende de:** T17
**Hacer:** `./init.sh` **completo**, no `--rapido`. El rápido **se niega solo** con este diff
(`db/schema.prisma`, `db/migrations/**`, `lib/types/**`).
**Hecho cuando:**
- `INIT_EXIT=0` escrito **dentro** del log (un `echo` posterior puede tapar el código de salida);
- el veredicto del baseline no lista ningún archivo nuevo;
- **la cuenta de `skipped` se lee y se anota**: si los archivos de `tests/integration/db` se
  saltaron, R10/R11/R13/R16/R28 **no se verificaron** y la ficha no está hecha, por muy verde que
  esté la corrida.

### T19. Poda del baseline
**Depende de:** T18
**Hacer:** si el gate avisa de que algún archivo de `tests/baseline-rojos.json` volvió a verde,
borrarlo **en este mismo PR**.
**Hecho cuando** el gate no propone ninguna poda pendiente.

---

## Fuera de alcance (declarado, para que nadie lo añada por su cuenta)

- Fijar coordenadas a mano en un mapa (§9-A1, decisión del humano).
- Revocar una autorización (Q4 abierta).
- Mostrar la autorización en el detalle de la orden o en la línea de tiempo (Q2 abierta).
- Una fila en `historial_accion` (Q1 abierta).
- Autorizar `geocodificacion_agotada` (Q3 abierta).
- Tocar `feature_list.json` o `progress/current.md`.
</content>

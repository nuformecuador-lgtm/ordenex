# Ficha 379 — bitácora de implementación (BACKEND)

**Rama:** `fix/379-zona-usuario-cierres-huerfanos` · **Worktree aislado.**
**Alcance de esta bitácora:** backend. El bloque A entra **entero**; del bloque B entra **todo lo
que no es pantalla**. `UsuarioForm.tsx` / `UsuariosModule.tsx` (T9, T11) y la comprobación con los
ojos (T13) son de la tanda de frontend y **no se han tocado**.

**Migración: NO.** Se confirmó lo que dice `design.md` §6: no hay tabla nueva, ni columna, ni valor
de enum (`usuario_zona_cambiada` ya existe desde `20260902120000_historial_accion`), ni backfill
(D2 ocurrió en 0 filas). No se ha tocado la base.

---

## Lo que entró

### Bloque A — la zona sigue al rol (R1-R8) · commit `a69943ea`

`UsuarioService.actualizar` recalcula la zona cuando cambia el **rol**, no solo cuando la petición
trae el campo. Es la forma exacta de la rama del vehículo, doce líneas más abajo en el mismo método,
y llama a la **misma** `resolverZona` que usa el alta (por un helper privado nuevo,
`resolverZonaDeEdicion`, que el bloque B reutiliza tal cual).

**El rastro no se pierde: se crea.** Medido contra Postgres, no razonado: al escribirse
`data.zonaId = null`, `UserRepository.update` escribe ahora `usuario_zona_cambiada` con
`valor_anterior = <nombre de la zona>` y `valor_nuevo = NULL`, **en el mismo `lote_id`** que
`usuario_rol_cambiado`. Antes llegaba `undefined` y **no se escribía ni una fila**. Y sin ruido: si
la zona ya era `null`, `null !== null` es falso y solo queda la fila del rol.

### Bloque B — el aviso, mitad de servidor (R9/R10/R14-R19/R22) · commit `a926916d`

Un solo predicado para las tres puertas (cambiar zona · cambiar rol · desactivar cuenta):

> avisa ⇔ es **hoy** `adminSatelite` activo con zona Z ∧ el cambio hace que deje de serlo para Z ∧
> en Z no queda **ningún otro** `adminSatelite` activo.

- `CierreBodegaRepository.resumirConsolidablesPendientes` reusa `consolidablesWhere` — el mismo
  criterio que la consolidación, no una copia parecida.
- `UserRepository.contarAdminSatelitesActivos` corta los cuatro criterios **en el `WHERE`** y
  excluye al usuario evaluado. Devuelve un número; nunca filas.
- `UsuarioService.consultarImpactoCambio` con los 7 pasos del design en orden (permiso antes de
  leer nada). **Lanza** si le falta el repositorio de cierres o el de zonas.
- Server Action de **solo lectura** + schema **derivado** de `actualizarUsuarioSchema` (que no gana
  ni un campo) + el quinto cable en `buildUsuarioService()`.

**R14 — nada bloquea al maestro.** Los caminos de escritura no consultan el impacto ni miran el
dinero, y se prueba por los dos lados: comportamiento (con dinero atrapado y **cero** admines
restantes, `actualizar` y `cambiarEstado` devuelven `ok` y escriben, y ni preguntan) y guardia
estática con contraprueba sobre los cuerpos de los dos métodos.

---

## Archivos

### Creados
- `tests/integration/db/cierre-bodega-resumen-pendientes.test.ts`
- `tests/integration/db/usuario-contar-adminsatelites.test.ts`
- `tests/unit/services/usuario-impacto-zona.test.ts`
- `tests/unit/guards/379-maestro-sin-bloqueo.guardia.test.ts`

### Modificados — producción
- `lib/services/UsuarioService.ts` — rama de la zona (A), `resolverZonaDeEdicion`,
  `consultarImpactoCambio`, quinto parámetro del constructor.
- `lib/repositories/CierreBodegaRepository.ts` — `resumirConsolidablesPendientes`.
- `lib/repositories/UserRepository.ts` — `contarAdminSatelitesActivos`.
- `lib/interfaces/repositories/ICierreBodegaRepository.ts` — `ResumenConsolidablesPendientes`.
- `lib/interfaces/repositories/IUserRepository.ts` — la firma del recuento.
- `lib/interfaces/services/IUsuarioService.ts` — `CambioUsuarioEvaluable`,
  `ImpactoSalidaAdminSatelite`, `ConsultarImpactoCambioServiceResult`, la firma.
  **`ActualizarUsuarioServiceResult` y `CambiarEstadoUsuarioServiceResult` no se tocaron**: esta
  ficha no añade ninguna rama de bloqueo.
- `lib/types/usuario.ts` — `consultarImpactoCambioUsuarioSchema` (derivado) y su result.
- `lib/actions/usuarios.ts` — `consultarImpactoCambioUsuario` + el quinto cable.

### Modificados — tests
- `tests/unit/services/usuario-zona.test.ts` — R1/R2/R3/R4 nuevos; ninguna aserción borrada.
- `tests/unit/services/usuario-service.test.ts` — el `toEqual` del contrato, ver abajo.
- `tests/integration/db/historial-accion-atomicidad.test.ts` — R5/R6 contra Postgres;
  `sembrarUsuario` gana overrides opcionales (los ocho usos previos no cambian).
- `tests/unit/actions/usuarios.test.ts` — el borde de la consulta previa.
- `tests/unit/actions/usuarios-composition.test.ts` — T10, el quinto cable se **pasa** de verdad.
- `tests/unit/services/usuario-restablecer-contrasena.test.ts` — la trampa de aridad de la 287,
  ver abajo.
- Dobles que implementan `IUserRepository` / `ICierreBodegaRepository` / `IUsuarioService` y que
  el tipo obliga a completar: `auth-service`, `postulacion-login-regresion`, `usuario-vehiculo`,
  `cierre-bodega-service`.

---

## Las cuatro cosas que hay que mirar de frente

**1. El `toEqual` literal — actualizado, no relajado.**
`tests/unit/services/usuario-service.test.ts` gana `zonaId: null` en la lista escrita a mano. Sigue
siendo `toEqual` contra un literal: **no** se pasó a `toMatchObject`, **no** se derivó de `data`.
Quitarle `zonaId: null` lo pone rojo (mutación M6, medida).

**2. Un test existente pedía la zona, y la pedía por R3.**
`usuario-service.test.ts` «editar cambiando rol de adminTienda a otro fuerza fulfillment=false» pasó
a `mensajero` sin enviar zona y ahora es `validation_error` (R3/AS4). Se le añadió `zonaId: "z1"`
por el mismo motivo por el que ya llevaba `vehiculoId: "v1"` — el comentario del propio caso ya
decía «exige vehículo, **igual que zona**». El invariante del `fulfillment` que ese caso mide sigue
intacto.

**3. La trampa de aridad de la feature 287 saltó, y saltó bien.**
`expect(UsuarioService.length).toBe(4)` existe para que nadie cuele un notificador por el
constructor. Se puso roja con el quinto parámetro, se miró el parámetro y se subió a `5` con el
motivo escrito: es `ICierreBodegaRepository`, expone **una lectura agregada**, `restablecerContrasena`
no lo usa (el caso de al lado sigue construyendo con cuatro argumentos y completando), y ningún
camino de escritura lo toca. **Sigue siendo un literal exacto**: relajarlo a `toBeGreaterThan`
desarmaría la trampa para el sexto.

**4. R19 con datos sale CARO, no imposible.** ⚠️ **Este punto decía otra cosa, y era falso.**

Lo que decía: «R19 no se puede probar con datos», porque la columna es `Decimal(12,2)` (máximo
9.999.999.999,99), a esa escala el error de un `double` es ~1e-6, `toFixed(2)` lo redondea de vuelta
al valor exacto, y «haría falta un importe del orden de 4,5e13 para verlo en los céntimos, y esa
fila no cabe». Y lo dejaba escrito **«para que nadie lo reintente»**.

**El error: confundir una FILA con la SUMA.** `resumirConsolidablesPendientes` devuelve un `SUM`, y
un `SUM` no está acotado por `Decimal(12,2)`. Lo levantó el reviewer y lo **remedí yo** con
aritmética exacta en enteros de céntimos:

```
primer N que rompe : 7038 filas al máximo de la columna (9.999.999.999,99)
suma exacta        : 70379999999929.62
vía Number()       : 70379999999929.63      ← un céntimo de más
una sola fila      : 9999999999.99 -> Number().toFixed(2) = 9999999999.99   (idéntico: por eso
                                                             los 3 casos de datos pasaban verdes)
```

Así que la prueba con datos **es alcanzable**; lo que es, es **cara** (sembrar ~7.000 `cierre_dia`
en una transacción revertida para cazar un céntimo). **Decisión mía al cerrar la revisión: no se
escribe, por coste** — R19 ya tiene evidencia que muerde (el barrido estructural sobre el cuerpo sin
comentarios, con contraprueba: con `Number(...)` se pone rojo, remedido por el reviewer como MUT-E1).
Lo que sí se corrigió es **el texto**, aquí y en
`tests/integration/db/cierre-bodega-resumen-pendientes.test.ts`, y se quitó el «para que nadie lo
reintente»: un comentario que afirma una imposibilidad falsa convierte un límite de presupuesto en
un dogma, y es peor que no tener comentario.

---

## El hueco de D2 — lo que esta bitácora declaró cubierto y no lo estaba

**Esto es una corrección, no un añadido.** La tabla de abajo daba `R10 · D1/D2/D3` por cubierto con
un tick verde. **No lo estaba**: la puerta D2 —el cambio de **rol**— no la mordía ningún test, y la
bitácora lo declaraba completo. El reviewer lo midió (`progress/review_379.md`, bloqueante 1) con
una mutación en el paso 5 de `consultarImpactoCambio`:

```ts
const rolResultante = valorDelRol(cambio.rolId ?? actual.rolId);   // real
const rolResultante = valorDelRol(actual.rolId);                   // MUT-B2
```

**Por qué se colaba, que es lo que había que arreglar de verdad:** los tres casos que decían cubrir
D2 cambiaban el rol a `admin`, y **`admin` no lleva zona**. Con la zona resultante en `null`, la
comparación `zonaResultante.zonaId === zonaId` ya falla sola y el aviso sale **aunque la comparación
de rol no existiera**. Estaban verdes por la regla del bloque A, no por la del rol.

`mensajero` es el **otro** rol que sí lleva zona, y `adminSatelite → mensajero en la misma zona` es
exactamente el escenario para el que la ficha existe: la zona conserva a la persona y pierde a quien
puede consolidar su dinero.

**El caso nuevo** vive donde vive la regla —`tests/unit/services/usuario-impacto-zona.test.ts`,
`«⭑ R9/R10 · D2 de verdad: pasar de Admin satelite a MENSAJERO en la MISMA zona tambien avisa»`— y
exige el impacto completo (zona, cuenta e importe) con un `toEqual` contra literales escritos a mano.
Al caso viejo de `admin` **no se le quitó nada**: se le añadió el comentario que dice qué prueba de
verdad (la forma del impacto) y qué no (el rol).

**La demostración, remedida sobre el árbol final** (arnés con autocomprobación: aborta si el texto a
mutar no aparece exactamente una vez, exige verde y línea de resultados de vitest antes de mutar,
restaura releyendo y comparando byte a byte, y vuelve a correr):

```
=== (1) BASELINE, sin mutar ===         Test Files 15 passed (15) · Tests 270 passed (270) · exit 0
=== (2) MUTADO (MUT-B2) ===             Test Files  1 failed | 14 passed (15)
                                        Tests      1 failed | 269 passed (270) · exit 1
  × ⭑ R9/R10 · D2 de verdad: pasar de Admin satelite a MENSAJERO en la MISMA zona tambien avisa
  AssertionError: expected null to deeply equal { zonaNombre: 'San Carlos', …(3) }
=== (3) RESTAURADO, byte a byte ===     Test Files 15 passed (15) · Tests 270 passed (270) · exit 0
```

La selección son los 15 archivos de la ficha, integración incluida (`.env` copiado). **El único rojo
es el caso nuevo**: los otros 269 tests siguen verdes con la mutación puesta, que es la medida
independiente de que el hueco era real y de que nada más lo tapaba.

**La implementación no se tocó.** El bloqueante era la red, no el código.

---

## Mapa R → test

| R | Test | Estado |
| --- | --- | --- |
| R1 | `unit/services/usuario-zona.test.ts` «R1 · cambiar el rol de adminSatelite a admin…» + el literal de `usuario-service.test.ts` | ✅ |
| R2 | `unit/services/usuario-zona.test.ts` «R2 · …conserva la zona actual» | ✅ |
| R3 | `unit/services/usuario-zona.test.ts` «R3 · …validation_error en zonaId y no escribe» | ✅ |
| R4 | `unit/services/usuario-zona.test.ts` «R4 · alta y edicion resuelven la MISMA zona efectiva» (recorre los 3 roles × 2 formas de pedir) | ✅ |
| R5 | `integration/db/historial-accion-atomicidad.test.ts` «⭑ R5: …registra la zona anterior en el MISMO lote» | ✅ Postgres |
| R6 | mismo archivo: «R6: editar solo el telefono…» y «R6: cambiar el rol de un usuario que YA estaba sin zona…» | ✅ Postgres |
| R7 | `unit/services/usuario-zona.test.ts` «no enviar zonaId no toca la zona» (**existente, sin editar**) | ✅ |
| R8 | suite completa verde; el diff de `tests/` solo toca lo declarado arriba | ✅ |
| R9 | `unit/services/usuario-impacto-zona.test.ts` (las 3 puertas) + `unit/actions/usuarios.test.ts` (el borde). **La aserción de ORDEN de llamadas es de pantalla (T11)** | ⚠️ mitad de pantalla pendiente |
| R10 | `unit/services/usuario-impacto-zona.test.ts` D1/D2/D3 + **«⭑ D2 de verdad: adminSatelite → MENSAJERO en la MISMA zona»** | ✅ **corregido** (ver «El hueco de D2») |
| R11 | — | ⛔ T11 (frontend) |
| R12 | — | ⛔ T11 (frontend) |
| R13 | — | ⛔ T11 (frontend) |
| R14 | `unit/guards/379-maestro-sin-bloqueo.guardia.test.ts`: comportamiento (`ok` con dinero atrapado y cero admines, en las tres formas) + guardia estática **con contraprueba** | ✅ |
| R15 | `usuario-impacto-zona`: otro activo / activar / mismo rol y zona | ✅ (el «sin diálogo», T11) |
| R16 | `usuario-impacto-zona`: mensajero / sin zona / ya inactivo | ✅ |
| R17 | `integration/db/usuario-contar-adminsatelites.test.ts` (los 4 cortes + control positivo) + `usuario-impacto-zona` (el argumento excluido) | ✅ Postgres |
| R18 | `integration/db/cierre-bodega-resumen-pendientes.test.ts`: **comparación cruzada** contra `findCierresDiaConsolidables` sobre el mismo dataset + las 4 exclusiones | ✅ Postgres |
| R19 | mismo archivo: STRING escala 2 exacto + barrido estático «sin `Number`/`parseFloat`» con contraprueba; y `usuario-impacto-zona` en el servicio | ✅ (ver punto 4) |
| R20 | `unit/actions/usuarios.test.ts`: el borde devuelve `ActionError` en vez de romper. **El diálogo del §4.6 es T11** | ⚠️ mitad de pantalla pendiente |
| R21 | — | ⛔ T11 (frontend) |
| R22 | `usuario-impacto-zona`: `forbidden` **sin tocar ningún repo** + el impacto sin PII (claves exactas y barrido de valores) + `usuarios.test.ts` sin sesión | ✅ |
| R23 | — | ⛔ T11 (frontend) |

---

## Mutaciones — 21 aplicadas, 21 rojas

El arnés aborta si el texto a mutar no aparece **exactamente una vez** (nada de «superviviente» sin
haber mutado) y restaura el archivo en un `finally` con relectura de comprobación.

### Bloque A (7/7 rojas)
| Mutación | Rojo |
| --- | --- |
| condición vuelve a `input.zonaId !== undefined` | R1, R2, R3, R4, el literal y **R5 (Postgres)** |
| `const deseado = input.zonaId ?? null` | R2 |
| la rama `required` de `resolverZona` devuelve `{ok:true, zonaId:null}` | R3 (+ el caso del alta) |
| sustituir `resolverZonaDeEdicion` por un literal local | R4, R1, R3, R28 |
| entrar siempre en la rama (quitar la condición) | R7 |
| quitar `zonaId: null` del `toEqual` del contrato | el literal |
| forzar `data.zonaId = null` en toda edición | R6 (Postgres) |

### Bloque B (14/14 rojas)
| Mutación | Rojo |
| --- | --- |
| quitar `cierreBodegaId: null` de `consolidablesWhere` | **las dos lecturas**: el resumen (Postgres) y `cierre-bodega-repository` |
| dar al resumen un `where` propio | R18 |
| `Number(_sum).toFixed(2)` | R19 (barrido estático) |
| quitar `id: { not: … }` | R17 (Postgres) |
| quitar `estado: "activo"` | R17 |
| quitar el filtro de rol | R17 |
| invertir el `> 0` del recuento | R15 |
| quitar el filtro de rol del paso 4 | R16 |
| mover el guard de permiso detrás de la lectura | R22 |
| devolver ceros cuando falta el repo de cierres | el caso de inyección |
| no cablear `CierreBodegaRepository` en el composition root | T10 |
| `cambiarEstado` bloquea por dinero | **R14 por los dos lados** (guardia estática y comportamiento) |
| schema `.loose()` | el `.strict()` del borde |
| schema escrito a mano en vez de derivado | el `.strict()` del borde |

---

## Verificación

Salidas reales, sobre el árbol final.

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm run lint
✖ 158 problems (0 errors, 158 warnings)      ← las 158 son preexistentes en `dev`

$ ./init.sh   (COMPLETO; el rápido se niega: el diff toca `lib/types/` y nombres de dinero)
```

**Primera corrida** (log propio, `INIT_EXIT` escrito **dentro**):

```
Test Files  2 failed | 1774 passed (1776)
     Tests  2 failed | 25387 passed | 26 skipped (25415)
Duration  1128.27s
INIT_EXIT=1
```

Los dos rojos, y qué era cada uno:

1. `usuario-restablecer-contrasena.test.ts` — **mío**: la trampa de aridad de la 287. Arreglado
   (punto 3 de arriba).
2. `censo-simpe.test.ts` — **flake de saturación**, no contenido: falló con
   `Test timed out in 20000ms` tras **27.672 ms**, no con una lista de infractores. Es un recorrido
   de sistema de archivos sobre `app/ lib/ tests/ e2e/` leyendo cada archivo. **Aislado pasa en
   1,69 s**, y ese recorrido incluye mis archivos nuevos, así que su contenido está medido.

**Segunda corrida — la que vale**, sobre el árbol final (`42593924`):

```
== Arnes SDD :: init (modo: completo) ==
Test Files  1776 passed (1776)
     Tests  25389 passed | 26 skipped (25415)
Duration  909.73s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1776 ejecutado(s))
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado …   ← deuda ajena, preexistente
✓ .env presente
== init OK ==
INIT_EXIT=0
```

`censo-simpe.test.ts` pasó en **477 ms** en esta corrida (contra los 27.672 ms del timeout de la
primera): flake de saturación confirmado, no contenido.

**Los `skipped` no esconden nada.** Los 26 son 17 + 9 de `AnaliticaPage.test.tsx` y
`AnaliticaShell.test.tsx` (condicionales preexistentes). **No** hay ningún
«sin `DATABASE_URL` … NO se van a ejecutar»: se copió el `.env` de la raíz y los ~78 archivos de
`integration/db` corrieron. Confirmado archivo a archivo en el log de la corrida verde:

```
✓ tests/integration/db/historial-accion-atomicidad.test.ts (22 tests) 973ms
✓ tests/integration/db/cierre-bodega-resumen-pendientes.test.ts (6 tests) 521ms
✓ tests/integration/db/usuario-contar-adminsatelites.test.ts (2 tests) 669ms
✓ tests/unit/guards/379-maestro-sin-bloqueo.guardia.test.ts (11 tests) 23ms
✓ tests/unit/services/usuario-impacto-zona.test.ts (16 tests) 38ms
✓ tests/unit/services/usuario-zona.test.ts (12 tests) 25ms
✓ tests/unit/actions/usuarios-composition.test.ts (2 tests) 497ms
✓ tests/unit/services/usuario-restablecer-contrasena.test.ts (26 tests) 1598ms
```

### Tercera corrida — el CIERRE de la revisión, sobre el árbol de esta tanda

`./init.sh` **completo** (el rápido se sigue negando: el diff toca `lib/`), con el `.env` de la raíz
copiado antes y borrado después, log propio y `INIT_EXIT=$?` escrito **dentro**, sin `tail`:

```
== Arnes SDD :: init (modo: completo) ==
✓ feature_list.json: sin ids duplicados (388 fichas), cupo por zona respetado (in_progress=2)
✓ typecheck paso
✓ lint paso                       ✖ 161 problems (0 errors, 161 warnings)
✓ DATABASE_URL resuelta: los 134 archivos de tests contra Postgres SI se ejecutan
 Test Files  1782 passed (1782)
      Tests  25520 passed | 26 skipped (25546)
   Duration  944.11s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1782 ejecutado(s))
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los `skipped` siguen siendo 26**, los conocidos: `AnaliticaPage.test.tsx (58 tests | 17 skipped)` y
`AnaliticaShell.test.tsx (15 tests | 9 skipped)`. Ni uno más, o sea que ningún archivo se cayó a
mitad.

**Los dos rojos que vio el reviewer salieron VERDES aquí**, y sin trato especial (no se tocaron, no
se añadieron al baseline): `ranking-snapshot-migration.test.ts (49 tests) 1792ms` —entero, **sin los
14 `skipped`** que tuvo en su corrida— y `seed-zonas-cruza-por-codigo.test.ts (8 tests) 834ms`. Es la
medida que confirma su diagnóstico: contención de la base local compartida, no regresión.

Los 15 archivos de la ficha —los mismos que corre el arnés de mutación—, verdes en esta misma
corrida (leídos línea a línea en el log):

```
✓ tests/unit/services/usuario-impacto-zona.test.ts (17 tests)      ← 16 + el caso nuevo de D2
✓ tests/unit/services/usuario-zona.test.ts (12 tests)
✓ tests/unit/services/usuario-service.test.ts (29 tests)
✓ tests/unit/services/usuario-restablecer-contrasena.test.ts (26 tests)
✓ tests/unit/actions/usuarios.test.ts (32 tests)
✓ tests/unit/actions/usuarios-composition.test.ts (2 tests)
✓ tests/unit/components/usuario-form.test.tsx (29 tests)
✓ tests/unit/components/usuarios-module.test.tsx (22 tests)
✓ tests/unit/components/usuarios-aviso-zona.test.tsx (18 tests)
✓ tests/unit/components/usuarios-restablecer.test.tsx (24 tests)
✓ tests/unit/guards/379-maestro-sin-bloqueo.guardia.test.ts (11 tests)
✓ tests/unit/guards/superficie-de-uso.guardia.test.ts (18 tests)
✓ tests/integration/db/historial-accion-atomicidad.test.ts (22 tests)
✓ tests/integration/db/cierre-bodega-resumen-pendientes.test.ts (6 tests)
✓ tests/integration/db/usuario-contar-adminsatelites.test.ts (2 tests)
```

---

## Lo que quedaba de frontend — HECHO (PR #738, `progress/impl_379_frontend.md`)

- **T9** — `UsuarioForm.tsx`: `cambioPendiente()` en el handle, apoyado en el `validate()` que ya
  existe.
- **T11** — `UsuariosModule.tsx`: el diálogo con el copy del `design.md` §4.6, los dos puntos de
  llamada y R11/R12/R13/R20/R21/R23.
- **T13** — verlo en la app (RS2: nadie ha visto este diálogo fuera de jsdom).

⚠️ **El aviso que dejé aquí para quien hiciera T11** decía que la Server Action llevaba la marca
transitoria de excepción de superficie y que **caducaba** en cuanto `UsuariosModule` la llamara.
Ocurrió: T11 la cableó y la marca se retiró. **Este párrafo escribía el nombre de esa marca entre
comillas invertidas**, que es justo lo que el docstring de `restablecerContrasenaUsuario` pide no
hacer —la guardia la busca por texto—; se quitó al cerrar la revisión, igual que en
`lib/actions/usuarios.ts:262`. Aquí no reactivaba nada (la guardia lee `lib/actions/**` y
`components/**`, no `progress/**`), pero el nombre no se escribe por costumbre, no por alcance.

## Veredicto

Bloque A completo y mergeable solo; bloque B entero por el lado del servidor, con el aviso listo
para que la pantalla lo pinte y sin una sola rama que impida nada al maestro. **Tras la revisión:**
el hueco de D2 tapado con un test que muerde (mutación roja medida arriba), las 14 tasks marcadas una
por una contra el árbol, y tres textos corregidos —el de R19, que afirmaba una imposibilidad falsa;
el del ordinal del constructor en el spec; y el nombre de la marca de superficie escrito en prosa—.

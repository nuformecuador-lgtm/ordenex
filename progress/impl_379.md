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

**4. R19 no se puede probar con datos, y está medido.**
La columna es `Decimal(12,2)`: como mucho 9.999.999.999,99. A esa escala el error de un `double` es
~1e-6 y `toFixed(2)` lo redondea de vuelta al valor exacto; haría falta un importe del orden de
4,5e13 para verlo en los céntimos, y esa fila no cabe. **Medido**: con la mutación
`Number(_sum.totalGeneral).toFixed(2)` los tres casos de datos pasaron en **verde**. La evidencia
honesta de R19 es por tanto estructural (barrido sobre el cuerpo sin comentarios, con
contraprueba) y así está escrito en el propio archivo para que nadie lo reintente.

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
| R10 | `unit/services/usuario-impacto-zona.test.ts` D1/D2/D3, con zona, cuenta e importe | ✅ (el contenido del diálogo, T11) |
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

---

## Lo que queda, y es de frontend

- **T9** — `UsuarioForm.tsx`: `cambioPendiente()` en el handle, apoyado en el `validate()` que ya
  existe.
- **T11** — `UsuariosModule.tsx`: el diálogo con el copy del `design.md` §4.6, los dos puntos de
  llamada y R11/R12/R13/R20/R21/R23.
- **T13** — verlo en la app (RS2: nadie ha visto este diálogo fuera de jsdom).

⚠️ **Para quien haga T11:** la Server Action lleva una anotación `@sin-superficie` en
`lib/actions/usuarios.ts` porque hoy no la llama ninguna pantalla. Esa anotación **caduca**: en
cuanto `UsuariosModule` la llame, la guardia de superficie de uso **exige quitarla**. Es
exactamente lo que le pasó a `restablecerContrasenaUsuario` entre su backend y su pantalla.

## Veredicto

Bloque A completo y mergeable solo; bloque B entero por el lado del servidor, con el aviso listo
para que la pantalla lo pinte y sin una sola rama que impida nada al maestro.

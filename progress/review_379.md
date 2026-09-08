# Revision de la ficha 379 — zona de usuario y cierres huerfanos

**Reviewer.** No edito codigo. Rama de trabajo: `worktree-agent-a78bc70e70aa8982b`,
salida de `dev` en `49b9e71f` (merge del PR #738, que ya incluye el #736).

Leido antes de revisar: `CLAUDE.md`, `AGENTS.md`, `CHECKPOINTS.md`, `docs/architecture.md`,
`docs/conventions.md`, `docs/verification.md`, los tres archivos de
`specs/379-zona-usuario-cierres-huerfanos/` y las dos bitacoras
(`progress/impl_379.md` y `progress/impl_379_frontend.md`).

> **Herramienta:** el MCP `codebase-memory` no aparece en el conjunto de esta sesion, asi que la
> busqueda de codigo se hizo con `grep`/`git`/lectura directa de archivo. Se dice explicitamente
> porque la regla 7 de `CLAUDE.md` manda empezar por el grafo. Todo lo que se afirma aqui esta
> confirmado en el archivo real, no en un indice.

---

## Veredicto

**RECHAZADO.** Dos bloqueantes. Ninguno de los dos es un fallo de comportamiento en produccion:
el codigo hace lo que la ficha dice y **no encontre ni un solo camino donde la pantalla o el
servidor le impidan guardar al maestro** (R14, la decision firmada del 2026-09-08). Lo que falla
es la RED: un requisito del bloque B no tiene ningun test que lo muerda —lo medi con una mutacion
que sobrevive a 206 tests— y `tasks.md` sigue con 11 de 14 tareas sin marcar.

---

## 1. Lo que corri yo

### 1.1 `./init.sh` completo — **INIT_EXIT=1**

Con el `.env` de la raiz copiado al worktree antes de correr (y borrado al terminar), y con
`INIT_EXIT=$?` escrito DENTRO del log, sin `tail`:

```
== Arnes SDD :: init (modo: completo) ==
OK feature_list.json: sin ids duplicados (388 fichas), cupo por zona respetado (in_progress=2)
OK typecheck paso
OK lint paso        (161 problems, 0 errors, 161 warnings)
OK DATABASE_URL resuelta: los 134 archivos de tests contra Postgres SI se ejecutan
 Test Files  2 failed | 1780 passed (1782)
      Tests  1 failed | 25504 passed | 40 skipped (25545)
   Duration  926.69s
ROJOS NUEVOS (2 archivo(s) que no estan en el baseline):
  - tests/integration/db/ranking-snapshot-migration.test.ts
  - tests/integration/db/seed-zonas-cruza-por-codigo.test.ts
X hay rojos NUEVOS respecto del baseline
INIT_EXIT=1
```

**Los dos rojos NO son de esta ficha, y esta medido, no supuesto.** Ninguno toca usuarios, zonas
de usuario ni cierres de bodega:

- `ranking-snapshot-migration.test.ts` cae con `40P01: se ha detectado un deadlock` corriendo DDL
  dentro de su transaccion;
- `seed-zonas-cruza-por-codigo.test.ts` (ficha 375, geografia) espera `creados = 1` y recibe `0`:
  el distrito ya existia cuando el test lo fue a crear.

Los corri **aislados dos veces** en este mismo arbol y las dos veces salieron
`Test Files 2 passed | Tests 57 passed`. Es la contencion de la base local COMPARTIDA con el otro
agente que trabaja en paralelo —el modo de fallo que `docs/verification.md` describe—, no una
regresion de la 379. **No se anaden al baseline**: no son deuda medida de nadie, son saturacion.

Los 40 `skipped` tampoco esconden nada: 26 son los conocidos (17 + 9 de `AnaliticaPage.test.tsx` y
`AnaliticaShell.test.tsx`) y los 14 restantes son los del propio archivo que cayo
(`ranking-snapshot-migration.test.ts (49 tests | 14 skipped)`), que aislado corre entero.

**Los 19 archivos de la ficha corrieron y salieron verdes en esa misma corrida**, integracion
incluida (lo comprobe linea a linea en el log):

```
OK tests/unit/components/usuario-form.test.tsx (29 tests)
OK tests/unit/components/usuarios-module.test.tsx (22 tests)
OK tests/unit/components/usuarios-aviso-zona.test.tsx (18 tests)
OK tests/unit/components/usuarios-restablecer.test.tsx (24 tests)
OK tests/unit/services/usuario-impacto-zona.test.ts (16 tests)
OK tests/unit/services/usuario-zona.test.ts (12 tests)
OK tests/unit/services/usuario-service.test.ts (29 tests)
OK tests/unit/services/usuario-restablecer-contrasena.test.ts (26 tests)
OK tests/unit/actions/usuarios.test.ts (32 tests)
OK tests/unit/actions/usuarios-composition.test.ts (2 tests)
OK tests/unit/guards/379-maestro-sin-bloqueo.guardia.test.ts (11 tests)
OK tests/unit/guards/superficie-de-uso.guardia.test.ts (18 tests)
OK tests/integration/db/historial-accion-atomicidad.test.ts (22 tests)
OK tests/integration/db/cierre-bodega-resumen-pendientes.test.ts (6 tests)
OK tests/integration/db/usuario-contar-adminsatelites.test.ts (2 tests)
```

### 1.2 Lint

Comprobado a mano contra el informe completo: **ninguna de las 161 advertencias nombra ninguno de
los archivos de la ficha**. La afirmacion de `progress/impl_379_frontend.md` es cierta.

---

## 2. Mis mutaciones — 14 aplicadas, 13 rojas, **1 SUPERVIVIENTE**

Arnes propio: aborta si el texto a mutar no aparece **exactamente una vez**, restaura en un
`finally` y **relee** el archivo para comprobar que quedo byte a byte igual (si no, se detiene
entero); y antes de mutar nada corre la seleccion SIN mutar exigiendo verde y exigiendo que la
linea `Tests ... passed` exista —si no, el reporte no valdria—. Todas las mutaciones son
DISTINTAS de las 21 del backend y las 16 de la pantalla; se eligieron sitios que nadie toco.

| # | Mutacion | Donde | Resultado |
| --- | --- | --- | --- |
| MUT-A1 | `resolverZonaDeEdicion` ignora el rol PEDIDO (`input.rolId ?? actual.rolId` -> `actual.rolId`) | `UsuarioService` | **ROJA** (3 fallos) |
| MUT-B1 | el estado RESULTANTE ignora el cambio pedido (D3 deja de detectarse) | `UsuarioService` | **ROJA** (4 fallos) |
| **MUT-B2** | **el rol RESULTANTE ignora el cambio pedido (D2 deja de detectarse)** | `UsuarioService` | **SUPERVIVIENTE** |
| MUT-B3 | se deja de comparar la zona resultante con la actual (D1) | `UsuarioService` | **ROJA** |
| MUT-B4 | se quita el corte por `estado = activo` del paso 4 (R16) | `UsuarioService` | **ROJA** |
| MUT-B5 | el servicio NO excluye al evaluado del recuento (R17) | `UsuarioService` | **ROJA** |
| MUT-C1 | el historial se escribe en DOS lotes en vez de uno (R5) | `UserRepository` | **ROJA** (2 fallos, Postgres) |
| MUT-C2 | el recuento de admines pierde el corte por ZONA en el `WHERE` | `UserRepository` | **ROJA** (Postgres) |
| MUT-D1 | la rama R20 pierde el nombre de zona que la FILA sabe | `UsuariosModule` | **ROJA** |
| MUT-D2 | desaparece la rama de CERO cierres (AS1) | `UsuariosModule` | **ROJA** |
| MUT-E1 | el importe pasa por `Number()` — la mutacion central de R19 | `CierreBodegaRepository` | **ROJA** |
| MUT-E2 | `consolidablesWhere` pierde `estado = aprobado` (afecta a las DOS lecturas a la vez) | `CierreBodegaRepository` | **ROJA** |
| MUT-G1 | `cambiarEstado` se ACOPLA al repositorio del dinero (R14, mitad estatica) | `UsuarioService` | **ROJA** |
| MUT-B2 (amplio) | la misma B2, medida contra 13 archivos y **206 tests** | — | **SUPERVIVIENTE** |

MUT-C1 y MUT-G1 valen la pena por separado: la primera confirma que la asercion de `lote_id`
compartido de R5 **muerde de verdad** (no es un adorno), y la segunda que la guardia estatica de
R14 caza el acople antes de que llegue a ser una rama —que es la unica cosa que sostiene por
escrito la decision del humano—.

MUT-E1 confirma lo que la bitacora dice del barrido de R19: con `Number(...)` el barrido se pone
rojo. Ese lado es cierto.

---

## 3. Bloqueantes

### BLOQUEANTE 1 — R10/R9, puerta D2: **el cambio de ROL no lo prueba nada**

`lib/services/UsuarioService.ts` (paso 5 de `consultarImpactoCambio`):

```ts
const zonaResultante = await this.resolverZonaDeEdicion(cambio, actual);
const rolResultante = valorDelRol(cambio.rolId ?? actual.rolId);   // <- esta linea
const estadoResultante = cambio.estado ?? actual.estado;
const sigueSiendoAdminDeLaZona =
  zonaResultante.ok &&
  zonaResultante.zonaId === zonaId &&
  rolResultante === ROL_ADMIN_SATELITE &&
  estadoResultante === "activo";
```

**Sustituyendo `cambio.rolId ?? actual.rolId` por `actual.rolId` —o sea, borrando la mitad del
predicado que responde a la puerta D2— pasan los 206 tests de los 13 archivos de la ficha.**
Nada se pone rojo: ni `usuario-impacto-zona`, ni `usuarios-aviso-zona`, ni la guardia de R14, ni
los tres de `integration/db`.

**Y el mutante NO es equivalente**: cambia el comportamiento en un caso real. Lo medi con una
sonda desechable (escrita, corrida y borrada):

```
usuario: adminSatelite ACTIVO de z1, unico de su zona
cambio pedido: { rolId: "rol-msg" }   // pasa a MENSAJERO, SIN cambiar de zona

codigo real  -> impacto != null   (avisa: la zona se queda sin Admin satelite)  OK
con MUT-B2   -> impacto == null   (NO avisa)                                    MAL
```

**Por que se cuela.** Los tres casos de `usuario-impacto-zona.test.ts` que dicen cubrir D2 cambian
el rol a `admin`, que **no lleva zona**; entonces `resolverZonaDeEdicion` devuelve `null`, la
comparacion `zonaResultante.zonaId === zonaId` ya falla por si sola y el aviso sale igual **aunque
la comparacion de rol no exista**. Dicho de otro modo: el test que se llama
«D2: cambiar el ROL del unico Admin satelite activo» esta verde por la regla del bloque A, no por
la regla del rol. `mensajero` es el OTRO rol con zona, y `adminSatelite -> mensajero en la misma
zona` es exactamente el escenario que la ficha existe para avisar: la zona conserva a la persona,
pero pierde a quien puede consolidar su dinero.

**Lo que falta para cumplirlo:** un caso en `tests/unit/services/usuario-impacto-zona.test.ts` que
cambie el rol de `adminSatelite` a `mensajero` **conservando la zona** y exija `impacto != null`.
Con el, MUT-B2 se pone roja. Es un test, no un cambio de codigo: **la implementacion es correcta**
—el bloqueante es que la red no la cubre, y `progress/impl_379.md` declara ese mapa como completo
(`R10 ... D1/D2/D3` con un tick verde), lo que hoy no es cierto.

### BLOQUEANTE 2 — `tasks.md` con 11 de 14 tareas sin marcar

`CHECKPOINTS.md` exige que **todas** las tasks esten `[x]`. En
`specs/379-zona-usuario-cierres-huerfanos/tasks.md` solo lo estan T9, T11 y T13 (las de la tanda de
pantalla). Siguen en `[ ]` **T1, T2, T3, T4, T5, T6, T7, T8, T10, T12 y T14**, incluidas todas las
del bloque A y el propio cierre. El historial del archivo lo confirma: solo lo tocaron el commit
del spec (`d6f6e0e6`) y el de la pantalla (`84cfca9e`); la tanda de servidor no marco ninguna.

Es documental —el trabajo de esas tareas SI esta hecho y verificado archivo a archivo en esta
revision—, pero es un checkpoint explicito y sin cumplir. **Lo que falta:** marcarlas.

---

## 4. Menores

### menor 1 — «R19 no se puede probar con datos» es FALSO como esta escrito

`progress/impl_379.md` (punto 4) y
`tests/integration/db/cierre-bodega-resumen-pendientes.test.ts:39-52` afirman que una prueba con
datos es imposible: *«haria falta un importe del orden de 4,5e13 para verlo en los centimos, y esa
fila no cabe en la columna»*. Y lo dejan escrito **«para que nadie lo reintente»**.

El razonamiento confunde una FILA con la SUMA. `resumirConsolidablesPendientes` devuelve un
`SUM`, y un `SUM` no esta acotado por `Decimal(12,2)`. **Medido**, no razonado:

```
primer N que rompe: 7038 filas al maximo de la columna (9 999 999 999,99)
suma exacta : 70379999999929.62
via Number() : 70379999999929.63     <- un centimo de mas
```

O sea: la prueba con datos **es alcanzable** (unas 7.000 filas sembradas); lo que es, es cara. Y
de paso: el caso de pantalla usa `9999999999.99`, y a esa escala `Number(x).toFixed(2)` devuelve
el mismo string, asi que ese caso por si solo tampoco prueba «sin coma flotante» —lo que lo
sostiene es usar `formatMontoString`, que la mutacion M6 del implementador si caza—.

**No lo cuento como bloqueante** porque R19 SI tiene evidencia que muerde: el barrido estructural
con contraprueba se pone rojo con `Number(...)` (mi MUT-E1, remedida). Lo que hay que corregir es
la justificacion escrita, que hoy desalienta un test que si se puede escribir.

### menor 2 — el nombre de la anotacion de superficie, escrito otra vez

`lib/actions/usuarios.ts:262` cuenta en prosa que ahi vivia la anotacion de excepcion de
superficie y **la nombra entre comillas invertidas**. Es justo lo que el docstring de
`restablecerContrasenaUsuario`, doce lineas mas arriba en ese mismo archivo, dice que no se haga:
*«la guardia la busca por texto en el comentario pegado al export... hoy no lo hace solo porque va
entre comillas invertidas, que es una red demasiado fina para dejarla puesta»*.

Comprobado: **hoy no reactiva nada** —`superficie-de-uso.guardia.test.ts` corrio con 18 tests en
verde en mi gate, con la accion ya alcanzable desde `UsuariosModule`—, y el modo de fallo si
alguien reformatea el comentario seria un rojo falso, no un verde falso. Menor, pero es una trampa
que el propio archivo ya habia documentado.

### menor 3 — el design dice «sexto parametro» y la implementacion es el QUINTO

`design.md` §4.3 y `tasks.md` T7 dicen que `ICierreBodegaRepository` entra como **sexto** parametro
del constructor. Entro como **quinto**, y es lo correcto (`UsuarioService.length` paso de 4 a 5).
Importa porque ESE numero es la trampa de aridad de la ficha 287: un spec que dice «sexto» y un
test que dice `toBe(5)` invitan a que la proxima persona crea que falta uno.

### menor 4 — cierre de ficha pendiente (es del leader, F2.6)

- `progress/history.md` no tiene entrada de la 379.
- `progress/current.md:17` sigue diciendo «Pantalla en curso: T9, T11, T13», que ya no es verdad.
- `feature_list.json` mantiene la 379 en `in_progress` con un `status_note` que sigue diciendo
  «FALTA LA PANTALLA» y repite el aviso de la anotacion de superficie ya retirada.

---

## 5. Lo que SI esta bien, y lo comprobe una por una

### 5.1 R14 — nada bloquea al maestro. **No encontre ni un camino.**

Es lo que mas pesaba del encargo, asi que lo enumere entero en vez de leerlo por encima:

| Camino | Que puede devolver | Bloquea? |
| --- | --- | --- |
| `UsuarioService.actualizar` | `ok`, `forbidden`, `not_found`, `validation_error{zonaId / vehiculoId / catalogo}` | no: ninguna rama mira dinero ni admines |
| `UsuarioService.cambiarEstado` | identico a antes de la ficha (sin rama nueva) | no |
| `consultarImpactoCambio` | lectura pura; puede LANZAR (falta cableado / zona rota) | no: el borde lo vuelve `ActionError` y la pantalla deja continuar |
| `UsuariosModule.evaluarYAplicar` | 3 salidas: impacto -> aviso, sin impacto -> aplica, error o excepcion -> aviso de R20 | no: las tres terminan en «puedes continuar» |
| `UsuarioForm.cambioPendiente()` | `null` si la validacion de cliente falla | no: el guardado sigue el camino de siempre y tampoco escribe |

`ActualizarUsuarioServiceResult` y `CambiarEstadoUsuarioServiceResult` **no ganaron ni una rama**
(comprobado en `lib/interfaces/services/IUsuarioService.ts`). Y el unico rechazo NUEVO de la ficha
es R3/AS4 —rol con zona sin zona ninguna—, que no es por dinero, esta declarado en el spec y es
inalcanzable desde la pantalla porque `UsuarioForm.validate()` ya lo corta en cliente (`:226`).

La guardia estatica de R14 muerde: MUT-G1 (meter una mencion al repositorio de cierres dentro de
`cambiarEstado`) la pone roja, y el archivo trae su propia contraprueba en memoria.

### 5.2 Las cuatro trampas del repo que se me pidio buscar

- **La asercion contra su propia fuente.** No la hay en los textos del aviso.
  `usuarios-aviso-zona.test.tsx` compara contra literales escritos a mano —«Admin satelite»,
  «Maestro», «Administrador», «4 cierres aprobados sin consolidar», `₡9.999.999.999,99`— y ademas
  exige `not.toMatch(/\badmin\b/)` y `not.toMatch(/\bmaestro\b/)`. No deriva nada de `ROL_LABELS`.
- **El `toEqual` literal.** `usuario-service.test.ts:187` sigue siendo `toEqual` contra una lista
  escrita a mano; solo gano `zonaId: null`. No se relajo a `toMatchObject` ni se derivo de `data`.
  Y la trampa de aridad de la 287 **sigue armada para el sexto**:
  `expect(UsuarioService.length).toBe(5)` es un literal exacto, con el motivo del cambio 4->5
  escrito al lado. Ninguna asercion borrada en todo el diff de `tests/`.
- **El test verde sin datos.** Los tres nuevos de `integration/db` **lanzan** cuando faltan los
  catalogos (`throw new Error("hay DATABASE_URL pero la tabla ... esta vacia")`), no `return`. Y
  llevan control positivo: `expect(r.listado.length).toBe(3)` antes de comparar, y
  `expect(r.conCompanero).toBe(1)` para que un `count` que siempre devuelva 0 no pase.
- **El composition root que no inyecta.** `usuarios-composition.test.ts` ejecuta la accion SIN
  inyectar servicio, captura los argumentos del constructor y exige
  `expect(args[4]).toBeInstanceOf(CierreBodegaRepository)` **y** que el cuarto siga siendo el
  `SessionRepository`. No comprueba el import: comprueba que alguien lo PASA.
- **La guardia que mira solo la primera llamada.** `UserRepository.update` escribe rol, zona y
  `fulfillment` en **una sola** `appendAccion(tx, entradas)` dentro de la transaccion, asi que
  comparten `lote_id`. La asercion de R5 lo exige, y lo verifique partiendola en dos llamadas
  (MUT-C1): se pone roja.
- **La anotacion caducada.** Se borro de verdad y la guardia esta conforme:
  `superficie-de-uso.guardia.test.ts` 18 tests verdes con la accion ya llamada desde
  `UsuariosModule`. El comentario que explica el borrado dice la verdad (con el matiz del menor 2).
- **El test que vive dentro de lo borrado.** La ficha no borro nada: el diff de `tests/` de los
  cuatro commits no tiene una sola asercion eliminada.

---

## 6. Mapa R -> test, verificado en los archivos (no en las bitacoras)

| R | Test que lo muerde | Estado |
| --- | --- | --- |
| R1 | `usuario-zona.test.ts` «R1 · cambiar el rol de adminSatelite a admin deja la zona en null…» + literal de `usuario-service.test.ts:187` | OK |
| R2 | `usuario-zona.test.ts` «R2 · …conserva la zona actual» | OK |
| R3 | `usuario-zona.test.ts` «R3 · …validation_error en zonaId y no escribe» | OK |
| R4 | `usuario-zona.test.ts` «R4 · alta y edicion resuelven la MISMA zona efectiva» (recorre 3 roles x 2 formas y compara las dos SALIDAS) | OK |
| R5 | `integration/db/historial-accion-atomicidad.test.ts` (valor anterior + `lote_id` unico); mordida remedida con MUT-C1 | OK Postgres |
| R6 | mismo archivo, dos casos (telefono / usuario ya sin zona) | OK Postgres |
| R7 | `usuario-zona.test.ts:165` (existente, sin editar) | OK |
| R8 | suite completa; el diff de `tests/` no borra nada | OK |
| R9 | `usuarios-aviso-zona.test.tsx`, orden con `invocationCallOrder` en las DOS puertas | OK |
| **R10** | `usuario-impacto-zona` D1/D3 + contenido del dialogo. **La puerta D2 (cambio de ROL) no la muerde nada: MUT-B2 sobrevive a 206 tests** | **HUECO** |
| R11 | `usuarios-aviso-zona`: cero escrituras con el dialogo abierto, en las dos puertas | OK |
| R12 | `usuarios-aviso-zona`: se corre el flujo con y sin aviso y se comparan los argumentos | OK |
| R13 | `usuarios-aviso-zona`: Cancelar y Escape, cero escrituras | OK |
| R14 | guardia estatica con contraprueba + comportamiento (`ok` con dinero atrapado y cero admines) + «confirmar tras el fallo aplica». Remedido con MUT-G1 | OK |
| R15 | `usuario-impacto-zona` (otro activo / activar / mismo rol y zona) + `usuarios-aviso-zona` (sin dialogo) | OK |
| R16 | `usuario-impacto-zona`: mensajero / sin zona / ya inactivo. Remedido con MUT-B4 | OK |
| R17 | `integration/db/usuario-contar-adminsatelites` (4 cortes + control positivo). Remedido con MUT-C2 (zona) y MUT-B5 (el argumento excluido) | OK Postgres |
| R18 | `integration/db/cierre-bodega-resumen-pendientes`: comparacion cruzada contra `findCierresDiaConsolidables` + control positivo + literal. Remedido con MUT-E2 | OK Postgres |
| R19 | barrido estructural con contraprueba (MUT-E1 roja) + STRING exacto en servicio y en pantalla | OK (ver menor 1) |
| R20 | `usuarios-aviso-zona`: error del borde, `not_found` y llamada que revienta — las tres abren el aviso y dejan continuar. Remedido con MUT-D1 | OK |
| R21 | las dos aserciones de ORDEN de R9 | OK |
| R22 | `usuario-impacto-zona`: `forbidden` sin tocar ningun repo + claves exactas del impacto y barrido de PII; `usuarios.test.ts` sin sesion | OK |
| R23 | `usuarios-aviso-zona`: las tres etiquetas escritas a mano y ningun `RolValue` en crudo | OK |

**22 de 23 con test que muerde. El hueco es R10 en su puerta D2.**

---

## 7. Checklist de `CHECKPOINTS.md`

### Especificacion
- [x] `requirements.md` con 23 requisitos EARS numerados.
- [x] `design.md` con siete alternativas descartadas y su porque (A1-A7).
- [ ] **`tasks.md` con todas las tasks `[x]` — NO: 11 de 14 sin marcar (BLOQUEANTE 2).**

### Trazabilidad
- [ ] **Cada `R<n>` mapea a un test concreto — NO: R10/D2 (BLOQUEANTE 1).**
- [x] Las dos bitacoras contienen su mapa `R -> test` (aunque el de R10 sobredeclara).

### Calidad de codigo
- [x] `pnpm run typecheck` sin errores.
- [x] `pnpm run lint` sin errores (161 warnings, ninguno de la ficha).
- [~] `pnpm test`: los 19 archivos de la ficha en verde; el gate global cierra en `INIT_EXIT=1`
      por dos archivos ajenos que **aislados pasan** (medido dos veces).
- [n/a] E2E: este repo no tiene arnes de E2E ejecutable —los `e2e/*.spec.ts` declaran en su propia
      cabecera «WRITTEN but NOT EXECUTED»—. El riesgo lo cubre T13, que se hizo con navegador real
      y dejo el `innerText` del dialogo copiado en la bitacora.

### Datos y seguridad
- [n/a] RLS: no hay tabla nueva.
- [n/a] Migraciones: la ficha no lleva ninguna, y esta justificado por las cuatro vias que podrian
      haberla pedido (`design.md` §6). `usuario_zona_cambiada` ya existia desde
      `20260902120000_historial_accion` — verificado en `db/schema.prisma`.
- [x] Sin secretos hardcodeados.
- [n/a] Webhooks: ninguno.

### Patron de capas
- [x] La accion no lleva logica: `withErrorHandler` + actor + `idSchema` + schema + delegar.
- [x] El servicio no conoce HTTP.
- [x] Los dos metodos nuevos de repositorio son solo Prisma (`aggregate` y `count`), con los cuatro
      cortes **en el `WHERE`** y ninguno en memoria.
- [x] Contratos en `lib/interfaces/`, separados por categoria.

### Permisos
- [x] `consultarImpactoCambio` usa el MISMO `ALLOWED_ROLES` del modulo, y el guard va ANTES de
      leer una sola fila (medido: el test exige que ningun repo se haya tocado).
- [x] El impacto no lleva PII: cuatro claves exactas y barrido de valores.
- [x] Mutacion interna por Server Action, no por route handler.

### Multi-pais
- [x] Nada de pais, moneda ni cuenta hardcodeado; el importe se formatea con `formatMontoString`.

### Verificacion final
- [ ] `./init.sh` en verde: **no en esta maquina** (dos rojos ajenos y medidos, ver §1.1).
- [x] Este archivo existe.
- [ ] Entrada en `progress/history.md`: falta (paso F2.6 del leader).

---

## 8. Que hace falta para que esto sea OK

1. **Un caso de test** en `tests/unit/services/usuario-impacto-zona.test.ts`: cambiar el rol de un
   `adminSatelite` unico de su zona a **`mensajero` conservando la zona**, y exigir
   `impacto != null` (con el nombre de zona, la cuenta y el importe). Comprobar que con
   `const rolResultante = valorDelRol(actual.rolId);` ese caso se pone ROJO. Y corregir el mapa de
   `progress/impl_379.md`, que hoy declara D2 cubierto.
2. **Marcar `[x]`** las once tareas hechas de `tasks.md` (T1-T8, T10, T12, T14).
3. Opcional pero recomendado: reescribir la nota de R19 —en la bitacora y en
   `tests/integration/db/cierre-bodega-resumen-pendientes.test.ts:39-52`— para que diga lo que es
   verdad («haria falta sembrar ~7.038 filas al maximo de la columna; se juzgo desproporcionado»)
   en vez de «no se puede».

Nada de esto toca el comportamiento. La ficha, funcionalmente, hace lo que la decision del humano
pidio: dice el numero y no le quita al maestro ni un solo camino.

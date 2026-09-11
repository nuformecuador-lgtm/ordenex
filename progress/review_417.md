# review 417 — el ámbito del aviso agregado se decide en su propio seam

- **Revisado:** PR **#779**, rama `feat/417-alcance-aviso-satelite-sin-zona`, base `dev` (`2f32c2d2`).
- **Cabeza revisada: `c5b40eff`** — **no `065b477c`**. El encargo decía «tres commits, cabeza en
  `065b477c`»; al empezar la revisión la rama ya tenía **cuatro**, con `c5b40eff` encima
  (`docs(417): T8.1 medida contra produccion — 10 satelites, cero sin zona`). Ese cuarto commit es
  **solo documentación** (`progress/impl_417.md` + `specs/.../tasks.md`): el diff entre ambos no
  toca ni una línea de `lib/` ni de `tests/`. El código revisado es el mismo.
- **Método:** worktree aislado y desacoplado en `R:\wt\rev417` (detached en `c5b40eff`,
  `node_modules` por junction, `.env` copiado). Ni una edición en el árbol principal ni en la rama
  del implementador. Las cinco mutaciones las apliqué **yo**, revirtiendo entre cada una y
  comprobando árbol limpio.

---

## Veredicto

# OK

**Cero bloqueantes.** Los diez requisitos tienen un test que los verifica de verdad —lo demostré
matando las cinco mutaciones yo mismo—, las tareas están todas marcadas, el alcance es exactamente
el declarado y **el entregable real de la ficha (el rojo propio) existe y es propio**: sale de este
seam con el predicado ajeno de la 146 intacto, medido en la misma corrida.

---

## 1. El punto entero: M1 y M4 reaplicadas por mí, con el predicado ajeno intacto

Partida: árbol limpio, **46/46 verdes** en `vigencia-aviso-agregado.test.ts` +
`notificacion-service.test.ts`.

### M1 — retirar la guarda de zona (volver al código pre-ficha)

El diff que apliqué es exactamente la línea pre-ficha, ni una más: se quitan las dos guardas de la
rama de represadas y se deja
`const zonaId = actor.rol === "adminSatelite" ? (actor.zonaId ?? null) : null;`

**Las dos mitades, en la misma corrida:**

```
$ git diff --stat -- lib/repositories/NotificacionRepository.ts
(SIN SALIDA — el predicado de la 146 sin una línea cambiada)

$ git status --short
 M lib/services/VigenciaAvisoAgregadoService.ts        <- el ÚNICO archivo tocado

       × R1 — con zonaId: null no se consulta NINGUN ambito
       × R1 — con zonaId ausente no se consulta NINGUN ambito
       × R1 — con zonaId vacio no se consulta NINGUN ambito
       × R2 — con zonaId: null falla NOMBRANDO la causa
       × R2 — con zonaId ausente falla NOMBRANDO la causa
       × R2 — con zonaId vacio falla NOMBRANDO la causa
     × adminSatelite sin zona + un aviso de represadas: se ve el texto, no el total, y el log lo dice
 Test Files  2 failed (2)
      Tests  7 failed | 39 passed (46)
```

**7 rojos. Confirmado el número que declaró el implementador.**

Y el aserto de R9 dice literalmente lo que se afirmó, palabra por palabra:

```
AssertionError: expected '7 órdenes esperan volver a su tienda' to be 'La más antigua lleva 8 días en bodega…'
Expected: "La más antigua lleva 8 días en bodega. Coordiná la devolución."
Received: "7 órdenes esperan volver a su tienda"
```

**Y ese 7 es el total del sistema, verificado en el archivo real** (no de palabra):
`AvisoAgregadoRepository.contarRepresadas` devuelve `filas.length` cuando el ámbito es `null`, y
solo filtra por zona cuando no lo es. Con la guarda retirada el ámbito pedido **es** `null`, o sea
todas las zonas. El satélite leería el número de OTRA bodega, y el test lo pone en pantalla con esas
palabras.

### M4 — retirar la guarda de rol de `novedades_sin_gestionar`

```
$ git diff --stat -- lib/repositories/NotificacionRepository.ts
(SIN SALIDA — el predicado de la 146 intacto, otra vez)

     × R3 — con un maestro no se cuenta nada con su usuarioId          (called 1 times)
     × R3 — con un adminSatelite no se cuenta nada con su usuarioId    (called 1 times)
     × R4 — con un maestro falla NOMBRANDO la causa                    (promise resolved "5")
     × R4 — con un adminSatelite falla NOMBRANDO la causa
     × R4 — ni siquiera devuelve el 0 que el repositorio daria         (promise resolved "+0")
 Test Files  1 failed | 1 passed (2)
      Tests  5 failed | 41 passed (46)
```

**5 rojos. Confirmado.**

### La otra mitad de la afirmación: «antes, esto dejaba la suite entera en verde»

No me bastó con su palabra. Restauré los cuatro archivos a `2f32c2d2` (estado pre-ficha, el defecto
vivo) y corrí el mismo par:

```
$ grep -n 'zonaId = actor.rol' lib/services/VigenciaAvisoAgregadoService.ts
39:      const zonaId = actor.rol === "adminSatelite" ? (actor.zonaId ?? null) : null;

 Test Files  2 passed (2)
      Tests  35 passed (35)
```

**Verde entero, con el defecto delante y en la línea 39 exacta que el spec anotó.** Eso es lo que la
ficha vino a cambiar, y lo cambió: **R10 cumplido y medido, no argumentado.**

### Las otras tres, también corridas por mí

| # | Mutación | Rojos (míos) | Rojos (declarados) | Coincide |
| --- | --- | --- | --- | --- |
| M1 | quitar la guarda de zona | **7** | 7 | sí |
| M2 | ese lanzamiento a `return 0` | **4** | 4 | sí |
| M3 | la guarda de zona dispara siempre | **2** | 2 | sí |
| M4 | quitar la guarda de rol | **5** | 5 | sí |
| M5 | la guarda de rol dispara siempre | **1** | 1 | sí |

**Las cinco muertas. Cero supervivientes.** En las cinco comprobé `git status --short` (un único
archivo modificado) y el `git diff --stat` del predicado ajeno (vacío).

---

## 2. El test derogado — mi juicio: la derogación es LEGÍTIMA

Es el punto donde más fácil era colar un borrado incómodo, así que lo verifiqué por partes en vez de
aceptar el razonamiento:

1. **El cuerpo viejo existía y era el que se cita.** En `2f32c2d2`, líneas 83-92: el titular era «un
   adminSatelite SIN zona **no ve el total**» y el aserto,
   `expect(repo.contarRepresadas.mock.calls[0][1]).toBeNull()`. **El titular prometía una protección
   y el cuerpo certificaba lo contrario**, porque `null` **es** el total (verificado arriba en
   `contarRepresadas`, en el archivo real). No era un contrato: era el defecto escrito como
   expectativa. **Polizón, no contrato.**
2. **El contrato de `null` NO se fue con él.** Vive en otro caso del mismo archivo —«maestro y admin
   lo piden GLOBAL (`null`)», líneas 75-80— con el **mismo** `toBeNull()`, y ese caso **sale intacto
   del diff** y sigue verde. Se derogó el polizón y **se conservó el contrato**, que es exactamente
   la distinción correcta.
3. **El motivo está escrito DENTRO del archivo**, con el cuerpo viejo citado y el porqué, no solo en
   el mensaje de commit.
4. **Lo sustituido es estrictamente más fuerte:** 1 caso débil pasa a 6 casos más 1 de extremo a
   extremo, y **demostré que ninguno está verde por vacío** (M1 mata 7 de ellos; M3/M5 ponen rojos
   los controles positivos).

**No hay borrado de test incómodo aquí.** Único matiz, trivial: la cita dentro del archivo condensa
la llamada multilínea en una y omite el `const repo = repoEspia();`. El aserto —lo que carga— es
verbatim, y la bitácora sí cita el cuerpo entero exacto. Ni siquiera lo cuento como hallazgo.

---

## 3. Lo demás, comprobado punto por punto

**R5-R7 salen intactos del diff — comprobado con el diff, no con su palabra.** El archivo de test
tiene **8 líneas borradas en total**, y las ocho son del caso derogado (contadas con
`grep -c` sobre las líneas `-` del diff de ese archivo). Los tres casos vigentes (R5 la zona del
satélite, R6 el global de maestro/admin, R7 la tienda) **no aparecen en el diff**. Son control
positivo real: M3 pone rojo R5 y M5 pone rojo R7.

**M2 y el modo mudo: la separación de R1 y R2 es REAL, y M2 demuestra lo que dice.** Lo corrí: con
`return 0`, **R1 se queda verde** (el repositorio efectivamente no se llama) y **solo R2 se pone
rojo** (`promise resolved "+0" instead of rejecting`). Sin esa separación, dos rojos simultáneos
habrían tapado cuál mitad se rompió; separados, el rojo dice *qué* se perdió. Y R9 bajo M2 falla con
`expected [] to deeply equal [ 'agg' ]`: con `return 0` **el aviso no sale en absoluto**, en vez de
salir sin número. La afirmación «la ficha exige ruido, no silencio» está **medida**, no razonada.

**El caso espejo: los tres hechos son ciertos, verificados en los archivos reales.**

| Hecho | Verificación |
| --- | --- |
| Un solo productor | `emitirNovedadesSinGestionar` tiene **una sola** llamada en todo `lib/` + `app/`: `notificadores.ts:372`, alcanzable solo desde `app/api/cron/avisos-diarios/route.ts` |
| Emite siempre a rol, nunca a usuario | `emitir.ts:1059`, literal: `destinatario: { tipo: "rol", rol: "adminTienda", tiendaId: ctx.tiendaId }` |
| El catálogo lo declara | `catalogo-avisos.ts`: `novedades_sin_gestionar: { ..., destinatarios: ["adminTienda"] }` |

**Y la guarda nueva NO rompe el camino vigente** — lo verifiqué aparte, porque era el riesgo real de
la simetría: `predicadoVisibilidad` cuelga su segundo término de `destinatarioRol: actor.rol`, y esas
filas se escriben con `destinatarioRol = adminTienda` y `destinatarioUsuarioId = null`. Un `maestro`
**no puede ver** una fila de ese evento (ni por el primer término ni por el segundo), así que **nunca
llega a `cifra` con ese evento**. El único actor que llega es el `adminTienda` que **es** esa tienda,
y ése pasa la guarda. **Cero cambio de comportamiento en el camino vivo.**

**Alcance: confirmado en el diff.** Los cuatro commits tocan **6 archivos y ninguno más**:

```
 lib/interfaces/services/IVigenciaAvisoAgregado.ts   |  12 +     solo comentario, sin cambio de firma
 lib/services/VigenciaAvisoAgregadoService.ts        |  52 ++-   único cambio de comportamiento
 progress/impl_417.md                                | 401 +++
 specs/417-alcance-aviso-satelite-sin-zona/tasks.md  |  66 ++--
 tests/unit/services/notificacion-service.test.ts    |  68 ++++  solo añade
 tests/unit/services/vigencia-aviso-agregado.test.ts | 101 +++-

$ git diff --stat 2f32c2d2 c5b40eff -- db/ app/ components/       -> VACÍO
$ git diff --stat 2f32c2d2 c5b40eff -- tests/baseline-rojos.json  -> VACÍO
```

**R8 verificado por diff y por corrida:** `NotificacionRepository.ts` y
`notificacion-visibilidad.test.ts` con diff **vacío**, y esa suite **12/12 verde sin haberse
editado**.

**El composition root sí inyecta.** Comprobé que alguien lo *pasa*, no solo que existe:
`lib/actions/notificaciones.ts:57` construye `new VigenciaAvisoAgregadoService(...)`. El cambio está
vivo, no es un servicio huérfano.

---

## 4. El gate: mi corrida NO fue verde, y por qué no es de esta ficha

Corrí `./init.sh --rapido` yo mismo en el worktree aislado, con `INIT_EXIT` escrito **dentro** del
log y sin canalizar por `tail`:

```
== Arnes SDD :: init (modo: rapido) ==
✓ feature_list.json: sin ids duplicados (412 fichas), cupo por zona respetado (in_progress=3)
✓ el cambio no toca esquema, tipos compartidos, config ni dinero: el modo rapido basta
✓ typecheck paso
  test:cambiados   Test Files  1 failed | 63 passed (64)   Tests  2 failed | 784 passed | 26 skipped
  test:guardias    Test Files 211 passed (211)             Tests  3100 passed (3100)
ROJOS NUEVOS (1 archivo(s) que no estan en el baseline):
  - tests/integration/wallet-page.test.tsx
INIT_EXIT=1
```

**Las dos corridas, como manda el arnés.** El propio gate dice que antes de darlo por ajeno se corra
aislado. Lo hice **tres veces**:

```
corrida aislada #1   Test Files 1 passed (1)   Tests 12 passed (12)
corrida aislada #2   Test Files 1 passed (1)   Tests 12 passed (12)
corrida aislada #3   Test Files 1 passed (1)   Tests 12 passed (12)
```

**Flake de saturación, no deuda ni regresión**, y el modo de fallo lo confirma: el primer rojo es
`Error: Test timed out in 20000ms` y el segundo es su **cascada** (`expected "vi.fn()" to be called
1 times, but got 2 times`: el render que se quedó colgado filtró una segunda llamada al caso
siguiente). El archivo es `WalletPage — control de acceso por rol`: **no toca notificaciones, ni
avisos agregados, ni nada de esta ficha**, y el árbol estaba limpio. Había una docena larga de
worktrees de otros agentes vivos durante la corrida (`import 529s`, `environment 348s`: contención
evidente). No lo cuento contra la ficha, y **no toqué `baseline-rojos.json`**.

**Todo lo demás del gate reproduce lo que declaró el implementador, comprobado en MI log:**

| Afirmación suya | Mi log |
| --- | --- |
| el rápido NO se negó | sí, literal: «el cambio no toca esquema, tipos compartidos, config ni dinero» |
| ¿debería haberse negado? | **NO.** El diff no toca migraciones, `db/schema.prisma`, `lib/types/`, config de build ni archivos de dinero. `lib/interfaces/` no es `lib/types/` y el cambio ahí es **solo comentario**. **El gate acertó** |
| 275 archivos | sí: 64 + 211 = 275 |
| 3 de `integration/db`, 45 tests, verdes | sí: `analytics-daily-guards` (26), `zona-central-guarda-y-rastro` (17), `zona-guardado-conserva-inactivos` (2) = **45**, los tres verdes |
| el rojo ajeno `notificacion-evento-*-migration` no apareció | sí: **0 ocurrencias** en el log, el modo rápido no lo selecciona |
| sin `40P01` | sí: 0 ocurrencias |
| 26 skipped, ninguno de `integration/db` | sí: los 26 son de `AnaliticaPage` (17) y `AnaliticaShell` (9) |
| los tests del seam, verdes en el gate | sí: `vigencia-aviso-agregado` (18) + `notificacion-service` (28) = **46** |

---

## 5. CHECKPOINTS.md, punto por punto

| Punto | Estado |
| --- | --- |
| `requirements.md` con EARS numerados | OK — R1 a R10 |
| `design.md` con alternativa descartada y su porqué | OK — §6 con **seis** (A-F), cada una con su motivo |
| `tasks.md` todas marcadas `[x]` | OK — incluida T8.1, medida en producción en el 4.º commit |
| Cada `R<n>` mapea a un test concreto | OK — los diez, y **ninguno vacío**: lo probé matando las cinco mutaciones |
| `progress/impl_417.md` con el mapa `R<n> → test` | OK |
| `typecheck` sin errores | OK en mi corrida |
| `lint` sin errores | OK (warnings preexistentes y ajenos) |
| `pnpm test` | ATENCIÓN — ver §4: único rojo ajeno, verde 3/3 aislado |
| E2E para flujo crítico | N/A — no toca auth, pagos, recaudo, ingesta ni webhooks; y este repo no tiene arnés E2E |
| RLS en tabla nueva | N/A — sin `db/`, sin tabla, sin columna |
| Migración reversible con `down.sql` | N/A — sin migración |
| Sin secretos hardcodeados | OK — ninguno; los mensajes de error **no llevan PII** y hay un aserto que lo fija |
| Webhooks con firma e idempotencia | N/A — no hay webhook |
| Capas separadas | OK — la guarda va en el **service**, que es quien deriva el ámbito del actor; el repositorio no cambia y `null` sigue siendo legítimo allí. Sin HTTP en el service. Interfaces en `lib/interfaces/` |
| Sin hardcode de país/moneda/contexto | OK |
| `progress/review_417.md` con veredicto OK | OK — este archivo |
| Entrada en `progress/history.md` | PENDIENTE — ver hallazgo menor 4 |

---

## Hallazgos

**BLOQUEANTES: ninguno.**

- **menor 1 — La cabeza del PR no es la que decía el encargo.** Son **4** commits con cabeza
  `c5b40eff`, no 3 con `065b477c`. El cuarto es **solo docs** (T8.1 medida en producción y las
  casillas), sin una línea de `lib/` ni de `tests/`. Revisé `c5b40eff`. Sin impacto.
- **menor 2 — Mi gate dio `INIT_EXIT=1` por un rojo ajeno.**
  `tests/integration/wallet-page.test.tsx` (timeout de 20 s más su cascada), **verde 3/3 aislado**,
  archivo sin relación con la ficha, bajo contención evidente de otros worktrees. No es de esta
  ficha y no se tocó el baseline. Queda dicho porque el checkpoint pide el gate en verde: la corrida
  del implementador y la mía **solo difieren en esto**.
- **menor 3 — El mismo defecto queda residual en la rama de represadas, por forma.** La guarda de
  tienda es una **lista blanca** (`rol !== "adminTienda"` lanza), pero la de zona sigue siendo una
  **lista negra**: si el rol no es `adminSatelite`, se pide el ámbito global. Con seis roles en el
  esquema (`maestro`, `admin`, `mensajero`, `adminTienda`, `adminSatelite`, `apiKey`), eso sigue
  dando **el total del sistema** a `mensajero`, `adminTienda` y `apiKey` si alguna vez llegaran ahí.
  **Hoy es inalcanzable** —lo verifiqué: la emisión de represadas solo apunta a maestro/admin y a
  `{rol: adminSatelite, zonaId}`— **pero es inalcanzable por exactamente la misma herencia que esta
  ficha existe para dejar de confiar**. No es incumplimiento: R6 solo exige que maestro/admin
  conserven el global, y cerrarlo habría sido alcance de más sobre una ficha declarada mínima. Lo
  dejo anotado como la continuación natural, no como deuda que bloquee.
- **menor 4 — Sin entrada en `progress/history.md`.** El checkpoint la pide. El precedente del repo
  es que se añade **al cierre** (`chore(NNN): cerrada...`) y normalmente tras el merge, no en la rama
  de la feature. Queda para el cierre; no es defecto de la implementación.

### Trampas buscadas expresamente, y qué encontré

| Trampa | Resultado |
| --- | --- |
| **Aserción contra su propia fuente** | **No la hay.** Los cuatro literales de mensaje van escritos a mano en el test (`/no tiene zona asignada/i`, `/no es una tienda/i`, `/vigencia del aviso agregado/i`, `"7 órdenes esperan volver a su tienda"`); nada importado de producción. Y el literal del título quedó **validado por la mutación**: bajo M1 el `Received` es exactamente esa cadena, así que el `not.toBe` no es un literal muerto |
| **Test verde sin datos** | **No lo hay, y no lo doy por razonado: está medido.** Los `it.each` no están vacíos —M1 los pone rojos **uno a uno**, los seis por nombre, y M4 los dos del espejo—, y los `not.toHaveBeenCalled()` van acompañados de un `rejects.toThrow` **con la causa nombrada**, no un error cualquiera |
| **Literal: contrato o polizón** | **Resuelto correctamente**, y es el punto 1 de arriba: el `toBeNull()` derogado era polizón, y el `toBeNull()` que **sí** es contrato (maestro/admin) sigue vivo e intacto |
| **40P01** | 0 ocurrencias |

---

## Lo que esta revisión sostiene, en una línea

El entregable de la ficha **no es el arreglo, es el rojo**, y **el rojo existe y es propio**: lo
reaplicé yo, sale de este seam, y sale **con `lib/repositories/NotificacionRepository.ts` sin una
sola línea cambiada** en la misma corrida — mientras que el mismo estado, antes de la ficha, dejaba
la suite **entera en verde**. Eso es todo lo que separa una protección heredada de una afirmada, y
está medido.

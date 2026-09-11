# review 418 — el aviso de represadas decide su ámbito por lista blanca, no por lista negra

- **Revisado:** PR **#782**, rama `feat/418-alcance-represadas-lista-blanca`, cabeza **`e7b7e9ce`**,
  base `origin/dev` (`becdc57c`). `git merge-base` = `becdc57c` = `origin/dev` exacto: **la rama
  está al día**, no hay `dev` viejo debajo.
- **Método:** worktree propio y aislado en `.claude/worktrees/rev418` (detached en `e7b7e9ce`,
  `pnpm install` + `prisma generate` dentro, `.env` copiado del worktree del implementador). **Ni
  una edición en el árbol principal ni en el del implementador.** Las **siete** mutaciones las
  apliqué yo, más **una octava propia** (M7). Entre cada una restauré desde copia en scratchpad y
  comprobé árbol limpio. **No usé `git checkout --` en ningún momento** (restauré por `cp` desde
  copia y por `git show <sha>:<ruta>`).
- **Gate y mutaciones NO en paralelo:** el gate corrió con el árbol en su estado commiteado, y las
  mutaciones antes y después. En ningún momento hubo un árbol mutado bajo el gate.

---

## Veredicto

# OK

**Cero bloqueantes.** Los once requisitos tienen un test que los verifica de verdad —abrí los
cuerpos y maté las mutaciones yo mismo—, las tareas están marcadas salvo T8.1 (sin marcar **a
propósito, y el motivo lo verifiqué independientemente**), y **el entregable real de la ficha —el
rojo, en sus dos mitades— se sostiene medido, no argumentado**.

---

## 1. EL ENTREGABLE: las dos mitades del rojo, reaplicadas por mí

Punto de partida y de llegada, medido: **57/57 verdes** en
`tests/unit/services/vigencia-aviso-agregado.test.ts` + `tests/unit/services/notificacion-service.test.ts`.

### M1 — quitar la guarda pone algo en ROJO por sí mismo

Sustituí el mapa por la lista negra literal de antes de la ficha
(`if (actor.rol !== "adminSatelite") return this.repo.contarRepresadas(this.ancladaAntesDe(), null);`).
**En la misma corrida**, antes de lanzar los tests:

```
$ git status --short
 M lib/services/VigenciaAvisoAgregadoService.ts      <- UN SOLO archivo

$ git diff --stat -- lib/repositories/NotificacionRepository.ts
(SIN SALIDA — el predicado ajeno de la 146, intacto)
```

```
     x R3 — con un mensajero no se consulta NINGUN ambito
     x R3 — con un adminTienda no se consulta NINGUN ambito
     x R3 — con un apiKey no se consulta NINGUN ambito
     x R4 — con un mensajero falla NOMBRANDO la causa
     x R4 — con un adminTienda falla NOMBRANDO la causa
     x R4 — con un apiKey falla NOMBRANDO la causa
     x R4 — ni siquiera devuelve el 7 que el repositorio daria: ese 7 ES el total del sistema
     x R6 — el error NO es el de las otras dos guardas del mismo metodo, y no lleva el usuarioId
     x R5 — el catalogo ENTERO de roles queda clasificado: lo que no esta enumerado NO obtiene cifra
     x mensajero + un aviso de represadas: se ve el texto, NUNCA el total del sistema, y el log lo dice
 Test Files  2 failed (2)
      Tests  10 failed | 47 passed (57)
```

**10 rojos, exactamente los que reporta la bitácora, con `NotificacionRepository.ts` de diff vacío
medido en la misma corrida.** El rojo es propio del seam, no prestado.

Y el aserto de R10 **enseña el defecto en palabras**, que es lo que valida que el rojo dice lo que
dice:

```
AssertionError: expected '7 órdenes esperan volver a su tienda' to be 'La más antigua lleva 8 días en bodega…'
Received: "7 órdenes esperan volver a su tienda"
```

Ese 7 es el total del sistema del repositorio espía. Verifiqué que el literal es el que compone
`tituloDevolucionesRepresadas(7)` (`lib/notificaciones/catalogo-avisos.ts`) y que en el test va
**escrito a mano**, no importado.

### M1b — LA CONTRAPRUEBA, la mitad que casi nadie hace

Restauré **los cuatro archivos** al `dev` de partida con `git show becdc57c:<ruta> > <ruta>`
(comprobé antes que los cuatro son **idénticos** entre `bd3233aa` —el `dev` que usó el
implementador— y `becdc57c` —el `dev` de hoy—, así que la medida es la misma):

```
$ git status --short
 M lib/interfaces/services/IVigenciaAvisoAgregado.ts
 M lib/services/VigenciaAvisoAgregadoService.ts
 M tests/unit/services/notificacion-service.test.ts
 M tests/unit/services/vigencia-aviso-agregado.test.ts

$ grep -n 'actor.rol !== "adminSatelite"' lib/services/VigenciaAvisoAgregadoService.ts
72:      if (actor.rol !== "adminSatelite") {          <- EL DEFECTO, delante

 Test Files  2 passed (2)
      Tests  46 passed (46)
```

**46/46 VERDE con el defecto en la línea 72 exacta.** Ésta es la mitad que convierte «antes esto no
lo veía nadie» en una medida: **46 casos mirando la lista negra de frente sin inmutarse**. Hoy la
misma retirada cuesta 10 rojos. Las dos mitades de **R11** se sostienen.

### Las otras cinco, reaplicadas y con su conteo

| # | Mutación | Reportado | Medido por mí | Coincide |
| --- | --- | --- | --- | --- |
| **M1** | volver a la lista negra | 10 rojos | **10 rojos** (R3 x3, R4 x4, R6, R5, R10) | si |
| **M1b** | el `dev` de partida, con el defecto delante | 46/46 verde | **46/46 verde, 0 rojos** | si |
| **M2** | el lanzamiento a `return 0` | 7 rojos, R3 verde | **7 rojos**, R3 x3 **verdes** | si |
| **M3** | quitar `admin` de la lista blanca | 1 rojo (R1, por `admin`) | **1 rojo**, y el error dice `"admin"` | si |
| **M4** | quitar `adminSatelite` | 6 rojos | **6 rojos** (R2, la mutación hermana de la 409, 417/R2 x3, 417/R9) | si |
| **M5** | el error nuevo con el mensaje de otra guarda | 7 rojos (R4, R6) | **7 rojos**, R4 x4 y R6 entre ellos | si |
| **M6** | `mensajero` en `destinatarios` del catálogo | 1 + 1 ajena | **1 rojo: R7 por nombre** + la guardia ajena | si |

**Los siete conteos coinciden exactamente con la bitácora.** El arnés de mutaciones ya mintió en
este repo reportando supervivientes sin correr un test; aquí **cada número de arriba sale de una
corrida mía**, con el árbol mutado verificado por `git status` antes de lanzar.

**T6.8 replicado:** tras revertir las ocho, `git status --short` y `git diff --numstat` salen
**vacíos** y el par vuelve a **57/57**.

### El «verde a propósito» de M2: es diseño, no agujero

Bajo M2 (`return 0`) los tres casos de R3 quedan verdes. **Lo juzgué y es correcto**, por tres
razones medidas:

1. El aserto de R3 (`contarRepresadas` no se llama) **es literalmente cierto** con `return 0`: el
   repositorio efectivamente no se consulta. No es un falso verde: es otra mitad del contrato.
2. R3 **no es vacuo**: bajo M1 se pone rojo x3. Un aserto que mata la mutación principal de la ficha
   no es un hueco.
3. Lo que M2 rompe —el silencio en vez del ruido— lo cazan R4 x4, R6, R5 **y R10**, y el mensaje de
   R10 lo dice con nombre: `expected [] to deeply equal [ 'agg' ]`, o sea **el aviso desaparece del
   listado entero**, que es el modo de fallo mudo de la 409/R55. Separarlos hace que el rojo diga
   *cuál* de las dos mitades se perdió; juntos lo taparía.

### M6 y la guardia ajena: NO es daño colateral

Corrí `tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts` bajo M6 y leí el diagnóstico:

```
AssertionError: expected [ Array(1) ] to deeply equal []
+   "devoluciones_represadas -> mensajero -> /ordenes"
```

La guardia dice que el atajo del aviso (`/ordenes`) **no es una ruta del menú de un `mensajero`**.
O sea: enrojece porque la mutación **es** un cambio semántico real del sistema, y una guardia ajena
y preexistente lo detecta correctamente. **Corrobora M6, no la contamina.** El caso de R7 está
entre los rojos **por nombre**, que era la condición de T6.7.

---

## 2. Una mutación mía que el spec no pedía: M7, la divergencia por el otro lado

R7 dice «la lista blanca no puede divergir del catálogo», pero su aserto compara
`LISTA_BLANCA_A_MANO` (del **test**) contra el catálogo — **no** contra
`AMBITO_REPRESADAS_POR_ROL` (de **producción**). Eso deja una pregunta abierta que M6 no responde:
si está la lista de producción realmente amarrada a la fuente, o sólo la del test.

La medí. **M7 (mía): añadir `mensajero: "global"` SÓLO a la lista blanca de producción**, dejando
el test y el catálogo intactos:

```
     x R3 — con un mensajero no se consulta NINGUN ambito
     x R4 — con un mensajero falla NOMBRANDO la causa
     x R4 — ni siquiera devuelve el 7 que el repositorio daria
     x R6 — el error NO es el de las otras dos guardas del mismo metodo
     x R5 — el catalogo ENTERO de roles queda clasificado
     x mensajero + un aviso de represadas: ...
      Tests  6 failed | 51 passed (57)
```

**La cadena está cerrada en los dos sentidos**, y esto es lo que hace que R7 no sea decorativo:

| Alguien mueve... | Qué se pone rojo | Medido en |
| --- | --- | --- |
| el **catálogo** (añade un destinatario) | **R7** | M6 |
| la lista de **producción** hacia arriba | **R3, R4, R5, R6, R10** | **M7 (mía)** |
| la lista de **producción** hacia abajo | **R1** / **R2** | M3 / M4 |

Producción queda anclada a `LISTA_BLANCA_A_MANO` por R1+R2+R5, y `LISTA_BLANCA_A_MANO` al catálogo
por R7. **La afirmación «derivada de una fuente» se sostiene.**

---

## 3. Trazabilidad R1-R11: abrí el archivo y leí el aserto

No me fié del mapa de la bitácora. Cada fila de abajo la verifiqué leyendo el cuerpo del caso **y**
con la mutación que lo mata.

| R | Test concreto | El aserto lo verifica de verdad? | Lo mata |
| --- | --- | --- | --- |
| **R1** | `vigencia-aviso-agregado.test.ts` › «maestro y admin lo piden GLOBAL (`null`)» — **vigente, sin editar** | Sí: itera `[MAESTRO, ADMIN]` y afirma `mock.calls[0][1]` `toBeNull()` | **M3** |
| **R2** | mismo archivo › «se pide con la ZONA del adminSatelite» — **vigente, sin editar** | Sí: `expect(zonaId).toBe(ZONA)` + la cota del umbral | **M4** |
| **R3** | mismo archivo › «R3 — con un %s no se consulta NINGUN ambito» x3 | Sí: `not.toHaveBeenCalled()` sobre **los dos** métodos del repo | **M1** |
| **R4** | mismo archivo › «R4 — con un %s falla NOMBRANDO la causa» x3 + el caso del 7 | Sí: `rejects.toThrow(/no define ambito para el rol/i)`, literal **a mano**; ningún caso afirma un número | **M1, M2, M5** |
| **R5** | mismo archivo › «R5 — el catalogo ENTERO de roles queda clasificado» | Sí, e itera `Object.values(RolValue)` **del enum real**, con guarda anti-escenario-vacío (`fuera.length` = `roles.length - 3` y `> 0`) | **M1, M7** |
| **R6** | mismo archivo › «R6 — el error NO es el de las otras dos guardas...» | Sí: niega `/no tiene zona asignada/i` y `/no es una tienda/i`, niega `"men-9"` y exige `"mensajero"` | **M5** |
| **R7** | mismo archivo › «R7 — la lista blanca no diverge de los destinatarios...» | Sí: compara como conjunto contra `CATALOGO_AVISOS.devoluciones_represadas.destinatarios` | **M6** |
| **R8** | los bloques vigentes, **0 líneas borradas** | Sí: contando las lineas que empiezan por un solo guion en `git diff` sale **0** en los dos archivos | M3/M4 los enrojecen |
| **R9** | `git diff --stat` de los cuatro ajenos | **Vacío, verificado por mí** (§6) | — |
| **R10** | `notificacion-service.test.ts` › «mensajero + un aviso de represadas...» | Sí, y afirma **las dos mitades**: el título es el texto persistido, `not.toBe("7 órdenes esperan volver a su tienda")`, y `logger.logError` x1 con la causa nombrada y sin `men-9`. Usa el resolutor **real** (`new VigenciaAvisoAgregadoService(...)`), no un doble | **M1, M2, M5** |
| **R11** | **M1** + **M1b** | Sí, y las medí las dos (§1) | — |

**Ningún test vacío, ningún `R<n>` sin aserto propio, ninguno que pase por accidente.** El único que
podría pasar «por otro motivo» —R3, que usa `.catch(() => undefined)`— está **separado a propósito**
y cubierto por R4/R6, y mata M1 por su cuenta. No es un hallazgo.

---

## 4. Cero casos derogados, y el `toBeNull()` es CONTRATO, no polizón

```
$ git diff --numstat origin/dev...e7b7e9ce -- tests/
65	0	tests/unit/services/notificacion-service.test.ts
127	0	tests/unit/services/vigencia-aviso-agregado.test.ts
```

**0 líneas borradas en los dos archivos, confirmado.** Ningún caso editado, renombrado ni derogado.

**Y el `toBeNull()` que queda ES contrato, no polizón.** Lo verifiqué en la fuente en vez de
aceptarlo de palabra: `AvisoAgregadoRepository.contarRepresadas` (línea 170) es
`return zonaId === null ? filas.length : filas.filter((f) => f.zonaId === zonaId).length;`, o sea
`null` **es** el ámbito global — que es exactamente lo que R1 exige para `maestro`/`admin`
(409/R49). Y **M3 demuestra que carga peso**: quitar `admin` de la lista blanca lo pone rojo con
`Error: ... no define ambito para el rol "admin"`. El polizón con este mismo aserto —el del
`adminSatelite` sin zona, cuyo título prometía una protección y cuyo cuerpo certificaba lo
contrario— ya lo derogó la 417, y su lápida sigue escrita en el archivo (líneas 90-100). **Los dos
casos son distintos y aquí no se tocó ninguno.**

---

## 5. La simetría con la 417: por inclusión, sin rama que decida por exclusión

Leí el método entero (`lib/services/VigenciaAvisoAgregadoService.ts:74-139`). Las **dos** ramas
deciden ya por inclusión, y no queda ninguna tercera:

- `novedades_sin_gestionar` (línea 85): `if (actor.rol !== "adminTienda") throw` — lista blanca de
  un miembro. **Sin tocar** (el diff no la roza).
- `devoluciones_represadas` (líneas 104-132): `AMBITO_REPRESADAS_POR_ROL[actor.rol]`; `undefined`
  lanza **sin consultar el repositorio**; `"global"` pide `null`; `"zona"` pasa por la guarda de
  zona de la 417 **intacta** y luego `actor.zonaId`.
- El `!==` que sobrevive en la rama de represadas —`if (!idUtil(actor.zonaId))`— **no decide
  ámbito**: es la guarda de la 417 y sólo se alcanza cuando el rol YA está en la lista blanca con
  ámbito `"zona"`. No es una exclusión encubierta.

**Regla aplicada tal cual:** *si el ámbito del actor no existe, se falla; no se inventa uno*. Y
`Partial<Record<RolValue, ...>>` hace que **el fallo cerrado sea estructural**: un séptimo valor del
enum devuelve `undefined` sin que nadie tenga que acordarse, y R5 lo afirma sobre el enum real.

**Dónde aterriza:** `NotificacionService.cifrasVivas` (líneas 153-173) captura, llama a `logError`
con `cause` y hace `cifras.set(evento, null)`, o sea el aviso sale **sin número**. Leído en el
archivo. Lanzar aquí no rompe ninguna pantalla, y R10 lo afirma de extremo a extremo con el
resolutor real.

---

## 6. R9 — los cuatro ajenos, con diff vacío (verificado por mí)

```
$ git diff --stat origin/dev...e7b7e9ce -- lib/repositories/NotificacionRepository.ts \
    lib/notificaciones/emitir.ts lib/notificaciones/catalogo-avisos.ts \
    lib/services/AvisosDiariosService.ts
(SIN SALIDA)
```

Y el diff completo son **exactamente seis archivos**, los que `tasks.md` anticipaba, ni uno más:

```
lib/interfaces/services/IVigenciaAvisoAgregado.ts
lib/services/VigenciaAvisoAgregadoService.ts
progress/impl_418.md
specs/418-alcance-represadas-lista-blanca/tasks.md
tests/unit/services/notificacion-service.test.ts
tests/unit/services/vigencia-aviso-agregado.test.ts
```

Nada de `db/`, `app/`, `components/`, ni `tests/baseline-rojos.json` (diff vacío, comprobado). El
único cambio de comportamiento en producción está en un método, una rama.

---

## 7. El gate, corrido por mí

```
$ ./init.sh --rapido > /tmp/rev418-gate.log 2>&1 ; echo "INIT_EXIT=$?" >> /tmp/rev418-gate.log
```

`INIT_EXIT` escrito **DENTRO** del log, sin `tail` de por medio.

```
== Arnes SDD :: init (modo: rapido) ==
OK feature_list.json: sin ids duplicados (413 fichas), cupo por zona respetado (in_progress=3) ...
OK el cambio no toca esquema, tipos compartidos, config ni dinero: el modo rapido basta
OK typecheck paso
OK lint paso
OK DATABASE_URL resuelta: los 160 archivos de tests contra Postgres SI se ejecutan
   test:cambiados   Test Files  64 passed (64)     Tests  797 passed | 26 skipped (823)
   test:guardias    Test Files 211 passed (211)    Tests 3100 passed (3100)
OK tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 275 ejecutado(s), todos en el baseline conocido)
OK .env presente
== init OK ==
INIT_EXIT=0
```

**El juicio de «el rápido no debe negarse» es correcto, y no es opinión de nadie: lo decide el
propio gate.** Lo verifiqué además contra la lista de `init.sh` (`RUTAS_SENSIBLES` +
`NOMBRES_DE_DINERO`, líneas 137-138): ninguno de los seis archivos cae en `^db/migrations/`,
`^db/schema\.prisma$`, `^lib/types/`, `^init\.sh$`, la config de build ni el patrón de dinero.
`lib/services/VigenciaAvisoAgregadoService.ts` **no** contiene ninguna de las palabras de
`NOMBRES_DE_DINERO`.

**Los `skipped`, mirados uno a uno y no sólo el `INIT_EXIT`** (la lección del gate sin `.env`):

- Los **26** salen de `tests/components/AnaliticaPage.test.tsx` (17) y
  `tests/components/AnaliticaShell.test.tsx` (9). **Ninguno de `integration/db`.**
- `integration/db` **ejecutados, con nombre y conteo**: `analytics-daily-guards.test.ts` (26),
  `zona-central-guarda-y-rastro.test.ts` (17), `zona-guardado-conserva-inactivos.test.ts` (2) =
  **45 tests, los tres verdes, cero saltados**.
- El gate anunció **160** archivos contra Postgres como ejecutables (había `.env`): los otros 157
  **no los seleccionó `--changed`**, que no es lo mismo que saltarlos por falta de base. Correcto.

Coincide con lo reportado por el implementador, en corrida independiente.

> **Lo que el rápido NO cubre, dicho con nombre:** `--changed` sólo ve este diff y no detecta un
> `dev` que ya viniera rojo. La corrida **completa post-merge a `dev`** (CLAUDE.md regla 5) sigue
> debiéndose y no es de esta revisión.

---

## 8. CHECKPOINTS.md, punto por punto

| Punto | Estado |
| --- | --- |
| `requirements.md` con EARS numerados | OK — R1-R11, y **cero preguntas abiertas** (dos decisiones firmadas, D1/D2) |
| `design.md` con alternativa descartada y su porqué | OK — **ocho** (A-H), cada una con su motivo |
| `tasks.md` con todas marcadas `[x]` | OK salvo **T8.1**, sin marcar **a propósito y con el motivo en su propia línea** — que es lo que T7.3 exigía (§9) |
| Cada `R<n>` mapea a un test concreto | OK — los once, verificados abriendo el aserto (§3) |
| `progress/impl_<feature>.md` con el mapa `R<n> -> test` | OK y **commiteado**: el blob de `origin/<rama>` (`e000eb59`, 28.083 B) coincide con el del disco |
| `typecheck` sin errores | OK en mi corrida |
| `lint` sin errores | OK en mi corrida |
| `pnpm test` | OK por el gate rápido (275 archivos, 0 rojos). El **completo** va post-merge a `dev` |
| E2E si toca flujo crítico | **N/A** — no toca auth, pagos, recaudo, ingesta ni webhooks; y no hay harness E2E en este repo |
| RLS en tabla nueva | **N/A** — ninguna tabla, columna, índice, enum ni migración. `db/` intacto |
| Migración con `down.sql` | **N/A** — sin migración. El aviso de tres migraciones sin `down.sql` en el log es **preexistente y ajeno** (agosto) |
| Ningún secreto hardcodeado | OK — el diff no introduce ni una constante de entorno ni una credencial |
| Webhooks con firma e idempotencia | **N/A** — ninguno |
| Controller sin queries ni lógica | **N/A** — ningún controller tocado |
| Service sin HTTP | OK — `VigenciaAvisoAgregadoService` importa **sólo** tipos y la interfaz del repositorio: ni `Request`, ni `Response`, ni `headers`, ni Prisma |
| Repository sólo queries | OK — intacto |
| Interfaces en `lib/interfaces/` por categoría | OK — `lib/interfaces/services/IVigenciaAvisoAgregado.ts`, **sin cambio de firma**, sólo el tercer caso de lanzamiento documentado |
| Páginas protegidas validan en servidor | **N/A** — ninguna página tocada |
| Sin hardcode de país/moneda/cuenta | OK — no aplica y no se introdujo ninguno |
| `./init.sh` en verde | OK — `--rapido`, `INIT_EXIT=0`, corrido por mí (§7) |
| `progress/review_<feature>.md` con veredicto OK | OK — este archivo |
| Entrada en `progress/history.md` | PENDIENTE del cierre — no es del implementador. La 417 tampoco la tiene todavía (§10, menor 2) |

---

## 9. T8: el motivo es legítimo, y lo verifiqué por mi cuenta

T8.1 queda sin marcar. **No es una casilla que se escurre**, y no me quedé con la palabra del
implementador: la premisa —«el valor `devoluciones_represadas` no existe en el enum de
producción»— la corroboré **contra el estado de las ramas**, que es una medida independiente:

```
$ grep -rln "devoluciones_represadas" db/migrations/
db/migrations/20260911120000_notificacion_evento_avisos_agregados/migration.sql
db/migrations/20260911120000_notificacion_evento_avisos_agregados/down.sql

$ git cat-file -e origin/prod:db/migrations/20260911120000_notificacion_evento_avisos_agregados/migration.sql
-> NO EXISTE en origin/prod
```

La migración que añade el valor al enum vive en `dev` y **no ha llegado a `prod`**. Hoy ese `SELECT`
**no devolvería cero: daría error de enum**, que es exactamente lo que el spec dice y **no** es lo
mismo que «salieron cero filas». La tarea está redactada con esa distinción explícita y con su tabla
de lectura, así que el día del despliegue no depende de que alguien recuerde el matiz. **Motivo
legítimo, y además no bloquea nada: el arreglo es fail-closed en los dos escenarios.**

**Límite de mi verificación, dicho con nombre:** el `SELECT` contra producción **no lo corrí**,
porque el MCP de Supabase **no está en mi conjunto de herramientas** en esta sesión. Lo que aporto
es la corroboración por estado de ramas, que sostiene la premisa pero **no la sustituye**: T8.1
sigue debiéndose el día del despliegue.

---

## 10. Hallazgos

**BLOQUEANTES: ninguno.**

- **menor 1 — R7 compara el test contra el catálogo, no producción contra el catálogo.**
  El aserto ata `LISTA_BLANCA_A_MANO` (test) con `CATALOGO_AVISOS...destinatarios`. La lista de
  **producción** (`AMBITO_REPRESADAS_POR_ROL`) no entra en él. **No es un agujero** —lo medí con
  **M7** (§2): moverla en cualquier dirección enrojece R3/R4/R5/R6/R10 o R1/R2, así que la cadena
  está cerrada—, pero la cadena es de **tres eslabones** y eso no está dicho en ningún sitio. Si
  alguien relajara R5 o R1/R2 en el futuro, R7 dejaría de amarrar producción **en silencio**.
  Bastaría una línea de comentario en el caso de R7 nombrando el eslabón intermedio. No bloquea.
- **menor 2 — falta la entrada en `progress/history.md`** (último punto de `CHECKPOINTS.md`). No es
  del implementador: se escribe al cerrar. La **417 tampoco la tiene**, así que ambas se deben en el
  cierre. No bloquea el PR.
- **menor 3 — el rojo de R1 bajo M3 llega por un `it` con bucle interno**, no por un caso por rol
  (`for (const actor of [MAESTRO, ADMIN])`). `tasks.md` T6.4 pedía que el rojo fuera «por el caso de
  `admin`». **Se cumple en sustancia y lo verifiqué**: el mensaje del fallo dice
  `no define ambito para el rol "admin"`, así que la iteración culpable queda nombrada. Pero es un
  caso **vigente que esta ficha tiene prohibido editar**, así que no hay nada que corregir aquí. Lo
  anoto sólo para que no se lea como cobertura por rol separada.
- **nota de método (no es hallazgo) — el grafo (regla 7) está rancio en esta zona, y falla POR
  DEFECTO.** Usé el MCP `codebase-memory` primero, como manda la regla:
  `search_graph(name_pattern=".*VigenciaAvisoAgregado.*")` devuelve **0 nodos** para una clase que
  existe, y `search_code` con `\.cifra\(` acierta el archivo pero con `total_results: 0` (no lo
  atribuye a ninguna función). Coincide con lo que reporta el implementador. **Confirmé todo en los
  archivos reales**, y el único consumidor de `.cifra(` en producción sigue siendo
  `lib/services/NotificacionService.ts:161` (verificado por lectura directa del árbol).

---

## 11. Lo que esta ficha NO entrega, para que nadie lo dé por cubierto

Lo dice el propio diseño (§10) y lo confirmo:

- **No vigila** que el predicado de la 146 siga existiendo ni que el emisor siga emitiendo a quien
  emite. Lo que entrega es que, **si eso cambia**, este seam se niegue y lo diga.
- **No cierra la familia** de listas negras del repo: arregla la evidenciada por el reviewer de la
  417. Un censo transversal sería otra ficha con su propia medida.
- **Nadie verá un cambio al desplegar.** Es preventiva, y la frase se sostiene hasta que T8.1 la
  mida de verdad el día del despliegue de la 409.

---

## Veredicto final

# OK

Las dos mitades del rojo se sostienen medidas por mí: **10 rojos** al volver a la lista negra con
`NotificacionRepository.ts` de diff vacío en la misma corrida, y **46/46 verde** con ese mismo
defecto delante en el `dev` de partida. Las siete mutaciones coinciden con lo reportado, más una
octava propia que cierra la cadena de R7. Once requisitos con aserto real, cero casos derogados,
seis archivos tocados, los cuatro ajenos intactos, gate rápido con `INIT_EXIT=0` y los `skipped`
auditados uno a uno, y T8 sin marcar por un motivo que verifiqué contra el estado de `origin/prod`.

**Sin bloqueantes. Listo para mergear a `dev`**, con la corrida completa post-merge que manda la
regla 5, y con los tres menores de §10 como deuda anotada, no como condición.

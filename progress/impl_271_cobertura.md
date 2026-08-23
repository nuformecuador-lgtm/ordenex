# impl 271 — cobertura: los TRES huecos declarados, cerrados

> Pasada de **solo tests**. Cierra las tres ausencias que `progress/impl_271.md` §«Lo que NO se
> cubrió» declara en los puntos **3 (R14)**, **4 (R44)** y la fila **R36** de la tabla de
> trazabilidad. **Ni una línea de producción cambia** — `git diff` sobre `lib/` está vacío.

Rama: `test/271-cobertura-tres-huecos`, partiendo de `feature/271-segundo-cierre-y-bloqueo`
(`79f62463`).

---

## Los tres huecos y por qué eran huecos

| Hueco | Lo que había | Lo que faltaba |
| --- | --- | --- |
| **R14 / T2.2** | El `where: { mensajeroId, cierreId: null, anuladaAt: null }` de `crearCierre` **no se tocó** y sus tests siguen verdes | El caso **sembrado con contraprueba por mutación** que T2.2 pedía |
| **R36 / T5.4** | El veredicto se recalcula por consulta y las 7 filas de la tabla de verdad están medidas (`cierre-bloqueo-nv-sql-real`) | La fila del **desbloqueo**: «apruebo el más viejo y el mensajero queda LIBRE» |
| **R44 / T6.3** | La mitad (a) —mismo hecho sin leer → 1 fila— y la afirmación de que la entidad es el cierre | La mitad (b): **otro cierre → 2 filas**, con la anterior sin leer |

**Por qué los tres van contra Postgres y no con dobles.** R14 y R36 SON un `where`; R44 depende de
un `where` (`existeNoLeidaPara`) **y** de un índice único del motor (`notificacion_dedupe_key`,
`NULLS NOT DISTINCT`). Un doble no ejecuta ninguno de los tres. Este repo ya midió cuatro veces que
una mutación de un `where` sobrevive en verde por arriba.

**Ninguno puede reportar `passed` sin comprobar nada.** Sin base alcanzable los tres se **saltan**
(`describe.skip`, visible en la salida); con base pero sin catálogo/usuarios fallan **ruidosamente**
desde `beforeAll`. No hay un solo `if (!datos) return;` en los tres archivos, y las aserciones viven
**fuera** del callback de la transacción, así que no pueden quedarse sin ejecutar.

---

## Archivos creados

| Archivo | Requisito |
| --- | --- |
| `tests/integration/db/cierre-segundo-vincula-solo-lo-suyo.test.ts` | **R14** (T2.2) |
| `tests/integration/db/cierre-aprobar-el-mas-viejo-desbloquea.test.ts` | **R36**, **R12** (T5.4) |
| `tests/integration/db/notificacion-bloqueo-otro-cierre-avisa.test.ts` | **R44** (T6.3) |

**No se tocó `tests/integration/db/cierre-bloqueo-nv-sql-real.test.ts`** (lo edita otra sesión en
paralelo), ni ningún otro archivo existente.

---

## Mapa `R<n> → test`

| Requisito | Test |
| --- | --- |
| **R14** | `cierre-segundo-vincula-solo-lo-suyo.test.ts` → «el cierre B se lleva EXACTAMENTE las 2 sueltas y NO toca ni una del cierre A» |
| **R36** | `cierre-aprobar-el-mas-viejo-desbloquea.test.ts` → «con N=2 está BLOQUEADO; aprobado el más viejo, la consulta siguiente lo da LIBRE» |
| **R12** (de refuerzo) | el mismo caso: la consulta del veredicto corre contra un cliente que **lanza** si alguien escribe |
| **R44** | `notificacion-bloqueo-otro-cierre-avisa.test.ts` → «el MISMO cierre dos veces deja UNA fila; OTRO cierre del mismo mensajero deja DOS» |

---

## Qué siembra y qué afirma cada uno

### R14 — el 2.º cierre se lleva sólo lo que aún no está en ningún cierre

Siembra un cierre **A** (el de ayer, `solicitado` y sin resolver) con **2** gestiones ya vinculadas,
**2** gestiones sueltas, y **dos señuelos**: una suelta pero **anulada** y una suelta de **otro
mensajero**. Llama a `CierreDiaRepository.crearCierre` de verdad. Afirma el **conjunto exacto**
vinculado a B (las 2 sueltas, ni una más), que las de A **siguen en A**, que los dos señuelos siguen
sueltos, y que el pago snapshot **no toca** la gestión de A aunque su id viajaba en
`pagoByGestionId` (la otra mitad de «NO DEBE tocar ninguna gestión ya vinculada a otro cierre»).

### R36 — aprobar el más viejo devuelve a LIBRE

Siembra el **caso 4** (`N=2, V=0`), comprueba BLOQUEADO y que «el que toca resolver primero» es el
más viejo, y **aprueba ese mismo** por el camino real (`CierresAdminRepository.resolverCierre`, con
los cuatro libros de dinero como no-op, igual que `cierre-aprobacion-libera-solo-lo-suyo`). La
consulta siguiente corre contra un cliente **envuelto en solo-lectura**: `N=1, V=0`, `bloqueado =
false`, y el que queda por resolver es el nuevo.

«Sin ninguna escritura adicional» **no se afirma de palabra**: el envoltorio lanza ante
`create/createMany/update/updateMany/upsert/delete/deleteMany/$execute*`. **Y el envoltorio está
auto-comprobado**: metiéndole un `updateMany` a `contarCierresAbiertosPorMensajero`, el test murió
con `R12 roto: la consulta del veredicto llamo a .updateMany()` — el guardián no miente.

### R44 — otro cierre es otro hecho

Dos cierres del mismo mensajero. Emite por A (**4** filas: mensajero + maestro + admin +
adminSatelite), repite por A con la anterior **sin leer** (**0**), y emite por B (**4** otra vez).
Cuenta en la tabla: **2** filas para el mensajero, con `entidad_id` = {A, B} y `entidad_tipo`
`cierre_dia` escrito a mano. El `BloqueoDetalle` **no es un fixture**: sale de
`OrdenRepository.findBloqueoDetalle` leyendo los cierres sembrados. **No se afirma ni un texto**:
los literales viven en `tests/unit/notificaciones/bloqueo-textos.test.ts`, y compararlos aquí contra
la función que los genera estaría siempre verde.

---

## Contraprueba por mutación — los tres MUEREN

Cada mutación se aplicó al código de producción, se corrió el test, y se **revirtió**
(`git checkout --`). El árbol quedó limpio de cambios en `lib/`.

| # | Mutación | Archivo | Resultado |
| --- | --- | --- | --- |
| 1 | quitar `cierreId: null` del `where` de `crearCierre` | `lib/repositories/CierreDiaRepository.ts:702` | **ROJO** — `expected [ …(4) ] to deeply equal [ …(2) ]`: el cierre B se llevó las 4 gestiones del mensajero, incluidas las 2 de A |
| 1-bis | quitar `anuladaAt: null` del mismo `where` | ídem | **ROJO** — `expected [ …(3) ] to deeply equal [ …(2) ]`: se llevó también la anulada |
| 2 | meter `"aprobado"` en el `estado: { in: … }` del conteo | `lib/repositories/OrdenRepository.ts:3228` | **ROJO** — `expected { n: 2, v: 0 } to deeply equal { n: 1, v: 0 }`: el aprobado sigue contando y el mensajero no se desbloquea nunca |
| 2-bis | (auto-comprobación del envoltorio) meter un `updateMany` en `contarCierresAbiertosPorMensajero` | ídem | **ROJO** — `R12 roto: la consulta del veredicto llamo a .updateMany()` |
| 3 | `entidadId: ctx.cierreId` → `ctx.mensajeroUsuarioId` en `emitirMensajeroBloqueado` (las 2 filas) | `lib/notificaciones/emitir.ts:620,629` | **ROJO** — `expected +0 to be 4`: el segundo cierre no emite nada, la dedupe se lo come y al mensajero le queda UNA fila |

---

## Salida real de las órdenes

```
$ pnpm run typecheck
> ordenex@0.1.0 typecheck
> tsc --noEmit
(sin salida: limpio)

$ pnpm run lint
✖ 99 problems (0 errors, 99 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
(cero avisos en los tres archivos nuevos; los 99 son preexistentes en `dev`)

$ pnpm exec vitest run <los tres archivos>
 Test Files  3 passed (3)
      Tests  3 passed (3)
   Duration  1.31s

$ pnpm exec vitest run <los tres + cierre-bloqueo-nv-sql-real + cierre-aprobacion-libera-solo-lo-suyo + cierre-sin-gestion-sql-real>
 Test Files  6 passed (6)
      Tests  26 passed (26)
   Duration  2.13s

$ pnpm exec vitest run guardia          # TODAS las guardias del árbol
 Test Files  96 passed | 1241 skipped (1337)
      Tests  486 passed | 17615 skipped (18101)
   Duration  259.43s
```

`./init.sh` **no** se corrió aquí a propósito: lo lanza quien integra, sobre el árbol ya mezclado.

---

## Notas de entorno

- El worktree no traía `node_modules`: se enlazó por *junction* al del checkout principal.
- Se copió `.env` al worktree (está en `.gitignore`, no se commitea): sin él
  `HAY_BASE_DE_DATOS` es `false` y los tres se saltarían en vez de correr.
- Base local comprobada antes de escribir: el enum `notificacion_evento` **ya trae**
  `cierre_dia_vencido` y `mensajero_bloqueado_por_cierres`. **No se aplicó ninguna migración.**
- Los tres corren dentro de `enTransaccionRevertida` + `serializarEscriturasReales`: no dejan ni
  una fila en la base compartida, pasen o fallen.

## Hallazgos de comportamiento

**Ninguno.** Los tres requisitos se comportan exactamente como el texto dice. Se verificó además el
extremo que R44 podía haber roto sin que el emisor tuviera la culpa: el productor
(`CierreDiaService.avisarBloqueoPorAcumular`) pasa el **cierre recién creado**, no
`aResolverPrimero.cierreId`; si pasara el más viejo, los dos bloqueos compartirían `entidad_id` y el
segundo aviso se perdería en silencio aunque el emisor estuviera bien.

**Veredicto:** los tres huecos declarados quedan cerrados con tests de integración contra Postgres,
cada uno con su mutación aplicada y su muerte demostrada; sin un solo cambio en producción y sin
ningún hallazgo que contradiga el spec.

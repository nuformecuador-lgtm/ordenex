# 412 — Informe de revisión

> Rama `feat/412-aviso-cierre-rechazado`, PR **#784**, HEAD **`a552f996`**, base `origin/dev` @ `6c5335fc`.
> Revisado en worktree propio (`R:/wt/rev412`), con `pnpm install --frozen-lockfile`, `prisma generate`
> y el `.env` del árbol principal copiado y **borrado al terminar**.
> Todo lo que sigue está **medido por el reviewer**, no leído de la bitácora.

## Veredicto

**OK.** Cero bloqueantes. Cinco menores, ninguno gatea el merge.

---

## 1 · Checklist de `CHECKPOINTS.md`, punto por punto

| Punto | Resultado |
| --- | --- |
| `requirements.md` con EARS numerados | OK — 26 (R1–R26), sin preguntas abiertas |
| `design.md` con alternativa descartada y su porqué | OK — **diez** (A1–A10), cada una con su motivo |
| `tasks.md` todas `[x]` | OK — las 21 (T0.1 … T7.5) |
| Cada `R<n>` mapea a un test concreto | OK — **26/26, abriendo el archivo y leyendo el aserto** (§2) |
| `progress/impl_412.md` con el mapa `R<n> -> test` | OK — §2 de la bitácora, confirmado contra los archivos |
| `pnpm run typecheck` | OK — sin errores (dentro de mi `./init.sh`) |
| `pnpm run lint` | OK — `184 problems (0 errors, 184 warnings)`; **ninguna advertencia en un archivo de la ficha** (las tres de `cierres-admin` son de archivos que esta rama no toca) |
| `pnpm test` | OK — **1932/1932 archivos, 28.026 tests, 26 skipped** |
| E2E Playwright si toca flujo crítico | INAPLICABLE — no hay harness de E2E en el repo (precedente establecido). Ver menor **m1** |
| RLS en tabla nueva | OK — **no hay tabla nueva**; `notificacion` conserva la RLS de la 146. La migración es aditiva: dos `ALTER TYPE … ADD VALUE IF NOT EXISTS` y nada más |
| Migración versionada y reversible, con `down.sql` | OK — y **ejercitada contra Postgres por el reviewer** (§4) |
| Ningún secreto hardcodeado | OK — nada de credenciales en el diff |
| Webhooks con firma e idempotencia | n/a (no toca webhooks). La **idempotencia del aviso** sí se midió: §3 |
| Controller sin queries ni negocio | OK — `lib/actions/cierres-admin.ts` sólo ensambla |
| Service sin HTTP | OK — `CierresAdminService` no ve `Request`/`Response` |
| Repository sólo Prisma | OK — `OrdenRepository.findJornadaDeCierre` es un `findUnique` más el derivador único |
| Interfaces en `lib/interfaces/` | OK — `IOrdenRepository` |
| Páginas protegidas / componentes `private/` | n/a (no toca UI) |
| Mutaciones por Server Action | n/a |
| Sin hardcode de país/moneda/cuenta | OK |
| `./init.sh` en verde | OK — **`INIT_EXIT=0`**, corrido por el reviewer (§5) |
| `progress/review_412.md` con veredicto OK | OK — este archivo |
| Entrada en `progress/history.md` | FALTA — es tarea de cierre del leader, no está en `tasks.md`. Menor **m2** |

---

## 2 · Trazabilidad: los 26 requisitos, con el aserto leído

Se abrió **cada archivo** y se leyó el aserto. No hay ningún test vacío ni ningún `R` sin defensa.

| R | Archivo y caso | Aserto que lo defiende (leído) |
| --- | --- | --- |
| R1 | `cierres-admin-aviso-rechazo.test.ts` · «mensajero NO bloqueado: el aviso SALE igual, UNA vez» | `notificarRechazo` llamado 1 vez con `mensajeroUsuarioId:"men-1"` y `quedaBloqueado:false` |
| R2 | `cierre-rechazado-aviso.test.ts` · «UNA sola fila… NINGUNA de rol» | `creadas===1`, destinatario `{tipo:"usuario"}`, filtro de `tipo:"rol"` vacío |
| R3 | `cierres-admin-aviso-rechazo.test.ts` · bloque R3, **cinco** desenlaces (`conflict`, `fuera_de_alcance`, motivo vacío, rol no autorizado, satélite sin zona) | los **dos** notificadores `not.toHaveBeenCalled()` |
| R4 | mismo · R4(a) y R4(b) | (a) el notificador lanza, devuelve `{status:"ok"}` y `console.error` recibe un texto que contiene `cierre_dia_rechazado`; (b) las claves del input de `resolverCierre` son exactamente `alcance, cierreId, motivoRechazo, nuevoEstado, resueltoPor` — **ningún cliente transaccional, ningún notificador** |
| R5 | mismo · bloque R5, los dos sentidos | el del rechazo lanza y el de bloqueo se emite con `solo_bodega`; y al revés |
| R6 | `notificacion-notificadores-reales.test.ts` | sobre el **fuente sin imports ni comentarios**, un `toMatch` que exige los DOS notificadores **dentro** de `new CierresAdminService(...)`. Y `cierres-admin-aviso-rechazo.test.ts` afirma que el **default del constructor es el no-op** |
| R7 | `cierre-rechazado-aviso-dedupe.test.ts` (Postgres real) | siembra cierre, rechaza, ejecuta **`CierreDiaRepository.transicionarASolicitado` REAL**, rechaza otra vez: `filas.length === 2`, `lecturas === 0`, y las dos `entidadId` escritas a mano |
| R8 | mismo | dos emisiones con el **mismo** `resuelto_at`: `primera===1`, `repetida===0`, `count===1` |
| R9 | mismo | `Promise.all` sobre **dos clientes Prisma distintos**: una crea y la otra no, `count===1`, ningún error propagado |
| R10 | mismo | dos mensajeros, 2 filas, cada `entidadId` empieza por SU cierre |
| R11 | `cierre-rechazado-jornada-sql-real.test.ts` (Postgres real) | cierre nacido el 22 con gestiones del 21 da `"2026-08-21"`, con **autocomprobación** de que las gestiones engancharon (`vinculadas===2`; sin ella la rama B daría 21 por casualidad); gestión anulada excluida; control de huso a las 23:30 CR |
| R12 | `cierre-rechazado-aviso.test.ts` | literal **completo escrito a mano** «Tu cierre del día fue rechazado. Revísalo, corrígelo y vuelve a enviarlo a aprobación.», más `not.toMatch(/\d/)` |
| R13 | mismo, más `atajo-aviso-ruta-visible.guardia.test.ts` | `toContain("Revísalo, corrígelo y vuelve a enviarlo a aprobación.")` y el destino `/cierre-dia` |
| R14 | mismo, más `bloqueo-textos.test.ts` | `toMatch(/…trabajo nuevo\.$/)` **a mano**; y la guardia de árbol (§6) |
| R15 | mismo | sin bloqueo: `not.toContain("Mientras tanto")` y `not.toContain("no puedes")` |
| R16 | mismo | motivo-cebo con teléfono, nombre, símbolo de moneda y guía: ninguno aparece; `anexo === null`; el texto sin el «21» no tiene dígitos |
| R17 | `cierres-admin-aviso-rechazo.test.ts` | al bloqueo se le pasa `"solo_bodega"`; y el **contado**: emisiones dirigidas al mensajero = 1 |
| R18 | `mensajero-bloqueado-aviso.test.ts` | con `solo_bodega`: `maestro`, `admin` y `adminSatelite` de la zona, con el **texto y la entidad de hoy**, y ninguna de usuario |
| R19 | mismo (bloque R19) y `cierre-dia-aviso-bloqueo.test.ts` | con `mensajero_y_bodega` salen las CUATRO de siempre y «la ÚNICA diferencia entre los dos modos es esa fila»; el productor de la solicitud pasa `mensajero_y_bodega` |
| R20 | `catalogo-avisos.test.ts` más typecheck | las claves del catálogo `toEqual` los valores del enum de Prisma (14), con anti-vacuidad `>= 14`; el `Record<NotificacionEvento,…>` no compila sin la entrada |
| R21 | `atajo-aviso-ruta-visible.guardia.test.ts` | caso propio: el atajo es `/cierre-dia`, `rutasVisiblesPara("mensajero")` lo contiene y **no** contiene `/cierres-admin` |
| R22 | `notificacion-service.test.ts` | `porHacer === 1`, `accionable === true`, `atajo` igual a `{href:"/cierre-dia", etiqueta:"Ver mi cierre"}` (etiqueta **a mano**) |
| R23 | `push-elegibles.test.ts` más typecheck | elegible para `mensajero`, `false` para los **seis** demás perfiles; la lista literal de elegibles pasa de ocho a nueve |
| R24 | `notificacion-evento-cierre-rechazado-migration.test.ts` | «retipa **LAS TRES** columnas» (estático) **más un CONTROL contra Postgres**: el down corre entero y `notificacion_dedupe_key` y `push_envio_dia_cupo` sobreviven con su `NULLS NOT DISTINCT` y su `WHERE` |
| R25 | mismo | con una fila del valor nuevo el down **aborta** y la fila **sigue ahí** (savepoint más recuento); y el `down.sql` no contiene ni un `DELETE` ni un `UPDATE` |
| R26 | `notificacion-visibilidad.test.ts` y las suites de autorización, **no tocadas por el diff** | verificado: `predicadoVisibilidad` es **por destinatario, no por evento**, así que el aviso nuevo lo hereda sin cambiarlo |

**Todas en verde en mi propia corrida:** 13 archivos de la ficha, **255 tests, 0 fallos, 0 skipped**.

---

## 3 · La pieza central, medida con datos por el reviewer

Sonda propia contra el Postgres local, dentro de una transacción revertida, usando los objetos
**reales** (`NotificacionRepository`, `CierreDiaRepository.transicionarASolicitado`,
`emitirCierreDiaRechazado`):

```
[1] DOS RECHAZOS (re-solicitud REAL, misma fila = true)
    emitidas: 1 1 | filas en la tabla: 2
      - cierre_dia_rechazo 8996407c-…-796b:2026-08-22T15:00:00.000Z | rol: null
      - cierre_dia_rechazo 8996407c-…-796b:2026-08-22T15:40:00.000Z | rol: null
    texto: Tu cierre del 21 de agosto fue rechazado. Revísalo, corrígelo y vuelve a
           enviarlo a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir
           trabajo nuevo.

[2] MISMO RECHAZO REPETIDO -> emitidas: 0 | filas: 2        (no crecio)

[3] INSTANTE DERIVADO (reloj del servicio), mismo hecho x2 -> emitidas: 1 1 | filas: 4
    ROMPE: dos avisos por UN hecho

[4] MISMA entidad, DOS usuarios distintos -> creadas: 2      (la clave SI los distingue)
```

**Qué demuestra cada uno:**

1. **Dos rechazos son dos avisos.** Y la re-solicitud se ejecutó de verdad
   (`transicionarASolicitado` devolvió `true` sobre la **misma fila** de `cierre_dia`), que es el
   hecho del que depende todo el diseño.
2. **El mismo rechazo es un aviso.** La segunda emisión devuelve `0` y la tabla no crece.
3. **La garantía, matada.** Con el instante **derivado** en el momento de emitir en vez del
   persistido, el **mismo hecho** produce **dos** avisos. Luego el `resuelto_at` leído de la fila
   **no es decorativo: es la garantía**. Y no depende de disciplina: lo de (2) lo decide el índice
   único, no un `if` — el test de R9 lo demuestra con dos conexiones a la vez.
4. **El hallazgo hermano de la 409 NO aplica aquí, y está medido.** En la base:
   `notificacion_dedupe_key` es `UNIQUE (evento, entidad_id, destinatario_rol,
   destinatario_usuario_id) NULLS NOT DISTINCT WHERE (entidad_id IS NOT NULL)` — **no lleva
   `destinatario_zona_id`**, que es exactamente el agujero de la 409. **Pero este aviso sólo crea
   filas dirigidas a `usuario`** (R2, con dos asertos que lo fijan) y `destinatario_usuario_id`
   **sí** está en la clave: dos mensajeros no se pisan. Las filas de bodega (`adminSatelite` con
   `zonaId`) pertenecen a `mensajero_bloqueado_por_cierres`, cuya entidad y clave esta ficha **no
   cambia**. **No hay colisión entre destinatarios que debieran distinguirse.**

---

## 4 · El `down.sql` del enum: enumerado, no leído

**Consultado `information_schema` contra la base, no el esquema:**

```
public | notificacion   | entidad_tipo | notificacion_entidad_tipo
public | notificacion   | evento       | notificacion_evento
public | push_envio_dia | evento       | notificacion_evento
```

**Son exactamente TRES, y el `down.sql` retipa las TRES.** Comprobado además por `pg_attribute`:
no hay vistas, matviews ni tipos compuestos colgando de estos enums; sólo los tres índices, que
`ALTER COLUMN … TYPE` reconstruye solo.

**Ningún `down.sql` anterior fue tocado.** Verificado uno por uno: los ocho directorios de
migraciones de estos dos enums (146, 253, 262, 271, 333, 403, 401, 409) tienen **0 archivos
cambiados** en el diff. La rama sólo añade
`db/migrations/20260913120000_notificacion_evento_cierre_rechazado/{migration,down}.sql`.

**Las listas del `down.sql` siguen siendo las de `origin/dev`.** Releídas hoy contra
`origin/dev` @ `6c5335fc`: **trece eventos y once entidades**, idénticos en nombre y orden a los
que el `down.sql` recrea. El pre-vuelo no ha caducado.

**El down, ejercitado por el reviewer contra Postgres** (transacción revertida, savepoint):

- con una fila usando el valor nuevo, **aborta en la sentencia 2**
  (`ALTER TABLE "notificacion" ALTER COLUMN "evento" … USING`) con
  **`22P02`: «la sintaxis de entrada no es válida para el enum notificacion_evento:
  cierre_dia_rechazado»**. Es **el motivo que R25 dice**, no otro, y sin borrar ni reescribir nada;
- sin filas de los valores nuevos, **corre entero** y sobreviven `notificacion_dedupe_key` y
  `push_envio_dia_cupo`.

---

## 5 · El gate, corrido por el reviewer

Una sola corrida, del árbol limpio, **con el `INIT_EXIT` escrito DENTRO del log** por el propio
wrapper (el `echo "INIT_EXIT=$?"` va dentro del bloque que se redirige al fichero, no en el comando
que lo envuelve):

```
 Test Files  1932 passed (1932)
      Tests  28026 passed | 26 skipped (28052)
   Duration  972.47s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1932 ejecutado(s))
✓ lint paso                         (184 problems, 0 errors)
✓ typecheck paso
== init OK ==
INIT_EXIT=0
```

- **Los 26 `skipped` son los de siempre**: `AnaliticaPage` (17) más `AnaliticaShell` (9).
  `↓ tests/integration/db` aparece **0 veces** y no hay línea «sin DATABASE_URL»: la capa de datos
  se ejecutó. Los cinco archivos de la ficha corrieron y pasaron
  (`notificacion-evento-cierre-rechazado-migration` 26, `cierre-rechazado-aviso-dedupe` 6,
  `cierre-rechazado-jornada-sql-real` 6, `cierre-rechazado-aviso` 21, y los unitarios del servicio).
- `tests/baseline-rojos.json` está **vacío** (`"archivos": {}`) y la rama **no lo toca**: no se
  baselineó nada, y cualquier archivo rojo habría roto el gate.

**Los dos rojos «ajenos» de la primera corrida del implementador son flakes de saturación, no
rojos reales.** En mi corrida limpia `tests/components/TableroOperativo.test.tsx` pasa
**50/50 en 11,9 s** — su fallo era `Test timed out in 20000ms`, y con 11,9 s de base bajo carga se
pasa del límite sin holgura — y `tests/integration/db/seed-zonas-cruza-por-codigo.test.ts` pasa
**8/8 en 737 ms** — su fallo era `prisma.$transaction.timeout`. Ninguno tiene relación con este
diff, ni por imports ni por datos, y los dos son los modos de flake que el arnés ya documenta.
**Explicación aceptada.**

**Los ocho rojos propios son inventarios que esta ficha tenía que actualizar, y los actualizó.**
Leído el diff de los ocho:

| Archivo | Qué se le añadió | ¿Se relajó algo? |
| --- | --- | --- |
| `notificacion-productores-wiring` | los dos valores a las dos listas literales | no |
| `no-migration-102` | la carpeta a `MIGRACIONES_NOTIFICACIONES_POSTERIORES` | no |
| `…postulacion-recurso-migration` (253) | los dos valores a sus listas de estado **ACTUAL** | no |
| `…dia-reparto-corregido-migration` (262) | idem | no |
| `…bloqueo-cierre-migration` (271) | sólo el evento (su up no toca el otro tipo) | no |
| `…gasto-fijo-migration` (333) | idem 253 | no |
| `…webhook-suscripcion-migration` (403) | idem 253 | no |
| `cierre-dia-aviso-bloqueo` | `destinatarios: "mensajero_y_bodega"` al `toEqual` exhaustivo | **no: sigue siendo `toEqual`**, no se degradó a `toMatchObject` |

Y las listas de «los enums **ANTES** de SU migración» **no se tocaron** en ninguno: se distinguen
porque terminan en el valor de su propia ficha. Comprobado en el diff.

**El rojo conocido de la 421** (`notificacion-evento-avisos-agregados-migration.test.ts`) **no
apareció** en mi corrida. No se persiguió ni se baselineó, como pedía el encargo.

---

## 6 · Las diez mutaciones, reaplicadas por el reviewer

Arnés propio con **copia byte a byte** (`shutil.copy2`), restauración desde esa copia y
**verificación de SHA256** antes y después. **En ningún momento se usó `git checkout --`.** El
arnés aborta si el patrón no aparece **exactamente una vez**, si vitest no deja una línea de conteo
real, o si el archivo no queda restaurado. Y lleva una **mutación de CONTROL** plantada para morir
(cambiar el literal del texto), porque en este repo un arnés ya reportó «9/9 sobrevivieron» **dos
veces sin haber ejecutado un test**.

```
M1       exit=1  | 5 failed | 22 passed (27)  -> MUERTA
M2       exit=1  | 2 failed |  4 passed  (6)  -> MUERTA
M3       exit=1  | 2 failed | 26 passed (28)  -> MUERTA
M4       exit=1  | 4 failed | 24 passed (28)  -> MUERTA
M5       exit=1  | 2 failed | 31 passed (33)  -> MUERTA
M6a      exit=1  | 5 failed | 16 passed (21)  -> MUERTA
M6b      exit=1  | 3 failed | 18 passed (21)  -> MUERTA
M7       exit=1  | 2 failed | 52 passed (54)  -> MUERTA   (1 archivo rojo, 1 VERDE)
M8       exit=1  | 5 failed |  1 passed  (6)  -> MUERTA
M9       exit=1  | 2 failed | 24 passed (26)  -> MUERTA
M10      exit=1  | 2 failed | 19 passed (21)  -> MUERTA
CONTROL  exit=1  | 7 failed | 14 passed (21)  -> MUERTA

CONTROL murio -> el arnes ejecuto tests de verdad.
SUPERVIVIENTES: ninguno
```

Los conteos coinciden con los de la bitácora en M1, M2, M3, M5, M6a, M6b, M7, M8 y M9. **M10 da un
rojo más que el declarado** porque mi variante concatena el motivo siempre y rompe además el
`toEqual` de la fila completa: misma conclusión, mutación algo distinta. Tras cada corrida el árbol
quedó idéntico (`git status` limpio, SHA verificado).

### M7 — la que el encargo pedía apretar

Con `NO_PUEDES` **copiada** a `emitir.ts` en vez de importada, la corrida reporta a nivel de archivo
**`1 failed | 1 passed (2)`**: el que muere es `bloqueo-textos.test.ts` (la guardia de árbol, dos
casos) y el que **sigue VERDE** es `cierre-rechazado-aviso.test.ts`, el de los literales.
**Confirmado byte a byte lo que declara el implementador**: una aserción sobre la salida no puede
distinguir una copia de un import.

**La guardia existe y muerde de verdad.** Recorre `lib/`, `app/` y `components/`, con
anti-vacuidad (más de 500 ficheros recorridos), y afirma tres cosas: la frase aparece en **un solo
fichero** (`toEqual(["lib/constants/bloqueo-mensajero.ts"])`), ahí se **declara exportada** con su
valor, y el emisor la **importa y la usa** (busca el import, busca el uso, y exige que el literal
**no** aparezca en `emitir.ts`).

**Y el test de literales NO compara contra su propia fuente.** Leído: los cuatro casos escriben la
cadena **entera, a mano** (`…toBe("Tu cierre del 21 de agosto fue rechazado. …")`), nunca
`toBe(textoCierreRechazadoMensajero(...))`. La mutación de CONTROL —tocar ese literal— mata **7
casos**, que es la prueba de que esos asertos no son autorreferentes.

### M9 — la trampa del `down.sql`, y el hueco de R25

Reaplicada aparte para leer **qué** casos mueren:

```
FAIL … > 412/T2.3 … > R24: el down retipa LAS **TRES** columnas, no dos
FAIL … > 412/T2.5 … > R24: CONTROL — sin filas de los valores nuevos, ese MISMO down corre ENTERO
Raw query failed. Code: 2BP01. Message: no se puede eliminar tipo notificacion_evento_old
porque otros objetos dependen de él
```

**El implementador tiene razón en los dos extremos, y lo verifico:**

- el caso de R25 (`rejects.toThrow()`) **sigue verde con la mutación puesta** — está entre los 24
  que pasan. Es un aserto que **no discrimina**: se cumple con cualquier excepción;
- **el caso de CONTROL que añadió cierra el hueco de verdad**: es el que muere con `2BP01`. Sin
  él, olvidar `push_envio_dia` habría pasado desapercibido.

**Y R25 hoy falla por el motivo que dice:** ejercitado a mano contra Postgres, aborta con
**`22P02`, «la sintaxis de entrada no es válida para el enum notificacion_evento:
cierre_dia_rechazado»**, en el `ALTER COLUMN … USING` de `notificacion.evento`. Es la precondición
del `down.sql` fallando ruidosamente, no otra cosa.

---

## 7 · Lo que el implementador declara, juzgado

**1. T7.4 no se cumplió como está escrita (no hay navegador).** **Sustitución ACEPTABLE, con un
hueco acotado y nombrado.** Cubre todo lo que esta ficha añade: la fila, su entidad, el `porHacer`,
el `accionable` y el `atajo` salen de `NotificacionService.listar`, que es **exactamente** lo que
alimenta la campana. Y la ficha **no añade una sola línea de render**: `presentacion-aviso.ts`
deriva título, clase y atajo del catálogo, sin ningún `Record` por evento que pudiera quedarse sin
entrada. **Lo que queda fuera** es que nadie ha visto el aviso pintado. Riesgo bajo, pero real:
menor **m1**.

**2. «`crear` devuelve `null`, no `false`».** **CIERTO.** `NotificacionRepository.crear` hace
`if (… code === "P2002") return null;` y su firma es `Promise<string | null>` desde la 410. La
sustancia del razonamiento de la entidad no cambia.

**3. Arregló su propio barrido de limpieza.** **CIERTO y correcto.** El `finally` del caso de R9
borra por `(evento, destinatarioUsuarioId)`, no por `entidad_id`, así que **también limpia lo que
escribe el código MUTADO** (con M1 la fila ya no lleva el `:`). Y el `beforeAll` exige que ese
mensajero parta de CERO avisos del evento, así que el barrido no toca nada ajeno. Tras mis doce
mutaciones y mi sonda, la base local queda sin filas de `cierre_dia_rechazado`.

**4. `ConsoleErrorLogger` pierde la cadena de `cause`.** **CIERTO, y la decisión de alcance es
CORRECTA.** `lib/errors/logger.ts:15` registra `err.stack ?? err.message` —una cadena—, así que
`cause` no se imprime. Es el logger de **todo** el repo: arreglarlo aquí cambiaría el diagnóstico
de las trece familias de best-effort dentro de una ficha de complejidad «baja». Se reporta, no se
toca. Merece ficha propia.

---

## 8 · Hallazgos

Ninguno bloqueante.

- **menor m1 — T7.4: nadie ha visto el aviso en la campana.** No hay navegador en el entorno y
  producción tampoco sirve de testigo (0 cierres rechazados en toda su historia, así que tras el
  despliegue lo correcto es ver **cero** avisos nuevos; quien busque la confirmación allí concluirá
  mal). Mitigado por dos hechos medidos: la ficha no añade render, y el camino real hasta
  `NotificacionService.listar` está recorrido con datos. **Recomendación:** que el humano provoque
  un rechazo en local y abra la campana una vez, cuando le venga. No gatea el merge.
- **menor m2 — falta la entrada en `progress/history.md`.** `CHECKPOINTS.md` la pide y no está. No
  es deuda del implementador: no figura en `tasks.md` y en este repo la escribe el leader al
  cerrar. Queda anotada para el cierre.
- **menor m3 — las dos unidades best-effort del rechazo comparten etiqueta de operación.**
  `avisarDelRechazo` llama `emitirBestEffort("cierre_dia_rechazado", …)` **dos veces**: una para
  las lecturas y otra para la emisión. En el log del servidor los dos fallos se leen igual y, con
  la pérdida de `cause` (hallazgo 4), no hay forma de distinguir «no pude leer el cierre» de «no
  pude escribir el aviso». Es justo lo que al implementador le costó tres corridas diagnosticar.
  Una etiqueta distinta para la unidad de lecturas lo cerraría en una línea.
- **menor m4 — un caso de R16 mide su propio fixture.** «el contexto del emisor NO TIENE campo de
  motivo» hace `Object.keys(ctx())` sobre el **helper del test**, no sobre el tipo de producción:
  seguiría verde si alguien añadiera `motivoRechazo` a `CierreRechazadoContexto`. **No es un
  agujero**, porque el caso del motivo-cebo sí lo caza —y es uno de los que murió con M10—, pero el
  caso no afirma lo que su título promete.
- **menor m5 — `feature_list.json` sigue en `in_progress`.** Correcto: la ficha se cierra al
  mergear, y el implementador hizo bien en no escribir el JSON con agentes dentro.

## 9 · Lo que NO se persiguió, por encargo

- El rojo de la **421** (`notificacion-evento-avisos-agregados-migration.test.ts`, etiquetas del
  enum duplicadas por consultar el tipo sin fijar el esquema). No apareció en mi corrida y no se
  baselineó. El test nuevo de esta ficha **no hereda el defecto**: fija `n.nspname = 'public'`.
- El rechazo de cierres de **bodega** (`CierresBodegaAdminService`), fuera de alcance por decisión
  del humano (D2).

---

**Veredicto final: OK.** Los 26 requisitos tienen un test que se pone rojo si el código está mal,
las diez mutaciones obligatorias mueren reaplicadas de forma independiente con su control, el
`down.sql` retipa las tres columnas que `information_schema` dice que existen, la propiedad central
está medida con datos —y matada a propósito para comprobar que la defiende el instante persistido y
el índice único—, y `./init.sh` completo termina en `INIT_EXIT=0` corrido por el reviewer.

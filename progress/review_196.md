# Feature 196 - Snapshot diario del ranking de mensajeros - REVISION

Revisor: reviewer. Fecha: 2026-08-10. Rama: `ux`.
Material: `specs/196-snapshot-ranking-diario/{requirements,design,tasks}.md`,
`progress/impl_196.md`, `docs/architecture.md`, `docs/conventions.md`,
`docs/verification.md`, `CHECKPOINTS.md`.

Fuera de alcance de esta revision (cambios AJENOS presentes en el arbol): ajustes de
`minWidth`/`font-semibold` en columnas de tablas y el WIP del escaner
(`EscanerModal`, `EscanerDesplegable`, `RecoleccionModule`, `RecogerPaqueteCard`,
`EscanerRecepcion`, `OrdenesListado`, `.gitignore`). No se juzgan.

# VEREDICTO: APROBADO CON RESERVAS

Cero hallazgos BLOQUEANTES en el codigo. Las reservas son de CIERRE (gate completo,
bookkeeping y aplicacion de la migracion), todas declaradas por el propio implementer
en su seccion 5 y todas del leader/humano, no del implementer.

---

## 1. Verificacion ejecutable (corrida por el reviewer, no citada del log)

### 1.1 `./init.sh --rapido` - VERDE

```
57 problems (0 errors, 57 warnings)
[OK] lint paso
-> pnpm run test:rapido
 Test Files  93 passed (93)      Tests  1283 passed (1283)   Duration 108.20s
 Test Files  84 passed (84)      Tests  1121 passed (1121)   Duration  11.36s
[OK] test:rapido paso
[OK] todas las migraciones tienen down.sql
[OK] .env presente
== init OK ==
```

Cero rojos. Ni `no-embalaje` ni `TableroOperativo` aparecieron: no hubo flakes que
descartar. Las 57 warnings de lint son `no-unused-vars` de `_args` en archivos AJENOS
a la 196 (revisado el listado completo): ninguna en archivos de esta feature.

Comprobado ademas que `--changed origin/dev` SI alcanza los archivos nuevos aunque
esten sin trackear: `vitest list --changed origin/dev` lista 168 casos de la 196. El
verde del gate cubre la feature de verdad, no la esquiva.

### 1.2 Los archivos de la feature, corridos aparte

```
pnpm exec vitest run <14 archivos de la 196 + Sidebar + AppLayout
                      + cobertura-tablas.guardia + asignado-at-solo-lectura.guardia>
 Test Files  18 passed (18)      Tests  250 passed (250)
```

### 1.3 El bloque de Postgres real SI corre (no queda verde por vacio)

`tests/integration/db/ranking-snapshot-migration.test.ts` con `--reporter=verbose`:
43 casos, cero skipped. Los del bloque B ejecutados de verdad contra el motor:
RLS (`relrowsecurity`), RESTRICT del borrado de usuario, el UNIQUE parcial de
`posicion`, los CHECK y el `down.sql` real.

### 1.4 La migracion NO se ha aplicado a ninguna base (el encargo lo prohibia)

Consultado el Postgres de `.env`, ANTES y DESPUES de correr los tests:

- `_prisma_migrations` con `migration_name like '%ranking_snapshot%'` -> 0 filas
- tablas `ranking_snapshot%` en `public` -> ninguna
- esquemas `t196%` -> ninguno
- usuarios `t196-%@example.test` -> 0

El bloque B no deja residuo. Ultima migracion aplicada en la base:
`20260810120000_gestion_orden_ubicacion` (de otra feature, ajena).

---

## 2. Trazabilidad R1-R38 -> test REAL

Ninguno huerfano, ninguno cubierto solo de refilon. Se listan primero los cuatro que el
encargo pedia mirar con lupa.

### Los sospechosos

- **R14 (nada de snapshot parcial)** - `ranking-snapshot-repository.test.ts`. El doble
  de Prisma distingue el cliente de FUERA de la transaccion del `tx` de DENTRO: los
  delegates externos LANZAN si alguien los usa. El caso "un fallo en createMany propaga
  y NO deja cabecera" comprueba que el `create` de la cabecera se llamo dentro del
  callback de `$transaction` y que el `create` externo nunca se toco. Es una medicion, no
  una suposicion por "el codigo menciona la transaccion". Limite: el rollback en si es
  garantia de Prisma/Postgres y no se mide contra base real (menor 5).
- **R19/R21 (secreto del cron y no filtrar datos personales)** -
  `snapshot-ranking-route.test.ts`. Cinco casos de 401: sin header, header sin esquema
  Bearer, token distinto, secreto NO configurado (null) y -el mas fuerte- sin inyectar
  `deps.service`, de modo que un 200 exigiria construir Prisma y reventaria: el 401 limpio
  prueba que la autorizacion corre antes de todo efecto. R21 verifica que ni el cuerpo ni
  las llamadas a `defaultLogger.logError` contienen el secreto, y ademas que el cuerpo no
  lleva ninguna clave de persona ni ningun cuid/uuid colado como valor.
- **R26 ("no corrio" vs "sin actividad")** - cubierto en las TRES capas y con literales
  distintos y mutuamente excluyentes: `ranking-snapshot-service.test.ts` (`sin_snapshot`
  vs `ok` con filas vacias), `ranking-snapshot-repository.test.ts` (null vs cabecera con
  `filasSnapshot: []`), `RankingHistoricoPage.test.tsx` y `RankingHistoricoModule.test.tsx`
  (cada caso afirma el mensaje esperado Y niega el otro).
- **R4 (desempate por mensajeroId)** - `orden-ranking.test.ts` tiene el caso EXACTO que el
  encargo pedia: dos filas "Ana Rojas" 5/5 con ids `m-zz` y `m-aa` -empate en pct, en
  entregadas Y en nombre- que salen ordenadas `["m-aa","m-zz"]`. Ademas: el mismo conjunto
  con la entrada invertida da el mismo orden, y un empate total de CUATRO produce siempre
  el mismo podio (1 m-aa, 2 m-bb, 3 m-cc). El requisito esta probado.

### El resto

| R | Test que lo verifica | Real |
| --- | --- | --- |
| R1 | migration (columnas + CHECK >=1 / >=0 contra Postgres) + repo (data con fecha, umbral y conteo) + service (umbral aplicado distinto del default) | si |
| R2 | `snapshot-dia.test.ts` (02:00 CR, 19:00 CR, cruce de mes y de anio, `now` obligatorio) + service (ventana pasada a los dos repos, cabecera a medianoche UTC) | si |
| R3 | service: instancia un `RankingService` REAL con los MISMOS repos y compara ids fila a fila y posicion a posicion | si, y fuerte |
| R5 | service: 0/0 no produce fila; 3/0 si; 0/6 si | si |
| R6 | service (comparacion exacta de las 8 claves) + migration (10 columnas reales, tipos y nullability) | si |
| R7 | service (monto Y descripcion vigentes; posicion sin premio configurado -> nulos, sin inventar) | si |
| R8 | migration bloque B: el CHECK de premio-sin-posicion RECHAZA en Postgres | si |
| R9 | orden-ranking (bajo umbral: se lista con puesto, sin posicion) + service con umbral 5 | si |
| R10 | `formatearPct` (8 casos, incl. >100 legitimo y null distinto de "0.0") + migration (no existe columna de pct) + guardia de "unico sitio del repo con este redondeo" | si |
| R11 | service (sin actividad y sin mensajeros -> cabecera con filas 0) + repo (no llama createMany) | si |
| R12 | repo (P2002 de fecha -> creado:false sin escribir; OTRA constraint SI propaga) + service (omitido) + route (200 estado omitido) + migration bloque B (el UNIQUE rechaza de verdad) | si, con matiz (menor 4) |
| R13 | migration bloque B: los CUATRO unicos rechazan su duplicado en Postgres, y el parcial SI admite muchas filas con posicion NULL | si, y fuerte |
| R15 | guardia: aridad de congelar = 1, firma `now: Date`, y la ruta no contiene searchParams / nextUrl / req.json / formData / new URL( | si |
| R16 | service (nombre congelado al escribir y al leer, con la fila "Ana la de entonces") | si |
| R17 | migration bloque B: el DELETE del usuario con filas falla nombrando la FK | si |
| R18 | migration (censo de CREATE TABLE / ALTER TABLE / COMMENT ON = solo las 2 nuevas; ninguna sentencia DML) + guardia ranking-ventana-dia reforzada | si |
| R20 | route (claves exactas fecha/estado/filas, y NO existe `status` en el cuerpo) | si |
| R22 | route (service que lanza -> >=500 y logError una vez) | si |
| R23 | guardia sobre vercel.json + aritmetica verificada en la seccion 5 | si |
| R24 | service (generadoAt ISO) + module + page (visible solo cuando hay cabecera) | si |
| R25 | repo (orderBy puesto asc) + service (no reordena) + module (props desordenadas se pintan tal cual) | si |
| R27 | page (rol ajeno y sin sesion -> notFound) + service (forbidden SIN consultar el repo) | si |
| R28 | page (mensajero: se comprueba fila a fila, no por conteo) + service | si |
| R29 | guardia: censo de escrituras Prisma sobre los 2 modelos en app/ y lib/; unico escritor = RankingSnapshotRepository; el contrato del service no expone verbo de escritura | si |
| R30 | action ("2026-02-31", "ayer", cadena vacia, sin clave -> invalid SIN llamar al service) + page (notFound) | si |
| R31 | action + repo (Decimal serializado a string escala 2; ningun Prisma.Decimal sale de la capa) + module | si |
| R32 | descarga (mismas filas, mismo orden, valores crudos sin el porcentaje, sin el simbolo de moneda y sin el guion) | si |
| R33 | descarga (sobre el tope: sin archivo y mensaje con total y tope) | si |
| R34 | columnas (la proyeccion no contiene mensajeroId) | si |
| R35 | columnas + componente (nombre de archivo con la fecha consultada; dos fechas -> dos nombres) | si |
| R36 | `tests/unit/services/ranking-service.test.ts` - ver seccion 3 | si |
| R37 | migration estatico (DOWN = 2 DROP, detalle antes que cabecera) + bloque B (UP y DOWN reales dejan el esquema vacio) | si |
| R38 | migration bloque B (pg_class.relrowsecurity = true en las dos) | si |

**Requisitos sin cobertura: NINGUNO.**

---

## 3. R36 - no regresion del ranking en vivo (comprobado con git diff, no de palabra)

```
$ git diff --stat -- tests/unit/services/ranking-service.test.ts
(vacio)
```

El archivo NO aparece en `git status`. Ni un assert tocado. Confirmado.

`git diff lib/services/RankingService.ts`: el unico cambio es sustituir el bloque de
sort + asignacion de podio + toFixed(1) por `ordenarAgregados` / `asignarPodio` /
`formatearPct`. Verificada la equivalencia linea a linea:

- Orden: definidos antes que indefinidos -> pct desc -> entregadas desc -> nombre asc por
  localeCompare. Identico. Se anade un quinto criterio (id asc) que solo actua donde el
  anterior devolvia 0.
- Podio: pct definido Y asignadas >= umbral Y quedan posiciones. Identico.
- Serializacion: `pct` sigue siendo null o string de un decimal; `premio` sigue siendo el
  monto del ocupante o null. `RankingRowDTO` sin cambios.
- Autorizacion: el diff no toca el bloque de rol. `editarPremio` NO aparece en el diff:
  intacto.

Matiz que se anota y se ratifica: el desempate por id SI cambia el comportamiento
observable en el caso de empate TOTAL, que antes quedaba a merced del sort del motor. No
es una regresion encubierta: R4 lo exige y design.md seccion 3 lo autoriza por escrito
("aditivo: solo actua donde el orden actual ya estaba SIN especificar").

---

## 4. El comparador es UNO SOLO

Verificado por lectura de las tres fuentes:

- `lib/ranking/orden-ranking.ts` es el unico modulo con comparador, regla de podio y
  redondeo. Puro: sin Prisma, sin next, sin reloj.
- `RankingService.obtenerRanking` lo consume. NO queda ni un sort ni un redondeo propio:
  el `AgregadoMensajero` local y su sort desaparecieron del archivo (visible en el diff).
- `RankingSnapshotService.congelar` lo consume: asignarPodio(ordenarAgregados(...), umbral).
  Cero comparadores, cero reglas de podio, cero redondeos propios.
- `RankingSnapshotRepository` no ordena: solo orderBy puesto asc sobre el dato congelado,
  que es lo que R25 pide.
- Hay ademas una guardia barata en `orden-ranking.test.ts` que afirma que `RankingService.ts`
  NO contiene la expresion del redondeo y SI contiene `formatearPct`.

No hay segundo comparador. No es bloqueante: es correcto.

---

## 5. Fecha CR y programacion del cron (R2, R23) - aritmetica verificada

- Ningun `toISOString` para calcular un dia. `fechaObjetivo` = fechaCalendarioCR(now - 24h);
  `ventanaDelDia` = inicioDelDiaCREnUtc / inicioDelDiaSiguienteCREnUtc; `fechaComoDate` =
  literal a medianoche UTC (convencion @db.Date, NO el `desde` de la ventana). El unico
  `toISOString` del codigo de la feature es `row.generadoAt.toISOString()`, que serializa
  un INSTANTE, no un dia. `snapshot-dia.test.ts` incluye un caso explicito de que el modulo
  no usa toISOString ni importa startOfDayCR ni lib/analytics.
- vercel.json: `/api/cron/snapshot-ranking` con `0 8 * * *`. Las programaciones de Vercel
  son UTC. Costa Rica es UTC-6 fijo (sin horario de verano): 08:00Z - 6h = 02:00 CR. El
  cambio de fecha CR ocurre a las 00:00 CR = 06:00Z, o sea DOS HORAS ANTES de la corrida.
  La aritmetica cierra: madrugada CR, posterior al cambio de fecha, y el dia que congela
  (D-1: las 02:00 CR del 11 congelan el 10) ya esta cerrado.
- Independiente del corte diario: `corte-diario` y `generar-gastos-fijos` corren a
  `0 6 * * *` (00:00 CR); el snapshot a `0 8 * * *`. Dos entradas distintas, dos horas de
  separacion, sin encadenamiento (la guardia comprueba ademas que la ruta no menciona
  corte-diario, CorteDiarioService, procesar-jobs ni jobsCola).

---

## 6. Migracion (R37/R38)

- Aditiva: dos CREATE TABLE nuevas y ALTER TABLE solo sobre esas dos. Censo automatico en
  el test. Cero DROP, cero ALTER COLUMN, cero RENAME, cero CREATE TYPE, cero DML
  (comprobado sentencia a sentencia, no por palabra suelta).
- down.sql: dos DROP TABLE IF EXISTS, detalle antes que cabecera, sin CASCADE (deliberado:
  que el rollback falle antes que arrastrar un objeto ajeno). Ejecutado de verdad en el
  bloque B: el esquema queda sin rastro de las dos tablas.
- RLS: ENABLE ROW LEVEL SECURITY en ambas, sin policies (patron ruta_optimizada /
  analytics_daily). Verificado contra pg_class.relrowsecurity.
- No toca ninguna tabla preexistente. Ni siquiera `usuario`: la FK se declara desde la
  tabla nueva.
- No aplicada a ninguna base. Verificado empiricamente (seccion 1.4).

---

## 7. Las NUEVE desviaciones del design (seccion 4.2 del log) - ratificacion una a una

**1. `asignarPodio` devuelve {agregado, puesto, posicion} en vez de solo posiciones -
RATIFICADA.** R6 exige congelar el puesto; calcularlo aparte abriria un segundo sitio
donde el orden puede desincronizarse. El vivo ignora `puesto` y su salida no cambia
(verificado en el diff).

**2. El `puesto` se RENUMERA 1..N tras filtrar los sin actividad - RATIFICADA. No
contradice R6/R25.** El glosario define puesto como "la posicion del mensajero en la lista
completa CONGELADA (1..N)", y R1 hace de `filas` el conteo congelado: conservar el puesto
del vivo dejaria un "puesto 7" en una tabla de 3 filas y max(puesto) distinto de `filas`,
ademas de agujeros que no significan nada para quien lee el historico. Lo que R3 fija es
el ORDEN RELATIVO y el PODIO, y ninguno se mueve: una fila 0/0 tiene el pct indefinido,
nunca es elegible para podio y el comparador la manda a la cola de los indefinidos, asi
que quitarla no puede desplazar ninguna posicion. El test "filtrar por actividad no mueve
el podio ni el orden relativo" lo ejercita con el caso duro (Zoe 5/0: pct indefinido, en
la cola, PERO con actividad) y comprueba a la vez el orden relativo y la renumeracion.

**3. `crearSnapshot` hace un findUnique extra al chocar el P2002 - RATIFICADA.** R12
prohibe crear, alterar y borrar; no leer. Devolver el conteo REALMENTE congelado en vez de
una cifra inventada es mas honesto, y el test comprueba que ese findUnique NO se llama en
el camino de error genuino.

**4. Solo se traga el P2002 de `fecha` - RATIFICADA, y es lo correcto.** Los otros tres
UNIQUE tambien emiten P2002 y son defectos (un mensajero repetido, dos puestos iguales).
Hay test explicito de que la colision de (snapshot_id, puesto) SI se propaga.

**5. El UNIQUE parcial va a mano en el SQL y no en schema.prisma - RATIFICADA con reserva
menor.** Prisma no expresa indices parciales; declararlo como @@unique seria un indice
TOTAL distinto del real, que es peor drift. Patron establecido del repo
(wallet_movimiento_origen_categoria_uq, purga_pdf_indices). Reserva: quedara un DROP INDEX
fantasma en el proximo `migrate dev --create-only`; el .sql y el schema lo dejan escrito y
un test prohibe "arreglarlo" metiendo un @@unique distinto del indice real.

**6. `?fecha` malformado -> notFound() en vez de caer a D-1 - RATIFICADA, CUMPLE R30.**
R30 exige rechazar la peticion SIN consultar el almacenamiento: la Server Action valida
con zod (esFechaCalendarioValida, que caza el 2026-02-31 por round-trip) ANTES de construir
el service. Verificado en el codigo y en el test "invalid sin llamar al service". Caer a
D-1 en silencio ensenaria los datos de una fecha DISTINTA de la pedida, que es peor que un
404.

**7. "sin_snapshot" no monta tabla ni control de descarga - RATIFICADA.** Coherente con
R26 y con R32: el archivo debe llevar "exactamente las filas mostradas", y sin cabecera no
hay filas mostradas. Un archivo vacio afirmaria un dia sin actividad que nadie midio.
Fijado por test (ni tabla ni boton de descarga en ese estado).

**8. `premioDescripcion` no viaja al archivo - RATIFICADA.** design.md seccion 7 declara
UNA columna "Premio" y R34 solo prohibe `mensajeroId`. La magnitud auditable es el monto;
la descripcion sigue visible en la celda de la tabla. No es una desviacion real del design.

**9. No se ejecuto `db:migrate:create`; el DDL se genero con `migrate diff --script` sin
conexion - RATIFICADA.** `prisma migrate dev --create-only` APLICA las migraciones
pendientes antes de crear el archivo, y eso estaba prohibido por el encargo. Verificado
empiricamente que la base sigue limpia (seccion 1.4) y que el DDL generado se ejecuta de
verdad contra Postgres (bloque B). Nota: contradice literalmente el criterio de hecho de
T1.2 ("generada con pnpm run db:migrate:create, no a mano"), que quedo marcada [x] con un
criterio incumplido, aunque por el motivo correcto. Ver menor 3.

---

## 8. Las tres guardias ajenas: alguna quedo DEBILITADA?

**`ranking-ventana-dia.guardia.test.ts` -> REFORZADA. Sin objecion.**
La lista de migraciones del modulo pasa de 1 a 2 entradas: es un ALTA legitima, no una
relajacion (la 196 anade una migracion de pleno derecho). Y se anaden tres aserciones
NUEVAS sobre el DDL de la 196: no nombra premio_ranking, no hay DROP, y todo CREATE/ALTER
TABLE es sobre las dos tablas nuevas. Verificado en el diff que las aserciones sobre
PremioRanking y sobre la ventana CR quedan INTACTAS. El unico afinado (`soloSentenciasDdl`,
que quita los comentarios y los COMMENT ON) aplica SOLO a la comprobacion nueva y esta
justificado: si no, obligaria a escribir migraciones mudas.

**`asignado-at-solo-lectura.guardia.test.ts` -> INTACTA. Sin objecion.**
Confirmado: NO aparece en `git status`. La guardia mantiene una whitelist de 3 migraciones
que MENCIONAN asignado_at en texto crudo. La migracion de la 196 la citaba en tres
COMMENT ON; se reescribieron los comentarios y la whitelist NO se amplio. Esta es la
eleccion FUERTE: anadir una cuarta entrada a la whitelist habria sido la debilitacion.
Coste aceptable: los comentarios ahora dicen "la fecha de asignacion de la orden" en vez
del nombre de la columna, un pelo menos preciso, y la migracion no toca esa columna.

**`cobertura-tablas.guardia.test.ts` + `censo-tablas.ts` -> ALTA, no relajacion. Sin
objecion.** Todos los contadores suben en +1 y NINGUNA exclusion se mueve: archivos 30->31,
instancias 31->32, censo total 32->33, con_descarga 26->27, fuera 6->6. La tabla nueva nace
con_descarga, que es la decision que esa guardia obliga a tomar explicitamente. Es
exactamente la forma prevista de absorber una tabla nueva.

Ademas, `superficie-de-uso.guardia.test.ts` estuvo rojo entre tandas y se apago al
aterrizar page.tsx, no con la anotacion @sin-superficie. Correcto.

**Sobre el item de menu "Ranking" convertido en DESPLEGABLE (Sidebar/AppLayout):**
era INEVITABLE y estaba prescrito: design.md seccion 6 dice literalmente "subitem
Historico bajo el item Ranking de lib/auth/menu-visibility.ts (children, patron Wallet)".
Un item con children deja de renderizarse como enlace, asi que los tres asserts tenian que
moverse. Los ajustes son LEGITIMOS y en neto NO debilitan el detector:
- `Sidebar.test.tsx` cambia getByRole("link","Ranking") por getByRole("button",/ranking/i)
  y ANADE `expect(queryByRole("link",{name:"Ranking"})).toBeNull()`: el caso ahora afirma
  tambien lo que ya NO debe existir.
- `AppLayout.test.tsx`: mismo cambio, misma intencion (que el item del maestro este montado).
- El caso "marca item simple activo por ruta" sustituye /ranking por /incidentes: unica
  perdida real de cobertura, pequena y compensada (el marcado de subitems lo cubre el caso
  de Tarifas). Se anota como menor 7, no como debilitacion deliberada.

---

## 9. CHECKPOINTS.md, punto por punto

**Especificacion**
- [x] `requirements.md` con requisitos EARS numerados R1-R38.
- [x] `design.md` con alternativas descartadas (ocho: A-H) y su porque.
- [ ] `tasks.md` con TODAS las tasks [x] -> T6.2 (gate completo) y T6.3 (bookkeeping) SIN
      marcar. Declarado por el implementer. Ver menores 1 y 2.

**Trazabilidad**
- [x] Cada R<n> mapea a al menos un test concreto y real (seccion 2).
- [x] `progress/impl_196.md` contiene el mapa R<n> -> test completo.

**Calidad de codigo**
- [x] typecheck sin errores (init.sh lo corre y termino en init OK).
- [x] lint sin errores (57 warnings, todas preexistentes y ajenas a la 196).
- [~] `pnpm test`: solo --rapido (93+84 archivos, 2404 tests, cero rojos). El COMPLETO no
      se ha corrido. Ver menor 1.
- [x] E2E: N/A. El snapshot no toca auth, pagos, recaudo, ingesta de ordenes ni webhooks;
      el premio que congela es un dato de auditoria, no un movimiento de dinero.

**Datos y seguridad (Supabase)**
- [x] RLS activada en las dos tablas nuevas, verificado contra pg_class.
- [x] Migracion versionada y con down.sql, ejecutado de verdad en el bloque B.
      (`pnpm run db:rollback` como script no se ejecuto: menor 6.)
- [x] Ningun secreto hardcodeado: CRON_SECRET por loadCronConfig().
- [x] Webhooks: N/A. El cron valida Bearer antes de todo efecto y es idempotente POR
      RESTRICCION DE BASE (UNIQUE(fecha)), no por un if del codigo: no hay ventana de
      carrera entre dos invocaciones simultaneas.

**Patron de capas**
- [x] Controller (route.ts): solo HTTP + auth, cero queries, cero negocio.
- [x] Service: no conoce Request/Response/headers; repos, config e instante por inyeccion.
- [x] Repository: solo Prisma, cliente acotado con Pick<PrismaClient, ...>, cero negocio,
      cero reloj propio.
- [x] Interfaces en lib/interfaces/{repositories,services}/.

**Permisos**
- [x] La pagina resuelve el rol server-side con resolveActorFromSession y notFound().
- [x] El componente cliente recibe todo por props ya serializadas; no fetchea.
- [x] Lectura por Server Action, no por fetch a una API route.

**Multi-pais / configuracion**
- [x] Ni pais ni cuenta hardcodeados. El simbolo de colon viene de money() en
      ranking-labels.ts, PREEXISTENTE de la feature 76 y reusado tal cual: la 196 no
      introduce moneda nueva.

**Verificacion final**
- [~] `./init.sh` completo: PENDIENTE (solo --rapido).
- [x] `progress/review_196.md`: este archivo.
- [ ] Entrada en `progress/history.md`: NO existe.

---

## 10. Hallazgos

### BLOQUEANTES

NINGUNO.

### Menores

1. **`./init.sh` COMPLETO no corrido en esta rama** (T6.2 sin marcar). CHECKPOINTS.md lo
   exige para pasar a done y CLAUDE.md regla 5 lo exige antes de cada PR, sin excepcion.
   Corresponde al leader antes del PR.
2. **Bookkeeping sin hacer** (T6.3): feature_list.json mantiene la 196 en `in_progress` y
   progress/history.md no tiene entrada. Declarado y deliberado (para no arrastrar altas
   ajenas en el diff). Corresponde al leader.
3. **T1.2 marcada [x] con su criterio de hecho incumplido**: dice "generada con
   pnpm run db:migrate:create (no a mano)" y se genero con migrate diff --script. La
   decision es correcta (el comando prohibido aplica migraciones), pero la tarea deberia
   haberse enmendado en vez de marcarse contra un criterio falso.
4. **R12 no tiene una prueba de dos corridas consecutivas contra la base real.** La cadena
   esta cubierta por tramos -el UNIQUE rechaza de verdad en Postgres; el P2002 se traduce a
   creado:false; el service lo mapea a omitido; la ruta devuelve 200 con estado omitido-
   pero el eslabon "el error que Postgres emite DE VERDAD es el que esColisionDeFecha
   reconoce" se prueba con un PrismaClientKnownRequestError fabricado a mano. Riesgo bajo
   (el nombre real ranking_snapshot_dia_fecha_key y el meta.target contienen "fecha", y
   ninguna de las otras tres constraints lo contiene), pero es el unico punto de la feature
   donde una suposicion sobre la forma del error del driver no esta medida.
5. **R14 solo medido con doble de Prisma.** El rollback en si es garantia del motor; lo que
   el test demuestra -que nada se escribe fuera de la transaccion- es lo unico que el codigo
   controla. Aceptable, se anota.
6. **`pnpm run db:rollback` no ejecutado como script.** El down.sql si se ejecuto real
   (bloque B). Queda para el momento de aplicar la migracion.
7. **Sidebar.test.tsx, caso "marca item simple activo por ruta"**: /ranking se sustituye
   por /incidentes y NO se anade un caso equivalente para el subitem activo
   /ranking/historico. La intencion del caso (item SIN submenu) se conserva y el marcado de
   subitems lo cubre el caso de Tarifas, pero la ruta de la 196 no queda cubierta ahi.
8. **Sidebar/AppLayout: el nombre exacto "Ranking" pasa a la regex /ranking/i.** Compensado
   con el queryByRole("link") -> null que se anadio; en neto no se debilita.
9. **Ventana ciega diaria de 00:00-02:00 CR**: en esas dos horas, /ranking/historico sin
   ?fecha apunta a D-1, que aun no esta congelado, y pinta "no se genero el snapshot". Es
   el comportamiento correcto y honesto, pero design.md seccion 10 no lo anticipa. Nota
   para una futura enmienda del design, no un defecto.
10. **Indice parcial huerfano del datamodel** (desviacion 5): aceptado, documentado en tres
    sitios y fijado por test. Reaparecera como DROP INDEX fantasma en el proximo
    migrate dev --create-only.
11. **El log se llama progress/impl_196.md**; T6.1 pedia
    progress/impl_196-snapshot-ranking-diario.md. Cosmetico.

---

## 11. Lo que queda para el leader / el humano antes de cerrar

1. `./init.sh` COMPLETO en verde en `ux`, comparado con el baseline de `dev` del mismo dia.
2. Aplicar 20260811120000_ranking_snapshot cuando corresponda (hoy la base esta limpia).
3. Bookkeeping: feature_list.json (196 -> done), progress/current.md, progress/history.md.
4. Commit (el implementer no commiteo, por indicacion expresa).

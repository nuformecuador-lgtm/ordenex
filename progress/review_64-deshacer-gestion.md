# review_64-deshacer-gestion

> Reviewer. Verificacion ejecutada por mi (no confie en las bitacoras). Rama
> `feature/64-deshacer-gestion`, working tree sin commitear. NO edite codigo ni cambie de rama.

## Veredicto: **APROBADO** (2026-07-15, 2.ª pasada)

**RECHAZADO en la 1.ª pasada por B1 y B2 (2 gates documentales). El leader los cerró; los verifiqué
uno por uno y AMBOS quedan cerrados → levanto el rechazo.** El código nunca tuvo bloqueantes: la
1.ª pasada ya lo dio por APROBADO con 0 hallazgos de código, y no se tocó ni una línea para cerrar
el rechazo (lo confirmé: los cambios son solo `tasks.md`, `impl_64-*.md` y `design.md`).

**B1 CERRADO** — `specs/64-deshacer-gestion/tasks.md`: **25 tasks `[x]`, 0 en `[ ]`** (medido).
T22 consolida el mapa R1–R38 y documenta la corrección de la ruta de test. **T23 la apruebo tal
como está redactada**, y es lo correcto: no marca verde lo que no lo está — declara sus 2 criterios
IMPOSIBLES por deuda AJENA en vez de maquillarlos. Un T23 que dijera "`./init.sh` verde" sería
falso; este dice la verdad y explica por qué. Eso es exactamente lo que `docs/verification.md`
pide ("compila" no es "funciona", y tampoco lo es "el agente dice que está listo").

**B2 CERRADO** — `progress/impl_64-deshacer-gestion.md`: retitulado "BACKEND + FRONTEND", con la
Tanda 2 y el mapa **R35–R38 → `tests/components/CierreDiaModule.test.tsx`** (ruta real), la línea
stale de "`app/` no se tocó" eliminada y la verificación final de la feature completa. El
"Falta solo el frontend" que sobrevive en la línea 146 es el veredicto **histórico de la Tanda 1**,
cerrado justo debajo por la Tanda 2: es registro, no una afirmación viva. Correcto así.

**Menor de `design.md` CERRADO** — §4.1 y §7.1 ahora dicen que la FK **ERA** `SET NULL` y que
F1.4-i la dejó en `RESTRICT` (citando `20260714170000` y el `confdeltype='r'` que medí); §7.6 pasó
de "ABIERTA… no entra salvo aprobación" a "**APROBADA (F1.4-i) E IMPLEMENTADA**". Apruebo además
la decisión de **conservar el análisis viejo**: es el porqué del predicado, que sigue siendo
obligatorio — la FK es defensa en profundidad, no su reemplazo.

### Hallazgo NUEVO del leader, confirmado por mí: la feature 65 bloquea el DESPLIEGUE

Corrí `pnpm build` yo mismo: **FALLA** en
`lib/repositories/TarifaVigentePorZonaRepository.ts:22` (`'zonaId' does not exist in type
'TarifaWhereInput'`) — Next.js typechequea al construir. **Es la feature 65, NO la 64** (archivo
que esta rama no toca; el error ya estaba en el baseline de `dev`). **Vale la pena registrarlo:
el riesgo de la 65 estaba subestimado en `progress/current.md`, que lo describe como "aprobar un
cierre reventaría en runtime". Es más grave: hoy `dev` NO COMPILA → nada se despliega hasta
saldarla.** No cambia el veredicto de la 64, pero sí la urgencia de la 65, que hoy figura como
`pending` aparcada.

### Los menores de código: van como DEUDA REGISTRADA, ninguno gatea el PR

Ninguno afecta comportamiento, ninguno toca dinero, ninguno es un requisito incumplido. Mi
recomendación: **no abrir una tanda de implementer solo para esto**. Si alguna otra razón obliga
a tocar el código antes del PR, el único que pediría colar es el typo **"desha" →
"deshacé"** (`lib/services/CierreDiaService.ts:47`): es la única cadena que ve un usuario final.
El resto (docstring en presente de `OrdenHistorialRepository.ts:84-86`, `unauthenticated` con
mensaje genérico, tests R13/R14/R15 tautológicos, numeración R a la deriva en §6 del design) es
higiene: que se registre en `history.md` al cerrar y se recoja en la próxima feature que pase por
esos archivos.


## Numeros que medi yo

| Medida | Resultado | Juicio |
| --- | --- | --- |
| `pnpm typecheck` | **2 errores**: `TarifaVigentePorZonaRepository.ts(22,16)`, `scripts/seed-zonas.ts(257,71)` | **= BASELINE EXACTO** (feature 65, aparcada por el humano). **0 nuevos.** |
| `pnpm lint` | **0 errores**, 138 warnings | verde (warnings preexistentes) |
| `pnpm test --testTimeout=20000` | **296 archivos / 2764 tests / 0 fallos** | verde. Sin flake de `HomePage` con el timeout documentado. |
| `prisma migrate status` | 47 migraciones, "Database schema is up to date" | verde |
| `prisma migrate diff --from-config-datasource --to-schema` | **"No difference detected"** | **sin drift** modelo-base |
| `./init.sh` | ROJO en typecheck | **NO imputable a la 64** (feature 65; gate honesto desde el PR #67) |

## Checklist CHECKPOINTS.md, punto por punto

**Especificacion**
- [x] `requirements.md` con EARS numerados R1-R38.
- [x] `design.md` con alternativas descartadas y su porque (§7: 6 alternativas).
- [ ] **`tasks.md` con TODAS las tasks `[x]` -> FALLA (B1):** T22 y T23 siguen en `[ ]`.

**Trazabilidad**
- [x] Cada `R<n>` mapea a >=1 test concreto y REAL (verifique los 38).
- [ ] **`progress/impl_<feature>.md` contiene el mapa `R<n> -> test` -> FALLA (B2):** R35-R38 dicen
      "PENDIENTE — frontend".

**Calidad de codigo**
- [x] `typecheck`: baseline exacto, 0 errores nuevos.
- [x] `lint`: 0 errores.
- [x] `pnpm test`: 2764/2764.
- [~] E2E de flujo critico: **escrito, no ejecutado** (`e2e/cierre-dia.spec.ts:133`). Deuda
      ESTANDAR del repo (sin harness de seed/login e2e), no inventada por esta feature.

**Datos y seguridad**
- [x] RLS: **sin tabla nueva -> sin RLS nueva.** Verificado VIVO: `gestion_orden` sigue
      `relrowsecurity=true` con **0 policies** (solo service role). Ninguna migracion toca policies.
- [x] Migraciones reversibles: **ambas tienen `down.sql`** y **ejecute el round-trip real**.
- [x] Sin secretos hardcodeados (la feature no anade ninguno).
- [x] Webhooks: N/A.

**Patron de capas**
- [x] Action (`lib/actions/cierre-dia.ts`) sin queries ni negocio: zod + actor + delega.
- [x] Service sin HTTP; las 8 guardias y `ESTADOS_ESPERADOS` viven ahi.
- [x] Repository solo queries Prisma; `findGestionParaDeshacer` devuelve la fila **sin juzgarla**.
- [x] Interfaces en `lib/interfaces/` separadas por categoria.

**Permisos / multi-pais**
- [x] Autz server-side por rol + propiedad (R8/R9); `/cierre-dia` ya hace `notFound()` para otros roles.
- [x] Mutacion por **Server Action**, no fetch a API route.
- [x] Sin hardcode de pais/moneda/cuenta.

**Verificacion final**
- [ ] `./init.sh` verde -> falla por la **feature 65** (deuda ajena, aparcada a proposito).
- [x] `progress/review_64-deshacer-gestion.md` existe (este archivo).
- [ ] Entrada en `progress/history.md` -> pendiente del leader al cerrar.

## Lo money-critical (lo que mas importaba): VERIFICADO

**Los 3 WHERE existen, con test real que los fija:**
1. `lib/repositories/CierreDiaRepository.ts:120` — `findGestionesPendientes`:
   `{ mensajeroId, cierreId: null, anuladaAt: null }` (R13/R14/R15).
2. `lib/repositories/CierreDiaRepository.ts:196` — **`crearCierre`, el `updateMany` que VINCULA**
   (R16, el punto donde la wallet cobraria una gestion deshecha):
   `{ mensajeroId, cierreId: null, anuladaAt: null }`. Test dedicado en
   `tests/unit/repositories/cierre-dia-repository.test.ts:338` — describe "Feature 64/R16 ...
   (MONEY-CRITICAL)", 2 tests: uno fija el WHERE exacto y **el otro afirma explicitamente que NO
   es el WHERE pre-64** (`expect(where).not.toEqual({ mensajeroId, cierreId: null })`). Es el test
   que el design §8 declaraba obligatorio: esta y muerde.
3. `lib/repositories/CorteDiarioRepository.ts:33` — `{ cierreId: null, anuladaAt: null }` (R17),
   con test del WHERE + caso "mensajero con solo anuladas queda fuera del corte".

**Inventario cerrado, verificado por mi con `rg`** (no asumido): los demas consumidores de
`gestion_orden` — `CierresAdminRepository:131`, `CierresBodegaAdminRepository:100`,
`WalletFeedService:27`, `WalletTiendaFeedService:60` — filtran **estrictamente por `cierreId`**, y
`WalletMensajeroFeedService` lee el snapshot por `cierre_dia.id`. Como una anulada **nunca** recibe
`cierre_id` (punto 2), son seguros por construccion. Defensa extra sin cambio funcional en
`LiberacionReprogramadaRepository.ts:51`. **No falta ningun consumidor.**

## El contador derivado (F1.4-a): el predicado es el del spec, literal

`lib/repositories/OrdenHistorialRepository.ts:90-106`:

    OR: [
      { gestionOrdenId: null, origenTipo: { notIn: [...ORIGEN_TIPOS_CON_GESTION] } }, // R25 cuenta
      { gestion: { anuladaAt: null } },                                               // R24 cuenta si vigente
    ]

- Filtro de **LECTURA**: `count`, cero escrituras. El historial no se toca (R23) — el repo solo
  expone `createMany` en este flujo, y hay test que lo fija.
- Desambigua por **`origen_tipo`**, no por la nulidad del enlace, como exige el spec.
- **La huerfana (`origen_tipo='gestion'` + `gestion_orden_id IS NULL`) NO casa ninguna rama -> NO
  cuenta** (R26), que es la direccion segura del "ante la duda". Verifique las 4 combinaciones a
  mano contra la semantica de Prisma; el test
  `tests/unit/repositories/orden-historial-repository.test.ts:182` **fija la forma exacta del OR**
  ("si alguien lo relaja al predicado ingenuo, rompe") + casos R24/R25/R26 y la variante
  `deshacer_gestion`.
- Fuente unica `ORIGEN_TIPOS_CON_GESTION` en `lib/types/orden-historial.ts` con `satisfies`.

## Choke point (ADR/feature 49)

- `anularGestionYDevolverAGestion` (`CierreDiaRepository.ts:326-365`): **una** `$transaction`,
  3 pasos, `appendCambioEstado` en el MISMO `tx` que el `orden.updateMany`. Nadie escribe
  `estatus_id` directo.
- `tests/unit/repositories/orden-historial-cobertura.test.ts` enumera **12** call-sites (el #12 es
  este, con `origen_tipo` dedicado) y afirma que **nadie mas** usa `deshacer_gestion`.
- Guardias en los WHERE (concurrencia-segura); `count 0` en cualquiera de los 2 pasos -> sentinela ->
  rollback -> `false` -> `conflict`, con tests de ambos casos y de que un error real se propaga.

## R19 — reposicion de la asignacion: verifique la premisa que el design NO probaba

`CierreDiaRepository.ts:350` escribe `mensajeroAsignadoId: mensajeroId` **incondicional**. El design
afirma que "no puede pisar a otro mensajero porque una reasignacion habria cambiado el estado" —
**lo comprobe en vez de creerlo**: los unicos writes de `mensajeroAsignadoId` en `lib/`
(`OrdenRepository.ts:835,877,923`, `GestionOrdenRepository.ts:267`, `GuiaAsignacionService`) escriben
SIEMPRE `estatusId` en el mismo `data`, y `asignarBodegaLote` (el unico que asigna un mensajero a una
orden en bodega) va siempre a `en_espera_aceptacion` (`GuiaAsignacionService.ts:300`), nunca deja
`en_bodega`. Por tanto la guardia `estatusId: estatusEsperadoId` del `updateMany` corta el caso.
**La premisa se sostiene.** Idem el TOCTOU de R4: para que nazca una gestion mas nueva la orden debe
pasar por `en_reparto`, lo que rompe la misma guardia dentro de la tx.

## Migraciones: round-trip REAL ejecutado por mi (no leido de la bitacora)

Ambas carpetas tienen `migration.sql` **y `down.sql`**. Ejecute **los dos `down.sql` contra el
Postgres vivo dentro de una transaccion que hice ROLLBACK** (la base quedo intacta):

| Sonda | Estado vivo (UP aplicado) | Tras ambos DOWN (dentro de la tx) |
| --- | --- | --- |
| `anulada_at` / `anulada_por` | ambas, `is_nullable=YES` | **0 columnas** |
| enum `orden_historial_origen_tipo` | **12** valores (`..., deshacer_gestion`) | **11** |
| indice parcial `gestion_orden_mensajero_pendiente_idx` | `(mensajero_id) WHERE ((cierre_id IS NULL) AND (anulada_at IS NULL))` | **0** |
| FK `orden_historial_estado_gestion_orden_id_fkey` | **`confdeltype='r'` (RESTRICT)** | `'n'` (SET NULL) |
| FK `gestion_orden_anulada_por_fkey` | `'n'` (SET NULL) | — |
| RLS `gestion_orden` | `relrowsecurity=true`, **0 policies** | sin cambio |

Los dos `down.sql` **corren sin error** y devuelven el esquema **exactamente** al estado previo.
Post-rollback confirme que la base sigue con el enum en 12 y la FK en `'r'`.

**F1.4-i esta COMPLETA** (schema.prisma + SQL, como exigia el spec): `db/schema.prisma`
`OrdenHistorialEstado.gestion ... onDelete: Restrict`, migracion propia
`20260714170000_orden_historial_gestion_fk_restrict` con su `down.sql`, y `migrate diff` -> **"No
difference detected"**: no reintroduce el drift que la `20260714123909` vino a eliminar.

## Trazabilidad R1-R38

Recorri los 38. **Todos mapean a un test real que verifica lo que dice cubrir** (ninguno vacio ni
decorativo). Muestreo profundo de los delicados: R11/R12 (el `data` del update tiene **exactamente**
`["anuladaAt","anuladaPor"]` y se afirma campo por campo que resultado/monto/metodo/motivo/fecha/
evidencia/mensajero/createdAt/pagos quedan `undefined`), R16 (arriba), R18/R19, R20 (el objeto
completo del append), R21/R23, R24-R26, R27 (reintento con 1 anulada **y** no-regresion del escalado
con 3 vigentes), R29 (`usuario.update`/`updateMany` no invocados), R34 (la tx toca exactamente 3
modelos), R35-R38 (`tests/components/CierreDiaModule.test.tsx`: `it.each` de las 4 tablas, cancelar
no invoca la action, se llama con el `gestionId` de ESA fila como **objeto**, `conflict` -> motivo del
server con fila y totales intactos y `refresh` NO invocado).

**Confirmo la correccion que ya conocias:** `tasks.md` apuntaba a
`tests/unit/components/cierre-dia-module.test.tsx`, que no existe; el frontend extendio la suite real
`tests/components/CierreDiaModule.test.tsx` y arreglo la tabla de trazabilidad. **La trazabilidad
quedo bien** en `tasks.md` (R35-R38 apuntan al archivo correcto y esos tests existen y pasan). Lo que
NO se actualizo es la bitacora (B2).

## Regresion 36/37/39/41/47/49/56

Sin regresion. 2764/2764 y, en particular: el snapshot de `solicitarCierre` y los derivadores 39/56
consumen la MISMA lista filtrada (un solo filtro compra R13/R14/R15); `cierre-totales.ts`
(money-critical) intacto; el escalado de la 47 sigue disparando con 3 intentos vigentes (test de
no-regresion explicito); la cobertura de la 49 paso de 11 a 12 puntos y el chequeo de exhaustividad
del enum rompe el build si el SEED se desincroniza. Los 3 tests ajenos que cambiaron
(`orden-historial-types`, `orden-historial-cobertura`, `zonas-migration`) son la senal esperada del
mecanismo, no dano colateral.

---

# Hallazgos

## BLOQUEANTES (los 2 son documentales; 0 de codigo) — **AMBOS CERRADOS el 2026-07-15, verificados**

**B1 — ~~BLOQUEANTE~~ CERRADO · `specs/64-deshacer-gestion/tasks.md:186` y `:191`.**
T22 ("Trazabilidad R->test") y T23 ("Verificacion ejecutable final") siguen marcadas `[ ]` con la
nota "**PARCIAL (backend hecho)**". CHECKPOINTS.md exige "todas las tasks estan marcadas `[x]`". La
tanda de frontend cerro T17/T18 pero nadie volvio a estas dos.
**Que falta para cumplirlo:** marcar T22/T23 `[x]` reflejando el estado real (T23 debe registrar que
`pnpm build` y `./init.sh` no se cerraron: `init.sh` corta en typecheck por la feature 65, aparcada;
y que el E2E de T21 sigue sin ejecutar por falta de harness). No cambiar codigo.

**B2 — ~~BLOQUEANTE~~ CERRADO · `progress/impl_64-deshacer-gestion.md:90` (y titulo, linea 1).**
El mapa `R -> test` cierra con `| R35-R38 | **PENDIENTE — frontend** (T17/T18: cierre-dia-module.test.tsx) |`
y el archivo se titula "impl_64-deshacer-gestion — **BACKEND**". No existe bitacora de frontend.
CHECKPOINTS.md exige "`progress/impl_<feature>.md` contiene el mapa `R<n> -> test`" y
`docs/verification.md` pide la evidencia ahi. **4 de 38 requisitos no tienen su mapa en la bitacora**
— aunque sus tests existen, pasan y estan bien mapeados en `tasks.md`.
**Que falta:** sustituir esa fila por R35, R36, R37 y R38 apuntando a
`tests/components/CierreDiaModule.test.tsx` (el nombre correcto), y anadir la seccion de verificacion
del frontend (typecheck/lint/test). No cambiar codigo.

## menores

- **menor · `specs/64-deshacer-gestion/design.md` §4.1, §7.6 y §8 — quedaron STALE tras la gate.**
  Siguen afirmando en presente "**La FK `orden_historial_estado_gestion_orden_id_fkey` es
  `ON DELETE SET NULL`**, no `RESTRICT`", titulan §7.6 "**ABIERTA** (F1.4-i), NO descartada ... **No
  entra en la implementacion salvo que el humano lo apruebe**" y §8 habla de "riesgo vivo si F1.4-(i)
  se rechaza". F1.4-i **se aprobo y se implemento**: la FK viva es `RESTRICT` (`confdeltype='r'`,
  medido). Es la misma familia de premisa desactualizada que ya se cazo, ahora invertida. No afecta
  al codigo (que si esta bien), pero el design miente sobre el estado actual del esquema.
- **menor · `lib/repositories/OrdenHistorialRepository.ts:84-86`** — el docstring explica la
  ambiguedad como "la gestion se borro y **la FK vacio el enlace**" en presente; tras la migracion
  `20260714170000` de esta misma feature, ese DELETE esta **bloqueado**. El predicado sigue siendo
  correcto (defensa en profundidad + filas anteriores a la migracion), pero conviene decir "la FK
  *vaciaba*" / "si la FK volviera a `SET NULL`". El comentario de la linea 100-101 si esta bien.
- **menor · numeracion `R` a la deriva en `design.md`** (requirements manda y el codigo cita bien):
  §6 se titula "UI (R34-R37)" cuando son R35-R38; §5.4 cita "(R28/R29)" para el puntero (es R29) y
  "(R31)" para la evidencia (es R32); §4.2 cita "R26: reintento vs escalado" y "R27" para la linea de
  tiempo (son R27 y R28). Misma deuda que la 59 dejo anotada.
- **menor · `lib/services/CierreDiaService.ts:47`** — `MSG_NO_ES_LA_ULTIMA = "Esta orden tiene una
  gestion mas reciente; **desha** esa primero."`: "desha" no existe; el voseo del archivo
  ("Tenes", "gestionalas") pide "**deshace** esa primero". Es texto que ve el usuario.
- **menor · `CierreDiaModule.tsx`** — `unauthenticated` cae en el generico "No se pudo deshacer la
  gestion. Intenta de nuevo.". Es un mensaje, pero no el accionable de una sesion vencida
  ("Tu sesion expiro, volve a entrar"). R38 se cumple; la UX se puede afinar.
- **menor · tests de R13/R14/R15 en `cierre-dia-service.test.ts:1000`** — son algo tautologicos: el
  repo falso ya devuelve la lista filtrada, asi que prueban que el service **consume** esa lista, no
  la exclusion en si. La exclusion real esta probada donde vive (el WHERE del repo). La cadena es
  solida; lo dejo anotado para que nadie confunda ese test con la garantia.
- **menor · tests de migracion estaticos** (regex sobre el SQL, patron del repo). Lo compense
  ejecutando yo el round-trip real contra Postgres.
- **menor · `pnpm run db:rollback` NO puede revertir `_gestion_orden_anulacion`** mientras exista
  `_orden_historial_gestion_fk_restrict` (el script solo revierte la **ultima carpeta por nombre**).
  CHECKPOINTS pide que "el script `pnpm run db:rollback` funciona". **Limitacion preexistente de
  `scripts/db-rollback.ts`**, no de esta feature, y el implementer la documento honestamente
  (`impl_64:108-110`) en vez de taparla. Los dos `down.sql` son correctos (lo verifique a mano).
  Deuda del arnes.

## Deuda ajena (NO imputable a la 64, per el baseline)

- `./init.sh` rojo en typecheck por los 2 errores de la **feature 65** (aparcada por el humano).
- E2E `e2e/cierre-dia.spec.ts:133` escrito y NO ejecutado (sin harness de seed/login).
- `tests/components/HomePage.test.tsx` ~5s contra el default de 5000ms -> flake ambiental. Con
  `--testTimeout=20000` pasa; ni la home ni sus dependencias las toca esta feature.

---

## Que falto para que esto fuera OK — HECHO

Se pedia cerrar **B1** y **B2** (bookkeeping, cero cambios de codigo) y re-review. El leader los
cerro y ademas el menor del `design.md` stale. Re-verificado el 2026-07-15: **B1 y B2 CERRADOS**
-> **veredicto final: APROBADO** (ver la cabecera). Quedan los menores de codigo como deuda
registrada, ninguno gatea el PR.

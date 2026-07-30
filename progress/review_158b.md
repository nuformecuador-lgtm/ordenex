# Review — Feature 158, **PR 2 de 2**: camino del ADMIN (R37-R64)

> Rama `feature/158b-incidente-admin`, worktree `.claude/worktrees/lote-135`.
> Material: `specs/158-incidente-indemnizacion/{requirements,design,tasks}.md`,
> `progress/impl_158b_backend.md`, `progress/impl_158b_frontend.md`, `CLAUDE.md`, `AGENTS.md`,
> `docs/{architecture,conventions,verification}.md`, `CHECKPOINTS.md`.
> **Alcance: R37-R64.** R1-R36 (camino del MENSAJERO) están fuera: revisados en
> `progress/review_158.md` (OK, 0 bloqueantes) y entregados en el **PR #208**. Aquí sólo se
> verifica que **no se rompieron** (R35/R36/R64).
> **Producción NO se tocó.** Todas las sondas de base corrieron contra `localhost:5432/ordenex`
> (host confirmado con `prisma migrate status`, que lo imprime sin exponer credencial) y **dentro
> de transacciones revertidas**. `git status` limpio al terminar.

---

## VEREDICTO: **OK**

**0 bloqueantes · 7 menores · 3 observaciones separadas.**

Verifiqué **32 mutaciones propias**, sin fiarme del mapa R→test de las bitácoras: **31 discriminan**.
La que no (MU-11) es una guardia hoy inalcanzable, de la misma familia que la que el implementador
ya declaró (su mutación F) — la reporto como **menor**, con la diferencia relevante escrita.

Los tres puntos que el encargo señalaba con lupa quedan verificados **por evidencia propia**:

- **R38 (el aislamiento) es real.** Lo comprobé rompiéndolo: hacer que el repo del admin escriba
  además una fila de `gestion_orden` pone **13 casos en rojo**. Y el archivo trae el **caso de
  control** que reproduce la alternativa descartada (§9.7) y demuestra que con ella el corte diario
  **sí** devolvería al admin — sin ese control, «no aparece» podría ser cierto por la razón
  equivocada.
- **R51 (quien reporta no aprueba) está en las DOS capas**, y también su **orden**: adelantar la
  validación del monto deja **1 caso rojo**, así que «se comprueba ANTES que el monto» no es prosa.
- **R29 está cobrado en las DOS direcciones**: un tercer emisor pone el guard rojo **y quitar uno de
  los dos también**. La comparación es por igualdad, no un `some()` permisivo.

Añado además la verificación que un E2E habría dado y que **ninguna suite del repo cubría**: la
idempotencia del egreso **contra el índice único parcial REAL de Postgres**, no simulada en memoria
(§4.4). Ésa es la razón por la que la dispensa del E2E se sostiene aquí, y no la inercia del PR 1.

---

## 1. Verificación ejecutable (la corrí yo)

| gate | resultado |
| --- | --- |
| `./init.sh` | **`== init OK ==`** |
| `pnpm run typecheck` | verde, 0 errores |
| `pnpm run lint` | **0 errores**, 19 warnings (los 19 del baseline, ninguno nuevo) |
| `pnpm run test` | **630 archivos / 7354 tests / 0 fallos** |
| `pnpm exec next build` | **EXIT 0**; `/incidentes` en el manifiesto de rutas (`ƒ /incidentes`) |
| `npx prisma migrate status` | 97 migraciones, «Database schema is up to date!», sin drift |
| migraciones con `down.sql` | todas |

⚠️ **En una 1.ª pasada de `./init.sh` falló 1 test — y es un FLAKE ajeno a la feature.**
`tests/unit/components/filter-component.test.tsx › «una racha de clics colapsa en UNA sola emisión»`
(`expected 1 times, got 2`): test de **debounce**, sensible al reloj, en un archivo que **este PR no
toca** (no aparece en el diff). Re-ejecutado en aislado: **39/39 verde**; y la 2.ª pasada completa
de `./init.sh` terminó **7354/7354**. Había otro agente trabajando en paralelo en la misma máquina
(`.claude/worktrees/rescate-141`), que explica la contención. Queda como **menor m7**.

---

## 2. CHECKPOINTS.md, punto por punto

### Especificación
- [x] `requirements.md` con EARS numerados `R1`…`R64`.
- [x] `design.md` con alternativas descartadas y su porqué: **§9.7 a §9.13** son siete alternativas
      del camino del admin, cada una con evidencia de código (no opinión). §9.7 cita el método
      culpable y su línea.
- [~] `tasks.md` con todas las tasks `[x]`: **52 de 57**. **Para el alcance de este PR: completo.**
      Las 5 sin marcar son **T3.1/T3.2** (pruebas de humo **manuales**: exigen levantar la app y
      operar), **T3.3** (su parte técnica está hecha y yo la reproduje —§4—; su cláusula «con los
      datos de las pruebas de humo BORRADOS antes» depende de T3.1/T3.2) y **T3.4/T3.5** (del
      leader). Ninguna de las 32 tasks de F1B/F2B queda sin marcar. **No bloqueante para el PR; sí
      condición para pasar la ficha a `done`.**

### Trazabilidad
- [x] Cada `R37`-`R64` mapea a al menos un test concreto. **Verificado uno a uno en §3, con
      mutación propia donde el requisito tenía comportamiento que romper.**
- [x] El mapa `R<n> → test` está en `impl_158b_backend.md` §2 (R37-R64 servidor) y
      `impl_158b_frontend.md` §2 (R1-R64 completo, con el archivo de cada uno).

### Calidad de código
- [x] `typecheck` sin errores.
- [x] `lint` sin errores.
- [x] `pnpm test` verde (630/7354). Salvedad del flake ajeno: **m7**.
- [~] **E2E de flujo crítico: INAPLICABLE, con la razón medida.** Ver §5.1.

### Datos y seguridad (Supabase)
- [x] **RLS en las DOS tablas nuevas.** No lo leí del `.sql`: lo consulté en la base viva tras
      aplicar el UP dentro de una transacción — `orden_incidente` y `orden_incidente_evidencia` con
      `relrowsecurity = true` y **0 policies** (sólo service role), patrón de
      `orden`/`gestion_orden`/`cierre_dia`/`wallet_movimiento`.
      *(El encargo pedía «UP sin INSERT/UPDATE ni RLS»: ése era el criterio de la migración del
      PR 1, que no crea tablas. Aquí mandan `CHECKPOINTS.md` —«toda tabla nueva … tiene RLS
      activado»— y T1.19, que pide RLS habilitada sin policies. El UP sí cumple la otra mitad:
      **cero `INSERT`, cero `UPDATE`**, y no altera ninguna tabla existente.)*
- [x] Migración versionada y **reversible de verdad**: round-trip `down → up` reproducido por mí
      contra Postgres (§4.2), con los 6 índices de `origen_tipo` **byte-idénticos** tras el `down`
      y la precondición del `USING` **ejercida con filas reales en las TRES tablas** (§4.1).
      `pnpm run db:rollback` existe y funciona (leído y verificado su SQL).
- [x] Ningún secreto hardcodeado. Barrido del diff de `lib/`, `app/` y `db/`: cero `console.*`,
      cero `process.env`, cero tokens/passwords, cero `any`/`as any`/`@ts-ignore`. Los únicos
      `eslint-disable` son tres `@next/next/no-img-element` de los visores de evidencia firmada
      (el repo ya tiene 7 del mismo tipo).
- [x] Webhooks: **no aplica** — esta feature no añade ninguno.

### Patrón de capas
- [x] Controller sin queries ni negocio: `app/(app)/incidentes/page.tsx` resuelve rol y llama a la
      Server Action; `lib/actions/incidentes.ts` es borde + composition root, sin Prisma propio.
- [x] Service sin HTTP: `IncidenteAdminService` no conoce `Request`/`Response`/headers. Importa
      `Prisma` **sólo** para `Decimal` (money-safe), que es lo que ya hacen otros 15 services.
- [x] Repository sólo Prisma: R51, la derivación del destino y el alcance por rol viven en el
      service, no en `IncidenteAdminRepository`.
- [x] Interfaces en `lib/interfaces/`, separadas por categoría (`repositories/`, `services/`).

### Permisos
- [x] Página protegida server-side (`resolveActorFromSession()` + `notFound()`), **verificado por
      mutación** (MU-26: dejarlo en «hay sesión» pone 2 rojos: `mensajero` y `adminTienda`).
- [x] El módulo cliente **recibe por props**; no fetchea la lista.
- [x] Mutaciones por Server Action, no por API route.

### Multi-país / configuración
- [~] Sin hardcode de país ni cuenta. **La moneda `₡` sí está hardcodeada** en dos textos nuevos —
      patrón vigente del repo (**31 ocurrencias** en `app/`, incluidas las dos gemelas que el PR 1
      metió en `CierresAdminModule`). **Deuda preexistente de todo el UI.** Menor **m6**.

### Verificación final
- [x] `./init.sh` termina en verde.
- [x] `progress/review_158b.md` existe y su veredicto es **OK**.
- [ ] Entrada en `progress/history.md`: **pendiente y correcto** — es del leader (T3.4), posterior
      al merge.

---

## 3. R37-R64, requisito a requisito, con CÓMO lo verifiqué

> «lectura» = leí código y test y comprobé que el test afirma lo que dice.
> «MU-n» = rompí el código a propósito y medí el rojo (§6).
> «sonda DB» = comprobado contra Postgres local, en transacción revertida (§4).

### I. Catálogos y datos del admin

| R | Verificación | |
| --- | --- | --- |
| **R37** | sonda DB (enum con 7 valores, los 6 previos en su orden) + **MU-27**: quitar `orden_incidente` del `WALLET_ORIGEN_TIPO_SEED` rompe `tsc` en **8 sitios**, incluido `_EnsureOrigenExhaustive`. Doble candado real en las dos direcciones. | OK |
| **R38** | **MU-15** (el repo del admin escribe además una `gestion_orden`) → **13 rojos**. Leí el **caso de CONTROL** que reproduce §9.7 y confirmé contra `CorteDiarioRepository:39-55` que el doble honra los dos `where` reales (rama (a) `cierreId:null,anuladaAt:null` + `distinct`; rama (b) `estatus.value = en_reparto`). Una orden en `incidente` no cae en ninguna. | OK |
| **R39** | sonda DB: las 12 columnas con su tipo, `indemnizacion DECIMAL(12,2)` nullable y sin default, y las **3 FKs** leídas de `pg_constraint` (`orden` RESTRICT, `reportado_por` RESTRICT, `resuelto_por` SET NULL). `resuelto_por`/`resuelto_at`/`motivo_rechazo` se escriben en `resolver`. | OK |
| **R40** | **sonda DB propia** (§4.1): con 0 filas el `down` corre **completo** (20/20); con una fila real `origen_tipo='orden_incidente'` **aborta en 11/20, 12/20 y 13/20** —una por tabla—, sin dejar nada a medias. Round-trip `down→up`: enum 7→6→7, tablas 2→0→2, los 6 índices idénticos. | OK |

### J. Reporte del admin

| R | Verificación | |
| --- | --- | --- |
| **R41** | **MU-6** (retirar #52) → 10 rojos en 4 archivos, incluidos los 5 `it.each` del repo (uno por estado). **MU-17** (la derivación de los 5 orígenes de la UI deja de filtrar por familia) → 5 rojos. Los cinco estados **no se teclean** en cliente: se derivan del mapa de la 140 y un test los fija **por igualdad** contra `ORIGENES_INCIDENTE_ADMIN`. | OK |
| **R42** | **MU-19** (el WHERE del reporte pierde la zona) → 1 rojo; **MU-32** (el service deja de compensar el bucket) → 2 rojos. Las cuatro condiciones (existe / no borrada / uno de los 5 / alcance) van **juntas en el mismo WHERE**: su fallo es indistinguible. El caso de la zona es de **FORMA** → menor **m2**. | OK |
| **R43** | **MU-25** (el reporte emite el egreso al instante) → 2 rojos: «el reporte NO produce NINGUN movimiento» **y el guard de R29**, que caza al repo como tercer emisor. | OK |
| **R44** | **MU-30** (`origen_tipo = "gestion"`) → 1 rojo. **MU-23** (la reversión no appendea) → 5 rojos. El append va por el **choke point** `appendCambioEstado`: una arista sin declarar aborta la escritura (verificado con MU-6/MU-7). No enlaza `gestion_orden_id`. | OK |
| **R45** | **MU-28** (la causa deja de ser lista cerrada) → 5 rojos en 2 archivos, incluido el borde de la action. El schema **importa el SEED**; hay caso que fija que admin y mensajero comparten exactamente el mismo. | OK |
| **R46** | lectura + los 4 casos de compensación + **MU-11** (§6.1, la que **no** discrimina). Evidencia 1..N obligatoria reusando `evidenciasSchema` **exportado** de la 119 (no copiado). URLs firmadas en **una** llamada. → menor **m1**. | OK (con m1) |
| **R47** | **sonda DB con datos reales**: dos `solicitado` sobre la misma orden → **RECHAZADO** por `orden_incidente_orden_vivo_uq`; `solicitado`+`aprobado` → **RECHAZADO**; dos `rechazado` → **ACEPTADOS**; `rechazado` y luego `solicitado` → **ACEPTADO**. Predicado leído de `pg_indexes`. No hay check-then-insert: la carrera la pierde la base. | OK |
| **R48** | **MU-19** + **MU-26** + **MU-16** → 1+2+5 rojos. Alcance resuelto **server-side**, filtrando por la **zona de la ORDEN** (no la del autor). El DTO **no expone** el id del autor: viaja `esPropio`. | OK |

### K. Aprobación y egreso

| R | Verificación | |
| --- | --- | --- |
| **R49** | **MU-12** (las dos colas colapsan) → 1 rojo en el service; la mitad visible tiene 5 casos (las dos tablas, el recuento, los dos vacíos, el aviso sin zona y «el histórico es de SOLO LECTURA»). | OK |
| **R50** | **MU-29** (`montoValido` acepta todo) → 1 rojo. El tope se **importa** (`INDEMNIZACION_MONTO_MAX`) y el cliente usa el **mismo** criterio con mensajes distintos por causa (tope vs. formato) — la lección m5 del PR 1, aplicada de entrada. | OK |
| **R51** | **MU-1** → **4 rojos**; **MU-2** (monto antes que R51) → 1 rojo; **MU-3a** (`esPropio` siempre false) → 1 rojo; **MU-3b** (la UI ofrece decidir en un incidente propio) → **4 rojos**. El bloque de UI trae su **CONTROL** con un incidente ajeno. **Las dos capas, y ninguna suple a la otra.** | OK |
| **R52** | **MU-13** (`origen_tipo = cierre_dia`) → 4 rojos; **MU-14** (`parseFloat`) → 6 rojos; **MU-21** (el feed emite sin exigir `aprobado`) → 3 rojos, **dos de comportamiento**. El feed **lee de la tx** lo que ésta acaba de escribir; no recibe el monto por parámetro. | OK |
| **R53** | **MU-20** (el `updateMany` pierde `estado = solicitado`) → 3 rojos, dos de comportamiento. **Y sonda DB**: dos inserciones del mismo `(orden_incidente, id, egreso_indemnizacion)` → **RECHAZADO** por `wallet_movimiento_origen_categoria_uq`; con `ON CONFLICT DO NOTHING` (= `skipDuplicates`) la 2.ª afecta **0 filas** y queda **1**. Doble red verificada. | OK |
| **R54** | **MU-24** (el rechazo persiste monto) → 6 rojos. El motivo obligatorio se valida en el borde **y** en el service, y la UI no envía sin él. | OK |
| **R55** | **MU-14** → 6 rojos, incluidos los de escala 2 y «0.1+0.2 guardado como 0.30 sale 0.30». `Decimal` de punta a punta; el repo proyecta con `toFixed(2)`; la UI manda el STRING tal cual. | OK |
| **R56** | **MU-18** (meter `en_reparto` en los orígenes del admin) → 6 rojos, incluidos los dos invariantes de disyunción del grafo. **Y sonda DB**: dos incidentes distintos **no** se deduplican; un `cierre_dia` con el mismo `origen_id` **coexiste**. Cerrado por construcción: el índice parcial de R47 impide un segundo incidente vivo, así que una orden con incidente `aprobado` no puede acumular otro. | OK |

### L. Reversión

| R | Verificación | |
| --- | --- | --- |
| **R57** | **MU-9** (hardcodear el destino) → 5 rojos, uno por origen. El destino se **deriva** de `findOrigenesReversion` (149, reusado tal cual), que lee el historial inmutable. **No hay destino fijo en el código.** | OK |
| **R58** | **MU-8** (se cae la validación del conjunto cerrado) → 5 rojos, uno por origen ilegítimo (incluidos `en_reparto` y un value retirado del catálogo). Fallo **cerrado**: sin fila, origen null o fuera del conjunto → `conflict` sin mover nada. | OK |
| **R59** | **MU-10** (se cae la exigencia de `solicitado`) → 3 rojos, incluido «un incidente APROBADO no se puede revertir — el dinero ya salió». El retracto es el espejo exacto de R51: allí el autor no resuelve, aquí **sólo** el autor retracta. | OK |
| **R60** | **MU-22** (la reversión limpia `mensajero_asignado_id`) → 5 rojos. El reporte tampoco los toca: la reversión es correcta **por construcción**, no por acordarse de restaurar. | OK |

### M. No regresión e invariantes del mapa

| R | Verificación | |
| --- | --- | --- |
| **R61** | **MU-7** (retirar #58) → **18 rojos en 8 archivos**, incluido el invariante de conectividad de la 154 y el caso que exige que las 6 salidas sean de familia de **reversión** (barrido de las 11 familias de negocio prohibidas). `incidente` sigue en `ESTADOS_TERMINALES`. | OK |
| **R62** | **MU-6** y **MU-7** rompen el fixture de inventario de la 140 (**52 flujo / 50 pares / 2 duplicados**) y el caso «el mapa declara exactamente las aristas del inventario, ni una más». Las 10 son pares **nuevos**: la diferencia de 2 (#19/#23 y #20/#24) no se mueve. | OK |
| **R63** | **MU-15** → 13 rojos. Los `it.each` estructurales van en **las dos direcciones**: los 4 módulos del admin no tocan `gestion_orden`, `cierre_dia`, `pago_mensajero_movimiento` ni `wallet_tienda_movimiento`; y los 8 del mensajero no conocen `orden_incidente`. El stripper de comentarios tiene su propio caso de discriminación. | OK |
| **R64** | **MU-5** (quitar el emisor del cierre) → 2 rojos; **MU-13** → 4 rojos; **sonda DB** de coexistencia. Estructural: **ningún test del camino del mensajero fue tocado** por este PR (verificado filtrando `git diff --name-only` por sus nueve familias de archivos: NINGUNO). El único cambio en su producción es **exportar** `evidenciasSchema` (diff leído: sólo añade `export` y el comentario). | OK |
| **R29** *(deuda del PR 1)* | **Las dos direcciones, como pedía el encargo.** **MU-4**: un tercer archivo de `lib/` que emite la categoría → guard rojo. **MU-5**: quitar uno de los dos → **2 rojos** (la igualdad y «la lista no es decorativa»). Comparación `toEqual` sobre la lista ordenada, no `some()`. La regex sólo cuenta la construcción del movimiento, no la mención en prosa, y eso tiene su propio caso. **El caso del PR 1 no se borró: se INVIRTIÓ y se cobró.** | OK |

**Los 28 requisitos de I-M tienen test que verifica lo que dice verificar.** R49 y R51, que F1B dejó
a medias, cerraron sus dos mitades en F2B.

---

## 4. Lo que verifiqué contra Postgres, yo mismo

Todo en `localhost:5432/ordenex`, **dentro de transacciones con `ROLLBACK`** salvo las lecturas de
catálogo. La base quedó **exactamente** como estaba: 97 migraciones, «up to date», sin drift.

### 4.1 Precondición del `down.sql` — con datos REALES en las tres tablas

| caso | resultado |
| --- | --- |
| control: sin filas con el valor nuevo | **DOWN corrió COMPLETO** (20/20 sentencias) |
| fila real en `wallet_movimiento` con el valor nuevo | **ABORTA en 11/20**, en su `ALTER COLUMN "origen_tipo"` |
| fila real en `wallet_tienda_movimiento` | **ABORTA en 12/20** |
| fila real en `pago_mensajero_movimiento` | **ABORTA en 13/20** |

Las **tres** importan, y el archivo aborta exactamente donde su comentario dice. Comprobé además
que sólo esas tres columnas usan `wallet_origen_tipo` (la cuarta columna llamada `origen_tipo`, la
de `orden_historial_estado`, es otro enum).

### 4.2 Round-trip real `down → up`, y los índices

| dato | tras DOWN | tras UP |
| --- | --- | --- |
| valores de `wallet_origen_tipo` | **6** | **7** |
| tablas `orden_incidente*` | **0** | **2**, `relrowsecurity=true`, **0 policies** |
| los 6 índices de `origen_tipo` | **6/6, definición byte-idéntica a la de partida** | 6/6 |
| `orden_incidente_orden_vivo_uq` | — | `USING btree (orden_id) WHERE (estado <> 'rechazado'::cierre_estado)` |

### 4.3 El ORDEN de los dos `down.sql` — reproducido

| caso | resultado |
| --- | --- |
| sólo el `down` del MENSAJERO, con la del ADMIN aplicada | **ABORTA en 3/15**: «no se puede eliminar tipo `gestion_causa_incidente` porque otros objetos dependen de él» |
| ADMIN y luego MENSAJERO | **las dos corren completas** (20 + 15) |

El hallazgo (a) de la bitácora es **cierto y reproducible**.

### 4.4 R47 y R53/R56/R64 contra los índices reales

| caso | resultado |
| --- | --- |
| 2.º incidente `solicitado` sobre la misma orden | **RECHAZADO** (`orden_incidente_orden_vivo_uq`) |
| `solicitado` + `aprobado` sobre la misma orden | **RECHAZADO** |
| dos `rechazado`; y `rechazado` seguido de `solicitado` | **ACEPTADOS** (se puede re-reportar) |
| mismo `(orden_incidente, inc-A, egreso_indemnizacion)` dos veces | **RECHAZADO** (`wallet_movimiento_origen_categoria_uq`) |
| lo mismo con `ON CONFLICT DO NOTHING` (= `skipDuplicates`) | la 2.ª afecta **0 filas**; queda **1** |
| dos incidentes **distintos** | **ACEPTADOS**, 2 filas |
| `cierre_dia` y `orden_incidente` con el **mismo** `origen_id` | **ACEPTADOS**, 2 filas: ninguno absorbe al otro |

**Esto es lo que `tests/integration/db/wallet-idempotencia.test.ts` simula en memoria y nadie había
comprobado contra la base.** Coincide.

---

## 5. Los tres juicios que el encargo pidió explícitamente

### 5.1 E2E — **checkpoint INAPLICABLE**, y por qué NO es inercia

Leído literal, el checkpoint aplica: este PR añade el **segundo productor de dinero** del sistema.
La dispensa del PR 1 se concedió **no extensible**, así que no la heredo. La verifiqué por mi cuenta
y el estado es peor de lo que «no hay harness» sugiere:

- `./init.sh` corre `typecheck`, `lint` y `test`. **No corre `test:e2e`.** El script existe en
  `package.json` y `playwright.config.ts` también.
- Los 20+ `e2e/*.spec.ts` están escritos contra **credenciales placeholder**
  (`maestro@example.com`, `mensajero@example.com`, `admin-satelite@example.com`) y ellos mismos lo
  declaran en su cabecera: *«If the environment lacks .env or a real database, these tests are
  WRITTEN but NOT EXECUTED»*.
- No hay seed de roles ni fixture de login. Un spec nuevo de la 158 sería **un archivo más que
  nadie ejecuta**, y `docs/verification.md` dice que eso **NO cuenta** como evidencia.

**Mi juicio: el checkpoint es inaplicable porque el repo no puede ejecutarlo, y exigir el spec
sería exigir la apariencia de cobertura en vez de la cobertura.** Pero la dispensa no la doy gratis:
el riesgo concreto que un E2E habría cubierto y que **ninguna suite cubría** era la idempotencia del
egreso **contra el índice real de la 42** (hasta hoy sólo simulada en memoria). **La verifiqué yo
contra Postgres** (§4.4) y se comporta como el diseño dice. Con eso, el riesgo residual queda
acotado al pegamento de UI, que sí tiene tests de componente con acciones dobladas.

**La deuda de arnés sigue viva y sin dueño desde la 148** (menor **m5**): mientras no exista seed +
login por rol, ninguna feature de dinero podrá cumplir este checkpoint y el repo seguirá
dispensándolo PR a PR. Eso **hay que arreglarlo o hay que retirar el checkpoint**; mantenerlo como
está lo convierte en decorado.

### 5.2 `en_ruta_bodega_satelite` fuera del satélite — **limitación aceptable, ningún requisito incumplido**

Comprobé los dos motivos y **los dos son ciertos**:

1. El paquete **no está** en la bodega satélite: va en tránsito desde la central. Con Q-B (evidencia
   fotográfica obligatoria **siempre**), pedirle una foto a quien no tiene el paquete delante es
   pedirle que fotografíe lo que no puede ver. Quien sí lo tiene —la central— **sí** puede
   reportarlo desde `/ordenes`, donde los cinco orígenes están cubiertos.
2. `PorAceptarSection` es **compartido**: lo usan `RecepcionSateliteModule` **y**
   `MisAsignacionesModule` (verificado por grep). Abrirle un slot habría tocado la cola del
   MENSAJERO, superficie ajena a esta feature.

**Ningún requisito queda incumplido.** R41 exige que el sistema **acepte** el reporte desde los
cinco estados: el service los acepta los cinco (`ORIGENES_INCIDENTE_ADMIN`) y hay 5 casos que lo
fijan. Ni R41 ni R48 ni Q-H obligan a que **cada rol** tenga superficie para **cada** uno de los
cinco; R48 sólo exige no rechazar al `adminSatelite` **de la zona**, y eso se cumple.

Queda un hueco de **producto**, declarado: un `adminSatelite` no puede reportar un paquete dañado en
tránsito hacia su bodega. Dado que tampoco puede fotografiarlo, es coherente. **Menor m4.**

### 5.3 El guard de zona del satélite compara por NOMBRE — **suficiente, pero es menos que «defensa en profundidad»**

Es correcto que la guardia real es la del servidor: `IncidenteAdminService.resolveAlcance` resuelve
la zona del `adminSatelite` **server-side** y el repo la mete en el WHERE por `zonaId`. **MU-16**
confirma que quitar el guard de cliente pone 5 rojos, y **MU-19** que quitar el del servidor
también.

Pero al rastrear el dato encontré algo que la bitácora no dice y que es **más fuerte** que su propia
declaración: el `zonaNombre` que el módulo recibe como «zona del actor» **sale de las propias filas**
(`RecepcionSateliteService:120-122`, `zonaNombre = row.zonaNombre`, derivado de `orden.zonaId`), y
todas las filas vienen de `findRecepcionSateliteByZona(zonaId)`. Es decir: **para cualquier fila que
llegue a pintarse la comparación es tautológicamente verdadera**. No es que «si dos zonas
compartieran nombre no las distinguiría» (lo que dice la pregunta abierta 6); es que **la rama de
zona distinta no puede ejecutarse en producción**.

**Juicio: es suficiente** — la autorización no depende de ella y la del servidor está probada por
mutación. Pero **no la llamaría defensa en profundidad**: es una condición inalcanzable. Sus tres
casos valen como especificación del predicado en aislado, y las otras dos condiciones (`sinZona` y
estado) **sí** son alcanzables y **sí** discriminan. **Menor m3**, con el diagnóstico corregido.
Añadir `zonaId` al DTO (backend) la volvería útil de verdad.

---

## 6. Mis mutaciones — **32 aplicadas, 31 discriminan**

Todas en memoria, con `git checkout -- .` después de cada una y `git status` limpio verificado
**tras cada una**. Suite dirigida: **22 archivos / 667 tests**, verde antes de empezar.

| # | mutación | resultado |
| --- | --- | --- |
| MU-1 | se retira la guardia R51 del servidor | **4 rojos** |
| MU-2 | el monto se valida ANTES que R51 (fuga por el orden de los errores) | 1 rojo |
| MU-3a | `toDTO` deja de calcular `esPropio` (siempre false) | 1 rojo |
| MU-3b | la UI ofrece Aprobar y Rechazar en un incidente PROPIO | **4 rojos** |
| MU-4 | aparece un **TERCER** emisor de `egreso_indemnizacion` en `lib/` | 1 rojo |
| MU-5 | **se quita uno de los dos** emisores | **2 rojos** |
| MU-6 | se retira la arista **#52** (`por_recoger → incidente`) | **10 rojos** en 4 archivos |
| MU-7 | se retira la inversa **#58** | **18 rojos** en 8 archivos |
| MU-8 | la reversión deja de validar el conjunto CERRADO (R58) | **5 rojos** |
| MU-9 | el destino de la reversión se hardcodea (R57) | **5 rojos** |
| MU-10 | se puede revertir un incidente ya `aprobado` (R59) | 3 rojos |
| **MU-11** | **si falta la firma, el DTO cae al PATH CRUDO del bucket (R46)** | **0 rojos — NO DISCRIMINA** (m1) |
| MU-12 | las dos colas colapsan (R49) | 1 rojo |
| MU-13 | el egreso del admin usa `origen_tipo = cierre_dia` | **4 rojos** |
| MU-14 | el monto del egreso pasa por `parseFloat` (R55) | **6 rojos** |
| MU-15 | el repo del admin escribe además una `gestion_orden` (§9.7) | **13 rojos** |
| MU-16 | el guard del satélite ignora zona y `sinZona` | **5 rojos** |
| MU-17 | la derivación de los 5 orígenes deja de filtrar por familia (entra #53) | **5 rojos** |
| MU-18 | `en_reparto` entra en los orígenes del admin (R56) | **6 rojos** |
| MU-19 | el reporte deja de acotar por zona en el WHERE (R48) | 1 rojo *(de FORMA — m2)* |
| MU-20 | `resolver` deja de guardar por `estado = solicitado` (R53) | 3 rojos, **2 de comportamiento** |
| MU-21 | el feed emite sin exigir `estado = aprobado` (R52) | 3 rojos, **2 de comportamiento** |
| MU-22 | la reversión limpia `mensajero_asignado_id` (R60/Q-K) | **5 rojos** |
| MU-23 | la reversión no appendea al historial (R44) | **5 rojos** |
| MU-24 | el RECHAZO persiste un monto (R54) | **6 rojos** |
| MU-25 | el REPORTE emite dinero al instante (R43) | 2 rojos (incl. el guard de R29) |
| MU-26 | `/incidentes` sólo comprueba que haya sesión (R48) | 2 rojos |
| MU-27 | el SEED pierde `orden_incidente` (R37) | **`tsc` rompe en 8 sitios** |
| MU-28 | la causa deja de ser lista CERRADA (R45) | **5 rojos** en 2 archivos |
| MU-29 | el service acepta cualquier monto (R50) | 1 rojo |
| MU-30 | el reporte appendea con familia `gestion` (R44/Q-G) | 1 rojo |
| MU-32 | el service no compensa el bucket cuando el repo rechaza (R42) | 2 rojos |

*(MU-31 se fusionó con MU-27: no requería vitest, sólo `typecheck`.)*

### 6.1 MU-11, la que no discrimina — y por qué NO es lo mismo que la F del implementador

`IncidenteAdminService.toDTO` filtra los paths que no tienen firma:

```ts
evidenciaUrls: row.evidenciaStoragePaths
  .map((p) => urlByPath[p])
  .filter((u): u is string => typeof u === "string"),
```

Sustituirlo por `.map((p) => urlByPath[p] ?? p)` —que **filtraría el path crudo de un bucket privado
al cliente**, justo lo que R46 prohíbe— deja los **667 casos en verde**: el doble del firmador
siempre devuelve URL para todos los paths, así que la rama nunca se ejecuta.

Fui a mirar si la rama es alcanzable hoy: **no lo es.**
`SupabaseSignedUrlProvider.createSignedUrls:69-74` **lanza** ante cualquier entrada con error o sin
`path`, así que el mapa siempre está completo o revienta antes.

**Diferencia con la mutación F que el implementador declaró** —y cuya conservación **me parece
correcta**, por lo mismo que él argumenta: un test que compruebe que la línea existe mediría FORMA—:
la F depende del **mismo archivo** (`reportarIncidenteSchema` valida lo mismo que el botón). Ésta
depende del **contrato de otro módulo**. Si mañana el provider cambia a devolver mapas parciales en
vez de lanzar —cambio razonable que nadie relacionaría con incidentes—, esto **filtra rutas de un
bucket privado y ninguna suite lo nota**. Un caso con un firmador doble que devuelva el mapa
incompleto lo mata en tres líneas y **sí** mide comportamiento. Menor **m1**.

---

## 7. Hallazgos

### Bloqueantes
**Ninguno.**

### Menores

- **m1 — `menor` · R46: la rama que evita filtrar el path crudo no tiene test, y mi mutación MU-11
  la atraviesa en verde.** Código actual **correcto**; la rama es hoy inalcanzable porque
  `SupabaseSignedUrlProvider` lanza ante firmas parciales. Riesgo: un cambio en **otro** módulo la
  vuelve alcanzable y expone rutas de un bucket privado sin que nada se ponga rojo. *Arreglo:* un
  caso con firmador doble que devuelva el mapa incompleto y afirme que el path crudo **no** sale.

- **m2 — `menor` · R42/R48: el alcance por zona del REPORTE está cubierto sólo por FORMA.** El caso
  «la pre-lectura exige los CINCO estados, no borrada, y el alcance, todo en el WHERE» compara el
  objeto `where`; el doble de Prisma no lo honra. Es la misma señal débil que las mutaciones D/E de
  la fase backend, **que allí sí se reforzaron con dobles que honran el `where`**; aquí no.
  *Arreglo:* un doble que honre `zonaId` y un caso de comportamiento («una orden de otra zona →
  `no_aplicable`, cero efectos»), con su control.

- **m3 — `menor` · el guard de zona del satélite es inalcanzable, no «defensa en profundidad».**
  Diagnóstico corregido en §5.3. No es incorrecto ni peligroso —la guardia real está en el servidor
  y probada— pero la pregunta abierta 6 lo describe más benignamente de lo que es. *Arreglo:*
  añadir `zonaId` al `RecepcionSateliteDTO` (backend), o quitar la condición y decir que la guardia
  es del servidor.

- **m4 — `menor` · `en_ruta_bodega_satelite` sin superficie para el `adminSatelite`.** Justificado y
  sin requisito incumplido (§5.2). Follow-up de producto.

- **m5 — `menor` · no hay harness de E2E, y la deuda sigue sin dueño desde la 148.** `test:e2e`
  existe pero ningún gate lo corre; los specs usan credenciales placeholder y declaran que no se
  ejecutan. Mientras siga así, el checkpoint de E2E de `CHECKPOINTS.md` es letra muerta para toda
  feature de dinero. **Decisión pendiente del humano: construir el harness o retirar el checkpoint.**

- **m6 — `menor` · la moneda `₡` sigue hardcodeada en el UI.** Este PR añade 2 ocurrencias
  (`MONTO_AYUDA`, `MONTO_EXCEDE`), calcadas de las dos que el PR 1 metió en `CierresAdminModule`.
  **Deuda preexistente y sistémica** (31 ocurrencias en `app/`), no introducida aquí. Choca con el
  checkpoint «no se hardcodeó país, moneda ni cuenta».

- **m7 — `menor` · flake ajeno en la suite.**
  `tests/unit/components/filter-component.test.tsx › «una racha de clics colapsa en UNA sola
  emisión»` falló una vez bajo contención de CPU y pasa 39/39 en aislado; la 2.ª pasada completa de
  `./init.sh` fue 7354/7354. Archivo **no tocado** por este PR. Lo anoto porque un gate que falla al
  azar erosiona la confianza en el gate.

### Observaciones separadas (consecuencias de decisiones cerradas; no se re-litigan)

- **O1 — consecuencia de Q-K que nadie nombró: el mensajero conserva la orden asignada y
  `OrdenEnvioReader.findParaEnvio` NO filtra por estado.** Sólo filtra por `mensajeroAsignadoId` y
  `deletedAt` (`:32-40`), y es lo que usan las tres acciones de `lib/actions/chat-whatsapp.ts`,
  `ChatWhatsappService:428` y `EnvioPlantillaWhatsappService:34`. Consecuencia: el mensajero al que
  le reportaron un incidente sobre una orden en `por_recoger` **podría seguir enviándole plantillas
  de WhatsApp al destinatario** de un paquete perdido o robado. La UI no se lo ofrece (sus listas
  filtran por estado) y **el patrón es preexistente** —`entregada` y `devuelta` también conservan la
  asignación—, así que **no lo introduce esta feature**. Pero Q-J («¿se entera el mensajero?») +
  Q-K («no se toca la asignación») juntas lo vuelven más incómodo que antes. Para la ficha de Q-J.

- **O2 — `scripts/db-rollback.ts` elige por NOMBRE de carpeta, no por migración APLICADA**
  (`:8-15`, `localeCompare` sobre `readdirSync`). Verificado leyendo el script. Hoy coincide (el
  timestamp del admin es mayor), pero ejecutarlo dos veces seguidas revierte **la misma** migración
  dos veces en vez de bajar dos escalones. **No lo introduce esta feature y no debería bloquear este
  PR**: es deuda del arnés. Sí conviene ficha propia.

- **O3 — el orden de los dos `down.sql` es obligatorio y no está codificado en ninguna parte.**
  Reproducido (§4.3): revertir la del mensajero con la del admin aplicada **aborta**. Está escrito
  en la bitácora y en el comentario del `down`, pero **ningún gate lo impone**. Combinado con O2, un
  `pnpm run db:rollback` ejecutado dos veces en producción no haría lo que su autor espera.
  **No bloqueante** —el fallo es ruidoso y transaccional: la base no queda a medias— pero es la
  observación que más me preocuparía en una noche de incidente.

---

## 8. Deuda declarada por el implementador — auditada

| lo declarado | mi veredicto |
| --- | --- |
| **Dispensa de E2E, declarada NO extensible y no resuelta** | **Correcto declararla; la concedo yo, con razón medida y no por herencia** (§5.1). Añado la verificación contra el índice real que faltaba (§4.4). Deuda de arnés viva → **m5**. |
| **Mutación L** (el monto medido con un dato que hacía indistinguible `parseFloat`) | **Reforzada de verdad.** Mi **MU-14** pone 6 rojos, tres de ellos de escala 2. La corrección funcionó. |
| **Mutación Z4** (los casos miraban el botón, que se auto-oculta; una columna colada quedaba muerta) | **Reforzada de verdad.** El diagnóstico («mide lo correcto por el sitio equivocado») es exacto y mirar la CABECERA es el arreglo correcto. |
| **Mutación F conservada sin inventarle test** (`if (!completo) return` redundante) | **Correcto, y lo respaldo.** Un caso que compruebe que la línea existe mediría FORMA, justo lo que la fase backend criticó. Sigue el precedente literal de `DeshacerAsignacionModal` (149). **Declararla es la conducta correcta.** *(Ojo: MU-11 es de la misma familia pero **no** equivalente — §6.1.)* |
| **«Retractar reporte» (R59) ofrecido aunque §12.6 sólo nombra aprobar/rechazar** | **Desviación CORRECTA y bien argumentada.** No inventa comportamiento: **R59 lo exige explícitamente** («por retracto de su autor **o** por rechazo del aprobador») y la action estaba implementada y probada en F1B. Sin superficie era código muerto **y** el mensaje de R51 quedaba en un «no podés» sin salida. §12.6 lista lo que el diseño previó, no un conjunto cerrado; **`requirements.md` manda sobre `design.md`**. La UI la ofrece **sólo** en un incidente propio, con caso de control en uno ajeno. |
| **Hallazgo (a): revertir la migración del PR 1 con la del admin aplicada ABORTA** | **Verificado y reproducido** (§4.3: aborta en 3/15). **No bloquea**: el fallo es ruidoso, transaccional y correcto. → **O3**. |
| **Hallazgo (b): `db-rollback.ts` elige por nombre de carpeta** | **Verificado leyendo el script.** **No bloquea** este PR: preexistente y ajeno a la 158. → **O2**, con ficha sugerida. |
| **Q-J sigue abierta** (el mensajero no se entera) | **Correcto dejarla abierta** (T0.7 la cerró como fuera de alcance con follow-up). Le añado **O1**, que amplía lo que la ficha debería cubrir. |
| **`catalogoCache` nunca se invalida** (heredado de la 154) | Correcto: esta migración no hace crecer `order_status`, así que el riesgo no aumenta. Sigue importando migrar-antes-de-desplegar, ahora con **dos** migraciones y un orden entre ellas (O3). |

---

## 9. Qué le queda al leader

1. **T3.1 / T3.2** — pruebas de humo manuales. Son del humano/operador; el agente hizo bien en **no**
   marcarlas. T3.2 ya tiene toda la UI que necesita.
2. **T3.3** — su parte técnica está hecha **y reproducida por mí** (§4); falta sólo su cláusula de
   «datos de humo borrados antes», que depende de T3.1/T3.2.
3. **T3.4 / T3.5** — `feature_list.json` (158 → `done`), `progress/current.md`, entrada en
   `progress/history.md`, y verificar que el follow-up de **Q-E** (crédito de indemnización en el
   ledger por tienda, feature 43) y la ficha de **Q-J** están registrados.
4. **Fichas nuevas sugeridas por esta review:** m1 (test del path crudo), m2 (doble que honre el
   `where` del reporte), m3 (`zonaId` en el DTO del satélite), m4 (`en_ruta_bodega_satelite` desde
   el satélite), **m5 (harness de E2E: construirlo o retirar el checkpoint)**, O1 (WhatsApp sobre
   orden en `incidente`), O2 (`db-rollback` por migración aplicada).

---

No hay bloqueantes. **Veredicto: OK.**

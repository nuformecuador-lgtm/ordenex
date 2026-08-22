# Feature 259 — Tareas

> Leer antes: `requirements.md` (R1-R26 + las cuatro decisiones cerradas) y `design.md`.
>
> **Zona `fullstack` ⇒ se secuencia backend → frontend.** T0-T6 las ejecuta `backend_dev`; **T7**
> (cuatro literales, sin lógica) la ejecuta `frontend_dev` **después de T5**, es decir cuando el
> criterio ya está **probado contra Postgres y matado con mutaciones**. Nunca a la vez sobre los
> mismos archivos — aunque aquí no se solapan, la secuencia es lo que hace que el texto se escriba
> sabiendo qué cuenta la pantalla. **T8** (aviso) y **T9** (gate y PR) van al final, en ese orden.
>
> **Ya no hay preguntas abiertas.** Las cuatro se firmaron el 2026-08-21 y están escritas como
> requisitos y tareas: **P1 → R11/T1.2**, **P2 → R23-R25/T7**, **P3 → R26/T1.4**, **P4 → T8**.
>
> **Gate: `./init.sh --rapido`**, al cerrar cada tanda y para abrir el PR. **Esta ficha NO lleva
> migración** (R20) y no toca `lib/types/**`, `db/schema.prisma` ni configuración de build, así que
> **el modo rápido no se niega solo**. Si durante la implementación apareciera cualquiera de esos
> —típicamente: alguien decide crear un índice—, `--rapido` **falla**, y eso no es un obstáculo que
> sortear: es la señal de que la ficha cambió de tamaño. Se para y se dice.
>
> **El gate NO se corre en paralelo con un subagente que esté mutando el árbol:** leería el árbol a
> medio escribir y su veredicto no valdría.
>
> **Un test de servicio con dobles NO VE EL SQL.** Este cambio es un `WHERE`: lo que decide si está
> bien es **T3 (Postgres real)** y **T5 (las mutaciones)**. Cerrar la ficha con T2 en verde y sin T5
> sería exactamente el fallo que ya ocurrió en este repo, donde una mutación del `WHERE` dejó 11
> tests de servicio en verde.

---

## T0 — Antes de tocar nada

- [x] **T0.1 — Confirmar el estado de `origin/dev`.** `git fetch origin dev` y mirar si alguien más
      está tocando `lib/repositories/TableroDiaRepository.ts` (la ficha **260** toca el detalle y
      `lib/types/tablero-dia.ts`).
      **Hecho:** anotado en `progress/impl_259_backend.md` el SHA de `origin/dev` desde el que nace la rama y
      la confirmación de que ninguna feature `in_progress` toca ese archivo. **Bloquea T1.**
- [x] **T0.2 — [P] Comprobar que hay Postgres alcanzable** (`DATABASE_URL` cargable) y que
      `pnpm exec vitest run tests/integration/tablero-dia-conteo.test.ts` **ejecuta** casos, no los
      salta.
      **Hecho:** el número de casos ejecutados, pegado. Si sale `skipped`, **T3 no puede dar
      evidencia de nada** y hay que resolverlo antes de escribir un solo test de integración.
      **Bloquea T3.**
- [x] **T0.3 — [P] Leer entera la cabecera actual de `TableroDiaRepository`** y la de
      `RankingRepository`. No es ceremonia: el comentario que hay que reescribir (T1.3) tiene que
      responder al argumento de D10, no ignorarlo.
      **Hecho:** nada que entregar; es requisito para T1.3.

---

## T1 — El criterio (`cteIdsDelDia`) y el comentario

- [x] **T1.1 — Las dos ramas del día de reparto en `ids_reparto`** (`design.md` §3): rama (a)
      `fecha_reparto = ${ventana.fecha}::date`, rama (b) `fecha_reparto IS NULL` + rango de
      `asignado_at`, unidas con `UNION` (**nunca** `UNION ALL`). El día viaja como **texto
      `ventana.fecha` con `::date` explícito**, jamás como `Date` ni interpolado (R9).
      Comentario obligatorio en el código, en tres líneas: por qué `IS NULL` no sobra, por qué es un
      `OR` partido y no un `COALESCE`, y que el predicado **es el de `RankingRepository`** citado por
      nombre.
      **Hecho:** compila, `pnpm typecheck` y `pnpm lint` en verde, y `pnpm exec vitest related --run
      lib/repositories/TableroDiaRepository.ts` sin rojos nuevos. **Cubre R1, R2, R4, R6, R7, R8, R9.**
      **Depende de:** T0.1.
- [x] **T1.2 — La cláusula de la rama de recolección** (`design.md` §5): `AND (o2."fecha_reparto" IS
      NULL OR o2."fecha_reparto" = ${ventana.fecha}::date)`, con su `JOIN "orden" o2`, y **dos**
      comentarios obligatorios: (a) la **secuencia 08:00 Ana / 14:00 Beto** que justifica la cláusula
      —resumida, con el hecho clave: `mensajero_asignado_id` **se sobrescribe**, así que sin esto la
      orden cae hoy en la tarjeta de quien no fue a recoger—; (b) **por qué el recorte de zona NO se
      mueve aquí** aunque ahora sea posible: la razón de hoy («no conoce todavía la orden») deja de
      ser cierta y no puede quedarse escrita.
      **Hecho:** igual que T1.1, y el comentario (a) presente — es una línea que no rompe ningún test
      si alguien la borra «para simplificar», y el comentario es lo único que lo impide.
      **Cubre R10, R11.**
- [x] **T1.3 — Reescribir la cabecera: D10 REVERTIDA** (`design.md` §7). Con fecha de firma
      (2026-08-20) **y** de reversión (2026-08-21), el motivo en una línea (D10 razonó sobre
      `asignadas` y no sobre el cubo `sinRecoger`), qué mide ahora, y que **coincide en criterio con
      `/ranking` pero no en universo** (aquí hay rama de recolección y allí no).
      Desaparecen: la frase «cuenta HOY en esta pantalla y MAÑANA en `/ranking`», el «dicho aquí para
      que nadie lo diagnostique como un bug» y la invitación «si algún día se quiere alinearlas».
      El razonamiento viejo **se conserva marcado como SUPERADO**, no se borra.
      **Hecho:** T2.4 (la guardia) en verde. **Cubre R21.** **Depende de:** T1.1.
- [x] **T1.4 — [P] El apéndice fechado en el spec de la 246** (`design.md` §7.1): **una línea al
      final de §D10** de `specs/246-asignacion-por-dia/requirements.md` diciendo que fue
      **supersedida el 2026-08-21 por la feature 259**, con una línea de motivo y el puntero a
      `specs/259-tablero-dia-por-reparto/`.
      **⛔ Ni una palabra del texto original se toca**: es un apéndice, no una edición. Un spec es la
      foto de su momento; reescribirlo borraría la prueba de que aquella decisión se tomó a
      conciencia.
      **Hecho:** la línea existe, el texto original sigue íntegro, y T2.4 lo comprueba en las dos
      direcciones. **Cubre R26.**

---

## T2 — Los tests de FORMA (lo que se puede probar sin base)

> Miden el SQL que el repositorio **emite** (espiando `$queryRaw` y reconstruyendo el `Prisma.Sql`,
> patrón de `tablero-dia-ritmo-sql.test.ts`), nunca un SQL escrito a mano en el test. **No pueden
> demostrar que las cifras sean correctas**: eso es T3.

- [x] **T2.1 — Nuevo `tests/unit/repositories/tablero-dia-universo-sql.test.ts`.** Emite las **tres**
      consultas (`contarPorMensajero`, `listarOrdenesDelDia`, `contarEntregasPorHora`) y afirma sobre
      cada una: las dos ramas presentes con sus parámetros; `ventana.fecha` entre los `values` y
      `::date` en el texto; la fecha **no** aparece como literal en la cadena; sin `COALESCE` sobre
      `fecha_reparto`; sin `AT TIME ZONE`, sin nombre de zona, sin `interval '6 hours'`, sin
      `startOfDayCR`; `UNION` sí, `UNION ALL` no.
      **Hecho:** los tres SQL comparten el mismo fragmento — es la prueba de forma de R13.
      **Cubre R8, R9, R13.** **Depende de:** T1.1.
- [x] **T2.2 — [P] Los tests de forma existentes siguen verdes SIN editarlos**
      (`tablero-dia-sql.test.ts`, `tablero-dia-detalle-sql.test.ts`, `tablero-dia-ritmo-sql.test.ts`).
      **Hecho:** salida pegada. Si alguno se pone rojo **se investiga, no se ajusta**: esos asserts
      son el contrato de la 192 y de la 258 (una sola aparición de `"zona_id"` y después de
      `ids_del_dia`, `IS NOT NULL` + rango de `asignado_at`, sin `actor_usuario_id`).
      **Cubre R16, R19.**
- [x] **T2.3 — [P] Las guardias del árbol, enteras.** `pnpm run test:guardias`.
      **Hecho:** verde, y **con el número de guardias ejecutadas**. Interesan especialmente
      `frontera.guardia.test.ts` (tres consultas clasificadas `["agregada","paginada","agregada"]`,
      sin `findMany`, sin `startOfDayCR`) y `asignado-at-solo-lectura.guardia.test.ts` (ni una
      escritura; lista blanca de migraciones **sin cambios**; el repositorio **sí** lee la columna).
      **Cubre R17, R18, R20.**
- [x] **T2.4 — Nueva guardia `tests/unit/tablero-dia/d10-revertida.guardia.test.ts`.** Dos fuentes,
      porque D10 vive en dos sitios y los dos pueden envejecer:
      **(1) `lib/repositories/TableroDiaRepository.ts`** — (a) **no** contiene la frase superada
      («…cuenta HOY en esta pantalla y MAÑANA en `/ranking`» ni «para que nadie lo diagnostique como
      un bug»); (b) **sí** contiene la reversión fechada de D10 y la mención a `fecha_reparto`;
      (c) **sí** cita `RankingRepository` como origen del predicado.
      **(2) `specs/246-asignacion-por-dia/requirements.md`** — (d) **sí** contiene el apéndice que
      apunta a la 259 (R26); (e) **sí** conserva el texto original de §D10 **verbatim** (una frase
      testigo), para que el apéndice no se convierta en una reescritura por la puerta de atrás.
      **Hecho:** más una **autocomprobación** en el mismo archivo (cada detector marca un texto de
      ejemplo que sí infringe y no marca uno que no), para que la guardia no pueda ser verde por
      vacía. **Cubre R21, R26.** **Depende de:** T1.3, T1.4.

---

## T3 — Los tests contra POSTGRES REAL (donde se decide si la ficha está bien)

> Todo dentro de `enTransaccionRevertida`, con la siembra en 2001 como el resto de la familia.
> **Ningún caso puede tener una salida temprana del tipo `if (!fks) return;`**: un test que reporta
> `passed` sin haber comprobado nada ya pasó en este repo.

- [x] **T3.1 — La siembra gana el día de reparto.** `SemillaOrden` de
      `tests/integration/_semilla-tablero-dia.ts` gana `fechaReparto?: Date | null` y `crearOrden` lo
      escribe. Con un helper `diaReparto("2001-06-15")` que devuelva la **medianoche UTC** de esa
      fecha (convención `@db.Date`), NO las 06:00Z.
      **Hecho:** los tests existentes siguen verdes sin tocarlos —ninguno fija el campo, así que
      todos ejercitan la rama (b)— y eso se dice en el comentario del archivo.
      **Depende de:** T0.2.
- [x] **T3.2 — Nuevo `tests/integration/tablero-dia-dia-reparto.test.ts`** con los casos mínimos.
      Cada uno vuelve a afirmar la **identidad de los ocho sumandos** (`sumaDeLosOcho`), como manda
      la 192:

      | Caso | Siembra | Se espera |
      | --- | --- | --- |
      | **C1** | asignada hoy, `fecha_reparto` = hoy | cuenta **hoy** (R2) |
      | **C2** | asignada hoy, `fecha_reparto` = mañana | **no** cuenta hoy; **sí** al correr el mismo conteo con la ventana de mañana (R3, R22) |
      | **C3** | asignada ayer, `fecha_reparto` = hoy | cuenta **hoy** (R4) |
      | **C4** | asignada hoy, `fecha_reparto` = NULL | cuenta **hoy** por el respaldo (R6) |
      | **C5** | asignada ayer, `fecha_reparto` = NULL | **no** cuenta hoy (R6) |
      | **C6** | asignada ayer, `fecha_reparto` = ayer | **no** cuenta hoy (R5) |
      | **C7** | las seis a la vez, contadas con las ventanas de **ayer, hoy y mañana** | cada orden aparece **exactamente una vez** en total; identidad en cada tarjeta (R7, R12) |

      **Hecho:** los siete casos, con el número de casos **ejecutados** pegado en
      `progress/impl_259_backend.md`. **Cubre R2, R3, R4, R5, R6, R7, R12, R22.** **Depende de:** T3.1, T1.1.
- [x] **T3.3 — La rama de recolección, en `tests/integration/tablero-dia-recoleccion.test.ts`**
      (casos nuevos en el archivo que ya existe):
      **C8** recolección de hoy + `fecha_reparto` NULL → cuenta hoy (R10, ya existe: reafirmar que
      sigue verde);
      **C9** recolección de hoy + `fecha_reparto` = mañana → **no** cuenta hoy y sí mañana (R11);
      **C10** recolección de hoy + `fecha_reparto` = hoy → cuenta **una sola vez** (la unión es de
      conjuntos) e identidad cumplida (R10, R12).
      **Hecho:** los tres. **C9 es el caso testigo de la secuencia 08:00/14:00**: se siembra con el
      mensajero **cambiado** (la recolección la registra Ana, la orden acaba asignada a Beto) y se
      afirma que **no aparece en la tarjeta de Beto hoy**. Sembrarlo con un solo mensajero probaría
      la mitad. **Cubre R10, R11.** **Depende de:** T1.2.
- [x] **T3.4 — [P] El cuadre no se rompe.** Un caso en
      `tests/integration/tablero-dia-detalle-cuadre.test.ts` con una siembra que mezcla rama (a),
      rama (b) y recolección: `detalle.total === fila.asignadas` (R14). Y un caso en
      `tests/integration/tablero-dia-ritmo.test.ts` con una orden de rama (a) entregada: el último
      acumulado de la serie `=== totales.entregadas` (R15).
      **Hecho:** los dos casos verdes. **Cubre R13, R14, R15.** **Depende de:** T1.1.
- [x] **T3.5 — [P] El aislamiento multi-tenant sigue en pie.** `tablero-dia-aislamiento.test.ts` y
      `tablero-dia-detalle-aislamiento.test.ts` verdes **sin editarlos**, más un caso nuevo: una
      orden de la zona B reservada para hoy **no** aparece con alcance zona A.
      **Hecho:** verde. **Cubre R16.** **Depende de:** T1.1.

---

## T4 — El `EXPLAIN`, anotado por lo que es

- [x] **T4.1 — `EXPLAIN` (sin `ANALYZE`) de la consulta nueva** contra la base local, para las tres
      consultas del repositorio.
      **Hecho:** los planes pegados en `progress/impl_259_backend.md` **con la etiqueta de que miden FORMA y
      no coste** —la base local tiene decenas de órdenes y el planificador hace `Seq Scan` con índice
      y sin él (lo dice la propia migración de la 246)— y con una frase sobre la rama (a), que no
      tiene ningún índice que empiece por `fecha_reparto` (`design.md` §6). **No se crea ningún
      índice en esta ficha (R20).** **Depende de:** T1.1.
      ⚠️ **Lo que este `EXPLAIN` NO puede hacer:** confirmar el razonamiento de indexabilidad de
      `design.md` §3.1. Ése se apoya en los planes de la 246, que son de **otra consulta**, y aquí no
      hay volumen para medir coste. Que quede escrito **junto a los planes**, no en otro archivo: la
      cita descontextualizada de dentro de un año saldrá de aquí.

---

## T5 — MATAR EL `WHERE` CON MUTACIONES *(obligatoria, no es un extra)*

> Sin esto, la ficha no se cierra. Cada mutación se aplica **sola**, se corre lo indicado, se
> **revierte**, y se reporta **qué test se puso rojo y con qué mensaje**. Una mutación que sobrevive
> es un **hallazgo bloqueante**: significa que el test que dice cubrir ese requisito no lo cubre.

- [x] **T5.1 — Las seis mutaciones que deben MATAR:**

      | # | Mutación en `cteIdsDelDia` | Debe ponerse rojo |
      | --- | --- | --- |
      | **M1** | quitar la rama (b) entera | C4 (y varios casos históricos de `tablero-dia-conteo`) |
      | **M2** | en la rama (a), `fecha_reparto` → `asignado_at` (volver a D10) | C2 y C3 |
      | **M3** | quitar `fecha_reparto IS NULL` de la rama (b) | C7 (una orden contada en dos días) |
      | **M4** | en la rama (a), `=` → `<=` | C6 |
      | **M5** | quitar la cláusula de `ids_recoleccion` | C9 |
      | **M6** | pasar `ventana.desde` en vez de `ventana.fecha` (o quitar el `::date`) | C1/C2, o error de Postgres |

      **Hecho:** una tabla en `progress/impl_259_backend.md` con **el nombre del test que cayó y su mensaje
      real**, no un «✅». Y la autocomprobación de que los tests **se ejecutaron** (número de casos
      corridos): en este repo ya hubo un arnés de mutaciones que reportó supervivientes sin haber
      ejecutado un solo test. **Depende de:** T3.2, T3.3.
- [x] **T5.2 — La mutación que debe SOBREVIVIR, y por qué eso es la prueba.**
      **M7:** `UNION` → `UNION ALL` **dentro de `ids_reparto`**. Los tests de conteo deben seguir
      **verdes** —porque las dos ramas son disjuntas: ése es justo el hecho que R7 afirma— y el test
      de forma (T2.1) debe ponerse **rojo**.
      **Hecho:** las dos mitades reportadas. Si los de conteo se pusieran rojos, las ramas **no** son
      disjuntas y hay un defecto real que hay que perseguir antes de seguir.
      ⚠️ **CORRECCIÓN MEDIDA EL 2026-08-21, al ejecutar T5** (`progress/impl_259_backend.md`,
      hallazgo 2): la premisa de arriba —«los de conteo siguen verdes **porque** las ramas son
      disjuntas»— **es más débil de lo que parece**. `ids_del_dia` hace
      `SELECT id FROM ids_reparto UNION SELECT id FROM ids_recoleccion`, y ese `UNION` exterior
      deduplica igualmente: **M7 sobreviviría aunque las ramas se solaparan**, así que su
      supervivencia NO confirma la disjunción y el recíproco tampoco vale. Las ramas SÍ son
      disjuntas, pero eso lo prueba **C7** —y **M3** prueba que C7 lo mide—. M7 se conserva por lo
      que sí demuestra: que el `UNION` interior está sujeto por los tests de forma y no por suerte.
      **Depende de:** T5.1.

---

## T6 — La bitácora del backend

- [x] **T6.1 — `progress/impl_259_backend.md`** con: archivos tocados, el **mapa `R<n> → test`** de abajo
      copiado y verificado uno a uno, la salida real de los tests (con casos **ejecutados**, no sólo
      «passed»), los planes de T4.1 y la tabla de mutaciones de T5.
      **Hecho:** el archivo existe y no tiene ni un «✅» sin evidencia detrás.

---

## T7 — Los cuatro textos de la pantalla *(`frontend_dev`, después de T5)*

> Firmado (D2): entran **aquí**. Un literal que promete algo que ya no ocurre no rompe ningún test y
> no lo caza `eslint`: sólo se ve abriendo la app. Dejarlo para otra ficha lo mantendría **vivo en
> producción** mientras tanto.
>
> **Son literales. Ni una línea de lógica, ni un cambio de props, ni un cambio del DOM.**

- [x] **T7.1 — El estado vacío** (`TableroDiaEstados.tsx`): `VACIO_TITULO` y `VACIO_DESCRIPCION`. La
      frase que **tiene que desaparecer** es «**En cuanto se asigne la primera, aparecerá aquí**»:
      con el criterio nuevo es falsa si esa primera se asigna para otro día. El texto nuevo dice qué
      cuenta la pantalla (**las de hoy**) sin prometer nada sobre lo que se asigne después.
      **Hecho:** casos nuevos en los tests de componente que ya existen, **leyendo el texto**.
      **Cubre R23, R24, R25.**
- [x] **T7.2 — [P] Los otros tres sitios:** el `aria-label` de `MensajeroCard.tsx`, la cabecera de
      `DetalleMensajeroPanel.tsx` y `DESAPARECIDO_DESCRIPCION` de `TableroDiaModule.tsx` — **el
      cuarto**, que no estaba en la pregunta original y entra por el mismo motivo: dejarlo haría que
      la misma pantalla dijera dos cosas distintas.
      **⛔ `ETIQUETA_ASIGNADAS` (`"Asignadas"`) NO se toca:** el contador sigue llamándose igual; lo
      que dejó de ser cierto es el «hoy» que lo acompaña.
      **Hecho:** un caso por texto, leyendo el texto. **Cubre R24, R25.** **Depende de:** T7.1 (para
      que las cuatro frases se escriban con el mismo criterio y no cada una por su lado).
- [x] **T7.3 — Lenguaje claro (R25).** Ni «día de reparto» a secas, ni nombres de columna, ni siglas:
      «de hoy» / «para hoy», que es como habla quien opera.
      **Hecho:** revisado sobre las cuatro frases finales, dicho en `progress/impl_259_frontend.md`.
      **Depende de:** T7.1, T7.2.

---

## T8 — Aviso operativo *(tarea de RELEASE: bloquea el despliegue, no el PR)*

> Firmado (D4). No es una nota al pie: es una tarea con criterio de hecho, y sin ella **no se
> despliega**.

- [ ] **T8.1 — Avisar a quien opera, ANTES de la release:** a partir del despliegue, **lo que se
      asigne hoy para mañana deja de aparecer en el tablero de hoy** y aparece mañana. No se ha
      perdido nada; cambió el día en que se cuenta.
      **Por qué bloquea:** el maestro que asigne para mañana verá **desaparecer** esas órdenes en el
      primer minuto y, sin aviso previo, lo leerá como «se perdieron». Es el patrón que ya mordió a
      este repo: **el sistema no falla, aparenta**. La 246 mandó dos avisos antes de desplegar por
      una razón parecida.
      **Hecho:** aviso enviado y anotado **con fecha** en `progress/impl_259_frontend.md` (la última
      bitácora de la ficha; el bloque backend vive en `progress/impl_259_backend.md`).
      ⛔ **ES CONDICIÓN DE DESPLIEGUE, NO UN EXTRA:** mientras este aviso no esté enviado y anotado,
      la 259 **NO se despliega a `prod`**. No es una recomendación ni una cortesía: es la puerta.
      **Bloquea:** la release a `prod`. **No bloquea:** el PR a `dev`.

---

## T9 — Gate y PR *(lo último)*

- [ ] **T9.1 — `./init.sh --rapido`**, con el árbol completo (backend **y** frontend) y **no en
      paralelo** con ningún subagente que esté escribiendo: leería el árbol a medio mutar y su
      veredicto no valdría.
      **Hecho:** exit code capturado **dentro** del log (`INIT_EXIT=$?`), no leído de un `echo` — en
      este repo un gate ROJO ya llegó como «exit code 0» por eso. **Depende de:** T6, T7.
- [ ] **T9.2 — PR hacia `dev`** con `gh pr create --base dev`, y la URL reportada al humano.
      ⚠️ **Un PR verde no dice nada de los tests:** el único check automático es un build de Vercel
      que no ejecuta ni uno. Lo que sostiene esta ficha es T9.1 y la tabla de mutaciones de T5.
      **Depende de:** T9.1.

---

## Mapa `R<n> → test`

> Regla 4 de `CLAUDE.md`: un requisito sin test es un fallo de la feature. El reviewer verifica esta
> tabla una a una.

| R | Test que lo cubre |
| --- | --- |
| **R1** | `tablero-dia-universo-sql.test.ts` (las dos ramas en las tres consultas) + C1/C4 |
| **R2** | C1 (`tablero-dia-dia-reparto.test.ts`) |
| **R3** | C2 — y **M2** demuestra que el caso mide |
| **R4** | C3 |
| **R5** | C6 — y **M4** |
| **R6** | C4 y C5 — y **M1** |
| **R7** | C7 (las tres ventanas, cada orden aparece exactamente una vez) — y **M3**, que es la que demuestra que C7 mide de verdad. ⛔ **M7 NO es evidencia de la disjunción**, aunque esta tabla lo dijera hasta el 2026-08-21: el `UNION` de `ids_del_dia` deduplica igualmente, así que M7 sobreviviría aunque las ramas se solaparan. Medido en T5 (`progress/impl_259_backend.md`, hallazgo 2). Lo que M7 sí prueba es que el `UNION` interior está sujeto por los tests de forma. |
| **R8** | `tablero-dia-universo-sql.test.ts` (sin `COALESCE` sobre `fecha_reparto`, sin zona horaria, sin `startOfDayCR`) + `frontera.guardia.test.ts` (a) |
| **R9** | `tablero-dia-universo-sql.test.ts` (`ventana.fecha` en `values`, `::date` en el texto, la fecha no aparece como literal) — y **M6** |
| **R10** | C8 y C10 (`tablero-dia-recoleccion.test.ts`) |
| **R11** | C9 — y **M5** *(cae si P1 se responde que no)* |
| **R12** | `sumaDeLosOcho` afirmado en **cada** caso de T3.2 y T3.3 |
| **R13** | `tablero-dia-universo-sql.test.ts` (el mismo fragmento en las tres) + T3.4 (cuadre detalle y ritmo) |
| **R14** | caso nuevo de `tablero-dia-detalle-cuadre.test.ts` |
| **R15** | caso nuevo de `tablero-dia-ritmo.test.ts` |
| **R16** | `tablero-dia-sql.test.ts` (una sola aparición de `"zona_id"`, después de `ids_del_dia`) + `tablero-dia-aislamiento.test.ts` + el caso nuevo de T3.5 |
| **R17** | `asignado-at-solo-lectura.guardia.test.ts` (ni una escritura en el árbol) |
| **R18** | `frontera.guardia.test.ts` (d) (sin `findMany`; tres consultas `["agregada","paginada","agregada"]`) |
| **R19** | `pnpm typecheck` + `tablero-dia-accion.test.ts` / `tablero-dia-detalle-accion.test.ts` verdes **sin editarlos** |
| **R20** | `asignado-at-solo-lectura.guardia.test.ts` (la lista blanca de migraciones no cambia) |
| **R21** | `d10-revertida.guardia.test.ts` (T2.4), bloque (1) |
| **R22** | C2, segunda mitad (la misma siembra contada con la ventana de mañana) |
| **R23** | Caso nuevo del test de componente de `TableroDiaEstados` (T7.1): el estado vacío **no** contiene la promesa «en cuanto se asigne la primera…» |
| **R24** | Un caso por sitio, leyendo el texto: `TableroDiaEstados`, `MensajeroCard` (`aria-label`), `DetalleMensajeroPanel` y `TableroDiaModule` (T7.1/T7.2) |
| **R25** | Los mismos cuatro casos, afirmando además que `ETIQUETA_ASIGNADAS` sigue siendo «Asignadas» y que ninguna frase nombra «día de reparto», una columna ni una sigla (T7.3) |
| **R26** | `d10-revertida.guardia.test.ts` (T2.4), bloque (2): el apéndice está **y** el texto original de §D10 sigue verbatim |

## Lo que este spec NO puede demostrar, dicho aquí

- **Que la consulta aguante con volumen.** Los `EXPLAIN` de T4.1 miden **forma**; con 141 órdenes
  vivas en producción no hay coste que medir. Y el argumento de indexabilidad que sostiene «dos
  `SELECT` en vez de un `OR`» **no está medido en esta ficha**: se apoya en los planes de la 246,
  que son de **otra consulta** (`design.md` §3.1, recuadro). Si algún día la pantalla va lenta, el
  sitio donde mirar está escrito en `design.md` §6.
- **Que la pantalla se lea bien.** Los tests de T7 comprueban que **el texto está**; no comprueban
  que se entienda ni que quepa. Eso se ve abriendo la app, y en este repo ya encontró siete textos
  rotos que 12.000 tests daban por buenos.
- **Que el aviso de T8 llegue a alguien.** Es una tarea humana con fecha, no algo que la suite pueda
  verificar. Por eso bloquea la release en vez de vivir como nota.

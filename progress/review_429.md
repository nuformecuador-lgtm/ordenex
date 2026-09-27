# Revisión — ficha 429 (SINPE por bodega)

**Veredicto: RECHAZADA.** Dos bloqueantes, los dos acotados. Todo lo demás está en muy buen estado:
**11 mutaciones aplicadas, 10 muertas.** La que sobrevivió ES el bloqueante nº 1.

Gate reproducido por el reviewer sobre `1fa283b1`, no leído de la bitácora: `INIT_EXIT=0`,
1994/1994 archivos, 29.096 tests, 26 saltados (`AnaliticaPage` 17 + `AnaliticaShell` 9, los de
siempre). **Los 188 de `integration/db` SÍ corrieron.**

---

## BLOQUEANTE 1 — el script de siembra no tiene ni un test, y la mutación lo prueba

`scripts/seed-sinpe-inicial.ts` es **el único archivo que decide el número que ocho bodegas le van a
enseñar a cada cliente en producción**. Sus dos exports no los importa ningún test.

**Mutación aplicada — dos defectos a la vez, los dos en el camino del dinero:**

1. quitar el `WHERE "sinpe_numero" IS NULL OR "sinpe_nombre" IS NULL`: la siembra deja de ser
   idempotente y **pisa la corrección que una bodega ya hizo a mano**;
2. hacer que `leerSemilla` devuelva un valor inventado cuando falta la variable, y borrar la
   validación de formato: el seed **siembra en silencio** en vez de fallar ruidosamente.

**Resultado: `1278 archivos / 19.902 tests, TODO VERDE.**

**La causa está en la trazabilidad, no en el código.** R10 está mapeado a
`tests/integration/db/zona-sinpe-migration.test.ts:242`, y ese caso **reescribe a mano el `UPDATE` del
seed** contra el esquema clon en vez de llamar a `sembrarSinpeInicial`. Su propio comentario lo dice:
«aquí se reproduce esa sentencia». Es la familia «probar el `WHERE` donde vive»: el test afirma el
resultado de un SQL que él mismo escribe, así que el código que implementa R10 **no está cubierto**.

**Para levantarlo:** un `tests/unit/scripts/seed-sinpe-inicial.test.ts` que cubra `leerSemilla`
(variable ausente, nombre ausente, formato inválido, nombre > 60, normalización de `"+506 8888 1111"`)
y que R10 pase a llamar a `sembrarSinpeInicial` de verdad, con el caso de idempotencia: segunda
corrida → `rellenadas === 0` y una fila corregida a mano que **no se pisa**.

## BLOQUEANTE 2 — el plan de release no tiene el paso 2, y hay una trampa que nadie nombró

`pnpm run build` en Vercel hace `prisma generate && tsx scripts/migrate-deploy.ts && next build`, que
aplica **todas** las migraciones pendientes de un tirón:

1. `20260918120100_zona_sinpe` (columnas nullables) → OK.
2. `20260918120200_zona_sinpe_no_nulo` levanta su `RAISE EXCEPTION` porque nadie sembró → el build
   muere. **Eso es lo diseñado y está bien.**
3. **Lo que nadie escribió:** ese fallo deja `20260918120200` marcada como *failed* en
   `_prisma_migrations`, y a partir de ahí **todo `prisma migrate deploy` posterior se niega** hasta
   que alguien corra `prisma migrate resolve`. Contra producción eso exige la `DATABASE_URL` de prod,
   que en este repo es *sensitive* e irrecuperable por CLI. **Se arregla desplegando mal una vez.**

Además, **T0 nunca se midió**: si el `NEXT_PUBLIC_SINPE_NUMERO` vigente en Vercel no cumple
`^[678][0-9]{7}$`, el seed sale con `exit 1` y la migración 3 aborta, en mitad de la release.

**Para levantarlo:** medir el valor de producción contra la regex, elegir la vía, y escribirla como
tarea en `tasks.md` Fase 8 **antes** de T27, nombrando la trampa del `migrate resolve`.

---

## Lo que se apretó y está bien

**Ningún dato real en el repositorio público.** Barrido de las 42.509 líneas del diff, incluidos los
dos logs de gate commiteados (31k líneas). Todos los móviles hallados son sintéticos y cada uno tiene
su propósito escrito. Titulares: «Titular de Prueba» y variantes. **Ningún nombre de persona.** Cero
cadenas de conexión, cero claves, cero `service_role` en los logs.

**La siembra en tres pasos no deja hueco** (salvo el bloqueante 2): la migración 1 no escribe ningún
valor y hay dos asertos que lo vigilan; el script es idempotente **por construcción** (`WHERE … IS
NULL`, no un `if`), nunca imprime el valor ni al fallar, y los dos valores viajan parametrizados. Si el
paso 2 no corrió, el paso 3 aborta y el build entero muere: la app nueva no llega a desplegarse.

**T14 verificado rompiéndolo.** Quitar el par a un productor del DTO → `TS2739`. Volverlos opcionales
—que apaga el compilador sin romper nada— → cae la guardia.

**La validación en tres capas.** `~ '[^[:space:]]'` está en la migración con su motivo. Revertirlo a
`btrim(…) <> ''` → 1 rojo (el tabulador). Relajar el `CHECK` del número → 4 rojos, tres de ellos del
`it.each` que compara el veredicto de la base contra el del validador sobre el mismo valor.

**Ningún test tautológico.** Los tres archivos de pantalla afirman literales y no importan
`sinpe-textos.ts`. Los dos `if (…) return` van precedidos del `expect` de esa misma condición.

**Las siete guardias tocadas: todas aportando el dato, ninguna aflojada.** Los cuatro tests de zonas
se arreglan **tecleando el SINPE** por rol y nombre accesible, no relajando el esquema.

**El aterrizaje post-login intacto**: `destino-post-login.test.ts` no se tocó. Mover «Mi bodega» a
primera posición → **11 rojos en 5 archivos**.

**El aviso no bloquea**: «Ahora no» no llama a ninguna acción; convertirlo en envoltorio de
`{children}` → 2 rojos.

## Las dos preguntas que se le hicieron

**«Última revisión: \<fecha\>» es la lectura correcta**, porque `sinpe_revisado_at` se mueve también al
confirmar sin cambiar nada, y titularlo «Último cambio» sería falso a veces en una pantalla de dinero.
**Lo que sí se pierde, y conviene saberlo:** el «quién» solo vive en `historial_accion`, de lectura
`maestro`-only. **Un `admin`, que puede editar las ocho bodegas, no tiene forma en la app de ver quién
cambió un número.** No incumple R21, pero si la pregunta del día del reclamo la hace un `admin`, hoy no
la puede contestar.

**El `admin` sin entrada de menú es aceptable pero deja un cabo suelto.** Sus dos únicas vías a
`/configuracion/sinpe` son la URL a pelo y el aviso del primer ingreso — y **el aviso deja de salir en
cuanto alguien confirma la central**. A partir de ahí queda autorizado a una pantalla a la que no llega.
Deuda declarada, no bloqueante.

## Menores

1. `db/schema.prisma:515` y `lib/utils/sinpe-cr.ts:95` **siguen documentando el `CHECK` del titular como
   `btrim(…) <> ''`** — justo la formulación que se descartó porque dejaba pasar un tabulador. Son los
   dos archivos que alguien lee para saber qué garantiza la base.
2. `progress/impl_429.md:146,148` siguen diciendo que R27 y R29 están PENDIENTE; sus tests existen.
3. `specs/429-sinpe-por-bodega/tasks.md` no tiene ni un `[x]`.
4. `progress/history.md` no tiene entrada de la 429.
5. `CrearZonaForm.tsx` copia literalmente los seis textos que `sinpe-textos.ts` centraliza — es una
   cuarta superficie, y es la divergencia que `SinpeCampos.tsx` dice en su cabecera que existe para
   evitar.
6. `/mi-bodega` no ofrece «confirmar sin cambiar»: `Guardar` está `disabled` con `sinCambios`, así que
   un `adminSatelite` que cierre el aviso ve «Sin revisar» y **no tiene cómo quitarlo** sin editar algo.
7. La guardia `sinpe-en-toda-superficie` solo caza `sinpeNumero:` seguido de literal; con variables pasa.

## Hallazgo estructural que conviene no perder

La mutación `appendAccion(this.prisma)` en vez de `tx` **solo la caza la guardia estática del censo** —
el test de integración no puede, porque ahí `this.prisma` *es* el cliente de la transacción del test.
Si alguien retira esa guardia «porque ya hay integración», el agujero de la ficha 373 vuelve entero.

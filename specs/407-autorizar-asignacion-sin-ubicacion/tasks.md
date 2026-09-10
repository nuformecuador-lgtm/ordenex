# 407 — Tasks

**Orden obligatorio: backend (T1–T6) → frontend (T7–T11) → cierre (T12–T14).**
`[P]` = puede ir en paralelo con las tasks de su mismo bloque marcadas igual.

**Regla de esta ficha para el criterio de «hecho»:** un aserto que se pone **ROJO** si el código
está mal. Un grep sobre un comentario no cuenta. Y ojo con la familia «aserción contra su propia
fuente»: los textos de §5 se comparan contra el literal **escrito a mano en el test**, copiado del
design, **nunca** contra la constante exportada.

**Sin base de datos.** Esta ficha no toca `db/schema.prisma`, ni `db/migrations/**`, ni ninguna
consulta. Si aparece una migración en el diff, algo se ha desviado del spec.

---

## Bloque A — El gate

### T1. Contrato del gate
**Depende de:** —
**Hacer:** en `lib/interfaces/services/IAsignabilidadCoordenadasService.ts` (design §3.1):
`"asignable_sin_ubicacion_autorizada"` en `EstadoAsignabilidad` **y** en `EstadoAsignable`; segundo
parámetro **opcional** `autorizadasSinUbicacion?: ReadonlySet<string>` en `evaluar`;
`MOTIVOS_AUTORIZABLES_SIN_UBICACION` + `esMotivoAutorizableSinUbicacion`.
**Hecho cuando:**
- `pnpm run typecheck` pasa **y** `MOTIVO_A_MENSAJE` de `geocodificacion-motivo-messages.ts` sigue
  compilando con sus **cinco** entradas (prueba de que el estado se clasificó como asignable y no
  cayó en `EstadoBloqueante`);
- los dobles de `IAsignabilidadCoordenadasService` que ya existen en `tests/` **siguen compilando
  sin tocarlos** (una implementación con menos parámetros es asignable a la firma nueva); si
  alguno hay que tocar, el parámetro no es aditivo y hay que revisarlo;
- **contraprueba obligatoria, ejecutada y anotada:** quitar el valor de `EstadoAsignable` dejando
  el de `EstadoAsignabilidad` **rompe el typecheck** con `TS2741` en ese `Record`. Si no rompe, el
  tripwire de la 400 está muerto y hay que decirlo antes de seguir.

### T2. El paso del gate, dentro de la rama R3
**Depende de:** T1
**Hacer:** `lib/services/AsignabilidadCoordenadasService.ts` — el `if` de design §3.2, **dentro**
de la rama de `STATUS_DETERMINISTAS`; el parámetro con `= new Set<string>()` por defecto; el tercer
valor en la lista de `esAsignable` (`:227`); ampliar la cabecera normativa del archivo con la fila
nueva (patrón 368/400).
**Hecho cuando** `tests/unit/services/asignabilidad-coordenadas-autorizada.test.ts` (nuevo) pasa
con estos casos, **cada uno rojo ante su mutación**:
- R1: `ZERO_RESULTS` + sin coordenadas + id en el conjunto → `asignable_sin_ubicacion_autorizada`;
- R2: tabla parametrizada con `geocodificacion_en_curso`, `_encolada`, `_no_encolable` y
  `_agotada`, **todos con el id en el conjunto** → los cuatro siguen bloqueando. Mutación que lo
  pone rojo: sacar el `if` de la rama R3 y ponerlo como paso propio;
- R3: conjunto con un id que **no** está en `ordenes` → ninguna orden del lote cambia de estado;
- R4: lat/lng presentes + id en el conjunto → `asignable`, **no** el estado nuevo;
- R9: dos llamadas a `evaluar` sobre la MISMA fila, la primera con conjunto y la segunda sin él →
  la segunda devuelve `direccion_no_geocodificable`. Mutación que lo pone rojo: guardar el
  conjunto en un campo de la instancia;
- `esAsignable("asignable_sin_ubicacion_autorizada") === true` — caso **explícito**, porque esa
  lista es un array más corto que su tipo y olvidarla **compila** (design §3.1.2).

### T3. El predicado de la UI no puede divergir del gate
**Depende de:** T2
**Hacer:** en el mismo archivo de test, un caso que recorra **todos** los valores de
`EstadoBloqueante` y compruebe que `esMotivoAutorizableSinUbicacion(m)` es `true` **si y solo si**
alimentar al gate una fila en ese estado **con la marca** la vuelve asignable.
**Hecho cuando** pasa, y **falla** al añadir un motivo a `MOTIVOS_AUTORIZABLES_SIN_UBICACION` sin
que el gate lo honre (contraprueba ejecutada). Esto es lo que impide que el modal ofrezca lo que
el servidor va a negar — la lección de la 271 (R17).

### T4. No regresión del gate
**Depende de:** T2  `[P]` con T5
**Hacer:** correr `tests/unit/services/asignabilidad-coordenadas.test.ts` **sin tocar ninguna
expectativa**.
**Hecho cuando** pasa entero tal cual está (R5). Si hubo que cambiar una expectativa, el paso nuevo
no es aditivo y hay que volver a T2.

---

## Bloque B — Los dos writers y el borde

### T5. `GuiaAsignacionService` + su contrato + su schema
**Depende de:** T2  `[P]` con T6
**Hacer:**
- `lib/interfaces/services/IGuiaAsignacionService.ts`: `AsignarBodegaInput.autorizarSinUbicacionIds?:
  string[]` (patrón aditivo de `dia?`) y `sinUbicacionAutorizada?: number` en `ok`/`partial`;
- `lib/services/GuiaAsignacionService.ts`: `gateCoordenadas` recibe el conjunto y lo reenvía a
  `evaluar`; cuenta `asignable_sin_ubicacion_autorizada` **antes** del `continue`; expone la cifra
  solo si es `> 0`;
- `lib/types/orden-guia.ts`: `asignarBodegaSchema` gana
  `autorizarSinUbicacionIds: z.array(z.string().uuid()).default([])`, y `AsignarBodegaResult` gana
  la cifra.

**Hecho cuando** `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts` (ampliado) pasa:
- R1: orden irresoluble marcada → sale en `resultados` y **no** en `bloqueadas`;
- R8: lote de 3 (una marcada e irresoluble, una `geocodificacion_en_curso`, una asignable) →
  `partial` con 2 asignadas y 1 bloqueada;
- R11: lote con una orden de la 400 y una de la 407 → `{ sinUbicacion: 1, sinUbicacionAutorizada:
  1 }`, disjuntas;
- R10: con cero autorizadas, `expect(result).not.toHaveProperty("sinUbicacionAutorizada")` — **no**
  `toBeUndefined()`, que pasaría igual si la clave existiera con valor `undefined`;
- R6/R7: **con la marca puesta**, un actor sin acceso total → `forbidden`; un mensajero bloqueado
  por cierres, una orden en origen inválido y una orden en el tope de intentos → abortan el lote
  igual que antes, y `asignarBodegaLote` **no se llamó**. Es la prueba de que la marca no
  desactiva ninguna otra guarda;
- R5: los `toEqual` vigentes del archivo siguen intactos.

### T6. `AsignacionSateliteService`, espejo exacto
**Depende de:** T2  `[P]` con T5
**Hacer:** lo mismo sobre `lib/interfaces/services/IAsignacionSateliteService.ts`,
`lib/services/AsignacionSateliteService.ts` (bloque `4b`, `:273-290`) y
`lib/types/recepcion-satelite.ts`.
**Hecho cuando** `tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts` (ampliado) pasa
**los mismos seis casos**, espejados, más el propio del satélite: con la marca puesta, `sin_zona` y
`bodega_bloqueada` siguen abortando antes del gate. Que se olvide en uno de los dos lados lo caza
este par de archivos: son la pareja que la 400 dejó puesta justo para esto.

> **`lib/actions/ordenes-guia.ts` y `lib/actions/recepcion-satelite.ts` NO se tocan.** Ambas hacen
> `schema.parse(input)` y pasan el resultado al service tal cual, así que el campo viaja solo.
> **Criterio de hecho de esa afirmación:** un test de acción que mande
> `autorizarSinUbicacionIds` y afirme que el service inyectado lo recibió **sin** haber editado el
> archivo de la acción. Si hay que editarlo, el passthrough no era tal y hay que decirlo.

---

## Bloque C — Frontend (NO empezar hasta que T5 y T6 estén verdes)

### T7. Los textos, en su único módulo
**Depende de:** T1
**Hacer:** en `app/(app)/_components/geocodificacion-motivo-messages.ts` añadir
`MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION` (design §5.1),
`mensajeAsignadasSinUbicacionAutorizada(n)` (§5.2), la etiqueta del control y el re-export de
`esMotivoAutorizableSinUbicacion`. **Copiar los literales carácter a carácter del design: están
aprobados por el humano y no se retocan.**
**Hecho cuando** `tests/unit/components/geocodificacion-motivo-messages.test.ts` (ampliado) pasa:
- R13: singular (`n === 1`), plural (`n === 3`) y `n <= 0` → cadena vacía, **con los textos
  escritos a mano en el test**;
- R15: la firma solo admite `number`, y el literal no contiene ninguna cadena de una fixture de
  PII (la dirección del caso medido, `"76068276"`, un uuid).

### T8. Guardia: los modales no citan literales del gate
**Depende de:** T1  `[P]` con T7
**Hacer:** añadir `"asignable_sin_ubicacion_autorizada"` a `MOTIVOS_DEL_GATE` en
`tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts:39-47` (lista
escrita a mano, por diseño) y un `it` que exija que los dos modales importen
`esMotivoAutorizableSinUbicacion` del **mismo** módulo compartido.
**Hecho cuando** el guardia pasa **y** su contraprueba nueva demuestra que caza un modal que
filtrara por `motivo === "direccion_no_geocodificable"` a mano (R17).

### T9. Guardia: el texto no miente
**Depende de:** T7
**Hacer:** `tests/unit/guards/autorizacion-texto-no-miente.guardia.test.ts` (nuevo). Lee el **árbol
real** de `geocodificacion-motivo-messages.ts` (con `quitarComentarios`, como el resto de guardias
del repo) y afirma que el literal de §5.2 **no** contiene `"no de la dirección"` ni `"problema del
sistema"`, y que los dos mensajes agregados (400 y 407) son **distintos entre sí** para el mismo
`n`.
**Hecho cuando** pasa y su contraprueba demuestra que se pone rojo si alguien hiciera
`mensajeAsignadasSinUbicacionAutorizada = mensajeAsignadasSinUbicacion` (R12).
**Por qué un guardia y no solo un test de comportamiento:** lo que se vigila es que **no vuelva**
un texto retirado; eso se lee del árbol, no de una salida. Y con el spec adelgazado este guardia
es lo único que queda vigilando la honestidad del aviso.

### T10. `AsignarBodegaModal`
**Depende de:** T5, T7, T8
**Hacer:** design §4.1–§4.3. El `setState` de `autorizables` va **antes** del `throw` existente
(`:176-178`); el panel con el literal de §5.1, la lista por `numRemision` y el control; la segunda
petición acotada a las autorizables con `autorizarSinUbicacionIds`; el manifiesto acumulado; el
aviso agregado concatenado a la frase que ya existe (`:204-212`).
**Hecho cuando** `tests/components/AsignarBodegaModal.autorizacion.test.tsx` (nuevo) pasa:
- R16-a: la acción devuelve `conflict` con un motivo autorizable → el panel se pinta **y** el toast
  de error sigue saliendo (el comportamiento viejo no se rompe);
- R16-b: la acción devuelve `partial` → el panel se pinta junto a la lista de bloqueadas;
- R16-c (contraste): `conflict` con `geocodificacion_en_curso` → **no** hay panel;
- R14: el literal de §5.1 está en el documento **antes** de pulsar el control (texto a mano);
- R18: tras confirmar, `asignarDesdeBodega` se llamó **una** vez más, y su argumento lleva
  `ordenIds` y `autorizarSinUbicacionIds` **iguales al conjunto autorizable** — se afirma sobre el
  argumento capturado, no sobre el número de llamadas a secas;
- R19: se ve el `numRemision` y el uuid de la orden **no** aparece en el DOM;
- R20: tras la segunda petición, `ManifiestoResultado` recibe la **unión** de lo asignado en las
  dos (caso construido con una asignada en la primera y otra en la segunda);
- R10/R12: con `sinUbicacionAutorizada: 2` en la respuesta, el mensaje de éxito contiene el texto
  de §5.2 (a mano) y **no** el de la 400.

### T11. `AsignarSateliteModal`
**Depende de:** T6, T7, T8. **Después de T10**, no en paralelo: comparten el módulo de textos.
**Hacer:** espejo exacto de T10 sobre
`app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx`.
**Hecho cuando** `tests/components/AsignarSateliteModal.autorizacion.test.tsx` (nuevo) pasa con los
**mismos ocho casos**, espejados.

---

## Bloque D — Cierre

### T12. Mapa `R<n> → test` y evidencia
**Depende de:** T1–T11
**Hacer:** escribir `progress/impl_407.md` con el mapa completo de `requirements.md` (20 filas), la
salida real de los tests y las **cuatro contrapruebas ejecutadas** (T1, T3, T8, T9).
**Hecho cuando** ninguna fila del mapa está vacía. Un requisito sin test es hallazgo bloqueante.
⚠️ **Commitear el informe.** Escribirlo y no commitearlo ha pasado tres veces en un día en este
repo, y un `git checkout` se lo lleva.

### T13. Gate completo
**Depende de:** T12
**Hacer:** `./init.sh` **completo**, no `--rapido`. El rápido **se niega solo** con este diff, por
`lib/types/orden-guia.ts` y `lib/types/recepcion-satelite.ts` (`lib/types/**`, ver design §9-3).
**Hecho cuando:**
- `INIT_EXIT=0` escrito **dentro** del log (un `echo` posterior puede tapar el código de salida);
- el veredicto del baseline no lista ningún archivo nuevo;
- la cuenta de `skipped` se lee y se anota. Esta ficha no añade tests contra Postgres, así que
  ningún requisito depende de ellos — pero si el número de saltados es inesperadamente alto, hay
  que decirlo igual.

### T14. Poda del baseline
**Depende de:** T13
**Hacer:** si el gate avisa de que algún archivo de `tests/baseline-rojos.json` volvió a verde,
borrarlo **en este mismo PR**.
**Hecho cuando** el gate no propone ninguna poda pendiente.

---

## Fuera de alcance (declarado, para que nadie lo añada por su cuenta)

- **Cualquier persistencia de la autorización**: tabla, columna, migración o fila en
  `historial_accion`. Decisión del humano del 2026-09-10 (design §8-A1). Si aparece un
  `db/schema.prisma` o un `db/migrations/**` en el diff, el spec se ha desviado.
- Mostrar quién autorizó, en cualquier pantalla. Cae con lo anterior.
- Fijar coordenadas a mano en un mapa (§8-A2).
- Autorizar `geocodificacion_agotada` (§8, la 400 ya cubre ese caso).
- Restringir la autorización a `maestro` (§8-A9).
- Tocar `feature_list.json` o `progress/current.md`.
</content>

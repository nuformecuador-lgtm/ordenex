# Feature 237 — Diseño técnico

> Requisitos en `requirements.md` (R1-R50) y decisiones abiertas D1-D8. **Molde de forma y de rigor:**
> `specs/238-confirmacion-fisica-cierre/design.md`. **Molde de fondo:**
> `progress/design_pila_ayuda_tienda.md` §F3.
>
> Los textos de pantalla están **pendientes de firma (D7)**; aquí se usan los recomendados.
> **D1, D2, D3, D4 y D6 cambian conducta o dinero y no se implementan sin firma.**
>
> Todo lo que este documento afirma sobre el código está **leído en el árbol**, con archivo y línea.
> Donde falta un número, está declarado como **medición pendiente (T0)**, no rellenado.

---

## 0. El cambio, en una línea de causa y efecto

Una orden en `ayuda_tienda` tiene hoy **dos salidas** (`lib/types/order-status-transiciones.ts:292-295`):
el rescate a `en_reparto` y el corte de la noche a `sin_gestionar`. Es decir: **la tienda no puede
resolver nada**; sólo puede devolverle el problema al mensajero o dejar que el día se acabe. Esta ficha
declara **las dos salidas que faltan** —`reprogramada` y `rechazada`— y su productor, y hace que la
fila que producen sea, para todo lo que mira `gestion_orden`, **una fila más del mensajero**.

El archivo de transiciones ya tiene escrito, con nombre y apellido, lo que esta ficha viene a hacer:

> «`ayuda_tienda -> entregada / reprogramada / devolucion_por_confirmar / rechazada / incidente`: son
> LAS GESTIONES. Las trae la **ficha 237** JUNTO A SU PRODUCTOR (`gestionarDesdeAyuda`).»
> — `lib/types/order-status-transiciones.ts:284-289`

---

## 1. LA INVARIANTE QUE SOSTIENE LA FICHA — medida, no supuesta

> Este es el punto número uno del diseño. La frase de `progress/design_pila_ayuda_tienda.md` §F3 —
> «`deshacerGestion` sigue funcionando sin tocarlo, **porque una orden en ayuda bloquea el cierre**»—
> se comprobó línea a línea. **Es media verdad, y la otra media contiene dos hallazgos distintos.**

### 1.1 Qué es cierto

`ESTADOS_PENDIENTES = ["por_recoger", "en_reparto", "ayuda_tienda"]` (`lib/services/CierreDiaService.ts:58`,
puesto ahí por la 235/R23 **por su nombre**, no por accidente). El **camino de creación** de un cierre
lo consulta en `:456` y devuelve `conflict` con `pendientes > 0`. Luego, por esa vía, es imposible que
exista un cierre `solicitado` mientras el mensajero tenga una orden en ayuda; cuando la tienda
gestiona, la orden sale de ayuda, el mensajero puede pedir cierre y `crearCierre` vincula la gestión
con `updateMany({ where: { mensajeroId, cierreId: null, anuladaAt: null } })`
(`lib/repositories/CierreDiaRepository.ts:518`). **La gestión cae en el cierre del día. ✔**

### 1.2 Qué es FALSO, y dónde exactamente

`solicitarCierre` tiene **dos rutas que devuelven antes de llegar a `:456`**:

| Ruta | Línea | Qué hace | Precondición de pendientes |
| --- | --- | --- | --- |
| `vencido → solicitado` | `CierreDiaService.ts:432` | `transicionarVencidoASolicitado` | **NO se aplica** (111/R9, anti-deadlock) |
| `rechazado → solicitado` | `CierreDiaService.ts:447` | `transicionarRechazadoASolicitado` | **NO se aplica** (109/R28) |

Las dos escrituras **sólo cambian `estado`** y lo dicen con esas palabras: «money-safe — cambia
ÚNICAMENTE `estado`. Los totales, pago, ingreso, `cierre_id` de las gestiones…»
(`CierreDiaRepository.ts:373`). **No re-vinculan gestiones.**

Y el propio comentario de la 235 (`CierreDiaService.ts:428-431`) lo afirma y pide que **nadie lo
«arregle»**: «con `ayuda_tienda` en `ESTADOS_PENDIENTES`, esta ruta se comporta EXACTAMENTE igual…
quitarle la exención reabre el deadlock que la 111/R9 cerró».

**Secuencia real y alcanzable** (todos los pasos existen hoy):

1. El mensajero tiene un cierre `rechazado` o `vencido`. Está **bloqueado** para gestionar (111/R1),
   pero **235/R25 le deja seguir pidiendo ayuda**.
2. Pide ayuda sobre una orden → `ayuda_tienda`.
3. Re-solicita el cierre por la ruta exenta → el cierre pasa a `solicitado` **con sus gestiones ya
   dentro y su snapshot congelado**.
4. La tienda gestiona desde ayuda → gestión nueva con `cierre_id = NULL`.
5. Esa gestión **no está** en el cierre en curso. La recogerá el **siguiente** `crearCierre` —el corte
   de la noche o la próxima solicitud—.

**Lo que NO se rompe, y por qué:** los cinco feeds de dinero leen `gestion_orden` **por `cierre_id`**
(§7). La gestión acaba en **un** cierre y en uno solo; el cierre viejo congeló sus totales sin ella. No
hay doble cobro ni cobro perdido. **Lo que SÍ cambia:** en qué cierre aparece, cuándo cuenta el intento
(al aprobarse **ese** cierre) y **en qué cierre bodega tendrá que escanear el paquete** (238), que
vuelve físicamente hoy.

➡️ **R32 existe por esto, y su test tiene que ejercer la ruta, no suponerla.** Decisión: **D1**.

### 1.3 El segundo hallazgo: `deshacerGestion` «sigue funcionando» — y por eso el mensajero puede revertir a la tienda

`CierreDiaService.deshacerGestion` (`:532`) tiene ocho guardias. La gestión de la tienda **las pasa
todas**:

| # | Guardia | Línea | La gestión de la tienda |
| --- | --- | --- | --- |
| 1 | rol `mensajero` | `:535` | el actor es el mensajero ✔ |
| 2 | mensajero no bloqueado | `:541` | depende de su cierre |
| 3 | `gestion.mensajeroId !== actor` → `forbidden` | `:550` | **es «suya»** (R3) ✔ |
| 4 | `cierre_id !== null` → `conflict` | `:554` | **`NULL`** (R9) ✔ |
| 5 | ya anulada | `:557` | no ✔ |
| 6 | orden borrada | `:560` | no ✔ |
| 7 | es la última no anulada | `:563` | sí ✔ |
| 8 | `ESTADOS_ESPERADOS[resultado]` | `:569` | `reprogramada→["reprogramada"]`, `rechazada→["rechazada"]` ✔ |

Resultado: **el mensajero puede deshacer la gestión de la tienda**, la orden vuelve a `en_reparto`
(no a `ayuda_tienda`) **reasignada a él**, y la tienda **no se entera** porque la fila ya no está en
ninguna de sus pestañas. Con ello desaparecen el intento y el `cobroRechazado`.

La invariante era cierta —el mecanismo no se rompe— pero **hacía un trabajo distinto del que la frase
sugiere**: la propiedad `mensajero_id` está ahí para que la gestión **caiga en su cierre**, no para
declarar autoría. Nadie decidió que un actor pueda revertir al otro. ➡️ **D3**.

---

## 2. Modelo de datos

### 2.1 Tablas y columnas nuevas: **ninguna**, y es una decisión

No hay tabla, ni columna, ni política RLS que escribir. Todo lo que esta ficha persiste cabe en
`gestion_orden` (+ `gestion_orden_evidencia`) y `orden_historial_estado`, con la RLS que ya tienen. Se
dice explícitamente porque en esta pila la tentación de persistir «para no calcular» ya costó dos
columnas retiradas (`orden.ayuda`, `orden.gestion_aprobada`).

**En particular, NO se persiste «quién gestionó».** Ya está: es `orden_historial_estado.actor_usuario_id`
de la fila con `origen_tipo = gestion_tienda_ayuda`, enlazada a la gestión por `gestion_orden_id`. Una
columna `gestionada_por_tienda` sería una segunda verdad que alguien tendría que mantener.

### 2.2 Un valor de enum nuevo: `gestion_tienda_ayuda`

Es el tercero de los tres que el diseño de la pila enumeró, y el único que quedaba: la 235 declaró los
otros dos y dejó éste fuera **a propósito**, con la razón escrita en tres sitios
(`lib/types/orden-historial.ts:76-78`, `requirements.md` P2 de la 235 y el comentario de la migración
`20260819150000`): «un valor de enum nace en el commit de su productor. Precedente literal: `incidente`
(154), declarado sin productor, *costó el tren 154+155+156*».

Migración **sola**, sin ningún uso del valor en la misma transacción (Postgres 55P04):
`db/migrations/<ts>_orden_historial_origen_gestion_tienda_ayuda/`, `<ts>` posterior al último aplicado.

- `migration.sql`: `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'gestion_tienda_ayuda';`
- `down.sql`: **recrea el tipo** con los **29** valores previos (los 27 de antes de la 235 más
  `solicitud_ayuda_tienda` y `rescate_ayuda_tienda`), copia literal del molde de
  `db/migrations/20260819150000_orden_historial_origen_ayuda_tienda/down.sql`, incluida su
  precondición: si queda alguna fila con el valor nuevo, el `USING` **falla ruidosamente** y el
  rollback aborta — comportamiento correcto (R47).

⚠️ **Los `down.sql` de las migraciones anteriores de este enum NO se tocan**: son fotos históricas.
Aplicar el de la 157 o el de la 239 después de ésta deja el enum sin los valores nuevos, y eso es el
comportamiento esperado de una cadena de rollbacks. Está escrito así en el down de la 235 y se hereda.

### 2.3 Índices: ninguno nuevo

- La escritura toca `gestion_orden` (INSERT), `gestion_orden_evidencia` (INSERT) y `orden` (UPDATE por
  PK con guarda de estatus).
- La lectura de D3 —«¿esta gestión la hizo la tienda?»— entra por `gestion_orden_id` de
  `orden_historial_estado`… que **no tiene índice propio**. Por eso se resuelve con el **mismo patrón
  que `whereIntentosVigentes`** (`OrdenHistorialRepository.ts:194-200`): repetir el `ordenId` dentro del
  `some` para que el `EXISTS` entre por `@@index([ordenId, createdAt])`. **No se inventa un índice: se
  copia el acceso que ya está medido.**

### 2.4 Las dos aristas

En `lib/types/order-status-transiciones.ts`, dentro de `ayuda_tienda`:

```ts
{ to: "reprogramada", via: "gestion_tienda_ayuda", rol: "adminTienda (dueña)" }, // #65 (237)
{ to: "rechazada",    via: "gestion_tienda_ayuda", rol: "adminTienda (dueña)" }, // #66 (237)
```

**Y ninguna más (R1).** `entregada`, `devolucion_por_confirmar` e `incidente` **no se declaran**: no
tienen productor, y declarar una arista sin productor es el error citado arriba. El comentario del
bloque `ayuda_tienda` (`:283-291`) se **reescribe** —deja de ser cierto que «desde aquí sólo se sale
rescatando o por el corte»— conservando qué decía y por qué (R45, y la regla del repo: un comentario
que describe un mundo que ya no existe es peor que ninguno).

**El inventario cambia**: `tests/fixtures/inventario-transiciones-140.ts` pasa de `aristasFlujo: 59` a
**61** y de `paresUnicos: 57` a **59** (las dos altas son pares nuevos), y gana sus dos filas con
`callSite`. Es un rojo **por diseño**, con reparación exacta (§14).

---

## 3. El destino de la gestión sale del mapa que ya existe

`lib/types/gestion-destino.ts` (feature 239) ya declara `reprogramada → "reprogramada"` y
`rechazada → "rechazada"`, con dos `satisfies` que rompen el build si el enum gana un resultado o si un
destino deja de existir. **Esta ficha lo consume y no escribe un segundo mapa** (R26).

Es más que higiene: la 239 rompió la identidad de nombre para `devuelta`, y volver a
`findEstatusIdByValue(resultado)` —lo que hacía el código antes— reabre el cobro prematuro que aquella
ficha cerró. Un mapa nuevo aquí sería exactamente esa recaída, en otro archivo.

---

## 4. La escritura: qué se reutiliza y qué NO se puede

### 4.1 Por qué NO se llama a `MisAsignacionesService.gestionar`

Cuatro guardas lo impiden, y **ninguna es accidental**:

| Guarda | Línea | Por qué no se puede relajar |
| --- | --- | --- |
| `actor.rol !== "mensajero" → forbidden` | `MisAsignacionesService.ts:376` | El actor aquí es la tienda |
| `estaBloqueado(actor)` | `:382` | Es la guarda de bloqueo total de la 111 sobre el **mensajero**; aplicarla a la tienda la bloquearía por un estado ajeno |
| `cargarOrdenGestionable` exige `en_reparto` | `:548` | La 235 lo dejó escrito: que sea `en_reparto` **y no una lista** es lo que hace que una orden en ayuda deje de ser gestionable **sin escribir ninguna guarda nueva** (`:55-57`). Ensancharlo devuelve al mensajero la gestión desde ayuda |
| `mensajeroId = actor.usuarioId` | `:495` | Aquí el autor y el atribuido **son personas distintas**: ése es el corazón de la ficha |

Añadir un modo o un actor suplantado a un método money-critical es la alternativa **A** de §13, y está
descartada.

### 4.2 Por qué NO se reutiliza `GestionOrdenRepository.crearGestionYTransicionar`

Tres cosas de esa transacción son **incorrectas** para este camino, y una es un fallo real:

1. `actorUsuarioId: mensajeroId` y `origenTipo: "gestion"|"incidente"` están **fijados dentro**
   (`GestionOrdenRepository.ts:486-495`). Necesitamos actor = tienda y familia propia (R4/R5).
   ⚠️ **Y no vale «dejar `gestion` y no tocar `ORIGEN_TIPOS_VISITA_REAL`»**, que es el atajo tentador:
   el historial atribuiría al mensajero un acto que no hizo, y R4 lo prohíbe.
2. `tx.usuario.update({ where: { id: mensajeroId }, data: { ordenEnGestionId: null } })` (`:460`)
   **limpia el puntero del mensajero sea cual sea la orden a la que apunte**. Una orden en
   `ayuda_tienda` **no puede** ser su orden en gestión —`escogerParaGestion` exige `en_reparto` y la
   solicitud de ayuda ya liberó el puntero (235/R7)—, así que reutilizarlo **le arrancaría de las manos
   otra orden distinta que estuviera gestionando**. Es un fallo, no una diferencia de estilo (R10).
3. `tx.orden.update({ where: { id } })` (`:455`) **no lleva guarda de estado**: se apoya en que el
   servicio ya validó. Aquí hay **dos actores** sobre la misma fila y la guarda tiene que ir **en el
   WHERE** (R24).

### 4.3 Lo que sí es el molde: `reprogramarDesdeDevuelta`

`GestionOrdenRepository.reprogramarDesdeDevuelta` (`:552`) ya hace **exactamente esta forma** para la
feature 100: `updateMany` guardado por el estatus de origen → `count === 0` ⇒ `false` sin efectos;
gestión sintética con el `mensajero_id` **derivado**; `cierre_id: null`; y `appendCambioEstado` con
`actorUsuarioId = el adminTienda` y `origen_tipo` propio. **Se copia esa estructura**, no se generaliza
aquel método: su semántica (derivar el mensajero de la última `devuelta` vigente) es otra.

### 4.4 El método nuevo: `crearGestionDesdeAyuda`

```ts
// lib/interfaces/repositories/IGestionOrdenRepository.ts
export interface CrearGestionDesdeAyudaInput {
  ordenId: string;
  estatusAyudaId: string;      // GUARDA del updateMany (R23/R24)
  estatusDestinoId: string;    // del mapa de §3
  mensajeroId: string;         // R3: a quién se atribuye -> en qué cierre cae
  actorUsuarioId: string;      // R4: la tienda
  gestion: GestionOrdenData;   // resultado + motivo + evidencias (+ fechaReprogramacion)
}

/** `null` = la orden ya no estaba en ayuda (carrera perdida): sin gestión y sin historial. */
crearGestionDesdeAyuda(input: CrearGestionDesdeAyudaInput): Promise<string | null>;
```

Dentro de **una** transacción, en este orden:

```
1. updateMany({ where: { id, estatusId: estatusAyudaId, deletedAt: null },
                data:  { estatusId: estatusDestinoId } })      ← R24, money-safe: SOLO estatusId
   count === 0  -> return null                                  ← R25, sin efectos
2. create gestion_orden { ordenId, mensajeroId, resultado, motivo,
                          fechaReprogramacion?, cierreId: null } ← R3/R9
3. createMany gestion_orden_evidencia (N filas, indice 0..N-1)   ← R2, misma tx
4. appendCambioEstado([{ estatusOrigenId: estatusAyudaId,        ← R4/R5, choke point
                         estatusDestinoId,
                         actorUsuarioId: LA TIENDA,
                         origenTipo: "gestion_tienda_ayuda",
                         motivo, gestionOrdenId }])
```

- **NO** toca `usuario.ordenEnGestionId`. **NO** toca `mensajeroAsignadoId`, `prioridad` ni ningún
  monto (R10/R11). **NO** encola reoptimización de ruta: la orden salió de la ruta al entrar en ayuda y
  `transicionarAyuda` tampoco encola — paridad deliberada.
- **NO** escribe ubicación: los tres campos son opcionales en `GestionOrdenData`
  (`IGestionOrdenRepository.ts:150-152`) y el INSERT escribe `NULL` explícito. Con eso el registro de la
  guardia `gestion-ubicacion-solo-escritura.guardia.test.ts` **no cambia** y sigue verde (R18).
- El INSERT de la gestión + sus evidencias **se extrae a un helper privado** compartido con
  `crearGestionYTransicionar`, para que `gestion_orden_evidencia` siga insertándose desde **un** sitio.
- **Idempotencia por construcción (R28):** la guarda del `updateMany` es la barrera. Un segundo envío
  encuentra la orden ya fuera de ayuda, `count = 0`, y no hay gestión ni historial. No hace falta código
  de idempotencia, y añadirlo sería un segundo mecanismo que puede divergir del primero.

---

## 5. La maquinaria de evidencias: la verdad medida

**El encargo dice «reutiliza la maquinaria, no una segunda». Hay que decir que ya hay dos.**

| Copia | Dónde | Qué hace |
| --- | --- | --- |
| 1 | `MisAsignacionesService.gestionar` `:446-482` + `:499-504` | bucle secuencial, `uploaded[]`, `storage.remove` en los dos fallos |
| 2 | `IncidenteAdminService` `:620-645` (`subir`/`compensar`) | lo mismo, con prefijo de path `incidente-` |

Escribir la de 237 serían **tres**. Diseño (D5, recomendación (a)):

```ts
// lib/services/evidencias-compensadas.ts  (NUEVO, sin Prisma, sin next/*)
export interface EvidenciaSubida { storagePath: string; contentType: string; indice: number }

/**
 * Sube 1..N evidencias de forma SECUENCIAL y determinista, acumulando lo subido para poder
 * COMPENSAR. El bucle es secuencial a proposito: `subidos` contiene EXACTAMENTE lo subido hasta
 * el fallo, sin rastrear promesas de un `Promise.all` que rechaza (119/R9/R10).
 */
export async function subirEvidenciasCompensadas(
  storage: IFileStorage,
  input: { ordenId: string; prefijo: string; evidencias: EvidenciaArchivo[] },
): Promise<{ paths: string[]; evidencias: EvidenciaSubida[] }>;

/** Retira lo subido. Se llama desde el `catch` del llamador (R16). */
export async function compensarEvidencias(storage: IFileStorage, paths: string[]): Promise<void>;
```

`prefijo` es lo único que cambiaba entre las dos copias (`${resultado}-` vs `incidente-`), así que se
parametriza en vez de bifurcarse. **En esta ficha se cablean la 237 y `MisAsignacionesService`**;
`IncidenteAdminService` queda como deuda declarada con dueño en `progress/` (D5).

**El borde** reutiliza `evidenciasSchema` y el patrón `FormData` + `getAll("evidencia")` +
`leerEvidencias` de `lib/actions/mis-asignaciones.ts:325`. Ese helper es privado del módulo y ya está
duplicado en `lib/actions/incidentes.ts:304`; **esta ficha no lo extrae** (es lectura de `FormData`, no
compensación: su duplicación no puede dejar basura en Storage). Se dice para que la asimetría con el
párrafo anterior sea una decisión y no un descuido.

---

## 6. La autorización: estrechar la ventana, no abrir una segunda tabla

```ts
// lib/services/GestionDesdeAyudaService.ts
1. autorizarSobreHilo(notaRepo, ordenId, actor)        → !ok  ⇒ forbidden   (R19/R22)
2. acceso.rol !== "adminTienda"                        ⇒ forbidden          (R20)
3. acceso.orden.estatusValue !== "ayuda_tienda"        ⇒ conflict           (R23)
4. estaEnVentanaDeEscritura(acceso.rol, estatusValue)  → false ⇒ forbidden  (R21)
5. acceso.orden.mensajeroAsignadoId === null           ⇒ conflict           (R8)
6. resolver catálogo (ayuda + destino) → alguno null   ⇒ config_error       (fallo cerrado)
7. subir evidencias (compensadas)                                            (R15/R16/R17)
8. repo.crearGestionDesdeAyuda(...)  → null            ⇒ conflict + compensar (R25)
```

Es **el mismo esqueleto** de `rescatarOrdenAyuda` (`lib/services/rescate-ayuda.ts:50`), que ya usa
`autorizarSobreHilo` + la ventana + el fallo cerrado del catálogo. `findOrdenParaHilo` devuelve
justamente lo que hace falta: `tiendaId`, `mensajeroAsignadoId`, `deletedAt` y `estatus.value`
(`OrdenNotaRepository.ts:84-93`), así que **la pertenencia y el mensajero salen de la misma lectura**.

**El paso 2 es la única regla que esta ficha añade, y hay que justificarla** porque el repo evita las
segundas tablas de permisos. No es una tabla nueva: es **estrechar la ventana**, exactamente lo que la
235 firmó en su P9 («la vía recomendada es estrechar la ventana de solicitud, no añadir un `if`
suelto»). El motivo es concreto y money-critical: `ayuda_tienda` está en la ventana de **los dos**
roles, así que sin el paso 2 **un mensajero podría gestionar por esta puerta** y con ello **saltarse
`estaBloqueado`** (111/R1), que es la guarda que le impide gestionar con un cierre sin resolver. Sería
un bypass del bloqueo total por una puerta lateral. R20 existe por esto y su test lo ataca de frente.

**Qué NO hace el servicio:** no comprueba el bloqueo del mensajero. Igual que `rescatarOrdenAyuda`
(`rescate-ayuda.ts:26-28`), añadirlo crearía un deadlock: la tienda no podría resolver una orden porque
el mensajero no cerró su día, que es la parálisis que esta ficha quita.

---

## 7. El dinero — verificado feed por feed

> La hipótesis del diseño de la pila era «sale solo porque los feeds leen `gestion_orden` y esta fila
> es una más». **Se comprobó.** Es cierta para los cinco feeds y **falsa para un consumidor**.

### 7.1 Lo que se lee por `cierre_id`, sin mirar quién

| Consumidor | Predicado real | ¿Filtra por mensajero / origen / actor? |
| --- | --- | --- |
| `WalletFeedService.construirMovimientosDeIngreso` | `gestionOrden.findMany({ where: { cierreId } })` `:41-43` | **No** |
| `WalletTiendaFeedService.construirMovimientosPorTienda` | `{ where: { cierreId } }` `:73-75` | **No** |
| `CAJA_COD_FEED.construirIngresoCod` | deriva del ledger que el anterior acaba de escribir | **No** |
| `WalletMensajeroFeedService.construirMovimientosDePago` | snapshot `pago_mensajero` del cierre | **No** |
| `WalletIndemnizacionFeedService` | `{ cierreId, resultado: "incidente" }` `:29-30` | por **resultado** — nuestra fila nunca es `incidente` |
| `computeTotales` / `derivarPagos` / `derivarIngresoBodega` | por **`resultado`** (`lib/utils/cierre-totales.ts`) | **No** |
| `crearCierre` (vinculación) | `{ mensajeroId, cierreId: null, anuladaAt: null }` `:518` | por **mensajero** — y por eso R3 es un requisito de dinero, no de estética |
| `findGestionesPendientes` (detalle y snapshot) | `{ mensajeroId, cierreId: null, anuladaAt: null }` `:310` | ídem |
| `findGestionesRetornablesDelCierre` (238) | `{ cierreId, resultado IN RESULTADOS_QUE_VUELVEN, anuladaAt: null }` | por **resultado** — `reprogramada` y `rechazada` **están dentro** ⇒ R35 |

**Conclusión:** el dinero sale solo **a condición de R3**. Si la gestión naciera con
`mensajero_id = la tienda`, `crearCierre` **no la vincularía nunca**, no habría `cierre_id`, y la fila
quedaría fuera de los cinco feeds y del escaneo del 238 — invisible y gratis. **R3 es el requisito de
dinero de esta ficha.** Se prueba con mutación (T8.1).

**Qué mueve exactamente cada resultado**, para que quede escrito:

- `reprogramada` → `pago_mensajero = 0.00`, `ingreso_bodega_rechazo = 0.00`, no aporta a los totales
  (`computeTotales` sólo suma `entregada`), y el ledger de la tienda recibe los débitos que
  `derivarIngresoOrden` decida para ese resultado. **Money-neutral en los conceptos propios del cierre.**
- `rechazada` → **`cobroRechazado` de la tarifa** (`lib/utils/ingreso-bodega.ts:23`), que es **dinero
  real** atribuido a la bodega.
  > ⚠️ **CORREGIDO el 2026-08-20 tras la revisión: aquí decía «y debitado a la tienda», y es FALSO.**
  > `cobroRechazado` **no** está en los seis conceptos del ledger de la tienda
  > (`WALLET_INGRESO_CONCEPTO_SEED`) y sus únicos consumidores son `CierreBodegaRepository` y
  > `CierreBodegaService`: es **ingreso de bodega**, no un cargo a la tienda.
  > **Y ojo con la conclusión contraria, que también sería falsa:** un `rechazada` **sí** debita a la
  > tienda —`ingreso_flete_devolucion` + IVA, vía `derivarIngresoOrden` → `WalletTiendaFeedService`—,
  > sólo que por **otra** vía y desde **otra** tarifa (la vigente por tienda, congelada en
  > `cierre_detail`). Son dos importes distintos con dos dueños distintos; confundirlos es lo que
  > hacía esta frase. La tarifa se resuelve por **zona + vehículo del
  MENSAJERO** (`CierreDiaService.resolveTarifaMensajero`), no de la tienda: coherente con «cuenta como
  del mensajero». **Cuánto es, se mide en T0.3.**

### 7.2 El consumidor que SÍ filtra por origen

`lib/notificaciones/emitir.ts:131-132`:

```ts
const DESTINO_RECHAZO: OrderStatusValue = "rechazada";
const ORIGEN_RECHAZO_DEL_DESTINATARIO = "gestion";
```

El aviso interno «Una orden fue rechazada por el destinatario» **sólo** se emite con
`origen_tipo === "gestion"`. Con `gestion_tienda_ayuda` **no se emitirá**. Es una consecuencia, no un
olvido, y por eso es **R44 + D4** — con un test que afirma la ausencia.

### 7.3 El intento de entrega

`whereIntentosVigentes` (`OrdenHistorialRepository.ts:176-202`) exige seis cosas; la sexta es
`historialEstados.some({ origenTipo IN ORIGEN_TIPOS_VISITA_REAL })`. Hoy esa lista es `["gestion"]`
(`lib/types/orden-historial.ts:171`). **`gestion_tienda_ayuda` entra ahí** (R6).

**Por qué esto NO contradice que `reprogramacion_tienda` esté fuera**, que es la objeción obvia y hay
que responderla antes de que la haga la revisión:

- `reprogramacion_tienda` (100) se hace sobre una orden **que ya tiene una gestión `devuelta` real
  contada**. Sumarla produce el **doble conteo** que 160/R2 evitaba: la visita del mensajero **más** el
  trámite de escritorio.
- `gestion_tienda_ayuda` se hace sobre una orden en la que **el mensajero no registró ningún
  desenlace**: pedir ayuda **no cuenta** (235/R11, y las dos familias de la ayuda están fuera de la
  lista). El mensajero **sí fue a la calle con el paquete**; la gestión de la tienda es el desenlace de
  **esa** visita. Contarla es contar **una** visita, **una** vez.

Se afirma con un test explícito: «una orden que pasó por ayuda y fue resuelta por la tienda suma
exactamente **1** intento, no 2» (R7). Y el grano por `cierre_id` de `contarIntentosVigentes`
(`groupBy(["cierreId"])`) sostiene R7 aunque hubiera dos gestiones en el mismo cierre.

⚠️ **Las dos guardias del criterio de intento (`intentos-entrega-criterio-unico`,
`criterio-intento-entrega`) NO se fusionan con el anclaje.** El diseño de la pila lo advierte: «el
ancla de la novedad y el conteo de intentos miran ambos *cierre aprobado* y fusionarlos es tentador y
está mal». Si `anclaje-vs-intentos.guardia.test.ts` o `deriva-primer-intento.guardia.test.ts` se ponen
rojos, alguien los unificó: **es regresión**.

---

## 8. Dónde NO cae la escritura: la transacción de aprobación

**Esta ficha no escribe ni una línea dentro de `resolverCierre` (R37).** La gestión se escribe **en su
propia transacción**, en el instante en que la tienda actúa, igual que `reprogramarDesdeDevuelta`.

Lo que sí ocurre dentro de la transacción de aprobación son **consecuencias de filas que ya existen**:

| Bloque | Qué pasa con una gestión de la tienda | ¿Cambia el código? |
| --- | --- | --- |
| Los cinco feeds de dinero (`:1245-1307`) | la leen por `cierreId`, como cualquier otra | **No** |
| `liberacionSinGestionar` (109) | no aplica (la orden no está `sin_gestionar`) | **No** |
| `devolucionRechazadas` (139, `:1386`) | una `rechazada` de la tienda **entra**: sigue con `mensajero_asignado_id` puesto (la ayuda no lo toca, 235/R6) y con `estatus = rechazada` ⇒ pasa a `por_devolver`/`por_devolver_a_tienda` | **No** |
| **Confirmación física (238, `:1461`)** | `reprogramada` y `rechazada` están en `RESULTADOS_QUE_VUELVEN` ⇒ **bodega tendrá que escanear ese paquete** (R35) | **No** |
| **Anclaje (239, `:1516`)** | **no aplica jamás**: sólo mira `resultado: "devuelta"`, y desde ayuda no se puede devolver (R1) | **No** |

**Consecuencia buscada: el orden de los bloques no se mueve.** `cierres-admin-caja-cod.test.ts` mide el
orden de las llamadas dentro de la transacción porque los feeds se leen unos a otros; esta ficha no
inserta nada entre ellos. **Un rojo ahí es regresión, no aserción a actualizar** — y lo mismo vale para
`cierres-admin-confirmacion-fisica.test.ts` y `cierres-admin-anclaje-devolucion.test.ts`.

⚠️ **Lo que sí cambia de hecho, sin cambiar código:** el conjunto de guías que la ventana del 238 pide
escanear **crece** con las órdenes que resolvió la tienda. Con la regla D2 de la 238 —«un solo paquete
perdido devuelve el cierre entero», sin escapatoria— eso significa que **una gestión de la tienda puede
bloquear la aprobación de un cierre** si el paquete no aparece. Es correcto (el paquete existe y está en
la moto) y hay que decirlo antes de que ocurra: va en §15 y en el recorrido de T9.

---

## 9. El estatus tras la gestión, y lo que ve cada uno

**La orden sale de `ayuda_tienda` a `reprogramada` o a `rechazada`** — el destino del mapa, sin estado
intermedio. Desde ahí sigue el camino que ya existe y que **esta ficha no toca**:

- `reprogramada` → el cron de liberación (46) la manda a bodega en su fecha (`liberacion_reprogramada`).
- `rechazada` → al **aprobar el cierre**, el bloque 139 la manda a `por_devolver`/`por_devolver_a_tienda`.

**El mensajero.** `MisAsignacionesService.listarMisAsignaciones` lee exactamente tres estatus
(`por_recoger`, `en_reparto`, `ayuda_tienda`, `:163-167`), así que la orden **desaparece de su portal**
(R40) y **aparece** en su «Cierre del día» vía `findGestionesPendientes` (`{ mensajeroId, cierreId: null,
anuladaAt: null }`). Ahí está el problema de D6: ve una gestión con evidencia y motivo que no son suyos y
**nada dice que la hizo la tienda**. R41 pide el rótulo; se resuelve leyendo la familia de origen de la
gestión con el mismo `some` de §2.3, sin columna nueva.

**Los KPI del mensajero no se mueven (R36), y hay que decir por qué.** El «Total a cobrar del día» tiene
dos sumandos disjuntos: `porGestionar ∪ conAyuda` (lo que lleva en la mano) y
`sumMontoCobrarGestionadas` (lo ya gestionado hoy). Al gestionar la tienda, la orden **sale del primero**
(deja `ayuda_tienda`) y **entra en el segundo** (tiene una gestión vigente del día con su `mensajero_id`
y su estatus ya no está en `ESTADOS_EN_MANO_DEL_MENSAJERO`). El total no cambia: **la orden sólo cambia
de sumando**. La 235 ya dejó ese `where` preparado para esto, nombrando la ficha:
`GestionOrdenRepository.ts:96` — «la 237 abre aristas desde `ayuda_tienda`».

**El destinatario.** Sin hito nuevo (R42): `reprogramada` y `rechazada` ya están clasificadas en el
rastreo público. Esta ficha **no añade ningún estado**, así que ninguna superficie exhaustiva de estados
cambia — ni `exclude-por-rol.ts`, ni `estados-bodega-satelite.ts`, ni `tablero-dia.ts`, ni el catálogo.

**Los integradores.** `rechazada` y `reprogramada` **están** en `EVENTOS_PUBLICOS`, y
`gestion_tienda_ayuda` **no se añade** a `ORIGENES_SIN_EVENTO_PUBLICO`, así que el evento se emite igual
que si lo hubiera hecho el mensajero (R43/R46). El vocabulario público **no gana ningún valor**. El test
que fija esa lista por igualdad (`tests/unit/types/webhook-eventos.test.ts`) **sigue verde sin tocarse**;
si se pone rojo, alguien exceptuó la familia nueva.

---

## 10. Las carreras

### 10.1 Tienda y mensajero sobre la misma orden

Cerrada **por construcción**, con la guarda en el WHERE (§4.4, paso 1): sólo una de las dos escrituras
encuentra la orden en `ayuda_tienda`.

- Si gana el mensajero («Recuperar») o el corte de la noche → `crearGestionDesdeAyuda` devuelve `null`,
  **no se crea gestión ni historial**, y **se compensan las evidencias ya subidas** (R16).
- Si gana la tienda → el rescate posterior es no-op por su propia guarda (`transicionarAyuda`).

**Y la pantalla no puede afirmar lo que no pasó (R25).** Es literalmente la lección de la 236/D8, ya
firmada sobre esta misma card: «Habilitar» afirmaba haber habilitado aunque la carrera dejara la orden
quieta. Aquí el resultado distingue `ok` de `conflict` y el toast lo dice con el texto de D7.

### 10.2 La tienda gestiona mientras se crea el cierre

Cerrada **por el repositorio, y ya estaba escrito**: `crearCierre` vincula con un `updateMany` **sin
lista de ids** y lee el snapshot **después**, `where: { cierreId }` (`CierreDiaRepository.ts:562-576`).
Una gestión creada entre la lectura del servicio y la transacción **se vincula igual** y **tiene su fila
de detalle**. Sin eso, `WalletFeedService` abortaría la aprobación por falta de detalle (`:49-51`).

### 10.3 La tienda gestiona con un cierre ya `solicitado` por la ruta exenta

**No es una carrera: es la invariante de §1.2.** La gestión nace huérfana y cae en el cierre siguiente.
➡️ D1, R32.

### 10.4 Doble envío desde la pantalla

`count === 0` en el segundo (R28). Sin código de idempotencia.

---

## 11. Contratos I/O

**Rutas nuevas: ninguna** (ni endpoint, ni página: la acción vive en la card de `/novedades`).
**Tablas nuevas: ninguna. Índices nuevos: ninguno. Integraciones externas: ninguna.**

```ts
// lib/types/gestion-desde-ayuda.ts  (NUEVO — borde zod, viaja al navegador: sin @prisma/client)
export const RESULTADOS_DESDE_AYUDA = ["reprogramada", "rechazada"] as const;   // R1

export const gestionarDesdeAyudaSchema = z.discriminatedUnion("resultado", [
  z.object({
    ordenId: z.string().uuid(),
    resultado: z.literal("reprogramada"),
    fechaReprogramacion: fechaFuturaSchema,   // reutilizado de `gestion-orden.ts` (R14)
    motivo: motivoSchema,                     // reutilizado (D8)
    evidencias: evidenciasSchema,             // reutilizado: 1..N, MIME y tamaño (R12/R13)
  }),
  z.object({
    ordenId: z.string().uuid(),
    resultado: z.literal("rechazada"),
    motivo: motivoSchema,
    evidencias: evidenciasSchema,
  }),
]);
```

> ⚠️ **`evidencias` en la rama `reprogramada` depende de D2.** Si D2 se firma como (b), esa clave
> desaparece de esa rama y R12 se parte en dos. Es el único punto del contrato que la firma mueve.
>
> ⚠️ **`fechaFuturaSchema` y `motivoSchema` son hoy privados de `lib/types/gestion-orden.ts`**: hay que
> exportarlos, no copiarlos. Una segunda copia de «mañana o posterior en el calendario de CR» es una
> segunda verdad sobre una fecha, y ese archivo ya explica el off-by-one que costó (`:178-191`).

```ts
// lib/actions/gestion-desde-ayuda.ts  (NUEVO, 'use server')
export async function gestionarDesdeAyuda(formData: FormData, deps?): Promise<GestionarDesdeAyudaResult>;

export type GestionarDesdeAyudaResult =
  | { status: "ok"; ordenId: string; resultado: "reprogramada" | "rechazada" }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; motivo: string };   // R25: la orden ya no está en ayuda
```

`FormData` y no un objeto: viajan archivos, y las Server Actions los soportan nativamente — mismo
patrón y mismo contrato de clave repetida (`evidencia`) que el panel del mensajero y que
`ReportarIncidenteModal`.

```ts
// lib/interfaces/services/IGestionDesdeAyudaService.ts (NUEVO)
gestionar(input: GestionDesdeAyudaInput, actor: Actor): Promise<GestionarDesdeAyudaResult>;
```

```ts
// lib/interfaces/repositories/IGestionOrdenRepository.ts
+ crearGestionDesdeAyuda(input: CrearGestionDesdeAyudaInput): Promise<string | null>;
```

```ts
// lib/types/orden-historial.ts
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED += "gestion_tienda_ayuda"
  ORIGEN_TIPOS_VISITA_REAL = ["gestion", "gestion_tienda_ayuda"]     // R6
  ORIGEN_TIPOS_CON_GESTION: SIN CAMBIOS                              // ver abajo
```

**`ORIGEN_TIPOS_CON_GESTION` no cambia, y es una decisión.** Esa lista sólo desambigua la **nulidad**
del enlace `gestion_orden_id` (67/R25-R26); nuestras filas nacen **con** el enlace poblado, exactamente
como `escalado_devuelta_sla` y `anclaje_devolucion`, que tampoco están. Su test literal
(`toEqual(["gestion","deshacer_gestion"])`) **sigue verde sin tocarse**.

**`NovedadDTO` no cambia.** La card ya trae todo lo que la ventana necesita.

---

## 12. La pantalla

### 12.1 Dos celdas en la tabla, no dos condiciones

`app/(app)/novedades/_components/novedad-acciones-catalogo.ts:63`:

```ts
export const ACCIONES_POR_GRUPO = {
  ayuda: ["contacto", "reprogramarDesdeAyuda", "rechazarDesdeAyuda",
          "habilitar", "conversacion", "intentoContacto"],
  devolucion: ["contacto", "reprogramar", "habilitar", "rechazar"],
} as const satisfies Record<GrupoNovedad, readonly AccionNovedad[]>;
```

**Claves NUEVAS, no reutilización de `reprogramar`/`rechazar`.** Si se reutilizaran, `NovedadAcciones`
tendría que **ramificar por grupo** para elegir a qué servicio llama —`ReprogramacionTiendaService` en
un caso, éste en el otro— y eso es exactamente la decisión fuera de la tabla que R18/R19 de la 236
prohíben, con su guardia (`novedad-acciones-una-tabla.guardia.test.ts`) vigilándolo. Con claves propias,
cada acción tiene **un** handler y la tabla sigue siendo el censo completo.

El comentario de la tabla que dice «`reprogramar` y `rechazar` NO están en `ayuda` (R23)… Gestionar
DESDE ayuda es la ficha 237» **se reescribe**, no se borra: ahora sí están, con otras claves y otro
destino, y la razón de que sean claves distintas es lo que hay que dejar escrito.

### 12.2 La ventana

`GestionarDesdeAyudaModal.tsx`, junto a la pantalla (un solo consumidor ⇒ no se promueve a `shared/`).
**Molde: `ReportarIncidenteModal`** (feature 158), que ya resuelve motivo + 1..N fotos con compresión,
tope de lista, errores por campo y `FormData` con `append("evidencia", file)`.

- Un solo componente con `modo: "reprogramar" | "rechazar"` — la única diferencia es el campo de fecha
  y los rótulos. Dos componentes serían dos copias del bloque de evidencias.
- **El aviso fijo de D7 va arriba y siempre visible**, no en un tooltip: es donde se dice el precio.
- `confirmDisabled` mientras falte motivo, foto o fecha, **y el motivo del bloqueo con palabras** —la
  regla que el sub-modal de la 158 y la ventana de la 238 ya siguen.
- `closeOnConfirm={false}` para pintar los `validation_error` del servidor sin perder lo capturado.
- Montaje condicional con `key={orden.id}` en `NovedadesModule` (mismo patrón que `ordenAReprogramar`,
  `ordenAHabilitar`, `ordenConHilo`).

### 12.3 Tras el éxito

Se recarga la página de la pestaña por Server Action (lo que ya hace «Habilitar»): la fila sale y el
total baja (R27). Tras `conflict`, **también** se recarga: la fila que ya no corresponde desaparece por
el dato, no por optimismo de cliente.

---

## 13. Alternativas descartadas

### A · Reutilizar `MisAsignacionesService.gestionar` con un actor suplantado o un modo `comoTienda`

**Descartada por dos razones independientes.** (i) Habría que **relajar cuatro guardas** (§4.1), y dos
de ellas son de seguridad de dinero: el bloqueo total de la 111 y el `en_reparto` que la 235 dejó
estrecho **a propósito** para que la orden en ayuda dejara de ser gestionable «sin escribir ninguna
guarda nueva». Relajarlas por un parámetro deja el camino del mensajero un `if` más cerca de abrirse.
(ii) Un método money-critical con un modo tiene **dos comportamientos y un solo juego de tests**; el día
que alguien toque el camino común, el otro se entera en producción. Coste que se evitaría: un servicio
y un método de repositorio nuevos. Coste que se pagaría: los cuatro candados a la vez.

### B · Que la gestión nazca con `mensajero_id = la tienda` y un campo «atribuida a»

Sería lo «honesto» respecto de quién actuó.

**Descartada: rompe el dinero en silencio.** `crearCierre` vincula por
`{ mensajeroId, cierreId: null }` (`CierreDiaRepository.ts:518`) y `findGestionesPendientes` filtra
igual (`:310`). Con la tienda como `mensajero_id`, la fila **no se vincularía a ningún cierre nunca**:
sin `cierre_id` queda fuera de los cinco feeds, fuera del snapshot, fuera del escaneo del 238 y fuera
del conteo de intentos. La ficha entera dejaría de cumplirse **sin que nada fallara**. Quién actuó ya
está registrado donde corresponde: `orden_historial_estado.actor_usuario_id` (R4).

### C · Escribir la gestión dentro de la transacción de aprobación del cierre

Aprovechar que ahí ya se toca `gestion_orden`.

**Descartada por tres cosas.** (i) **El momento es otro**: la tienda actúa cuando actúa, no cuando un
admin aprueba; diferirlo dejaría la orden en ayuda —y bloqueando el cierre (R33)— hasta que alguien
aprobara el cierre que ella misma bloquea: un **deadlock**. (ii) Mover escrituras a esa transacción
**mueve el orden de las llamadas** que `cierres-admin-caja-cod.test.ts` mide, y ese orden existe porque
los feeds se leen unos a otros. (iii) Esa transacción ya es la más cara del sistema y la 238 acaba de
sumarle una condición.

### D · Un `origen_tipo` reutilizado (`gestion` o `reprogramacion_tienda`) en vez de uno nuevo

`gestion` sería **gratis**: entraría en `ORIGEN_TIPOS_VISITA_REAL` sin tocar nada y el aviso de rechazo
seguiría emitiéndose.

**Descartada, y es la alternativa más peligrosa de la lista precisamente porque es la más barata.**
Con `gestion`, el historial **atribuiría al mensajero un acto que no hizo** (R4/R5), y el historial es
la única evidencia de quién decidió el rechazo que se le cobró a la tienda — el dato que alguien pedirá
el día de la primera disputa. Además haría **indistinguibles** las dos poblaciones, así que D3 (¿se
puede deshacer?) y D6 (¿qué ve el mensajero?) dejarían de tener respuesta computable. Con
`reprogramacion_tienda` sería peor: esa familia está **deliberadamente fuera** de la lista de visita
real (215/R12) y meterla dentro haría contar **de más** la reprogramación de escritorio de la 100 sobre
órdenes devueltas — el doble conteo que cobra un rechazo antes de tiempo. La familia propia es el
precio de poder decidir cada cosa por separado.

### E · Reutilizar las claves `reprogramar` / `rechazar` de la tabla de acciones

**Descartada:** obliga a ramificar por grupo dentro de `NovedadAcciones` para elegir servicio y modal,
que es la decisión fuera de la tabla que la guardia de la 236 caza. Ver §12.1.

### F · Feature flag para desplegar por mitades

**Descartada: no hay punto intermedio útil.** Sin la pantalla, el servicio no lo llama nadie; sin el
servicio, la pantalla ofrece botones que fallan. Y el valor de enum **no puede** ir en la misma
transacción que su primer uso (55P04), así que la migración ya va sola por obligación técnica: ése es
el único corte, y es inerte. Todo lo demás, **un PR**.

---

## 14. Rojos esperados, y rojos que son REGRESIÓN

### Rojos POR DISEÑO (se actualizan con nota fechada; ninguno se «arregla» tocando el código)

| Suite (existe hoy) | Qué se pone rojo | Cómo se repara |
| --- | --- | --- |
| `tests/unit/types/orden-historial-types.test.ts:125` | `expect([...ORIGEN_TIPOS_VISITA_REAL]).toEqual(["gestion"])` | Pasa a `["gestion","gestion_tienda_ayuda"]` **con nota fechada**. ⚠️ **Ese literal ES el contrato** (censo cerrado que impide que una familia entre de rebote): se **actualiza**, jamás se sustituye por una derivación de su propia fuente — quedaría verde para siempre |
| `tests/unit/types/criterio-intento-entrega.test.ts:90` | `expect(ORIGEN_TIPOS_VISITA_REAL).toEqual(["gestion"])` | Ídem. El caso R34-c de `:98-107` **se auto-ajusta** (deriva `fuera` de la lista) y **debe seguir verde**: `escalado_devuelta_sla` y `reprogramacion_tienda` siguen fuera |
| `tests/fixtures/inventario-transiciones-140.ts:229,234` | `aristasFlujo: 59`, `paresUnicos: 57` | `61` y `59`, más las dos filas `#65`/`#66` con su `callSite`. Las cifras **se re-derivan**, no se copian |
| `tests/unit/domain/order-status-transiciones.guardia.test.ts` · `.connectividad.test.ts` | el censo de aristas y la conectividad de `ayuda_tienda` | Dos aristas nuevas declaradas y con productor (R45) |
| `tests/unit/types/novedad-acciones-catalogo.test.ts` | el juego exacto del grupo `ayuda` | Se añaden las dos acciones al censo del grupo |
| `tests/components/NovedadAcciones.test.tsx` | censo de nombres accesibles de la fila de ayuda («ni uno más ni uno menos») y el caso «sobre una orden en ayuda no se ofrecen Reprogramar ni Rechazar» | El caso **cambia de sentido a propósito**: es el producto de esta ficha. Se reescribe nombrando las claves nuevas, no se borra |
| `tests/unit/services/mis-asignaciones-evidencias.test.ts` | si la extracción de §5 cambia la forma de las llamadas a `storage` | La conducta observable (subir N, compensar k-1) **no cambia**; si el test mira la conducta sigue verde, y si mira la estructura se re-apunta al módulo |
| `tests/integration/db/*` de migraciones de enum | el enum gana un valor | Test propio, molde de `tests/integration/db/ayuda-tienda-migration.test.ts` |
| `tests/unit/services/cierre-dia-*` / deshacer | **sólo si se firma D3 como (b)** | Caso nuevo: deshacer una gestión de familia `gestion_tienda_ayuda` → `conflict` con su mensaje |

### Rojos que son REGRESIÓN (si aparecen, el cambio aterrizó mal — se arregla el CÓDIGO, no el test)

- `tests/unit/repositories/cierres-admin-caja-cod.test.ts` — **mide el orden de las llamadas** dentro
  de la transacción de aprobación. Esta ficha no escribe ahí (R37).
- `tests/unit/repositories/cierres-admin-confirmacion-fisica.test.ts` ·
  `tests/unit/repositories/cierres-admin-anclaje-devolucion.test.ts` ·
  `tests/unit/repositories/cierres-admin-indemnizacion.test.ts` — los bloques de la 238/239/158 no se
  tocan.
- `tests/integration/db/wallet-idempotencia.test.ts` · `tests/integration/db/wallet-tienda-idempotencia.test.ts` ·
  `tests/integration/db/pago-mensajero-idempotencia.test.ts` · `tests/integration/db/caja-tesoreria-idempotencia.test.ts`
  — los cinco feeds y su idempotencia.
- `tests/unit/guards/anclaje-vs-intentos.guardia.test.ts` · `tests/unit/guards/deriva-primer-intento.guardia.test.ts`
  — **si se ponen rojos, alguien fusionó el criterio de intento con el anclaje.** Es la trampa que el
  diseño de la pila nombra explícitamente.
- `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts` · `tests/unit/guards/dinero-sin-centimos.guardia.test.ts`
  — money-safe (R11).
- `tests/unit/repositories/gestion-ubicacion-solo-escritura.guardia.test.ts` — esta ficha **no nombra**
  las columnas de ubicación (R18); si se pone roja, alguien las escribió.
- `tests/unit/types/webhook-eventos.test.ts` — la lista de exclusión se fija por igualdad; un rojo
  significa que alguien exceptuó la familia nueva (R46).
- `tests/unit/guards/novedad-acciones-una-tabla.guardia.test.ts` — si se pone roja, la decisión de qué
  botón se ofrece volvió a salirse de la tabla.
- `tests/unit/guards/hilo-ventana-alcanzable.guardia.test.ts` · `tests/unit/services/habilitar-novedad-service.test.ts`
  · `tests/components/RepartoAyuda.test.tsx` — la ventana del hilo, el rescate y el portal del mensajero
  **no cambian** (R49).
- `tests/unit/repositories/orden-repository.novedades.test.ts` — el predicado de `/novedades` no cambia:
  esta ficha no añade ni retira estados de la pantalla.

---

## 15. Riesgos

1. **Un rechazo de la tienda es dinero irreversible si D3 se firma como (b).** Mitigación: el aviso fijo
   de D7 dice el precio **antes**, y el bloqueo del envío exige foto y motivo. La medición T0.3 pone el
   número encima de la mesa antes de firmar.
2. **La invariante de §1.2 en producción.** Si las rutas exentas resultan frecuentes (T0.2), «entra en
   su cierre» se lee como una promesa incumplida por parte de quien opera. Mitigación: R32 con su test,
   y la consecuencia escrita en la ficha.
3. **La ventana del 238 crece y puede bloquear un cierre.** Una gestión de la tienda añade un paquete
   que hay que escanear; si no aparece, el cierre entero se rechaza (D2 de la 238, sin escapatoria).
   Mitigación: es el comportamiento correcto y se recorre en T9.
4. **La extracción de §5 toca un camino money-critical vivo** (`MisAsignacionesService.gestionar`).
   Mitigación: la conducta observable no cambia y la tanda lleva mutación propia (T8.3).
5. **`ORIGEN_TIPOS_VISITA_REAL` es la lista que cobra dinero.** Cambiarla es lo más delicado del PR;
   dos tests la fijan por igualdad **a propósito**. Mitigación: se actualizan a mano, con nota fechada, y
   T8.1 mata la mutación de quitarla.
6. **Esta ficha y la 240 escriben sobre los mismos archivos.** `ACCIONES_POR_GRUPO`, `NovedadAcciones`,
   `NovedadesModule` y `HabilitarNovedadResult`. **No van en paralelo** (`tasks.md` §Paralelismo).
7. **El pre-vuelo caduca:** comparar el SHA medido contra `origin/dev` **justo antes** de abrir el PR.

---

## 16. Consultas de verificación (solo lectura, MCP)

```sql
-- M1 (T0.1) — poblacion viva por estatus. Denominador incluido: un cero sin denominador no dice nada.
SELECT os."value" AS estatus, count(*) AS n
FROM "orden" o JOIN "order_status" os ON os."id" = o."estatus_id"
WHERE o."deleted_at" IS NULL
GROUP BY os."value" ORDER BY n DESC;
```

```sql
-- M2 (T0.2) — LA CONSULTA QUE DECIDE D1. Poblacion de cierres por estado (de `vencido`/`rechazado`
-- sale la ruta exenta) y cuantos pasaron por `rechazado -> solicitado` (la re-solicitud NO limpia
-- `motivo_rechazo`, asi que un cierre `solicitado`/`aprobado` con motivo escrito paso por ahi).
SELECT "estado", count(*) AS n
FROM "cierre_dia" GROUP BY "estado" ORDER BY n DESC;

SELECT count(*) AS resolicitados_tras_rechazo
FROM "cierre_dia"
WHERE "estado" IN ('solicitado','aprobado') AND "motivo_rechazo" IS NOT NULL;
```

```sql
-- M3 (T0.3) — cuanto dinero mueve UN rechazo. Es el importe que la tienda se cobra a si misma
-- con un click desde la card de ayuda.
SELECT min("cobro_rechazado") AS min, max("cobro_rechazado") AS max,
       round(avg("cobro_rechazado"), 2) AS media, count(*) AS tarifas
FROM "tarifa_zona_mensajero";
```

```sql
-- M4 (T0.4) — cuanto se deshace hoy (dimensiona D3) y cuantas gestiones esperan al cierre siguiente.
SELECT count(*) FILTER (WHERE "anulada_at" IS NOT NULL)                                AS anuladas,
       count(*)                                                                        AS gestiones_total,
       count(*) FILTER (WHERE "cierre_id" IS NULL AND "anulada_at" IS NULL)            AS sin_cierre,
       count(*) FILTER (WHERE "cierre_id" IS NULL AND "anulada_at" IS NULL
                          AND "created_at" < now() - interval '24 hours')               AS sin_cierre_mas_24h
FROM "gestion_orden";
```

---

## 17. Documentación que esta feature deja al día

- `progress/design_pila_ayuda_tienda.md` §F3 → anotar el aterrizaje con fecha y PR, **y corregir la
  frase de la invariante**: no es «`deshacerGestion` funciona porque la ayuda bloquea el cierre», son
  dos hechos distintos y uno tiene dos excepciones (§1). Anotar también la ADVERTENCIA HEREDADA como
  **resuelta por R32/D1**.
- `progress/auditoria_ayuda_tienda.md` §4 → cae «la gestión de la tienda que cuenta como del
  mensajero», la última ausencia de las nueve que quedaba junto al desenlace de las no gestionadas.
- `lib/types/order-status-transiciones.ts:283-291` → el bloque «LO QUE **NO** SE DECLARA» deja de ser
  cierto para dos de las cinco. Se reescribe conservando qué decía y por qué las otras tres siguen sin
  declararse.
- `lib/types/orden-historial.ts:76-78` → la nota «`gestion_tienda_ayuda` NO se declara aquí» se
  sustituye por el valor y su razón de entrar en `ORIGEN_TIPOS_VISITA_REAL` **con el argumento de §7.3**
  (por qué sí, si `reprogramacion_tienda` no).
- `app/(app)/novedades/_components/novedad-acciones-catalogo.ts:58-61` → el comentario «`reprogramar` y
  `rechazar` NO están en `ayuda`… Gestionar DESDE ayuda es la ficha 237».
- `lib/notificaciones/emitir.ts:130-137` → si D4 se firma como (a), anotar **ahí** que la familia nueva
  queda fuera **a propósito** y por qué, para que la ausencia sea decisión y no olvido.

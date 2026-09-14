# 425 — Salida del rechazo de tienda por el cierre · Diseño

> Requisitos: `specs/425-salida-rechazo-tienda/requirements.md`.
> Decisiones humanas vinculantes: `progress/decisiones_425.md` (D1/D2/D3).
> Todo lo que aquí se afirma del código está leído en el árbol de `dev` el 2026-09-14, con archivo y
> línea. Lo que no está medido se dice que no lo está.
>
> **APROBADO por Carlos Restrepo el 2026-09-14**, con la lectura de D1 confirmada (§3) y la forma de
> pantalla de §5.4 validada. **Sin preguntas abiertas.** La sonda de bloqueo previo (`M5`) está
> ejecutada contra producción: §1.1.

---

## 1. El mapa de lo que ya existe (y que este diseño no puede romper)

| Pieza | Dónde | Qué hace hoy |
| --- | --- | --- |
| `gestionesDelCierreWhere(mensajeroId)` | `lib/repositories/CierreDiaRepository.ts:410-417` | Las **4 condiciones** de pertenencia al cierre: mensajero, `cierre_id IS NULL`, `anulada_at IS NULL` y (337) `historialEstados: { none: origenTipo ∈ ORIGENES_GESTION_FUERA_DEL_CIERRE }`. Lo consumen la **lectura** (`findGestionesPendientes:518`) y la **escritura** (`crearCierre:857`). |
| `ORIGENES_GESTION_FUERA_DEL_CIERRE` | `lib/types/orden-historial.ts:399-407` | `["rechazo_tienda", "reprogramacion_tienda"]`. |
| Guarda «algo pasó» | `CierreDiaRepository.ts:870-872` | `vinculadas.count === 0 && sinGestionarTransicionadas === 0` → `SinGestionesVinculadas` → **rollback** → `crearCierre` devuelve `null`. **Es el nudo del atasco.** |
| Devolución de `rechazada` (139) | `CierresAdminRepository.ts:2088-2139` | Al **aprobar**, busca las órdenes `rechazada` **por `mensajero_asignado_id` del cierre** (no por sus gestiones) y las manda a `por_devolver_a_tienda` / `por_devolver` con `resolverDestinoCierre`. |
| Pago al mensajero | `lib/utils/pago-mensajero.ts:13-23` | `pagoPorResultado`: **solo `entregada` paga**; `rechazada` → `"0.00"`. |
| Ingreso de bodega | `lib/utils/ingreso-bodega.ts:18-27` | `ingresoBodegaPorResultado`: **solo `rechazada`** genera `cobroRechazado` (₡164 medidos). |
| Caja de Ordenex al aprobar | `lib/services/WalletFeedService.ts:32-78` | Lee `gestionOrden.findMany({ where: { cierreId } })` y llama a `derivarIngresoOrden` por gestión. |
| Cobro a la tienda al aprobar | `lib/services/WalletTiendaFeedService.ts` (vía `CierresAdminRepository.ts:1804`) | Espejo del anterior, por tienda. |
| `derivarIngresoOrden` | `lib/utils/ingreso-ordenex.ts:182-188` | Con `resultado = "rechazada"` emite **`ingreso_flete_devolucion` + `ingreso_iva_flete_devolucion`**. |
| Vía propia del cobro (337, 2.ª mitad) | `lib/interfaces/services/IRechazoTiendaCobroService.ts:53-67` | Al aprobar el `rechazo_tienda_cobro` emite **exactamente los mismos cuatro apuntes**, con `origen = (gestion_orden, gestionId)`. |
| Confirmación física (238) | `CierresAdminService.ts:1182-1251` + `CierresAdminRepository.ts:983-1001` | Exige escanear **toda** gestión del cierre con `resultado ∈ {devuelta, rechazada, reprogramada}`. **Sin puerta de escape**: falta una y el cierre entero se devuelve. |
| Precedente exacto de «material del cierre sin dinero» | `cierre_sin_gestion` (264): `db/schema.prisma:2388-2423`, `db/migrations/20260822120000_cierre_sin_gestion/` | Tabla de vínculo con descriptivos congelados, **ni una columna de importe**, RLS sin policies, grano `(cierre_id, orden_id)`. |
| Guardia de superficies | `tests/unit/guards/cierre-detalle-superficies.guardia.test.ts` | Toda superficie que renderice `<CierreFacturaDetalle>` pasa `ordenesSinGestion` y `sinGestionRegistrado`. |

### 1.1 Por qué la orden se queda sin salida (la cadena completa, no la versión corta)

La 139 **no** libera por las gestiones del cierre: libera por `mensajero_asignado_id` (2097-2104). Y
`rechazarDesdeDevuelta` **no toca** `mensajero_asignado_id` a propósito
(`GestionOrdenRepository.ts:806-808`, con ese motivo escrito). Así que a un mensajero que sigue
trabajando, su siguiente cierre aprobado **sí** le libera la orden.

El atasco aparece cuando el mensajero **no llega a tener cierre**: si sus únicas gestiones sueltas son
de escritorio, `gestionesDelCierreWhere` las excluye, `vinculadas.count` es 0, la guarda «algo pasó»
hace rollback y `crearCierre` devuelve `null` —el «caso Andy Cortes» que la 337 introdujo a
propósito—. Sin cierre no hay aprobación, y sin aprobación no hay salida. Cuadra con lo medido: los
3 rechazos de Arnel Guillen (todos del 2026-09-10) y 3 órdenes atascadas.

> ✅ **MEDIDO contra producción el 2026-09-14 por el humano — no es una deducción de leer el código.**
> Era la sonda obligada («la sonda que mide otro bloqueo»): si alguna de las 3 tuviera
> `mensajero_asignado_id` nulo o de otro mensajero, este arreglo **no la destrabaría**. Las tres lo
> conservan y **las tres son del mismo mensajero, Arnel Guillen Arce**:
>
> | Remisión | Guía |
> | --- | --- |
> | NA-947 | 19301246 |
> | NA-981 | 58980454 |
> | NA-1103 | 85696637 |
>
> O sea: las 3 órdenes atascadas **son** exactamente los 3 rechazos de Arnel de la tabla de §6, y el
> bloque 139 las libera en cuanto su cierre exista y se apruebe. El arreglo de §3 es suficiente.
>
> ⚠️ **No cruzar esto con la reasignación manual del 2026-09-14.** Ese día el humano pasó **31
> órdenes de Andy Cortés a Carlos Eduardo**, pero eran **`en_reparto`, no `rechazada`**: no tocan a
> estas tres ni a ningún rechazo de tienda. Quien audite las dos cosas juntas puede creer que un
> cambio de mensajero explica el atasco, y no es así.

---

## 2. La tensión, con el precio de cada lado medido

| | Qué exige | Qué cuesta ignorarlo |
| --- | --- | --- |
| **Operación** (D1) | El rechazo entra al cierre: ahí se ve y alguien separa el paquete | 3 órdenes sin salida hoy, y una más por cada rechazo futuro |
| **Dinero** (motivo de la 337) | No puede sumar al pago del mensajero | Firma un documento de trabajo que no hizo |
| **Dinero (2)** — *descubierto al leer el código, no estaba en la ficha* | No puede volver a cobrarle el flete de devolución a la tienda | La 337 ya le dio vía propia: **24 cobros aprobados, ₡65.088**. Un segundo apunte por el mismo rechazo es **doble cobro**, y el índice de idempotencia **no lo impide** (los orígenes son distintos: `gestion_orden` vs `cierre_dia`) |
| **Operación (2)** — *ídem* | No puede exigir escanear paquetes que no vienen con el mensajero | La confirmación física no tiene puerta de escape: 19 paquetes de tres semanas atrás en un solo cierre de Carlos Cambronero |

La tensión no se resuelve eligiendo un lado: se resuelve **separando pertenencia de facturación**.

---

## 3. Decisión: el rechazo entra como **vínculo de revisión**, no como gestión facturable

La gestión **no** recibe `cierre_id`. En su lugar, la transacción que crea el cierre escribe una fila
en una tabla nueva, `cierre_rechazo_tienda`, con el grano `(cierre_id, gestion_id)` y **sin ninguna
columna de importe**.

**Por qué esto cumple D1 — y está confirmado, no interpretado.** El rechazo aparece **en el documento
del cierre**, en las tres superficies, con guía y fecha; y la **aprobación de ese cierre** es lo que
libera la orden (R11), sin acción manual de nadie (R13). El humano validó esta lectura el 2026-09-14
sobre la forma de §5.4: se ve, se separa el paquete, se destraba al aprobar, **y no entra en el
cálculo del dinero**. Las dos alternativas que descartó —colgarlo del cobro y una acción del admin—
siguen descartadas: aquí no hay más botón que «Aprobar cierre».

**Por qué esto resuelve la tensión, y por construcción.** `gestion_orden.cierre_id` es la **única**
llave que abre los cinco caminos de dinero, y todos preguntan literalmente `where: { cierreId }`:

1. `WalletFeedService:41-44` (caja de Ordenex),
2. `WalletTiendaFeedService` (libro de la tienda),
3. `WalletMensajeroFeedService` (libro de pago del mensajero),
4. `crearCierre:876-903` (congelado de `pago_mensajero` e `ingreso_bodega_rechazo`),
5. `findGestionesRetornablesDelCierre:987-995` (confirmación física).

Dejar el `cierre_id` en `NULL` cierra los cinco **a la vez** y sin tocar ni una línea de aritmética.
`R6`, `R7`, `R8`, `R9` y `R10` no dependen de que alguien se acuerde: dependen de que no exista el
dato por el que preguntan. Y la tabla nueva no tiene dónde guardar un importe —el mismo argumento,
palabra por palabra, que escribió la 264 en `20260822120000_cierre_sin_gestion/migration.sql:15-18`—.

---

## 4. Modelo de datos

### 4.1 Tabla nueva `cierre_rechazo_tienda`

Molde literal: `cierre_sin_gestion` (264). Fila **inmutable**: sin `updated_at`, sin `deleted_at`.

```prisma
model CierreRechazoTienda {
  id        String @id @default(uuid())
  cierreId  String @map("cierre_id")
  gestionId String @map("gestion_id")
  ordenId   String @map("orden_id")

  // --- descriptivos CONGELADOS al incorporar. Copia, no identidad (69/T18). ---
  numGuia      Int?   @map("num_guia")   // SIN @unique: es copia
  numRemision  String @map("num_remision")
  destinatario String
  producto     String
  tiendaNombre String @map("tienda_nombre")
  zonaNombre   String @map("zona_nombre")

  // R15 — la EDAD, que es lo que evita que un documento con tres semanas parezca un error (D3).
  // Es `gestion_orden.created_at` de la gestión: cuándo la tienda rechazó.
  rechazadoAt DateTime @map("rechazado_at")
  // El motivo que la tienda escribió (obligatorio en `rechazarDesdeDevuelta`, 240/R12).
  motivo      String?

  createdAt DateTime @default(now()) @map("created_at")

  cierre  CierreDia    @relation(fields: [cierreId], references: [id])
  gestion GestionOrden @relation(fields: [gestionId], references: [id])
  orden   Orden        @relation(fields: [ordenId], references: [id])

  @@unique([gestionId])            // R3: una gestión pertenece a UN cierre y a ninguno más
  @@index([cierreId])              // ruta caliente: el detalle filtra por cierre
  @@index([ordenId])               // trazar en qué cierre se revisó una orden
  @@map("cierre_rechazo_tienda")
}
```

**Por qué el `UNIQUE` va en `gestion_id` y no en el par `(cierre_id, gestion_id)`.** El par permitiría
que dos cierres se llevaran la misma gestión (dos filas válidas), que es justo lo que `R3` prohíbe.
Con el único en `gestion_id`, «una sola vez, en toda la vida» lo impone Postgres, no un `if`. El
`skipDuplicates` de la escritura sigue haciendo su papel para `R4`.

**`gestion_id` y además `orden_id`.** `gestion_id` es la identidad y la clave de idempotencia (y es
la misma con la que `rechazo_tienda_cobro` indexa su cobro, `rechazo_tienda_cobro_gestion_uq`:
permite cruzar los dos mundos sin inventar una correspondencia). `orden_id` no es redundante para el
lector: es la columna por la que se pregunta «¿en qué cierre se revisó este paquete?» sin pasar por
la gestión, y es el mismo criterio que la 264.

### 4.2 Migración

`db/migrations/<timestamp>_cierre_rechazo_tienda/migration.sql` + `down.sql` (obligatorio).

- `CREATE TABLE` + el `UNIQUE` + los dos índices + las **3 FKs** como `ALTER TABLE` aparte, todas
  `ON DELETE RESTRICT ON UPDATE CASCADE` (molde `cierre_sin_gestion`, pasos 1-3).
- `ALTER TABLE "cierre_rechazo_tienda" ENABLE ROW LEVEL SECURITY;` **sin policies** (R21): el acceso
  es por service role vía Prisma; la tabla lleva destinatario y guía, o sea PII.
- **SIN backfill, y es una decisión.** Los cierres ya existentes no se llevaron ningún rechazo —no
  existía el mecanismo—, así que una lista vacía en un cierre viejo es un hecho **cierto**, no un
  «no se sabe». Por eso este diseño **no** necesita la columna-marca `…_registrado` que la 264 sí
  necesitó (allí el dato existía y se había destruido; aquí nunca existió).
- `down.sql`: `DROP TABLE IF EXISTS "cierre_rechazo_tienda";` y nada más. No hay columna añadida a
  ninguna tabla previa, así que el DOWN no puede perder dato ajeno. **No se toca ningún `down.sql`
  anterior** (son fotos históricas) y no hay enum nuevo.

### 4.3 Lo que NO se toca

- `ORIGENES_GESTION_FUERA_DEL_CIERRE` (`lib/types/orden-historial.ts:399`) **se queda igual, con sus
  dos valores**. Es la lista que decide quién recibe `cierre_id`, o sea, quién factura. `rechazo_tienda`
  tiene que seguir fuera de ella: sacarlo de ahí es exactamente la alternativa descartada (§7).
- `ORIGENES_GESTION_DE_LA_TIENDA`, `ORIGEN_TIPOS_VISITA_REAL`, `derivarPagos`,
  `derivarIngresoBodega`, `computeTotales`, `derivarIngresoOrden`, los tres feeds de wallet, la
  confirmación física y el bloque 139: **ni una línea**.
- `gestion_orden`: ninguna columna nueva. (Ver §7, alternativa B.)

---

## 5. Cambios en el código

### 5.1 Repositorio — `lib/repositories/CierreDiaRepository.ts`

**(a) Predicado nuevo, hermano del de la 337 y declarado una sola vez:**

```ts
/** Los rechazos de ESCRITORIO que este cierre tiene que PONER DELANTE (no cobrar). */
function rechazosDeTiendaDelCierreWhere(mensajeroId: string): Prisma.GestionOrdenWhereInput {
  return {
    mensajeroId,
    cierreId: null,                 // nunca una que ya pertenece a un cierre facturable
    anuladaAt: null,                // 67/R16: una gestión deshecha no se revisa ni se cobra
    resultado: "rechazada",         // D2: la reprogramación NO, y aquí hay dos cerrojos
    historialEstados: { some: { origenTipo: "rechazo_tienda" } },
    vinculoRechazoTienda: { is: null }, // R3: ningún cierre anterior se la llevó
  };
}
```

Los **dos cerrojos para D2** (`resultado: "rechazada"` y el `some` por la familia exacta) son
deliberados: una `reprogramacion_tienda` falla los dos, así que hace falta romper dos cosas a la vez
para que se cuele. `R17` se prueba contra Postgres, no por lectura.

**(b) Escritura, dentro de la MISMA `$transaction` de `crearCierre`** (`:857-872`), justo después del
`updateMany` que vincula y **antes** de la guarda «algo pasó»:

1. `findMany` con el predicado de (a), proyectando los descriptivos de la orden y el `created_at` y
   `motivo` de la gestión. Es un pre-`SELECT` como el del corte (`:738-759`) y por la misma razón:
   los descriptivos se congelan a partir de él.
2. `createMany({ data: […], skipDuplicates: true })` sobre `cierre_rechazo_tienda` (R2, R4).
3. La guarda pasa a ser
   `if (vinculadas.count === 0 && sinGestionarTransicionadas === 0 && rechazosIncorporados === 0) throw new SinGestionesVinculadas();`
   — **este es el cambio que destraba a Arnel** (R5), y es aditivo: un cierre que hoy se crea se
   sigue creando igual.

> **Carrera:** entre el `findMany` y el `createMany` otra transacción podría llevarse la misma
> gestión. El `UNIQUE(gestion_id)` + `skipDuplicates` la resuelve sin lanzar: el segundo cierre
> simplemente no la incorpora. Es la misma red que el `@@unique([cierreId, ordenId])` de la 264.

**(c) Lectura del detalle:** el método que hoy compone el detalle de un cierre ya creado (el que
alimenta `found.sinGestion`, consumido en `CierreDiaService.ts:425` y `CierresAdminService.ts:889`)
suma una lectura por `cierre_id` sobre la tabla nueva. Ordenada por `rechazado_at` ascendente: lo más
viejo primero, que es lo que hay que ir a buscar a la estantería.

### 5.2 Interfaces y contratos de E/S

`lib/interfaces/repositories/ICierreDiaRepository.ts` y
`lib/interfaces/services/{ICierreDiaService,ICierresAdminService}.ts`:

```ts
/** Un rechazo de tienda puesto delante de quien aprueba. NI UN IMPORTE: no es facturable. */
export interface CierreRechazoDeTienda {
  gestionId: string;
  ordenId: string;
  numGuia: number | null;      // null = la orden llegó sin guía; la fila lo OMITE, no pinta guion
  numRemision: string;
  destinatario: string;
  producto: string;
  tiendaNombre: string;
  zonaNombre: string;
  rechazadoAt: string;         // ISO, congelado. R15: la EDAD del rechazo
  motivo: string | null;
}
```

El DTO del detalle gana `rechazosDeTienda: CierreRechazoDeTienda[]` —**lista vacía**, nunca `null`:
aquí «ninguno» y «no consta» son lo mismo (§4.2)—. **Ningún campo de importe**, ni siquiera `"0.00"`:
un cero invita a sumarlo.

### 5.3 Rutas, endpoints y acciones

**Ninguna ruta nueva, ningún endpoint nuevo, ninguna Server Action nueva.** Los tres consumos ya
existen y solo cambian de contenido:

| Superficie | Archivo | Qué cambia |
| --- | --- | --- |
| Detalle del admin (`/cierres-admin`) | `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` | Pasa `rechazosDeTienda` a `<CierreFacturaDetalle>` |
| Detalle del mensajero (`/cierre-dia`) | `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` | Ídem, en el comprobante de un cierre pasado |
| Comprobante | `app/(app)/cierres-admin/_components/cierre-factura.tsx` | Declara la prop y pinta la sección |

La **vista en vivo** del mensajero (`listarCierreDia`, `CierreDiaService.ts:263-353`) **no cambia**:
los rechazos no son suyos y no puede hacer nada con ellos (Q2, cerrada en requirements §5).

### 5.4 Presentación (R14/R15/R16) — **forma aprobada por el humano el 2026-09-14**

```
CIERRE DEL DIA - Arnel Guillen
  Gestiones del mensajero......  17   (paga)
  RECHAZADOS POR LA TIENDA.....   3   (revisar)
    NA-947, NA-981, NA-1103  -> separar para devolucion
  Al aprobar: las 3 pasan a 'por devolver a tienda'
```

Los **dos conteos, uno al lado del otro, con su etiqueta de qué hace cada uno** («paga» / «revisar»)
son el corazón de lo aprobado: es lo que hace legible de un vistazo que la segunda lista no es
trabajo del mensajero ni dinero. Sección propia, separada de los cuatro grupos de gestiones y del
bloque de `sin_gestionar`, con:

- rótulo: **«Rechazados por la tienda»**, con «separar para devolución» y la frase de efecto «al
  aprobar pasan a *por devolver a tienda*» (en zona satélite, *por devolver*);
- una línea fija: «No son gestiones del mensajero y no suman a su pago.»;
- por fila: guía · remisión · destinatario · producto · tienda · **fecha del rechazo**, y el motivo;
- **sin ninguna columna de importe** y **sin casilla de confirmación física** (`R10`): la casilla vive
  en `cierre-confirmacion-fisica.tsx` y se alimenta de `RESULTADOS_QUE_VUELVEN` sobre las gestiones
  **del cierre**, así que esta sección queda fuera por construcción, no por una excepción escrita.

### 5.5 Integraciones

Ninguna. No toca Supabase Auth, ni Meta, ni Shopify, ni WhatsApp/Telegram. Notificaciones: **no** se
añade ningún aviso nuevo; el de «cierre por aprobar» (146/271) ya se emite y su texto no cambia.

---

## 6. Qué verá cada quien el día del despliegue (D3, y hay que avisarlo ANTES)

Con el arreglo vivo, cada uno de estos 6 mensajeros arrastra a su **siguiente** cierre los rechazos
acumulados. Medido el 2026-09-14 (`progress/decisiones_425.md`); hay que **re-medirlo el día del
despliegue** (`M7`), porque el conjunto se mueve:

| Mensajero | Rechazos que aparecerán | Más antiguo | Más reciente |
| --- | ---: | --- | --- |
| Carlos Cambronero Cambronero | 19 | 2026-08-28 | 2026-09-10 |
| Andres Aguero Aguero | 7 | 2026-08-28 | 2026-09-03 |
| Andy Cortes Cortes | 7 | 2026-08-28 | 2026-09-03 |
| Kendall Hernandez Hernandez | 6 | 2026-08-28 | 2026-09-01 |
| Johel Hernandez Hernández | 4 | 2026-08-28 | 2026-09-10 |
| Arnel Guillen Arce | 3 | 2026-09-10 | 2026-09-10 |
| **Total** | **46** | | |

Los **3 de Arnel son exactamente las 3 órdenes atascadas** (NA-947, NA-981, NA-1103; medido el
2026-09-14, §1.1): su cierre es el que hoy no llega a existir, y por eso es el primero que hay que
mirar tras desplegar.

**Esto es lo esperado, no un error.** Quien aprueba verá un documento con hasta 19 paquetes de hasta
tres semanas atrás en la sección nueva. Lo que tiene que hacer con ellos es **ir a la estantería,
separarlos y devolverlos a la tienda**; la fecha de cada fila está precisamente para que se entienda
por qué son viejos. No tiene que escanearlos (`R10`) ni cuadrar ningún importe: los totales del cierre
no los incluyen.

**Dos consecuencias más que hay que decir en el mismo aviso:**

- A algún mensajero **le aparecerá un cierre que hoy no existía** (el caso Arnel: sus únicas gestiones
  sueltas son rechazos). Ese cierre nace con los **seis totales en 0,00** y es correcto: es un
  documento de revisión, no de dinero. Es el mismo tipo de cierre money-neutral que la 41/C1 ya
  admite para el corte.
- Un cierre abierto de más cuenta para el bloqueo por acumular (271, N ≥ 2). `M7` mide a cuántos les
  pasa **antes** de desplegar.

---

## 7. Alternativas descartadas

### 7.1 Alternativa A — quitar `rechazo_tienda` de `ORIGENES_GESTION_FUERA_DEL_CIERRE` (un solo valor de una lista)

Es el arreglo de una línea, y es el que primero se piensa: la gestión vuelve a recibir `cierre_id` y
todo lo demás funciona solo. **Descartada, con cuatro motivos medidos:**

1. **Doble cobro a la tienda.** Con `cierre_id`, `WalletFeedService` y `WalletTiendaFeedService`
   emiten `ingreso_flete_devolucion` + IVA por esa gestión (`ingreso-ordenex.ts:182-188`). La 337 ya
   emite **esos mismos cuatro apuntes** por su vía propia al aprobar el `rechazo_tienda_cobro`
   (`IRechazoTiendaCobroService.ts:60-63`). El índice único de idempotencia **no protege**: allí el
   origen es `(gestion_orden, gestionId)` y aquí sería `(cierre_dia, cierreId)`. Medido: **24 cobros
   ya aprobados, ₡65.088**. Se cobraría dos veces lo mismo.
2. **Cierre inaprobable.** `rechazada ∈ RESULTADOS_QUE_VUELVEN`, así que cada rechazo pasaría a exigir
   confirmación física **sin puerta de escape** (`CierresAdminService.ts:1177-1180`): 19 paquetes de
   tres semanas atrás que no vienen en la mano del mensajero. El atasco actual se cambiaría por otro
   peor: un cierre que no se puede aprobar.
3. **Cierra sola la pregunta que el humano quiere decidir después.** Al vincularse, `crearCierre`
   congelaría `ingreso_bodega_rechazo` de los 46 **con la tarifa de hoy**, no con la del día del
   rechazo. Es exactamente «tocar dinero histórico» sin que el humano lo haya visto (`R9`, Q5).
4. **Regresión de atribución.** Es el motivo por el que se escribió la 337: el mensajero firma un
   documento con trabajo que no hizo. Aquí el rechazo aparece en una sección aparte y rotulada.

Mitigar (1) y (2) sin `cierre_id` significaría enseñar la excepción a **cinco** consultas de dinero
distintas, cada una money-critical. Este diseño las deja intactas.

### 7.2 Alternativa B — columna `gestion_orden.cierre_revision_id` en vez de tabla nueva

Más barata (una columna aditiva, sin tabla). **Descartada:** sería un **segundo `cierre_id` viviendo
en la tabla del dinero**, y la única barrera contra que un feed futuro lo lea sería la disciplina de
quien lo escriba. Además obligaría a leer los descriptivos **vivos** (`gestion.orden.*`) al pintar un
cierre pasado, que es literalmente el error que la 69/T18 corrigió y que la 264 no quiso repetir. La
tabla sin columnas de importe hace que mover un total sea **imposible**, no improbable.

### 7.3 Alternativa C — derivar la lista en tiempo de lectura, sin persistir nada

Cero migraciones. **Descartada:** sin vínculo persistido la gestión **nunca se consume**, así que el
mismo rechazo aparecería en todos los cierres siguientes de ese mensajero —se mandaría a separar el
mismo paquete una y otra vez— y no quedaría rastro de en qué cierre se revisó. Es el mismo argumento
con el que la 264 sustituyó su predicado vivo.

### 7.4 Ya descartadas por el humano (no se reabren)

Colgar la salida de la aprobación del cobro de rechazo, y una acción manual del administrador (D1).
Se listan aquí solo para que nadie las vuelva a proponer creyendo que no se miraron.

---

## 8. Lo que hay que medir, con la consulta escrita

Todo **solo lectura** contra producción (vía el MCP de Supabase; `DATABASE_URL` de prod es
*sensitive*). El resultado se pega en `progress/impl_425.md`. Los `<...>` se resuelven al ejecutar.

**M5 — ¿es este el único bloqueo? ✅ EJECUTADA el 2026-09-14. Resultado: las 3 órdenes conservan su
`mensajero_asignado_id` y las 3 son de Arnel Guillen Arce (NA-947 / NA-981 / NA-1103; ver §1.1). No
hay un segundo bloqueo.** La consulta se conserva para poder repetirla si el conjunto cambia:

```sql
SELECT o.id, o.num_guia, o.mensajero_asignado_id, g.mensajero_id, o.deleted_at, z.es_central
  FROM orden o
  JOIN order_status s ON s.id = o.estatus_id AND s.value = 'rechazada'
  JOIN zona z ON z.id = o.zona_id
  LEFT JOIN LATERAL (
    SELECT gg.mensajero_id FROM gestion_orden gg
     WHERE gg.orden_id = o.id AND gg.anulada_at IS NULL
     ORDER BY gg.created_at DESC LIMIT 1) g ON TRUE
 WHERE o.deleted_at IS NULL;
```
*Criterio:* las 3 filas con `mensajero_asignado_id` no nulo **e igual** a `g.mensajero_id`. Cualquier
otra cosa → parar y volver al humano. **Cumplido: 3 de 3, mismo mensajero.**

**M1/M2 — totales de un cierre real, antes y después.** *Antes* (hoy, prod): los seis totales del
último cierre **aprobado** de cada uno de los 6 mensajeros, más el `SUM(pago_mensajero)` de sus
gestiones. *Después* (prod, tras desplegar, sobre el primer cierre que incorpore rechazos): los mismos
seis totales, más `SELECT count(*) FROM cierre_rechazo_tienda WHERE cierre_id = <id>` y

```sql
SELECT count(*) FROM gestion_orden g
  JOIN cierre_rechazo_tienda v ON v.gestion_id = g.id
 WHERE v.cierre_id = <id> AND (g.cierre_id IS NOT NULL OR g.ingreso_bodega_rechazo IS NOT NULL
                               OR g.pago_mensajero IS NOT NULL);
```
*Criterio:* `total_pago_mensajero` = `SUM(pago_mensajero)` de las gestiones **con `cierre_id`**, y la
segunda consulta devuelve **0**. Si no, revertir (§9).

**M6 — la tienda ya pagó:**

```sql
SELECT c.estado, count(*) FROM rechazo_tienda_cobro c
  JOIN gestion_orden g ON g.id = c.gestion_id
 WHERE g.cierre_id IS NULL AND g.resultado = 'rechazada'
 GROUP BY c.estado;
```

**M7 — desglose a avisar + bloqueo.** Re-medir la tabla de §6 el día del despliegue, y

```sql
SELECT mensajero_id, count(*) FROM cierre_dia
 WHERE estado IN ('solicitado','vencido','rechazado') GROUP BY mensajero_id;
```
para decir a quién le dejaría en N ≥ 2 el cierre nuevo.

**M3/M4** se miden **contra Postgres en los tests** (`tasks.md`), no en producción: son un `WHERE` y
una transición, y aquí un test con dobles no prueba nada.

---

## 9. Riesgos y vuelta atrás

| Riesgo | Mitigación |
| --- | --- |
| El arreglo no destraba las 3 órdenes porque el bloqueo era otro | **Descartado con medida**: `M5` ejecutada el 2026-09-14, las 3 conservan mensajero y son de Arnel (§1.1) |
| Un documento con 19 filas viejas parece un error | Aviso previo (D3, §6) + fecha en cada fila |
| Un mensajero queda bloqueado por el cierre nuevo | `M7` lo dice antes; la salida ya existe (aprobar el más viejo) |
| Regresión silenciosa en el `WHERE` | Los tests de pertenencia corren **contra Postgres real**, y se les aplica contraprueba por mutación |
| Hay que revertir | El código se revierte sin migración inversa (la tabla vacía no molesta); si hay que bajar el esquema, `down.sql` es un `DROP TABLE` y **ningún dato previo depende de él**. Ningún apunte de dinero se emitió, así que no hay nada que compensar |

Gate: el diff toca `db/schema.prisma` y una migración, así que **`./init.sh` completo es obligatorio**
—el modo rápido se niega solo—. Y la base local es compartida entre worktrees: aplicar la migración
puede poner rojo el gate de otras fichas; avisar antes de migrar.

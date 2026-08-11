# Feature 193 — Diseño

## 1. Qué se añade y qué se reutiliza

**Se reutiliza sin tocar** (esto es la mitad del trabajo, y ya está hecho):

| Pieza | Dónde | Qué aporta |
|---|---|---|
| `ubicacionSchema` | `lib/types/ruta-mensajero.ts:19` | rangos `[-90,90]`/`[-180,180]`, ya validados en el borde |
| lectura de `FormData` | `lib/actions/mis-asignaciones.ts:222-225` | recompone `{lat,lng}` **solo si vienen los dos** |
| `ubicacion` en las 5 ramas | `lib/types/gestion-orden.ts:148-196` | el campo ya es transversal |
| `registrarUbicacion` | `MisAsignacionesService.ts:93-106` | origen `gps` de la ruta; **se conserva** (R25) |

**Se añade:**

1. Tres columnas en `gestion_orden` + un enum nativo para el motivo.
2. El endurecimiento del borde: de `ubicacion` opcional a «coordenadas **o** motivo».
3. La captura en el front, en el único punto por el que pasan las cinco ramas.

---

## 2. Modelo de datos

Columnas nuevas en `gestion_orden`, todas nullable (R2):

- `ubicacion_lat` · `Decimal(10,7)` — R4, el mismo tipo que `geocode_cache.latitud`
  (`schema.prisma:1662`) y `ruta_optimizada.origen_lat` (`:1694`).
- `ubicacion_lng` · `Decimal(10,7)`
- `ubicacion_ausencia` · enum nativo `gestion_ubicacion_ausencia`

> **Por qué `Decimal(10,7)` y no `Float`.** La feature 121 guardó las coords de WhatsApp
> como `Float` (`schema.prisma:274-275`) y conviven dos criterios en el schema. Para
> geolocalización **propia** manda el decimal de precisión fija: 7 decimales ≈ 1 cm, y no
> arrastra el error de representación binaria en un dato que puede acabar en una disputa
> laboral. El precedente de la 121 es de un payload ajeno que se copia tal cual; este no.

Enum nativo (patrón `JobEstado`/`RutaEstado`: vocabulario propio y cerrado):

```
enum GestionUbicacionAusencia {
  timeout            // la captura agotó el tiempo máximo
  no_disponible      // el dispositivo no pudo fijar posición (sin señal)
  no_soportado       // el navegador no expone geolocalización
  contexto_inseguro  // sin HTTPS: la API no está disponible
  @@map("gestion_ubicacion_ausencia")
}
```

**La denegación NO es un valor de este enum, y eso es el mecanismo de R12**, no un olvido.
Al no existir el valor, una gestión denegada no se puede representar y el rechazo es
estructural: no depende de que alguien se acuerde de comprobarlo. Si un día se decide
aceptarla, añadir el valor es el cambio consciente que obliga a revisar R19.

**Coherencia (R6).** Las tres columnas admiten exactamente dos formas válidas:
`(lat, lng, NULL)` o `(NULL, NULL, motivo)`. Se afirma en el borde con zod, **sin `CHECK`
en la base**, igual que `causa_devolucion` (73/F1.4-b) y `causa_incidente` (158). El motivo
de no poner el CHECK no es pereza: la base la escribe un único repositorio y el borde ya
rechaza; un CHECK duplicaría la verdad y rompería las filas históricas de R3.

**Migración.** `db/migrations/<timestamp>_gestion_orden_ubicacion/` con `migration.sql` y
`down.sql` (el gate lo exige). Solo `CREATE TYPE` + `ALTER TABLE ADD COLUMN` nullable: no
reescribe la tabla ni bloquea, y **no toca ni una fila existente** (R3). El `down.sql`
suelta las tres columnas y el tipo.

**Privacidad (R7).** `gestion_orden` ya vive tras el service role y no se expone al cliente;
las columnas nuevas heredan esa postura. Nacen de **solo escritura**: ningún repositorio de
lectura las proyecta en este ciclo. El reviewer debe leer eso como el estado esperado, no
como código muerto — igual que se declaró para `causa_devolucion`.

---

## 3. Borde (zod)

En `lib/types/gestion-orden.ts`, el campo `ubicacion: ubicacionSchema.optional()` de las
cinco ramas pasa a un objeto compartido que expresa la disyunción:

- con `ubicacion` presente y `ubicacionAusencia` ausente → válido (R8)
- con `ubicacion` ausente y `ubicacionAusencia` en la lista cerrada → válido (R9)
- con las dos ausentes → error (R10)
- con las dos presentes → error (R11)
- motivo fuera de la lista (incluida la denegación) → error (R12)

Se declara **una vez** y se aplica a las cinco ramas por composición (R14). Declararlo cinco
veces es como divergen: la 92 ya dejó escrito ese razonamiento al sacar `ubicacionSchema` a
su propio archivo.

`recogerSchema` y `sincronizarRutaSchema` **no se tocan** (R15).

---

## 4. Frontend

Toda la captura entra por **un solo sitio**: `GestionarOrdenPanel.tsx`, que es por donde
pasan las cinco ramas. `buildFormData()` (`:349`) arma el envío y `gestionar(...)` (`:425`)
lo dispara.

Un helper nuevo `capturarUbicacion()` envuelve `navigator.geolocation.getCurrentPosition`
y **nunca lanza**: devuelve o coordenadas, o un motivo, o la señal de denegación.

```
capturarUbicacion(): Promise<
  | { estado: "ok"; lat: number; lng: number }
  | { estado: "ausente"; motivo: GestionUbicacionAusencia }
  | { estado: "denegado" }
>
```

El mapeo a los motivos sale de `GeolocationPositionError`: `PERMISSION_DENIED` → `denegado`
(R19), `TIMEOUT` → `timeout`, `POSITION_UNAVAILABLE` → `no_disponible`. Sin
`navigator.geolocation` → `no_soportado`; sin contexto seguro (`window.isSecureContext`
falso) → `contexto_inseguro`, comprobado **antes** de llamar para no gastar un intento que
la plataforma ya sabe que va a fallar.

El `timeout` de R20 se declara en una constante junto al helper, no esparcido.

Secuencia al confirmar (R16): se llama a `capturarUbicacion()` **antes** de `buildFormData()`;
`ok` y `ausente` añaden sus campos al `FormData` y siguen (R17/R18); `denegado` corta y
muestra el aviso con las instrucciones de reactivación (R19), sin llamar a la acción.

Mientras corre, el CTA queda en estado ocupado con texto propio (R21) — la misma guarda
que ya impide el doble envío. Nada pide el permiso al abrir el panel (R22).

> **Coste de R19 que hay que pintar bien.** Un mensajero que denegó el permiso **no puede
> cerrar entregas**, y eso traba su cierre del día, que es dinero. El aviso tiene que decir
> dónde se reactiva (candado de la barra de direcciones / ajustes del sitio), no solo que
> falta. Es la diferencia entre un bloqueo con salida y una llamada a soporte.

---

## 5. Riesgos declarados

1. **R19 invierte parcialmente la R25 de la feature 92.** La R25 sigue rigiendo para
   `sincronizarRuta` y `recoger`; aquí se acota a la gestión, por decisión humana del
   2026-08-10. Queda escrito en los dos sitios para que nadie lo lea como una regresión.
2. **Cobertura parcial e inevitable.** Las gestiones con motivo de ausencia no tendrán
   ubicación. Cualquier informe futuro sobre estas columnas debe contar los `NULL`, no
   asumir que la ausencia es rara.
3. **Precisión sin garantía.** `getCurrentPosition` puede devolver una posición de red (por
   IP o wifi) con kilómetros de error, y no lo distingue de un GPS fino. Este ciclo **no**
   guarda `accuracy`; si el dato llega a usarse para juzgar a una persona, esa columna hace
   falta antes. Se deja anotado como puerta abierta, no como algo hecho.

---

## 6. Alcance explícitamente FUERA

- Mostrar la ubicación en cualquier pantalla (R7: solo escritura este ciclo).
- Backfill del histórico (R3).
- Guardar `accuracy` o el instante de la captura.
- Tocar el flujo de recoger o de sincronizar ruta (R15).

---

## 7. Archivos

| Archivo | Cambio |
|---|---|
| `db/schema.prisma` | 3 columnas en `GestionOrden` + enum `GestionUbicacionAusencia` |
| `db/migrations/<ts>_gestion_orden_ubicacion/{migration,down}.sql` | nuevo |
| `lib/types/gestion-orden.ts` | disyunción coordenadas/motivo en las 5 ramas |
| `lib/actions/mis-asignaciones.ts` | leer `ubicacionAusencia` del `FormData` |
| `lib/interfaces/repositories/IGestionOrdenRepository.ts` | campos nuevos en el input |
| `lib/repositories/GestionOrdenRepository.ts` | persistir las 3 columnas |
| `lib/services/MisAsignacionesService.ts` | pasar los campos; **conservar** `registrarUbicacion` |
| `lib/utils/capturar-ubicacion.ts` | helper nuevo del navegador |
| `app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx` | capturar antes de enviar |

---

## 8. Trazabilidad R → test

| Req | Test |
|---|---|
| R1, R4 | `tests/integration/db/gestion-orden-ubicacion-migration.test.ts` — columnas y tipo |
| R2 | ídem — ambas nullable, sin CHECK |
| R3 | ídem — fila preexistente queda en NULL tras migrar |
| R5 | ídem — enum con exactamente los 4 valores |
| R6 | `tests/unit/types/gestion-ubicacion-borde.test.ts` — media coordenada rechazada |
| R7 | `tests/unit/repositories/gestion-ubicacion-solo-escritura.guardia.test.ts` |
| R8–R13 | `tests/unit/types/gestion-ubicacion-borde.test.ts` — un caso por requisito |
| R12 | ídem — el valor de denegación no existe en el enum |
| R14 | ídem — tabla que recorre **las cinco ramas** con los mismos casos |
| R15 | `tests/unit/actions/mis-asignaciones-ubicacion.test.ts` — recoger/sincronizar sin cambio |
| R16, R22 | `tests/components/GestionarOrdenUbicacion.test.tsx` — se pide al confirmar, no al abrir |
| R17 | ídem — coords en el FormData |
| R18 | ídem — un caso por motivo técnico; la gestión se completa |
| R19 | ídem — denegado: no se llama a la acción y el aviso explica cómo reactivar |
| R20 | `tests/unit/utils/capturar-ubicacion.test.ts` — timeout → motivo |
| R21 | `tests/components/GestionarOrdenUbicacion.test.tsx` — ocupado + sin doble envío |
| R23 | `tests/unit/services/mis-asignaciones-gestion.test.ts` — efectos idénticos |
| R24 | `tests/unit/services/deshacer-asignacion-service.test.ts` — anular no borra la ubicación |
| R25 | `tests/unit/actions/mis-asignaciones-ubicacion.test.ts` — `registrarUbicacion` sigue corriendo |

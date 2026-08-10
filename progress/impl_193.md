# Feature 193 — implementación

> Ubicación del mensajero en cada gestión de orden. Spec en
> `specs/193-ubicacion-gestion-orden/` (25 requisitos EARS, mapa R→test en `design.md §8`).

## 1. Lo que ya existía, y por eso esta feature es más pequeña de lo que parece

La tubería de `ubicacion` estaba puesta **de punta a punta desde la feature 92** y nadie la
alimentaba al gestionar:

- `ubicacionSchema` con rangos geográficos — `lib/types/ruta-mensajero.ts:19`
- la Server Action ya recomponía `ubicacionLat`/`ubicacionLng` del `FormData`, y solo si venían
  los dos — `lib/actions/mis-asignaciones.ts:222-225`
- `ubicacion` ya era transversal a las cinco ramas — `lib/types/gestion-orden.ts`

El único `getCurrentPosition()` del repo vivía en `SincronizarRutaButton.tsx:37`, un botón
aparte. **Ningún formulario de gestión escribía esos campos**, y lo que llegaba se usaba solo
para sobrescribir el origen de `ruta_optimizada` (una fila por mensajero). No había rastro por
gestión.

## 2. Las tres decisiones humanas del 2026-08-10

1. **Nullable en la base + obligatorio en el borde.** No `NOT NULL`: exigiría backfill de las
   filas existentes y no hay coordenada cierta que inventar. Es además el patrón declarado del
   repo para todo campo por rama (36, 73, 158).
2. **La denegación bloquea; el fallo técnico no.** Denegar es una decisión reversible por la
   propia persona; quedarse sin señal en una bodega no lo es.
3. **Privacidad:** misma postura que `ruta_optimizada` y `geocode_cache`. Solo escritura este
   ciclo, con guardia.

## 3. La decisión de diseño que sostiene todo lo demás

**La denegación no existe como valor del enum `gestion_ubicacion_ausencia`**, ni en Postgres ni
en zod. Los cuatro valores son fallos técnicos: `timeout`, `no_disponible`, `no_soportado`,
`contexto_inseguro`.

Eso hace el bloqueo **estructural**: una gestión denegada no se puede representar, así que el
rechazo no depende de una comprobación que alguien pueda olvidar ni de que el front se porte
bien. Aunque se envíe `ubicacionAusencia=denegado` a mano por HTTP, el borde lo rechaza.

Hay dos guardias que protegen esa ausencia (`gestion-orden-ubicacion-migration.test.ts` y
`gestion-ubicacion-borde.test.ts`), porque añadir el valor «por completitud» tumbaría R19 sin
poner en rojo ningún otro test.

Corolario en el helper del navegador: **un código de error desconocido degrada a
`no_disponible`, nunca a `denegado`**. Ante un fallo que no sabemos leer, trabar al mensajero
sería el peor desenlace.

## 4. Lo que costó, y no estaba en el spec

**42 tests en 7 archivos se pusieron rojos**, ninguno por un defecto. Hablaban de evidencias,
causas de devolución e incidentes, y construían gestiones que eran válidas bajo el contrato
viejo. Se **ampliaron** con la ubicación en vez de relajarse, siguiendo el precedente que las
propias features 73 y 75 dejaron escrito en esos mismos archivos al endurecer esta rama
(`gestion-orden-schemas.test.ts:156-162`). Cada archivo lleva la nota de qué cambió.

En `mis-asignaciones-ubicacion.test.ts` conviven ahora dos bloques que dicen lo contrario: el
de `recoger` sigue afirmando que una ausencia no bloquea (R25 de la 92, intacta por R15) y el
de `gestionar` afirma que sí. **No es una incoherencia: es la frontera exacta del cambio**, y
está anotada como tal.

## 5. Hallazgo de infraestructura: drift de la base local

`prisma migrate status` destapó, antes de aplicar nada:

```
Última común:            20260808120000_orden_busqueda_producto
En la BASE, no en el repo: 20260728120000_orden_historial_origen_deshacer_asignacion
```

Con ese historial divergente **`pnpm db:migrate` (`migrate dev`) no habría aplicado: habría
propuesto RESETEAR la base local**. Por eso no se corrió. Se aplicó solo el SQL de esta
migración con `prisma db execute` y se registró con `migrate resolve --applied`.

⚠️ **De dónde salió esa migración fantasma sigue sin explicación.** O se aplicó a mano, o viene
de una rama que nunca se mergeó. No se tocó: no es de esta feature.

Antes de aplicarla, cualquier test contra base que tocara `gestion_orden` fallaba con `The
column (not available) does not exist` — Prisma devuelve todos los escalares en un `update()`,
así que el cliente pedía columnas que la base no tenía. No era un defecto: era el schema por
delante de la base.

## 6. Límites conocidos, declarados

- **No se guarda `accuracy`.** `getCurrentPosition` puede devolver una posición de red con
  kilómetros de error sin distinguirla de un GPS fino. Si este dato llega a usarse para juzgar
  a una persona («no estaba donde dijo»), esa columna hace falta **antes** de acumular
  histórico. Puerta abierta, no cosa hecha.
- **Cobertura parcial e inevitable.** Las gestiones con motivo de ausencia no tendrán
  ubicación. Cualquier informe sobre estas columnas debe contar los `NULL`.
- **El coste operativo de R19 es real.** Un mensajero que denegó el permiso no puede cerrar
  entregas hasta reactivarlo, y eso traba su cierre del día. Por eso el aviso dice dónde se
  reactiva.

## 7. Pendiente, y no lo puede cerrar un test

**Probarlo en un teléfono real con HTTPS, denegando el permiso a propósito**, y comprobar que
el texto del aviso coincide con lo que ese navegador enseña de verdad: en Chrome Android y en
Safari iOS ese ajuste no está en el mismo sitio. jsdom simula el permiso, no lo concede ni lo
deniega. Es el único punto de la feature sin cobertura ejecutable, y es justo donde vive el
riesgo operativo.

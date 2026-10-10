# Componentes de terceros (VENDORS)

`polar-locate` incluye y distribuye código y datos de terceros. Aquí se listan
con su licencia (SPDX) y su titular, tal y como exigen dichas licencias. Este
proyecto **no reclama autoría** sobre ellos.

Autor del proyecto: **Ignacio de Miguel Díaz** — `imigueldiaz@tutamail.com`.
Licencia del proyecto: **MIT** (ver [`LICENSE`](LICENSE)).

---

## 1. Dependencias de ejecución (se incluyen en el binario distribuido)

| Componente | Versión | Licencia | Titular / origen |
|---|---|---|---|
| expo | 57.0.27 | MIT | 650 Industries, Inc. (Expo) |
| expo-camera | 57.0.6 | MIT | 650 Industries, Inc. (Expo) |
| expo-haptics | 57.0.3 | MIT | 650 Industries, Inc. (Expo) |
| expo-image-manipulator | 57.0.21 | MIT | 650 Industries, Inc. (Expo) |
| expo-localization | 57.0.2 | MIT | 650 Industries, Inc. (Expo) |
| expo-location | 57.0.20 | MIT | 650 Industries, Inc. (Expo) |
| expo-sensors | 57.0.3 | MIT | 650 Industries, Inc. (Expo) |
| expo-status-bar | 57.0.1 | MIT | 650 Industries, Inc. (Expo) |
| react | 19.2.3 | MIT | Meta Platforms, Inc. y afiliados |
| react-native | 0.86.3 | MIT | Meta Platforms, Inc. y afiliados |
| react-native-svg | 15.15.4 | MIT | Horcrux / Software Mansion |
| astronomy-engine | 2.1.19 | MIT | Don Cross |
| i18n-js | 4.5.4 | MIT | Nando Vieira y colaboradores |
| base64-js | 1.5.1 | MIT | Roman Shtylman |
| jpeg-js | 0.4.4 | BSD-3-Clause | Eugene Ware |

### Plantilla de origen

Parte del andamiaje del repositorio procede de la plantilla
**`blank-typescript` de Expo**, Copyright (c) 2015-present
650 Industries, Inc. (aka Expo), bajo licencia MIT.

## 2. Datos

| Fuente | Licencia | Atribución |
|---|---|---|
| **HYG Database v4.1** (github.com/astronexus/HYG-Database) — catálogo embebido en `src/lib/catalog.ts` | CC BY-SA 4.0 | David Nash (astronexus) y colaboradores |

> El catálogo (`src/lib/catalog.ts`) es una obra derivada de HYG v4.1 y se
> distribuye igualmente bajo **CC BY-SA 4.0**. Es una obra separada del código
> de la aplicación, que permanece bajo MIT. Cualquier redistribución del
> catálogo (o de versiones modificadas) debe mantener la misma licencia y la
> atribución a astronexus.

## 3. Herramientas de desarrollo (no se distribuyen con la app)

`typescript`, `eslint`, `eslint-config-expo` y `@types/react` se usan solo en
desarrollo y no forman parte del binario. Sus licencias son MIT.

---

## Textos de licencia

### MIT License

Se aplica a todos los componentes marcados como *MIT* en la tabla. Cada paquete
conserva su propia línea de copyright; el texto íntegro es:

```
MIT License

Copyright (c) <año> <titular indicado en la tabla de arriba>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### BSD 3-Clause License (jpeg-js)

```
Copyright (c) 2014, Eugene Ware
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

### Creative Commons Attribution-ShareAlike 4.0 (HYG Database)

Texto completo: https://creativecommons.org/licenses/by-sa/4.0/legalcode

Atribución requerida: **HYG Database v4.1 — David Nash / astronexus**, CC BY-SA 4.0.

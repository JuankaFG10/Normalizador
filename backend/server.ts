import express from 'express';
import cors from 'cors';
import multer from 'multer';
import sqlParser from 'node-sql-parser';

const { Parser } = sqlParser;

// ---------- Tipos ----------

type Fila = (string | null)[];

type Columna = { nombre: string; tipo: string; tipoSQL: string; nullable: boolean };

type Tabla = { nombre: string; columnas: Columna[]; pk: string[]; filas: Fila[] };

type ClaveForanea = {
    tablaHija: string;
    columnaHija: string;
    tablaPadre: string;
    columnaPadre: string;
    onUpdate: string;
    onDelete: string;
};

type Indice = { nombre: string; tabla: string; columnas: string[]; unica: boolean };

type Modelo = { tablas: Record<string, Tabla>; fks: ClaveForanea[]; indices: Indice[] };

// Una parte de una tabla descompuesta: nombres de columnas y sus filas
type Parte = { columnas: string[]; filas: Fila[] };

type Estado = 'cumple' | 'transformado' | 'revisar' | 'no cumple' | 'bloqueado' | 'informativo';

type Requisito = { id: string; nombre: string; estado: 'cumple' | 'revisar' | 'no cumple'; detalles: string[] };

type CandidatoLista = { tabla: string; columna: string; ejemplo: string };

type DependenciaDeclarada = { tabla: string; determinante: string; dependientes: string[]; nombreTabla: string };

type ListaDecidida = { tabla: string; columna: string; separar: boolean };

type Decisiones = {
    prerrequisitosConfirmados?: boolean;
    dependencias?: DependenciaDeclarada[];
    listas?: ListaDecidida[];
};

type VistaTabla = {
    nombre: string;
    filas: number;
    columnas: { nombre: string; tipo: string; pk: boolean; fk: boolean }[];
    datos: { columnas: string[]; filas: Fila[] };
};

type Paso = {
    id: string;
    titulo: string;
    estado: Estado;
    mensaje: string;
    detalles: string[];
    requisitos?: Requisito[];
    candidatos?: CandidatoLista[];
    tablas?: VistaTabla[];
    svg?: string;
};

// ---------- Servidor ----------

const app = express();
app.use(cors());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const parser = new Parser();

app.post('/api/normalizar', upload.single('scriptSql'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Sube un archivo .sql' });
    if (!req.file.originalname.toLowerCase().endsWith('.sql')) {
        return res.status(400).json({ error: 'Solo se aceptan archivos .sql' });
    }

    let decisiones: Decisiones;
    try {
        decisiones = req.body?.decisiones ? JSON.parse(req.body.decisiones) : {};
    } catch {
        return res.status(400).json({ error: 'Las decisiones no son un JSON válido' });
    }

    try {
        const { modelo, avisos } = leerScript(decodificarArchivo(req.file.buffer));
        if (Object.keys(modelo.tablas).length === 0) {
            return res.json({
                sinEstructura: true,
                mensaje: 'El archivo no tiene requisitos para normalizar: no contiene ninguna sentencia CREATE TABLE que el sistema pueda leer (el sistema solo soporta SQL Server).',
                avisos,
            });
        }
        res.json(ejecutarPipeline(modelo, avisos, decisiones));
    } catch (e) {
        res.status(400).json({ error: 'No se pudo procesar el archivo', detalle: mensajeDeError(e) });
    }
});

app.listen(3001, () => console.log('Backend corriendo en el puerto 3001'));

// ---------- Utilidades ----------

const copiar = <T>(valor: T): T => JSON.parse(JSON.stringify(valor));

// Devuelve solo la primera línea del mensaje de error
function mensajeDeError(e: unknown): string {
    const texto = e instanceof Error ? e.message : String(e);
    return texto.split('\n')[0] ?? '';
}

// ---------- Lectura del script ----------

function decodificarArchivo(buffer: Buffer): string {
    // UTF-16 little endian con BOM
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');

    // UTF-16 big endian con BOM: hay que invertir los bytes de cada par
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
        const bytes = Buffer.from(buffer.subarray(2));
        for (let i = 0; i + 1 < bytes.length; i += 2) {
            const temporal = bytes[i]!;
            bytes[i] = bytes[i + 1]!;
            bytes[i + 1] = temporal;
        }
        return bytes.toString('utf16le');
    }

    // UTF-16 sin BOM: los caracteres ASCII tienen bytes en cero
    if (buffer.subarray(0, 400).includes(0x00)) return buffer.toString('utf16le');

    const utf8 = buffer.toString('utf8');
    // Si no es UTF-8 válido (ANSI de Windows con acentos) se usa latin1
    if (utf8.includes('�')) return buffer.toString('latin1');
    return utf8.replace(/^﻿/, '');
}

// Quita comentarios y comandos que SQL Server Management Studio usa pero no son parte del modelo
function limpiarScript(texto: string): string {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/)
        .filter(linea => !/^\s*(USE\s|SET\s|GO\s*$)/i.test(linea))
        .join('\n');
}

function leerScript(texto: string): { modelo: Modelo; avisos: string[] } {
    const modelo: Modelo = { tablas: {}, fks: [], indices: [] };
    const avisos: string[] = [];
    const sentencias = limpiarScript(texto).split(/\n(?=\s*(?:CREATE|INSERT|ALTER)\s)/i);

    for (const sentencia of sentencias) {
        const sql = sentencia.trim();
        if (!sql) continue;
        try {
            if (/^CREATE\s+TABLE/i.test(sql)) {
                const tabla = parsearCreate(sql);
                modelo.tablas[tabla.nombre] = tabla;
            } else if (/^INSERT/i.test(sql)) {
                agregarInsert(sql, modelo.tablas);
            } else if (/^ALTER\s+TABLE/i.test(sql) && /FOREIGN\s+KEY/i.test(sql)) {
                modelo.fks.push(parsearForanea(sql));
            } else if (/^CREATE\s+(UNIQUE\s+)?(CLUSTERED\s+|NONCLUSTERED\s+)?INDEX/i.test(sql)) {
                modelo.indices.push(parsearIndice(sql));
            }
        } catch (e) {
            avisos.push(mensajeDeError(e));
        }
    }
    return { modelo, avisos };
}

function parsearCreate(sql: string): Tabla {
    const ast: any = parser.astify(sql, { database: 'transactsql' });
    const sentencia = Array.isArray(ast) ? ast[0] : ast;
    const nombre = String(sentencia.table[0].table).replace(/[\[\]\s]/g, '');
    const columnas: Columna[] = [];
    let pk: string[] = [];

    for (const definicion of sentencia.create_definitions) {
        if (definicion.resource === 'column') {
            const tipo = String(definicion.definition.dataType).toUpperCase();
            const { length, scale } = definicion.definition;
            const tipoSQL = length ? `${tipo}(${length}${scale != null ? `, ${scale}` : ''})` : tipo;
            columnas.push({
                nombre: definicion.column.column,
                tipo,
                tipoSQL,
                nullable: definicion.nullable?.type !== 'not null',
            });
        } else if (definicion.constraint_type === 'primary key') {
            pk = definicion.definition.map((c: any) => c.column);
        }
    }
    return { nombre, columnas, pk, filas: [] };
}

// Separa "(...), (...), (...)" en el contenido de cada tupla, respetando comillas
function separarTuplas(texto: string): string[] {
    const tuplas: string[] = [];
    let profundidad = 0;
    let dentroComillas = false;
    let contenido = '';
    for (const caracter of texto) {
        if (caracter === "'") dentroComillas = !dentroComillas;
        if (!dentroComillas) {
            if (caracter === '(') {
                profundidad++;
                if (profundidad === 1) { contenido = ''; continue; }
            } else if (caracter === ')') {
                profundidad--;
                if (profundidad === 0) { tuplas.push(contenido); contenido = ''; continue; }
            }
        }
        if (profundidad >= 1) contenido += caracter;
    }
    return tuplas;
}

// Acepta INSERT [INTO] tabla [(columnas)] VALUES (...), (...)
function agregarInsert(sql: string, tablas: Record<string, Tabla>) {
    const m = sql.match(/^INSERT\s+(?:INTO\s+)?(?:\[?\w+\]?\.)?\[?(\w+)\]?\s*(?:\(([^)]*)\)\s*)?VALUES\s*([\s\S]*)$/i);
    if (!m) throw new Error(`INSERT no reconocido: ${sql.slice(0, 60)}`);

    const tabla = Object.values(tablas).find(t => t.nombre.toLowerCase() === m[1]!.toLowerCase());
    if (!tabla) throw new Error(`INSERT para una tabla no creada antes: ${m[1]}`);

    const columnasInsert = m[2]
        ? m[2].split(',').map(c => c.replace(/[\[\]\s]/g, ''))
        : tabla.columnas.map(c => c.nombre);

    const tuplas = separarTuplas(m[3]!);
    if (tuplas.length === 0) throw new Error(`INSERT en ${tabla.nombre}: no encontré filas en VALUES`);

    // Se validan todas las filas antes de guardar ninguna
    const nuevasFilas: Fila[] = [];
    for (const tupla of tuplas) {
        const textoValores = tupla.replace(/CAST\(\s*([\d.\-]+)\s+AS\s+\w+\(\s*\d+\s*,\s*\d+\s*\)\s*\)/gi, '$1');
        const piezas = textoValores.split(/,(?=(?:[^']*'[^']*')*[^']*$)/);
        const valores = piezas.map(pieza => {
            const texto = pieza.trim();
            if (/^N?'/.test(texto)) return texto.replace(/^N?'|'$/g, '').replace(/''/g, "'");
            if (/^NULL$/i.test(texto)) return null;
            return texto;
        });
        if (valores.length !== columnasInsert.length) {
            throw new Error(`INSERT en ${tabla.nombre}: ${valores.length} valores para ${columnasInsert.length} columnas`);
        }
        nuevasFilas.push(tabla.columnas.map(col => {
            const i = columnasInsert.indexOf(col.nombre);
            return i === -1 ? null : valores[i]!;
        }));
    }
    tabla.filas.push(...nuevasFilas);
}

function parsearForanea(sql: string): ClaveForanea {
    const limpio = sql.replace(/\[|\]/g, '');
    const m = limpio.match(
        /ALTER TABLE\s+(?:\w+\.)?(\w+)[\s\S]*?FOREIGN KEY\s*\((\w+)\)\s*REFERENCES\s+(?:\w+\.)?(\w+)\s*\((\w+)\)/i
    );
    if (!m) throw new Error(`Llave foránea no reconocida: ${sql.slice(0, 60)}`);
    const onUpdate = limpio.match(/ON UPDATE\s+(\w+(?:\s+(?:ACTION|NULL|DEFAULT))?)/i)?.[1] ?? 'NO ACTION';
    const onDelete = limpio.match(/ON DELETE\s+(\w+(?:\s+(?:ACTION|NULL|DEFAULT))?)/i)?.[1] ?? 'NO ACTION';
    return {
        tablaHija: m[1]!,
        columnaHija: m[2]!,
        tablaPadre: m[3]!,
        columnaPadre: m[4]!,
        onUpdate: onUpdate.toUpperCase(),
        onDelete: onDelete.toUpperCase(),
    };
}

function parsearIndice(sql: string): Indice {
    const m = sql.replace(/\[|\]/g, '').match(
        /CREATE\s+(UNIQUE\s+)?(?:CLUSTERED\s+|NONCLUSTERED\s+)?INDEX\s+(\w+)\s+ON\s+(?:\w+\.)?(\w+)\s*\(([^)]*)\)/i
    );
    if (!m) throw new Error(`Índice no reconocido: ${sql.slice(0, 60)}`);
    const columnas = m[4]!
        .split(',')
        .map(c => c.trim().replace(/\s+(ASC|DESC)$/i, '').trim())
        .filter(Boolean);
    return { nombre: m[2]!, tabla: m[3]!, columnas, unica: !!m[1] };
}

// ---------- Prerrequisitos ----------

const esTexto = (tipo: string) => /^(CHAR|NCHAR|VARCHAR|NVARCHAR|TEXT|NTEXT)$/.test(tipo);
const esNumerico = (tipo: string) => /^(TINYINT|SMALLINT|INT|BIGINT|DECIMAL|NUMERIC|MONEY|SMALLMONEY|FLOAT|REAL)$/.test(tipo);
const esFecha = (tipo: string) => /^(DATE|DATETIME|SMALLDATETIME|DATETIME2|DATETIMEOFFSET|TIME)$/.test(tipo);

function prerrequisitos(modelo: Modelo): Requisito[] {
    const semantica: string[] = [];
    const redundancia: string[] = [];
    const nulos: string[] = [];
    const falsos: string[] = [];
    const falsosRevisar: string[] = [];
    const relacion: string[] = [];
    const dependencias: string[] = [];

    for (const tabla of Object.values(modelo.tablas)) {
        const columnasFK = new Set(modelo.fks.filter(f => f.tablaHija === tabla.nombre).map(f => f.columnaHija));

        tabla.columnas.forEach((columna, indice) => {
            const valores = tabla.filas.map(f => f[indice] ?? null);
            const noNulos = valores.filter((v): v is string => v !== null);
            const distintos = new Set(noNulos).size;
            const etiqueta = `${tabla.nombre}.${columna.nombre}`;
            const nombre = columna.nombre.toLowerCase();
            const esPK = tabla.pk.includes(columna.nombre);
            const esFK = columnasFK.has(columna.nombre);

            // Semántica: el nombre de la columna debe coincidir con su tipo
            if (/fecha|nacimiento/.test(nombre) && !esFecha(columna.tipo)) {
                semantica.push(`${etiqueta} parece una fecha, pero es ${columna.tipoSQL}`);
            }
            if (/salario|monto|pago|precio|costo/.test(nombre) && !esNumerico(columna.tipo)) {
                semantica.push(`${etiqueta} parece un monto, pero es ${columna.tipoSQL}`);
            }
            if (/telefono|teléfono|celular|movil|móvil|fax/.test(nombre) && !esTexto(columna.tipo)) {
                semantica.push(`${etiqueta} parece un teléfono, pero es ${columna.tipoSQL}`);
            }
            if (/nombre|apellido|direccion|dirección|correo|email/.test(nombre) && !esTexto(columna.tipo)) {
                semantica.push(`${etiqueta} parece texto, pero es ${columna.tipoSQL}`);
            }
            if (esNumerico(columna.tipo) && !esPK && !esFK && !/^id/i.test(columna.nombre)
                && valores.length >= 3 && distintos > 0 && distintos <= 5 && distintos < noNulos.length) {
                semantica.push(`${etiqueta} es numérico con pocos valores repetidos: ¿es un código que necesita catálogo?`);
            }

            // Redundancia: valores repetidos fuera de la clave
            if (!esPK && !esFK && noNulos.length > distintos) {
                redundancia.push(`${etiqueta}: ${noNulos.length - distintos} valor(es) repetido(s)`);
            }

            // NULL y cadenas vacías
            if (!esPK && columna.nullable) {
                nulos.push(`${etiqueta} permite NULL (${valores.filter(v => v === null).length} en los datos)`);
            }
            if (esTexto(columna.tipo)) {
                const vacios = noNulos.filter(v => v.trim() === '').length;
                if (vacios) nulos.push(`${etiqueta}: ${vacios} cadena(s) vacía(s) que deberían ser NULL`);
            }

            // Datos de prueba
            if (noNulos.some(v => ['test', 'prueba', '123', 'asdf'].includes(v.trim().toLowerCase()))) {
                falsos.push(`${etiqueta}: contiene datos de prueba`);
            }

            // Valores únicos: hay que confirmar si determinan a otras columnas
            if (!esPK && !esFK && valores.length > 1 && distintos === valores.length) {
                dependencias.push(`${etiqueta}: valores únicos; confirma si su valor determina a otras columnas`);
            }
        });
    }

    // Llaves foráneas: no deben tener registros huérfanos
    for (const fk of modelo.fks) {
        const padre = modelo.tablas[fk.tablaPadre];
        const hija = modelo.tablas[fk.tablaHija];
        if (!padre || !hija) {
            falsos.push(`FK ${fk.tablaHija}.${fk.columnaHija} apunta a una tabla que no existe en el script`);
            continue;
        }
        const indiceHija = hija.columnas.findIndex(c => c.nombre === fk.columnaHija);
        const indicePadre = padre.columnas.findIndex(c => c.nombre === fk.columnaPadre);
        const valoresPadre = new Set(padre.filas.map(f => String(f[indicePadre])));
        const huerfanos = hija.filas.filter(f => f[indiceHija] !== null && !valoresPadre.has(String(f[indiceHija]))).length;
        if (huerfanos) falsos.push(`${fk.tablaHija}.${fk.columnaHija}: ${huerfanos} registro(s) sin padre en ${fk.tablaPadre}`);
        if (fk.onDelete !== 'CASCADE' || fk.onUpdate !== 'CASCADE') {
            falsosRevisar.push(`${fk.tablaHija}.${fk.columnaHija} no tiene ON DELETE/UPDATE CASCADE (el SQL normalizado sí lo incluye)`);
        }
        if (fk.columnaHija !== fk.columnaPadre) {
            relacion.push(`${fk.tablaHija}.${fk.columnaHija} referencia ${fk.tablaPadre}.${fk.columnaPadre}: nombres distintos`);
        }
    }

    const estadoDe = (lista: string[]): Requisito['estado'] => (lista.length ? 'revisar' : 'cumple');
    return [
        { id: 'semantica', nombre: 'Semántica de atributos (nombres y tipos)', estado: estadoDe(semantica), detalles: semantica },
        { id: 'redundancia', nombre: 'Reducción de información redundante', estado: estadoDe(redundancia), detalles: redundancia },
        { id: 'nulos', nombre: 'Reducción de valores NULL', estado: estadoDe(nulos), detalles: nulos },
        {
            id: 'falsos',
            nombre: 'Prohibir registros falsos (integridad referencial)',
            estado: falsos.length ? 'no cumple' : falsosRevisar.length ? 'revisar' : 'cumple',
            detalles: [...falsos, ...falsosRevisar],
        },
        { id: 'relacion', nombre: 'Semántica clara de la relación', estado: estadoDe(relacion), detalles: relacion },
        { id: 'dependencias', nombre: 'Dependencias funcionales', estado: estadoDe(dependencias), detalles: dependencias },
    ];
}

// ---------- 1FN ----------

// Grupos de columnas repetidas, como Telefono1, Telefono2 o Materia1, Materia2
function buscarGruposRepetidos(modelo: Modelo): { tabla: string; base: string; columnas: string[] }[] {
    const grupos: { tabla: string; base: string; columnas: string[] }[] = [];
    for (const tabla of Object.values(modelo.tablas)) {
        const porBase = new Map<string, string[]>();
        for (const columna of tabla.columnas) {
            if (tabla.pk.includes(columna.nombre)) continue;
            const partes = columna.nombre.match(/^(.*?)_?(\d+)$/);
            if (partes && partes[1]) {
                porBase.set(partes[1], [...(porBase.get(partes[1]) ?? []), columna.nombre]);
            }
        }
        for (const [base, columnas] of porBase) {
            if (columnas.length >= 2) grupos.push({ tabla: tabla.nombre, base, columnas });
        }
    }
    return grupos;
}

// Cada grupo repetido pasa a su propia tabla, con la clave original y el valor en filas
function separarGruposRepetidos(modelo: Modelo, grupos: { tabla: string; base: string; columnas: string[] }[]): string[] {
    const detalles: string[] = [];
    for (const grupo of grupos) {
        const tabla = modelo.tablas[grupo.tabla]!;
        const indices = grupo.columnas.map(c => tabla.columnas.findIndex(x => x.nombre === c));
        const columnaBase = tabla.columnas[indices[0]!]!;
        const indicesClave = tabla.pk.map(p => tabla.columnas.findIndex(c => c.nombre === p));

        const nuevaTabla: Tabla = {
            nombre: nombreLibre(modelo, `${tabla.nombre}_${grupo.base}`),
            columnas: [
                ...tabla.pk.map(p => ({ ...tabla.columnas.find(c => c.nombre === p)!, nullable: false })),
                { nombre: grupo.base, tipo: columnaBase.tipo, tipoSQL: columnaBase.tipoSQL, nullable: false },
            ],
            pk: [...tabla.pk, grupo.base],
            filas: [],
        };

        const vistos = new Set<string>();
        for (const fila of tabla.filas) {
            const valoresClave = indicesClave.map(i => fila[i] ?? null);
            for (const i of indices) {
                const valor = fila[i];
                if (valor == null || valor.trim() === '') continue;
                const llave = JSON.stringify([...valoresClave, valor]);
                if (!vistos.has(llave)) {
                    vistos.add(llave);
                    nuevaTabla.filas.push([...valoresClave, valor]);
                }
            }
        }

        modelo.tablas[nuevaTabla.nombre] = nuevaTabla;
        tabla.columnas = tabla.columnas.filter(c => !grupo.columnas.includes(c.nombre));
        tabla.filas = tabla.filas.map(f => f.filter((_, i) => !indices.includes(i)));
        for (const p of tabla.pk) {
            modelo.fks.push({
                tablaHija: nuevaTabla.nombre, columnaHija: p, tablaPadre: tabla.nombre, columnaPadre: p,
                onUpdate: 'CASCADE', onDelete: 'CASCADE',
            });
        }
        detalles.push(`${tabla.nombre}: el grupo repetido ${grupo.columnas.join(', ')} pasó a ${nuevaTabla.nombre} (clave ${nuevaTabla.pk.join(', ')}, ${nuevaTabla.filas.length} fila(s)).`);
    }
    return detalles;
}

// Separa un valor con lista (coma, punto y coma, barra vertical, " y " o salto de línea)
function separarValores(valor: string): string[] {
    const piezas = valor.split(/\s*[,;|]\s*|\s+y\s+|\s*\r?\n\s*/i).map(x => x.trim()).filter(x => x !== '');
    return [...new Set(piezas)];
}

const tieneLista = (valor: unknown) => typeof valor === 'string' && separarValores(valor).length > 1;

// Columnas de texto con valores que parecen listas (se separan salvo que el usuario diga "No es lista")
function buscarCandidatosListas(modelo: Modelo): CandidatoLista[] {
    const candidatos: CandidatoLista[] = [];
    for (const tabla of Object.values(modelo.tablas)) {
        tabla.columnas.forEach((columna, i) => {
            if (tabla.pk.includes(columna.nombre) || !esTexto(columna.tipo)) return;
            const fila = tabla.filas.find(f => tieneLista(f[i]));
            if (fila) candidatos.push({ tabla: tabla.nombre, columna: columna.nombre, ejemplo: fila[i]! });
        });
    }
    return candidatos;
}

// Cada valor de una lista pasa a su propia fila. Si la columna es parte de la clave, la clave se amplía con ella
function separarListas(modelo: Modelo, objetivos: { tabla: string; columna: string }[]): string[] {
    const detalles: string[] = [];
    for (const objetivo of objetivos) {
        const tabla = modelo.tablas[objetivo.tabla];
        if (!tabla || tabla.pk.includes(objetivo.columna)) continue;
        const i = tabla.columnas.findIndex(c => c.nombre === objetivo.columna);
        if (i < 0) continue;
        const columna = tabla.columnas[i]!;
        if (!esTexto(columna.tipo)) continue;
        const filasConLista = tabla.filas.filter(f => tieneLista(f[i])).length;
        if (!filasConLista) continue;

        const nuevas: Fila[] = [];
        for (const fila of tabla.filas) {
            const valor = fila[i];
            const valores = typeof valor === 'string' ? separarValores(valor) : [];
            if (valores.length === 0) {
                nuevas.push([...fila]);
                continue;
            }
            for (const unico of valores) {
                const nuevaFila = [...fila];
                nuevaFila[i] = unico;
                nuevas.push(nuevaFila);
            }
        }

        const tienePK = tabla.pk.length > 0;
        if (tienePK) {
            if (nuevas.some(f => f[i] === null)) {
                detalles.push(`${tabla.nombre}.${columna.nombre}: tiene listas y también valores NULL; no se amplió la clave. Revisa esa columna.`);
                continue;
            }
            const indicesClave = [...tabla.pk.map(p => tabla.columnas.findIndex(c => c.nombre === p)), i];
            const claves = new Set(nuevas.map(f => JSON.stringify(indicesClave.map(k => f[k] ?? null))));
            if (claves.size !== nuevas.length) {
                detalles.push(`${tabla.nombre}.${columna.nombre}: al separar la lista se repetirían claves; no se aplicó.`);
                continue;
            }
            tabla.pk = [...tabla.pk, columna.nombre];
            tabla.columnas[i] = { ...columna, nullable: false };
        }
        tabla.filas = nuevas;
        const sufijo = tienePK ? `; la clave ahora incluye ${columna.nombre}` : '';
        detalles.push(`${tabla.nombre}.${columna.nombre}: ${filasConLista} fila(s) con varios valores pasaron a ${nuevas.length} fila(s)${sufijo}.`);
    }
    return detalles;
}

// Devuelve un nombre de tabla que no esté usado todavía
function nombreLibre(modelo: Modelo, base: string): string {
    let nombre = base;
    let numero = 2;
    while (modelo.tablas[nombre]) nombre = `${base}_${numero++}`;
    return nombre;
}

// ---------- 2FN ----------

// Todos los subconjuntos no vacíos y distintos del total de la clave
function subconjuntosPropios(elementos: string[]): string[][] {
    const resultado: string[][] = [];
    for (let mascara = 1; mascara < (1 << elementos.length) - 1; mascara++) {
        resultado.push(elementos.filter((_, i) => mascara & (1 << i)));
    }
    return resultado;
}

// Columnas que dependen solo de una parte de la clave compuesta
function buscarDependenciasParciales(modelo: Modelo): { tabla: string; clave: string[]; columnas: string[] }[] {
    const resultado: { tabla: string; clave: string[]; columnas: string[] }[] = [];
    for (const tabla of Object.values(modelo.tablas)) {
        if (tabla.pk.length < 2) continue;
        const usadas = new Set<string>();
        for (const parteClave of subconjuntosPropios(tabla.pk)) {
            const indicesParte = parteClave.map(c => tabla.columnas.findIndex(x => x.nombre === c));
            const grupos = new Map<string, number[]>();
            tabla.filas.forEach((fila, r) => {
                const llave = JSON.stringify(indicesParte.map(i => fila[i] ?? null));
                grupos.set(llave, [...(grupos.get(llave) ?? []), r]);
            });
            if (![...grupos.values()].some(filas => filas.length > 1)) continue;

            const dependientes: string[] = [];
            tabla.columnas.forEach((columna, i) => {
                if (tabla.pk.includes(columna.nombre) || usadas.has(columna.nombre)) return;
                const constante = [...grupos.values()].every(filas =>
                    new Set(filas.map(r => JSON.stringify(tabla.filas[r]![i] ?? null))).size === 1
                );
                const varia = new Set(tabla.filas.map(f => JSON.stringify(f[i] ?? null))).size > 1;
                if (constante && varia) dependientes.push(columna.nombre);
            });
            if (dependientes.length) {
                resultado.push({ tabla: tabla.nombre, clave: parteClave, columnas: dependientes });
                dependientes.forEach(c => usadas.add(c));
            }
        }
    }
    return resultado;
}

// Busca otra tabla con esa misma clave que ya guarde los mismos datos. Si existe, no hace falta crear una nueva
function buscarTablaExistente(modelo: Modelo, tabla: Tabla, dep: { clave: string[]; columnas: string[] }): Tabla | null {
    if (tabla.filas.length === 0) return null;
    for (const otra of Object.values(modelo.tablas)) {
        if (otra.nombre === tabla.nombre) continue;
        if (otra.pk.length !== dep.clave.length || !dep.clave.every(c => otra.pk.includes(c))) continue;

        const indicesTabla = dep.clave.map(c => tabla.columnas.findIndex(x => x.nombre === c));
        const indicesOtra = dep.clave.map(c => otra.columnas.findIndex(x => x.nombre === c));
        const porClave = new Map<string, Fila>();
        for (const f of otra.filas) porClave.set(JSON.stringify(indicesOtra.map(i => f[i] ?? null)), f);

        const emparejadas = tabla.filas.map(f => porClave.get(JSON.stringify(indicesTabla.map(i => f[i] ?? null))));
        if (emparejadas.some(f => f === undefined)) continue;

        const mismosDatos = dep.columnas.every(c => {
            const i = tabla.columnas.findIndex(x => x.nombre === c);
            return otra.columnas.some((x, k) =>
                !otra.pk.includes(x.nombre) &&
                tabla.filas.every((f, r) => (f[i] ?? null) === (emparejadas[r]![k] ?? null))
            );
        });
        if (mismosDatos) return otra;
    }
    return null;
}

function aplicarSegundaFN(modelo: Modelo, dependencias: { tabla: string; clave: string[]; columnas: string[] }[]): string[] {
    const detalles: string[] = [];
    for (const dep of dependencias) {
        const tabla = modelo.tablas[dep.tabla]!;
        const indicesDependientes = dep.columnas.map(c => tabla.columnas.findIndex(x => x.nombre === c));
        const indicesClave = dep.clave.map(c => tabla.columnas.findIndex(x => x.nombre === c));

        // Si los datos ya existen en otra tabla, solo se quitan y se enlazan con clave foránea
        const tablaExistente = buscarTablaExistente(modelo, tabla, dep);
        if (tablaExistente) {
            tabla.columnas = tabla.columnas.filter(c => !dep.columnas.includes(c.nombre));
            tabla.filas = tabla.filas.map(f => f.filter((_, i) => !indicesDependientes.includes(i)));
            for (const c of dep.clave) {
                const yaExiste = modelo.fks.some(f =>
                    f.tablaHija === tabla.nombre && f.columnaHija === c && f.tablaPadre === tablaExistente.nombre);
                if (!yaExiste) {
                    modelo.fks.push({
                        tablaHija: tabla.nombre, columnaHija: c, tablaPadre: tablaExistente.nombre, columnaPadre: c,
                        onUpdate: 'CASCADE', onDelete: 'CASCADE',
                    });
                }
            }
            detalles.push(`${tabla.nombre}: ${dep.columnas.join(', ')} dependen solo de ${dep.clave.join(', ')}, pero esos datos ya están en ${tablaExistente.nombre}; se quitaron de ${tabla.nombre} sin crear una tabla nueva.`);
            continue;
        }

        const nuevaTabla: Tabla = {
            nombre: nombreLibre(modelo, `${tabla.nombre}_${dep.clave.join('_')}`),
            columnas: [
                ...dep.clave.map(c => ({ ...tabla.columnas.find(x => x.nombre === c)!, nullable: false })),
                ...dep.columnas.map(c => ({ ...tabla.columnas.find(x => x.nombre === c)! })),
            ],
            pk: [...dep.clave],
            filas: [],
        };
        const vistos = new Set<string>();
        for (const fila of tabla.filas) {
            const valoresClave = indicesClave.map(i => fila[i] ?? null);
            const llave = JSON.stringify(valoresClave);
            if (vistos.has(llave)) continue;
            vistos.add(llave);
            nuevaTabla.filas.push([...valoresClave, ...indicesDependientes.map(i => fila[i] ?? null)]);
        }

        // Verificación: la división debe poder unirse de nuevo sin tuplas falsas ni datos perdidos
        const restantes: Parte = {
            columnas: tabla.columnas.filter(c => !dep.columnas.includes(c.nombre)).map(c => c.nombre),
            filas: tabla.filas.map(f => f.filter((_, i) => !indicesDependientes.includes(i))),
        };
        const original: Parte = { columnas: tabla.columnas.map(c => c.nombre), filas: tabla.filas };
        const nuevaParte: Parte = { columnas: nuevaTabla.columnas.map(c => c.nombre), filas: nuevaTabla.filas };
        if (!sinTuplasFalsas(original, [nuevaParte, restantes])) {
            detalles.push(`${tabla.nombre}: ${dep.columnas.join(', ')} no se separaron porque la división generaría tuplas falsas o perdería datos.`);
            continue;
        }

        modelo.tablas[nuevaTabla.nombre] = nuevaTabla;
        tabla.columnas = tabla.columnas.filter(c => !dep.columnas.includes(c.nombre));
        tabla.filas = tabla.filas.map(f => f.filter((_, i) => !indicesDependientes.includes(i)));
        for (const c of dep.clave) {
            modelo.fks.push({
                tablaHija: tabla.nombre, columnaHija: c, tablaPadre: nuevaTabla.nombre, columnaPadre: c,
                onUpdate: 'CASCADE', onDelete: 'CASCADE',
            });
        }
        detalles.push(`${tabla.nombre}: ${dep.columnas.join(', ')} dependen solo de ${dep.clave.join(', ')} y pasaron a ${nuevaTabla.nombre}.`);
    }
    return detalles;
}

// ---------- 3FN ----------

// Columnas que no son clave y que determinan a otras columnas dentro de la misma tabla
function buscarDependenciasTransitivas(modelo: Modelo): { tabla: string; determinante: string; dependientes: string[] }[] {
    const resultado: { tabla: string; determinante: string; dependientes: string[] }[] = [];
    for (const tabla of Object.values(modelo.tablas)) {
        const columnasFK = new Set(modelo.fks.filter(f => f.tablaHija === tabla.nombre).map(f => f.columnaHija));
        const candidatas = tabla.columnas.filter(c => !tabla.pk.includes(c.nombre) && !columnasFK.has(c.nombre));

        for (const determinante of candidatas) {
            const iDet = tabla.columnas.indexOf(determinante);
            const grupos = new Map<string, number[]>();
            tabla.filas.forEach((fila, r) => {
                const valor = fila[iDet];
                if (valor === null || valor === undefined) return;
                grupos.set(valor, [...(grupos.get(valor) ?? []), r]);
            });
            if (![...grupos.values()].some(filas => filas.length > 1)) continue;

            const dependientes: string[] = [];
            for (const posible of candidatas) {
                if (posible.nombre === determinante.nombre) continue;
                const iPos = tabla.columnas.indexOf(posible);
                const consistente = [...grupos.values()].every(filas =>
                    new Set(filas.map(r => JSON.stringify(tabla.filas[r]![iPos] ?? null))).size === 1
                );
                const varia = new Set(tabla.filas.map(f => JSON.stringify(f[iPos] ?? null))).size > 1;
                if (consistente && varia) dependientes.push(posible.nombre);
            }
            if (dependientes.length) resultado.push({ tabla: tabla.nombre, determinante: determinante.nombre, dependientes });
        }
    }
    return resultado;
}

function aplicarTerceraFN(modelo: Modelo, declaradas: DependenciaDeclarada[]): string[] {
    const detalles: string[] = [];
    for (const dep of declaradas) {
        const tabla = modelo.tablas[dep.tabla];
        if (!tabla) throw new Error(`No existe la tabla ${dep.tabla}. Tablas en el archivo: ${Object.keys(modelo.tablas).join(', ')}`);
        const columnaDeterminante = tabla.columnas.find(c => c.nombre === dep.determinante);
        if (!columnaDeterminante) throw new Error(`No existe la columna ${dep.determinante} en ${tabla.nombre}`);
        if (tabla.pk.includes(dep.determinante)) throw new Error(`${dep.determinante} es clave primaria: no puede ser determinante`);
        if (!dep.dependientes.length) throw new Error(`Indica qué columnas dependen de ${dep.determinante}`);
        for (const columna of dep.dependientes) {
            if (!tabla.columnas.find(c => c.nombre === columna)) throw new Error(`No existe la columna ${columna} en ${tabla.nombre}`);
            if (tabla.pk.includes(columna) || columna === dep.determinante) {
                throw new Error(`${columna} no puede ser dependiente en esta separación`);
            }
        }

        const iDet = tabla.columnas.findIndex(c => c.nombre === dep.determinante);
        const indicesDependientes = dep.dependientes.map(n => tabla.columnas.findIndex(c => c.nombre === n));

        // Cada valor del determinante debe tener siempre los mismos dependientes
        const valorPorDeterminante = new Map<string, string>();
        for (const fila of tabla.filas) {
            const clave = String(fila[iDet] ?? null);
            const valores = JSON.stringify(indicesDependientes.map(i => fila[i] ?? null));
            const previo = valorPorDeterminante.get(clave);
            if (previo !== undefined && previo !== valores) {
                throw new Error(`${dep.determinante}=${clave} tiene valores distintos en ${dep.dependientes.join(', ')}: no es una dependencia`);
            }
            valorPorDeterminante.set(clave, valores);
        }

        const nombreNuevo = dep.nombreTabla?.trim() ? dep.nombreTabla.trim() : `${tabla.nombre}_${dep.determinante}`;
        const nuevaTabla: Tabla = {
            nombre: nombreLibre(modelo, nombreNuevo),
            columnas: [
                { ...columnaDeterminante, nullable: false },
                ...dep.dependientes.map(n => ({ ...tabla.columnas.find(c => c.nombre === n)! })),
            ],
            pk: [dep.determinante],
            filas: [],
        };
        const vistos = new Set<string>();
        for (const fila of tabla.filas) {
            const valor = fila[iDet] ?? null;
            if (valor === null || vistos.has(valor)) continue;
            vistos.add(valor);
            nuevaTabla.filas.push([valor, ...indicesDependientes.map(i => fila[i] ?? null)]);
        }

        const restantes: Parte = {
            columnas: tabla.columnas.filter(c => !dep.dependientes.includes(c.nombre)).map(c => c.nombre),
            filas: tabla.filas.map(f => f.filter((_, i) => !indicesDependientes.includes(i))),
        };
        const original: Parte = { columnas: tabla.columnas.map(c => c.nombre), filas: tabla.filas };
        const nuevaParte: Parte = { columnas: nuevaTabla.columnas.map(c => c.nombre), filas: nuevaTabla.filas };
        if (!sinTuplasFalsas(original, [nuevaParte, restantes])) {
            throw new Error(`La separación de ${dep.dependientes.join(', ')} en ${tabla.nombre} generaría tuplas falsas o perdería datos: no se aplicó`);
        }

        modelo.tablas[nuevaTabla.nombre] = nuevaTabla;
        tabla.columnas = tabla.columnas.filter(c => !dep.dependientes.includes(c.nombre));
        tabla.filas = tabla.filas.map(f => f.filter((_, i) => !indicesDependientes.includes(i)));
        modelo.fks.push({
            tablaHija: tabla.nombre, columnaHija: dep.determinante, tablaPadre: nuevaTabla.nombre, columnaPadre: dep.determinante,
            onUpdate: 'CASCADE', onDelete: 'CASCADE',
        });
        detalles.push(`${tabla.nombre}: ${dep.dependientes.join(', ')} dependen de ${dep.determinante} y pasaron a ${nuevaTabla.nombre}.`);
    }
    return detalles;
}

// ---------- Verificación sin tuplas falsas (JOIN natural) ----------

function unirNatural(a: Parte, b: Parte): Parte {
    const comunes = a.columnas.filter(c => b.columnas.includes(c));
    const indicesA = comunes.map(c => a.columnas.indexOf(c));
    const indicesB = comunes.map(c => b.columnas.indexOf(c));
    const extras = b.columnas.map((_, i) => i).filter(i => !comunes.includes(b.columnas[i]!));
    const filas: Fila[] = [];
    for (const filaA of a.filas) {
        for (const filaB of b.filas) {
            const coinciden = indicesA.every((ia, k) => (filaA[ia] ?? null) === (filaB[indicesB[k]!] ?? null));
            if (coinciden) filas.push([...filaA, ...extras.map(i => filaB[i] ?? null)]);
        }
    }
    return { columnas: [...a.columnas, ...extras.map(i => b.columnas[i]!)], filas };
}

// Une las partes con JOIN natural y compara con la tabla original: si sobran o faltan filas, no es válido
function sinTuplasFalsas(original: Parte, partes: Parte[]): boolean {
    const unido = partes.reduce((acumulado, parte) => unirNatural(acumulado, parte));
    const orden = original.columnas.map(c => unido.columnas.indexOf(c));
    if (orden.some(i => i < 0)) return false;

    const conjunto = (filas: Fila[], indices: number[]) =>
        new Set(filas.map(f => JSON.stringify(indices.map(i => f[i] ?? null))));
    const esperadas = conjunto(original.filas, original.columnas.map((_, i) => i));
    const obtenidas = conjunto(unido.filas, orden);
    if (esperadas.size !== obtenidas.size) return false;
    for (const llave of esperadas) if (!obtenidas.has(llave)) return false;
    return true;
}

// ---------- Pipeline ----------

function ejecutarPipeline(original: Modelo, avisos: string[], decisiones: Decisiones) {
    const pasos: Paso[] = [];
    const avisosFinales = [...avisos];
    const modelo = copiar(original);
    const aprobado = (estado: Estado) => estado === 'cumple' || estado === 'transformado';

    pasos.push({
        id: 'original',
        titulo: 'Estructura original',
        estado: 'informativo',
        mensaje: `${Object.keys(original.tablas).length} tabla(s) leídas.`,
        detalles: [],
        ...vistaDeTablas(original),
    });

    // Prerrequisitos
    const requisitos = prerrequisitos(original);
    const hayNoCumple = requisitos.some(r => r.estado === 'no cumple');
    const pendientes = requisitos.filter(r => r.estado === 'revisar').length;
    const confirmados = !!decisiones.prerrequisitosConfirmados;
    const estadoPre: Estado = hayNoCumple ? 'no cumple' : pendientes && !confirmados ? 'revisar' : 'cumple';
    const mensajePre = hayNoCumple
        ? 'El script no cumple prerrequisitos: corrígelo antes de normalizar.'
        : estadoPre === 'revisar'
            ? `Hay ${pendientes} requisito(s) por revisar. Revísalos y confírmalos para continuar.`
            : pendientes
                ? 'Prerrequisitos revisados y confirmados.'
                : 'El script cumple los prerrequisitos.';
    pasos.push({
        id: 'prerrequisitos', titulo: 'Prerrequisitos', estado: estadoPre, mensaje: mensajePre,
        detalles: [], requisitos, tablas: [], svg: '',
    });
    const prerrequisitosOk = estadoPre === 'cumple';

    // 1FN
    let estado1: Estado = 'bloqueado';
    let detalles1: string[] = [];
    let candidatos: CandidatoLista[] = [];
    if (prerrequisitosOk) {
        const grupos = buscarGruposRepetidos(modelo);
        if (grupos.length) detalles1.push(...separarGruposRepetidos(modelo, grupos));

        // Por defecto las listas se separan; solo se conservan las que el usuario marcó como "No es lista"
        candidatos = buscarCandidatosListas(modelo);
        const noListas = new Set((decisiones.listas ?? []).filter(d => !d.separar).map(d => `${d.tabla}.${d.columna}`));
        const aSeparar = candidatos.filter(c => !noListas.has(`${c.tabla}.${c.columna}`));
        detalles1.push(...separarListas(modelo, aSeparar));
        estado1 = detalles1.length ? 'transformado' : 'cumple';
    }
    pasos.push({
        id: '1FN',
        titulo: 'Primera forma normal (1FN)',
        estado: estado1,
        detalles: detalles1,
        candidatos,
        ...vistaDeTablas(modelo),
        mensaje: mensajesPaso({
            cumple: 'Ya cumple 1FN: todos los valores son atómicos y no hay grupos repetidos.',
            transformado: 'Se separaron los grupos repetidos y los valores con listas en filas.',
            bloqueado: 'Pendiente: primero deben aprobarse los prerrequisitos.',
        }, estado1),
    });

    // 2FN
    let estado2: Estado = 'bloqueado';
    let detalles2: string[] = [];
    if (aprobado(estado1)) {
        const parciales = buscarDependenciasParciales(modelo);
        if (parciales.length) {
            detalles2 = aplicarSegundaFN(modelo, parciales);
            estado2 = 'transformado';
        } else {
            estado2 = 'cumple';
        }
    }
    pasos.push({
        id: '2FN',
        titulo: 'Segunda forma normal (2FN)',
        estado: estado2,
        detalles: detalles2,
        ...vistaDeTablas(modelo),
        mensaje: mensajesPaso({
            cumple: 'Ya cumple 2FN: ningún atributo no primo depende solo de una parte de la clave.',
            transformado: 'Se separaron las dependencias parciales en tablas propias.',
            bloqueado: 'Pendiente: requiere 1FN aprobada.',
        }, estado2),
    });

    // 3FN
    let estado3: Estado = 'bloqueado';
    let detalles3: string[] = [];
    if (aprobado(estado2)) {
        const declaradas = decisiones.dependencias ?? [];
        const detectadas = buscarDependenciasTransitivas(modelo);
        const sinCubrir = detectadas.filter(d =>
            !declaradas.some(x => x.tabla === d.tabla && x.determinante === d.determinante));
        if (sinCubrir.length) {
            estado3 = 'revisar';
            detalles3 = sinCubrir.map(d =>
                `${d.tabla}: ${d.determinante} → ${d.dependientes.join(', ')} (detectada en los datos). Declárala para separarla o descártala.`);
        } else {
            try {
                detalles3 = aplicarTerceraFN(modelo, declaradas);
                estado3 = detalles3.length ? 'transformado' : 'cumple';
            } catch (e) {
                estado3 = 'no cumple';
                detalles3 = [e instanceof Error ? e.message : String(e)];
            }
        }
    }
    pasos.push({
        id: '3FN',
        titulo: 'Tercera forma normal (3FN)',
        estado: estado3,
        detalles: detalles3,
        ...vistaDeTablas(modelo),
        mensaje: mensajesPaso({
            cumple: 'Ya cumple 3FN: no hay dependencias transitivas declaradas ni detectadas.',
            transformado: 'Se separaron las dependencias transitivas declaradas.',
            revisar: 'Hay dependencias detectadas en los datos que debes confirmar o descartar.',
            'no cumple': 'La dependencia declarada no es válida para estos datos.',
            bloqueado: 'Pendiente: requiere 2FN aprobada.',
        }, estado3),
    });

    // Diagnóstico: formaNormal indica el nivel FINAL alcanzado, no el de origen
    let diagnostico: string;
    let formaNormal: string;
    if (!prerrequisitosOk) {
        diagnostico = 'Pendiente de prerrequisitos.';
        formaNormal = 'Pendiente';
    } else {
        formaNormal = aprobado(estado3) ? '3FN' : aprobado(estado2) ? '2FN' : aprobado(estado1) ? '1FN' : 'Sin 1FN';
        const origen = estado1 === 'transformado' ? 'No estaba en 1FN'
            : estado2 === 'transformado' ? 'Estaba en 1FN'
            : estado3 === 'transformado' ? 'Estaba en 2FN' : null;
        const inicio = origen ? `${origen}: se llevó a ${formaNormal}` : `Ya está en ${formaNormal}`;
        const cola = formaNormal === '3FN' ? '. Aquí tienes el diagrama y el SQL normalizado.'
            : formaNormal === '2FN' ? '; falta resolver la 3FN.'
            : '; faltan 2FN y 3FN.';
        diagnostico = inicio + cola;
    }

    const puedeDescargar = prerrequisitosOk && aprobado(estado3);
    let sqlFinal: string | null = null;
    if (puedeDescargar) {
        const resultadoSQL = generarSQL(modelo);
        sqlFinal = resultadoSQL.sql;
        avisosFinales.push(...resultadoSQL.omitidos.map(n =>
            `Índice ${n} omitido: sus columnas ya no existen en la tabla normalizada.`));
    }

    return { formaNormal, diagnostico, puedeDescargar, sqlFinal, avisos: avisosFinales, pasos };
}

// Texto del paso según su estado. Si el estado no tiene texto, queda vacío
function mensajesPaso(mensajes: Partial<Record<Estado, string>>, estado: Estado): string {
    return mensajes[estado] ?? '';
}

// ---------- Vista, diagrama y SQL ----------

function vistaDeTablas(modelo: Modelo) {
    return {
        tablas: Object.values(modelo.tablas).map((tabla): VistaTabla => ({
            nombre: tabla.nombre,
            filas: tabla.filas.length,
            datos: {
                columnas: tabla.columnas.map(c => c.nombre),
                filas: tabla.filas.slice(0, 50),
            },
            columnas: tabla.columnas.map(c => ({
                nombre: c.nombre,
                tipo: c.tipoSQL,
                pk: tabla.pk.includes(c.nombre),
                fk: modelo.fks.some(f => f.tablaHija === tabla.nombre && f.columnaHija === c.nombre),
            })),
        })),
        svg: svgER(modelo),
    };
}

const escaparXml = (texto: string) =>
    texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Diagrama entidad-relación en SVG: una caja por tabla y una línea por llave foránea
function svgER(modelo: Modelo): string {
    const tablas = Object.values(modelo.tablas);
    if (!tablas.length) return '';

    const ANCHO = 280;
    const ENCABEZADO = 26;
    const ALTO_FILA = 18;
    const SEPARACION_X = 80;
    const SEPARACION_Y = 70;
    const MARGEN = 24;

    const columnasEnFila = Math.min(3, Math.ceil(Math.sqrt(tablas.length)));
    const alturaTabla = (tabla: Tabla) => ENCABEZADO + tabla.columnas.length * ALTO_FILA + 12;

    const posiciones: Record<string, { x: number; y: number; alto: number }> = {};
    let y = MARGEN;
    for (let i = 0; i < tablas.length; i += columnasEnFila) {
        const fila = tablas.slice(i, i + columnasEnFila);
        const altoMaximo = Math.max(...fila.map(alturaTabla));
        fila.forEach((tabla, c) => {
            posiciones[tabla.nombre] = { x: MARGEN + c * (ANCHO + SEPARACION_X), y, alto: alturaTabla(tabla) };
        });
        y += altoMaximo + SEPARACION_Y;
    }

    const columnasUsadas = Math.min(columnasEnFila, tablas.length);
    const anchoTotal = MARGEN * 2 + columnasUsadas * ANCHO + (columnasUsadas - 1) * SEPARACION_X;
    const altoTotal = y - SEPARACION_Y + MARGEN;
    const elementos: string[] = [];

    for (const fk of modelo.fks) {
        const hija = posiciones[fk.tablaHija];
        const padre = posiciones[fk.tablaPadre];
        if (!hija || !padre) continue;
        const x1 = hija.x + ANCHO / 2, y1 = hija.y + hija.alto / 2;
        const x2 = padre.x + ANCHO / 2, y2 = padre.y + padre.alto / 2;
        elementos.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#6b7280" stroke-width="1.5" stroke-dasharray="5 4"/>`);
        elementos.push(`<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 4}" font-size="11" fill="#374151" text-anchor="middle" font-family="monospace">${escaparXml(fk.columnaHija)}</text>`);
    }

    for (const tabla of tablas) {
        const pos = posiciones[tabla.nombre]!;
        elementos.push(`<rect x="${pos.x}" y="${pos.y}" width="${ANCHO}" height="${pos.alto}" rx="6" fill="#ffffff" stroke="#1f2937" stroke-width="1.2"/>`);
        elementos.push(`<rect x="${pos.x}" y="${pos.y}" width="${ANCHO}" height="${ENCABEZADO}" rx="6" fill="#1f4e79"/>`);
        elementos.push(`<text x="${pos.x + 10}" y="${pos.y + 18}" font-size="13" font-weight="bold" fill="#fff" font-family="monospace">${escaparXml(tabla.nombre)}</text>`);
        tabla.columnas.forEach((columna, i) => {
            const yTexto = pos.y + ENCABEZADO + 14 + i * ALTO_FILA;
            const esPK = tabla.pk.includes(columna.nombre);
            const esFK = modelo.fks.some(f => f.tablaHija === tabla.nombre && f.columnaHija === columna.nombre);
            const marca = esPK ? 'PK' : esFK ? 'FK' : '  ';
            const color = esPK ? '#b45309' : esFK ? '#1d4ed8' : '#111827';
            elementos.push(`<text x="${pos.x + 8}" y="${yTexto}" font-size="11" font-family="monospace" fill="${color}" font-weight="${esPK ? 'bold' : 'normal'}">${marca} ${escaparXml(columna.nombre)}</text>`);
            elementos.push(`<text x="${pos.x + ANCHO - 8}" y="${yTexto}" font-size="11" font-family="monospace" fill="#6b7280" text-anchor="end">${escaparXml(columna.tipoSQL)}</text>`);
        });
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${anchoTotal} ${altoTotal}" width="${anchoTotal}" height="${altoTotal}" style="background:#f8fafc;max-width:100%;height:auto">${elementos.join('')}</svg>`;
}

// Orden de creación: primero las tablas que no dependen de otras
function ordenarTablas(modelo: Modelo): string[] {
    const pendientes = new Set(Object.keys(modelo.tablas));
    const orden: string[] = [];
    while (pendientes.size) {
        const listas = [...pendientes].filter(t =>
            modelo.fks.filter(f => f.tablaHija === t && f.tablaPadre !== t).every(f => !pendientes.has(f.tablaPadre))
        );
        if (!listas.length) throw new Error('Ciclo de llaves foráneas: no se puede ordenar la creación');
        for (const t of listas) {
            orden.push(t);
            pendientes.delete(t);
        }
    }
    return orden;
}

function generarSQL(modelo: Modelo): { sql: string; omitidos: string[] } {
    const partes: string[] = [];
    const omitidos: string[] = [];
    const orden = ordenarTablas(modelo);

    partes.push('-- Script normalizado (3FN) generado por el Normalizador.');
    partes.push('-- Ejecutar en SQL Server (SSMS o Azure Data Studio).');

    for (const nombre of orden) {
        const tabla = modelo.tablas[nombre]!;
        const definiciones = tabla.columnas.map(c => `\t[${c.nombre}] ${c.tipoSQL} ${c.nullable ? 'NULL' : 'NOT NULL'}`);
        if (tabla.pk.length) {
            definiciones.push(`\tCONSTRAINT [PK_${tabla.nombre}] PRIMARY KEY CLUSTERED (${tabla.pk.map(p => `[${p}] ASC`).join(', ')})`);
        }
        partes.push(`CREATE TABLE [dbo].[${tabla.nombre}](\n${definiciones.join(',\n')}\n);\nGO`);
    }

    for (const nombre of orden) {
        const tabla = modelo.tablas[nombre]!;
        if (!tabla.filas.length) continue;
        const columnas = tabla.columnas.map(c => `[${c.nombre}]`).join(', ');
        for (const fila of tabla.filas) {
            const valores = fila.map((valor, i) => {
                const columna = tabla.columnas[i]!;
                if (valor === null || valor === undefined) return 'NULL';
                if (esNumerico(columna.tipo)) {
                    if (!/^-?\d+(\.\d+)?$/.test(valor.trim())) {
                        throw new Error(`Valor no numérico "${valor}" en ${tabla.nombre}.${columna.nombre}`);
                    }
                    return valor.trim();
                }
                return `N'${valor.replace(/'/g, "''")}'`;
            }).join(', ');
            partes.push(`INSERT [dbo].[${tabla.nombre}] (${columnas}) VALUES (${valores});`);
        }
        partes.push('GO');
    }

    for (const indice of modelo.indices) {
        const tabla = modelo.tablas[indice.tabla];
        const existen = !!tabla && indice.columnas.every(c => tabla.columnas.some(x => x.nombre === c));
        if (!existen) {
            omitidos.push(indice.nombre);
            continue;
        }
        partes.push(
            `CREATE ${indice.unica ? 'UNIQUE ' : ''}NONCLUSTERED INDEX [${indice.nombre}] ON [dbo].[${indice.tabla}] (${indice.columnas.map(c => `[${c}] ASC`).join(', ')});\nGO`
        );
    }

    for (const fk of modelo.fks) {
        const nombreFK = `FK_${fk.tablaHija}_${fk.tablaPadre}_${fk.columnaHija}`;
        partes.push(
            `ALTER TABLE [dbo].[${fk.tablaHija}]  WITH CHECK ADD  CONSTRAINT [${nombreFK}] FOREIGN KEY([${fk.columnaHija}])\n` +
            `REFERENCES [dbo].[${fk.tablaPadre}] ([${fk.columnaPadre}])\nON UPDATE CASCADE\nON DELETE CASCADE\nGO`
        );
        partes.push(`ALTER TABLE [dbo].[${fk.tablaHija}] CHECK CONSTRAINT [${nombreFK}]\nGO`);
    }
    return { sql: partes.join('\n') + '\n', omitidos };
}

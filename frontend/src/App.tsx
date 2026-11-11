import { useState } from 'react';

type Requisito = { id: string; nombre: string; estado: 'cumple' | 'revisar' | 'no cumple'; detalles: string[] };

type ColumnaVista = { nombre: string; tipo: string; pk: boolean; fk: boolean };

type TablaVista = {
    nombre: string;
    filas: number;
    columnas: ColumnaVista[];
    datos?: { columnas: string[]; filas: (string | null)[][] };
};

type CandidatoLista = { tabla: string; columna: string; ejemplo: string };

// Dependencia detectada en los datos que todavía hay que declarar o descartar
type Pendiente = { fase: '2FN' | '3FN'; tabla: string; determinante: string[]; dependientes: string[] };

type Paso = {
    id: string;
    titulo: string;
    estado: string;
    mensaje: string;
    detalles: string[];
    requisitos?: Requisito[];
    tablas?: TablaVista[];
    candidatos?: CandidatoLista[];
    pendientes?: Pendiente[];
    svg?: string;
};

type Resultado = {
    sinEstructura?: boolean;
    mensaje?: string;
    avisos: string[];
    pasos?: Paso[];
    formaNormal?: string;
    diagnostico?: string;
    puedeDescargar?: boolean;
    sqlFinal?: string | null;
};

// Lo que escribe el usuario en el formulario de dependencias (las listas se escriben como texto)
type FilaDependencia = { tabla: string; determinante: string; dependientes: string; nombreTabla: string };

// Dependencia parcial (2FN): la clave parcial se escribe separada por comas
type FilaParcial = { tabla: string; clave: string; dependientes: string; nombreTabla: string };

// Dependencia detectada que el usuario descartó
type Descarte = { fase: '2FN' | '3FN'; tabla: string; determinante: string[]; dependientes: string[] };

const API = 'http://localhost:3001/api';

const colorEstado: Record<string, string> = {
    'cumple': '#2e7d32',
    'transformado': '#1565c0',
    'revisar': '#ef6c00',
    'no cumple': '#d32f2f',
    'bloqueado': '#757575',
    'informativo': '#455a64',
};

const textoEstado: Record<string, string> = {
    'cumple': 'cumple',
    'transformado': 'transformado',
    'revisar': 'por revisar',
    'no cumple': 'no cumple',
    'bloqueado': 'bloqueado',
    'informativo': 'información',
};

const estiloCampo = { padding: 4, marginRight: 6, marginBottom: 6, width: 160 } as const;

function Badge({ estado }: { estado: string }) {
    return (
        <span style={{
            background: colorEstado[estado] ?? '#555', color: '#fff', borderRadius: 999,
            padding: '2px 10px', fontSize: 12, fontWeight: 600, marginLeft: 8,
        }}>
            {textoEstado[estado] ?? estado}
        </span>
    );
}

function App() {
    const [archivo, setArchivo] = useState<File | null>(null);
    const [resultado, setResultado] = useState<Resultado | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(false);
    const [confirmado, setConfirmado] = useState(false);
    const [dependencias, setDependencias] = useState<FilaDependencia[]>([]);
    const [parciales, setParciales] = useState<FilaParcial[]>([]);
    const [descartes, setDescartes] = useState<Descarte[]>([]);
    const [listas, setListas] = useState<Record<string, boolean>>({});

    const procesar = async (confirmarOverride?: boolean, descartesOverride?: Descarte[]) => {
        if (!archivo) return;
        const confirmar = confirmarOverride ?? confirmado;
        setCargando(true);
        setError(null);

        const separar = (texto: string) => texto.split(',').map(s => s.trim()).filter(Boolean);
        const decisiones = {
            prerrequisitosConfirmados: confirmar,
            listas: Object.entries(listas).map(([clave, separarLista]) => {
                const [tabla, ...resto] = clave.split('.');
                return { tabla: tabla ?? '', columna: resto.join('.'), separar: separarLista };
            }),
            dependenciasParciales: parciales
                .filter(p => p.tabla.trim() && p.clave.trim())
                .map(p => ({
                    tabla: p.tabla.trim(),
                    clave: separar(p.clave),
                    dependientes: separar(p.dependientes),
                    nombreTabla: p.nombreTabla.trim(),
                })),
            dependencias: dependencias
                .filter(d => d.tabla.trim() && d.determinante.trim())
                .map(d => ({
                    tabla: d.tabla.trim(),
                    determinante: d.determinante.trim(),
                    dependientes: separar(d.dependientes),
                    nombreTabla: d.nombreTabla.trim(),
                })),
            descartadas: descartesOverride ?? descartes,
        };

        const formData = new FormData();
        formData.append('scriptSql', archivo);
        formData.append('decisiones', JSON.stringify(decisiones));

        try {
            const respuesta = await fetch(`${API}/normalizar`, { method: 'POST', body: formData });
            const datos = await respuesta.json();
            if (!respuesta.ok || datos.error) {
                setError(datos.detalle ? `${datos.error}: ${datos.detalle}` : datos.error ?? 'Error desconocido');
                setResultado(null);
            } else {
                setResultado(datos as Resultado);
            }
        } catch (err) {
            console.error('Error al conectar con el backend', err);
            setError('No se pudo conectar con el backend. Revisa que esté corriendo en el puerto 3001.');
        } finally {
            setCargando(false);
        }
    };

    const elegirArchivo = (nuevo: File | null) => {
        setResultado(null);
        setError(null);
        setConfirmado(false);
        setListas({});
        setDependencias([]);
        setParciales([]);
        setDescartes([]);
        if (nuevo && !nuevo.name.toLowerCase().endsWith('.sql')) {
            setArchivo(null);
            setError('Solo se aceptan archivos .sql');
            return;
        }
        setArchivo(nuevo);
    };

    const descargar = () => {
        if (!resultado?.sqlFinal) return;
        // BOM UTF-8 para que SSMS y otros editores en Windows abran bien los acentos
        const blob = new Blob(['﻿', resultado.sqlFinal], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = 'normalizado_3FN.sql';
        document.body.appendChild(enlace);
        enlace.click();
        enlace.remove();
        URL.revokeObjectURL(url);
    };

    const cambiarDependencia = (indice: number, campo: keyof FilaDependencia, valor: string) => {
        setDependencias(prev => prev.map((d, i) => (i === indice ? { ...d, [campo]: valor } : d)));
    };

    const cambiarParcial = (indice: number, campo: keyof FilaParcial, valor: string) => {
        setParciales(prev => prev.map((p, i) => (i === indice ? { ...p, [campo]: valor } : p)));
    };

    // Pasa una dependencia detectada al formulario correspondiente para completarla
    const declarar = (pendiente: Pendiente) => {
        if (pendiente.fase === '2FN') {
            setParciales(prev => [...prev, {
                tabla: pendiente.tabla, clave: pendiente.determinante.join(', '),
                dependientes: pendiente.dependientes.join(', '), nombreTabla: '',
            }]);
        } else {
            setDependencias(prev => [...prev, {
                tabla: pendiente.tabla, determinante: pendiente.determinante[0] ?? '',
                dependientes: pendiente.dependientes.join(', '), nombreTabla: '',
            }]);
        }
    };

    // Descartar vuelve a procesar el archivo con esa dependencia marcada como descartada
    const descartar = (pendiente: Pendiente) => {
        const nuevos: Descarte[] = [...descartes, {
            fase: pendiente.fase, tabla: pendiente.tabla,
            determinante: pendiente.determinante, dependientes: pendiente.dependientes,
        }];
        setDescartes(nuevos);
        procesar(undefined, nuevos);
    };

    const pasoPrerrequisitos = resultado?.pasos?.find(p => p.id === 'prerrequisitos');
    const requiereConfirmacion = pasoPrerrequisitos?.estado === 'revisar';

    return (
        <div style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: 1000, margin: '0 auto' }}>
            <h1>Normalizador de Base de Datos</h1>
            <p>Sube un archivo .sql. El sistema valida los prerrequisitos y luego pasa por 1FN, 2FN y 3FN.</p>

            <div style={{ marginBottom: '1.5rem' }}>
                <input
                    type="file"
                    accept=".sql"
                    onChange={e => elegirArchivo(e.target.files?.[0] ?? null)}
                />
                <button onClick={() => procesar()} disabled={!archivo || cargando} style={{ marginLeft: 12 }}>
                    {cargando ? 'Analizando…' : 'Analizar archivo'}
                </button>
            </div>

            {error && (
                <div style={{ padding: '1rem', borderRadius: 8, border: '1px solid #d32f2f', color: '#d32f2f', marginBottom: '1rem' }}>
                    {error}
                </div>
            )}

            {resultado?.sinEstructura && (
                <div style={{ padding: '1rem', borderRadius: 8, border: '1px solid #ef6c00', marginBottom: '1rem' }}>
                    <strong>{resultado.mensaje}</strong>
                    {resultado.avisos.length > 0 && <ul>{resultado.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
                </div>
            )}

            {resultado && !resultado.sinEstructura && resultado.pasos && (
                <>
                    {resultado.avisos.length > 0 && (
                        <details style={{ marginBottom: '1rem' }}>
                            <summary>Avisos del archivo ({resultado.avisos.length})</summary>
                            <ul>{resultado.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
                        </details>
                    )}

                    {resultado.pasos.map(paso => (
                        <section key={paso.id} style={{ border: '1px solid #ccc', borderRadius: 8, padding: '1rem', marginBottom: '1rem', background: '#fafafa' }}>
                            <h3 style={{ marginTop: 0 }}>
                                {paso.titulo}
                                <Badge estado={paso.estado} />
                            </h3>
                            <p>{paso.mensaje}</p>

                            {paso.requisitos && (
                                <ul style={{ listStyle: 'none', padding: 0 }}>
                                    {paso.requisitos.map(requisito => (
                                        <li key={requisito.id} style={{ marginBottom: 8 }}>
                                            <strong>{requisito.nombre}</strong>
                                            <Badge estado={requisito.estado} />
                                            {requisito.detalles.length > 0 && (
                                                <ul>{requisito.detalles.map((d, i) => <li key={i}>{d}</li>)}</ul>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}

                            {paso.id === 'prerrequisitos' && requiereConfirmacion && (
                                <div style={{ marginTop: 8 }}>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={confirmado}
                                            disabled={cargando}
                                            onChange={e => {
                                                setConfirmado(e.target.checked);
                                                procesar(e.target.checked);
                                            }}
                                        />{' '}
                                        Revisé los puntos marcados y confirmo que se pueden continuar
                                    </label>
                                </div>
                            )}

                            {paso.detalles.length > 0 && paso.id !== 'prerrequisitos' && !(paso.pendientes && paso.pendientes.length > 0) && (
                                <ul>{paso.detalles.map((d, i) => <li key={i}>{d}</li>)}</ul>
                            )}

                            {paso.pendientes && paso.pendientes.length > 0 && (
                                <div style={{ marginTop: 8, padding: 8, background: '#fff7ed', borderRadius: 6 }}>
                                    <strong>Dependencias detectadas en los datos</strong>
                                    <div style={{ color: '#555', marginBottom: 6 }}>
                                        Con pocas filas, algunas pueden ser accidentales. Declara solo las que sean reales y descarta el resto.
                                    </div>
                                    {paso.pendientes.map((p, i) => (
                                        <div key={i} style={{ marginBottom: 4 }}>
                                            <code>{p.tabla}</code>: {p.determinante.join(', ')} → {p.dependientes.join(', ')}{' '}
                                            <button onClick={() => declarar(p)} disabled={cargando}>Declarar</button>{' '}
                                            <button onClick={() => descartar(p)} disabled={cargando}>Descartar</button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {paso.candidatos && paso.candidatos.length > 0 && (
                                <div style={{ marginTop: 8, padding: 8, background: '#fffbeb', borderRadius: 6 }}>
                                    <strong>Columnas con varios valores por fila</strong>
                                    <div style={{ color: '#555', marginBottom: 6 }}>
                                        Estos valores se separan en filas para que sean atómicos. Si una columna sí es un solo valor, márcala como "No es lista" y pulsa "Normalizar con estas decisiones".
                                    </div>
                                    {paso.candidatos.map(candidato => {
                                        const clave = `${candidato.tabla}.${candidato.columna}`;
                                        return (
                                            <div key={clave} style={{ marginBottom: 4 }}>
                                                <code>{clave}</code> (ej. "{candidato.ejemplo}"){' '}
                                                <label>
                                                    <input type="radio" name={clave} checked={listas[clave] !== false}
                                                        onChange={() => setListas(prev => ({ ...prev, [clave]: true }))} /> Separar en filas
                                                </label>{' '}
                                                <label>
                                                    <input type="radio" name={clave} checked={listas[clave] === false}
                                                        onChange={() => setListas(prev => ({ ...prev, [clave]: false }))} /> No es lista
                                                </label>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {paso.tablas && paso.tablas.length > 0 && paso.estado !== 'bloqueado' && paso.id !== 'prerrequisitos' && (
                                <>
                                    {paso.svg && (
                                        <div
                                            style={{ overflow: 'auto', background: '#f8fafc', borderRadius: 6, padding: 8, marginBottom: 8 }}
                                            dangerouslySetInnerHTML={{ __html: paso.svg }}
                                        />
                                    )}
                                    <div style={{ fontFamily: 'monospace', fontSize: 13 }}>
                                        {paso.tablas.map(tabla => (
                                            <div key={tabla.nombre} style={{ marginBottom: 8 }}>
                                                <div>
                                                    <strong>{tabla.nombre}</strong>: {tabla.columnas.map(c => `${c.nombre}${c.pk ? ' (PK)' : ''}${c.fk ? ' (FK)' : ''}`).join(', ')}
                                                </div>
                                                {tabla.datos && (
                                                    <details style={{ marginTop: 4 }}>
                                                        <summary style={{ cursor: 'pointer', color: '#334155' }}>
                                                            Ver datos ({tabla.filas} fila(s){tabla.filas > tabla.datos.filas.length ? `, mostrando ${tabla.datos.filas.length}` : ''})
                                                        </summary>
                                                        {tabla.filas === 0 ? (
                                                            <div style={{ color: '#64748b', marginTop: 4 }}>La tabla no tiene filas.</div>
                                                        ) : (
                                                            <div style={{ overflowX: 'auto', marginTop: 4 }}>
                                                                <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                                                                    <thead>
                                                                        <tr>
                                                                            {tabla.datos.columnas.map(c => (
                                                                                <th key={c} style={{ border: '1px solid #cbd5e1', padding: '3px 8px', background: '#e2e8f0', textAlign: 'left' }}>{c}</th>
                                                                            ))}
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {tabla.datos.filas.map((fila, i) => (
                                                                            <tr key={i}>
                                                                                {fila.map((valor, j) => (
                                                                                    <td key={j} style={{ border: '1px solid #cbd5e1', padding: '3px 8px' }}>{valor === null ? 'NULL' : valor}</td>
                                                                                ))}
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        )}
                                                    </details>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </section>
                    ))}

                    <section style={{ border: '1px solid #ccc', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
                        <h3 style={{ marginTop: 0 }}>Dependencias parciales (2FN)</h3>
                        <p style={{ marginTop: 0, color: '#555' }}>
                            Declara qué parte de la clave primaria determina otras columnas. Ejemplo: si la clave es
                            <code> Cod_Actividad, Fecha, Hora_I, Sala</code> y <code>Cod_Actividad</code> determina
                            <code> Nombre_Actividad</code>, esa columna pasa a su propia tabla. Si tu archivo no tiene dependencias de este tipo, deja esta sección vacía.
                        </p>
                        {parciales.map((p, i) => (
                            <div key={i} style={{ marginBottom: 4 }}>
                                <input style={estiloCampo} placeholder="Tabla" value={p.tabla} onChange={e => cambiarParcial(i, 'tabla', e.target.value)} />
                                <input style={estiloCampo} placeholder="Clave parcial (separada por coma)" value={p.clave} onChange={e => cambiarParcial(i, 'clave', e.target.value)} />
                                <input style={{ ...estiloCampo, width: 220 }} placeholder="Dependientes (separados por coma)" value={p.dependientes} onChange={e => cambiarParcial(i, 'dependientes', e.target.value)} />
                                <input style={estiloCampo} placeholder="Nueva tabla" value={p.nombreTabla} onChange={e => cambiarParcial(i, 'nombreTabla', e.target.value)} />
                                <button onClick={() => setParciales(prev => prev.filter((_, idx) => idx !== i))}>Quitar</button>
                            </div>
                        ))}
                        <button onClick={() => setParciales(prev => [...prev, { tabla: '', clave: '', dependientes: '', nombreTabla: '' }])}>
                            + Agregar dependencia parcial
                        </button>
                        <div style={{ marginTop: 12 }}>
                            <button onClick={() => { setConfirmado(true); procesar(true); }} disabled={!archivo || cargando}>
                                {cargando ? 'Procesando…' : 'Normalizar con estas decisiones'}
                            </button>
                        </div>
                    </section>

                    <section style={{ border: '1px solid #ccc', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
                        <h3 style={{ marginTop: 0 }}>Dependencias transitivas (3FN)</h3>
                        <p style={{ marginTop: 0, color: '#555' }}>
                            Declara qué atributos dependen de otro atributo que no es clave. Ejemplo: si
                            <code> Codigo_Producto</code> determina la <code>Categoria</code> y el
                            <code> Nombre_Categoria</code>, esos datos se repiten por cada producto. Si tu archivo no tiene dependencias de este tipo, deja esta sección vacía.
                        </p>
                        {dependencias.map((d, i) => (
                            <div key={i} style={{ marginBottom: 4 }}>
                                <input style={estiloCampo} placeholder="Tabla" value={d.tabla} onChange={e => cambiarDependencia(i, 'tabla', e.target.value)} />
                                <input style={estiloCampo} placeholder="Determinante" value={d.determinante} onChange={e => cambiarDependencia(i, 'determinante', e.target.value)} />
                                <input style={{ ...estiloCampo, width: 220 }} placeholder="Dependientes (separados por coma)" value={d.dependientes} onChange={e => cambiarDependencia(i, 'dependientes', e.target.value)} />
                                <input style={estiloCampo} placeholder="Nueva tabla" value={d.nombreTabla} onChange={e => cambiarDependencia(i, 'nombreTabla', e.target.value)} />
                                <button onClick={() => setDependencias(prev => prev.filter((_, idx) => idx !== i))}>Quitar</button>
                            </div>
                        ))}
                        <button onClick={() => setDependencias(prev => [...prev, { tabla: '', determinante: '', dependientes: '', nombreTabla: '' }])}>
                            + Agregar dependencia
                        </button>
                        <div style={{ marginTop: 12 }}>
                            <button onClick={() => { setConfirmado(true); procesar(true); }} disabled={!archivo || cargando}>
                                {cargando ? 'Procesando…' : 'Normalizar con estas decisiones'}
                            </button>
                        </div>
                    </section>

                    {resultado.formaNormal && (
                        <div style={{ padding: '1rem', borderRadius: 8, background: '#eef3f8', marginBottom: '1rem' }}>
                            <strong>Forma normal detectada: {resultado.formaNormal}</strong>
                            <p style={{ marginBottom: 0 }}>{resultado.diagnostico}</p>
                        </div>
                    )}

                    {resultado.puedeDescargar && resultado.sqlFinal && (
                        <div style={{ marginBottom: '2rem' }}>
                            <button onClick={descargar}>Descargar SQL normalizado (.sql)</button>
                            <details style={{ marginTop: 8 }}>
                                <summary>Ver SQL</summary>
                                <pre style={{ background: '#f3f3f3', padding: '1rem', overflow: 'auto', maxHeight: 400 }}>{resultado.sqlFinal}</pre>
                            </details>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default App;

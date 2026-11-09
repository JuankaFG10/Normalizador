-- Tabla de préstamos de libros (datos tomados de la tabla del ejemplo).
-- Id_Prestamo se agregó como clave primaria para poder probar la ampliación de clave.
-- Ejecutar en SQL Server (SSMS o Azure Data Studio)

CREATE TABLE Prestamo (
    Id_Prestamo INT NOT NULL,
    Colegio NVARCHAR(50) NOT NULL,
    Profesor NVARCHAR(50) NOT NULL,
    Asignatura NVARCHAR(100) NOT NULL,
    Aula NVARCHAR(10) NOT NULL,
    Curso NVARCHAR(5) NOT NULL,
    Libro NVARCHAR(100) NOT NULL,
    Editorial NVARCHAR(50) NOT NULL,
    Fecha_Prestamo DATE NOT NULL,
    PRIMARY KEY (Id_Prestamo)
);
GO

INSERT INTO Prestamo (Id_Prestamo, Colegio, Profesor, Asignatura, Aula, Curso, Libro, Editorial, Fecha_Prestamo) VALUES
(1, N'C.P. Cervantes', N'Juan Pérez', N'Pensamiento Lógico', N'1.A01', N'1º', N'Aprender y Enseñar en Educación Infantil', N'Graó', '2006-09-09'),
(2, N'C.P. Cervantes', N'Juan Pérez', N'Escritura', N'1.A01', N'1º', N'Preescolar Rubio, N6', N'Técnicas Rubio', '2005-05-05'),
(3, N'C.P. Cervantes', N'Juan Pérez', N'Pensamiento Numérico', N'1.A01', N'1º', N'Aprender y Enseñar en Educación Infantil', N'Graó', '2005-05-05'),
(4, N'C.P. Cervantes', N'Alicia García', N'Pensamiento Espacial, Temporal y Causal', N'1.B01', N'1º', N'Educación Infantil N9', N'Prentice Hall', '2005-05-06'),
(5, N'C.P. Cervantes', N'Alicia García', N'Pensamiento Numérico', N'1.B01', N'1º', N'Aprender y Enseñar en Educación Infantil', N'Graó', '2005-05-06'),
(6, N'C.P. Cervantes', N'Andrés Fernández', N'Escritura', N'1.A01', N'2º', N'Aprender y enseñar en Educación Infantil', N'Graó', '2006-09-09'),
(7, N'C.P. Cervantes', N'Andrés Fernández', N'Inglés', N'1.A01', N'2º', N'Saber Educar: Guía para Padres y Profesores', N'Temas de Hoy', '2005-05-05'),
(8, N'C.P. Quevedo', N'Juan Méndez', N'Pensamiento Lógico', N'2.B01', N'1º', N'Saber Educar: Guía para Padres y Profesores', N'Temas de Hoy', '2006-12-18'),
(9, N'C.P. Quevedo', N'Juan Méndez', N'Pensamiento Numérico', N'2.B01', N'1º', N'Aprender y Enseñar en Educación Infantil', N'Graó', '2005-05-06');
GO

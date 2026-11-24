@echo off
setlocal
title VizinhoHub - iniciar banco e API

set "RAIZ=%USERPROFILE%\Desktop\Unifor\projetos\VizinhoHub"
set "API=%RAIZ%\apps\api"

if not exist "%API%\package.json" (
  echo Nao encontrei o projeto em "%RAIZ%".
  echo Edite a linha RAIZ deste arquivo com o caminho correto.
  pause
  exit /b 1
)

echo [1/2] Banco de dados (porta 5432)...
netstat -ano | findstr /R /C:":5432 .*LISTENING" >nul
if %errorlevel%==0 (
  echo     Ja esta rodando.
) else (
  start "VizinhoHub - Banco" /D "%API%" cmd /k "npm run dev:db"
  echo     Aguardando o banco subir...
  timeout /t 10 /nobreak >nul
)

echo [2/2] API (porta 3333)...
netstat -ano | findstr /R /C:":3333 .*LISTENING" >nul
if %errorlevel%==0 (
  echo     Ja esta rodando.
) else (
  start "VizinhoHub - API" /D "%API%" cmd /k "npm run dev"
)

echo.
echo Pronto. Banco: localhost:5432  ^|  API: http://localhost:3333/api/docs
echo Para parar, feche as janelas "VizinhoHub - Banco" e "VizinhoHub - API".
echo Pode abrir o pgAdmin agora.
echo.
pause

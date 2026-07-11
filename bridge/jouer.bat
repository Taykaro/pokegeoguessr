@echo off
REM ============================================================
REM  PokeGeoGuessr - lanceur JOUEUR (relaie ta position au serveur)
REM  A lancer APRES avoir ouvert la ROM + bridge/hgss.lua dans BizHawk.
REM ============================================================
echo === PokeGeoGuessr : rejoindre une partie ===
echo.
set /p pseudo="Ton pseudo (le MEME que dans le navigateur) : "
set /p room="Nom de la room : "
set /p server="URL du serveur (https://...) : "
echo.
echo Connexion au serveur %server% en tant que "%pseudo%" (room %room%)...
node "%~dp0watch.js" --name "%pseudo%" --room "%room%" --server "%server%"
pause

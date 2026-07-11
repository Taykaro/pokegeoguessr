@echo off
REM ============================================================
REM  PokeGeoGuessr - lanceur HOTE (heberge la partie pour tes potes)
REM ============================================================
echo === PokeGeoGuessr : hote ===
echo.
echo 1) Demarrage du serveur (fenetre "serveur")...
start "PokeGeo serveur" cmd /k npm start
timeout /t 4 >nul
echo.
echo 2) Ouvre l'acces Internet dans une NOUVELLE fenetre, au choix :
echo.
echo      cloudflared tunnel --url http://localhost:3000
echo        (URL propre ; installe cloudflared.exe une fois)
echo.
echo      npx localtunnel --port 3000
echo        (zero installation ; Node suffit)
echo.
echo 3) L'URL publique affichee (https://...) = a donner a tes potes,
echo    avec un nom de room. Ils l'ouvrent dans leur navigateur ET
echo    lancent leur emulateur + bridge/jouer.bat.
echo.
echo Garde cette fenetre + celle du serveur + celle du tunnel ouvertes.
pause

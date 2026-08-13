@echo off
REM ============================================================
REM  PMAI WMS - push this project to GitHub
REM  Double-click this file, or run it from a terminal.
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo   PMAI Warehouse Management System - GitHub push
echo   ---------------------------------------------
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo   Git is not installed. Get it from https://git-scm.com/download/win
  echo   then run this file again.
  pause
  exit /b 1
)

echo   Step 1 of 3: create an EMPTY private repo named  pmai-wms
echo                at  https://github.com/new
echo                Do NOT add a README, .gitignore or licence.
echo.
pause

if not exist ".git" (
  git init
  git branch -M main
  git add .
  git -c user.email=itdevice@meatplus.ph -c user.name=itdevice2026 commit -m "PMAI Warehouse Management System"
)

git remote remove origin >nul 2>&1
git remote add origin https://github.com/itdevice2026/pmai-wms.git
git branch -M main

echo.
echo   Step 2 of 3: pushing...
echo.
echo   When asked for a PASSWORD, paste a Personal Access Token,
echo   NOT your GitHub account password. Create one here:
echo     https://github.com/settings/tokens
echo     "Tokens (classic)" - tick the  repo  scope.
echo.

git push -u origin main
if errorlevel 1 (
  echo.
  echo   Push failed. The usual cause is using an account password
  echo   instead of a Personal Access Token. See the link above.
  pause
  exit /b 1
)

echo.
echo   Step 3 of 3: in your new repo on GitHub -
echo     Settings - Secrets and variables - Actions - Variables:
echo         SUPABASE_URL       = https://cayhkmnjlvifogaiksvg.supabase.co
echo         SUPABASE_ANON_KEY  = sb_publishable_QRuciPYjzloVb-XchNe3VQ_xf1YwheR
echo     Settings - Pages - Source: GitHub Actions
echo.
echo   Your site will then build at:
echo     https://itdevice2026.github.io/pmai-wms/
echo.
pause

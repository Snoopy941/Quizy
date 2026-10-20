@echo off
rem Builds the Quizy installer: install deps, run tests, then scripts\build-installer.sh.
rem Output is shown here and saved to build.log.
cd /d "%~dp0"
set "BASH="
if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH if exist "%LocalAppData%\Programs\Git\bin\bash.exe" set "BASH=%LocalAppData%\Programs\Git\bin\bash.exe"
if not defined BASH (
  echo Git Bash not found. Install Git for Windows from https://git-scm.com and run this again.> build.log
  type build.log
  pause
  exit /b 1
)
"%BASH%" -c "{ echo '== npm install'; npm install --no-audit --no-fund && echo '== prisma generate' && npx prisma generate && echo '== tests' && npm test && echo '== installer' && bash scripts/build-installer.sh; } 2>&1 | tee build.log; echo \"BUILD_EXIT=${PIPESTATUS[0]}\" | tee -a build.log"
echo.
echo Done. You can close this window.
pause

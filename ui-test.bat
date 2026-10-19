@echo off
rem Runs Quizy's click-through UI tests (Playwright) against a throwaway dev server.
rem Output is shown here and saved to ui-test.log.
cd /d "%~dp0"
set "BASH="
if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH if exist "%LocalAppData%\Programs\Git\bin\bash.exe" set "BASH=%LocalAppData%\Programs\Git\bin\bash.exe"
if not defined BASH (
  echo Git Bash not found. Install Git for Windows from https://git-scm.com and run this again.> ui-test.log
  type ui-test.log
  pause
  exit /b 1
)
"%BASH%" -c "{ npm install --no-audit --no-fund && npx prisma generate && npx playwright install chromium && npm run test:ui; } 2>&1 | tee ui-test.log; echo \"UI_TEST_EXIT=${PIPESTATUS[0]}\" | tee -a ui-test.log"
echo.
echo Done. You can close this window.
pause

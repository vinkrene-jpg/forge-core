$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repo

$branch = (git branch --show-current).Trim()
if ($branch -ne "forge-mission-reliability") {
    throw "Verkeerde branch: $branch. Verwacht forge-mission-reliability."
}

$path = Join-Path $repo "lib/forge-runtime/src/learning-engine.test.ts"
$content = [System.IO.File]::ReadAllText($path)

$old = @'
      assert.ok(scheduled.mission.mission.input.reasonForSelection);
      assert.ok(
        scheduled.mission.mission.input.expectedNewEvidence.length > 0,
      );
      assert.match(
        scheduled.mission.mission.input.reasonForSelection,
        /open blockage|recent/i,
      );
'@

$new = @'
      const reasonForSelection =
        scheduled.mission.mission.input.reasonForSelection;
      const expectedNewEvidence =
        scheduled.mission.mission.input.expectedNewEvidence;
      assert.ok(typeof reasonForSelection === "string");
      assert.ok(Array.isArray(expectedNewEvidence));
      assert.ok(expectedNewEvidence.length > 0);
      assert.match(reasonForSelection, /open blockage|recent/i);
'@

if (-not $content.Contains($old)) {
    throw "Verwacht testblok niet gevonden; er is niets gewijzigd."
}

$content = $content.Replace($old, $new)
[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))

pnpm.cmd --filter @workspace/forge-runtime typecheck
if ($LASTEXITCODE -ne 0) {
    throw "Typecheck is mislukt; commit is niet gemaakt."
}

git add -- $path
git commit -m "fix(tests): narrow scheduled learning mission input"
if ($LASTEXITCODE -ne 0) {
    throw "Git-commit is mislukt."
}

git push origin forge-mission-reliability
if ($LASTEXITCODE -ne 0) {
    throw "Git-push is mislukt."
}

Write-Host "RESULTAAT: GESLAAGD" -ForegroundColor Green
Write-Host "De twee learning-engine typefouten zijn hersteld, typecheck is groen en de commit is gepusht." -ForegroundColor Green

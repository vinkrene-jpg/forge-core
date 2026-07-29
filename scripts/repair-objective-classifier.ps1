$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repo

$branch = (git branch --show-current).Trim()
if ($branch -ne "forge-mission-reliability") {
    throw "Verkeerde branch: $branch. Verwacht forge-mission-reliability."
}

$sourcePath = Join-Path $repo "lib/forge-runtime/src/autonomous-cycle.ts"
$source = [System.IO.File]::ReadAllText($sourcePath)

$old = @'
  const buildIndicators = [
    "bouw ",
    " maak ",
    "create ",
    "write ",
    "bestand",
    "file",
    "build",
    "compile",
    "wijzig",
    "modify",
    "implement code",
  ];
  const buildLikely = buildIndicators.some((token) => normalized.includes(token));

  if (buildLikely) {
'@

$new = @'
  const normalizedForIntent = ` ${normalized.replace(/\s+/g, " ").trim()} `;
  const explicitReadOnly = [
    /\bwijzig\s+geen\b/,
    /\bgeen\s+bestanden?\s+(?:wijzigen|aanpassen|schrijven|veranderen)\b/,
    /\bverander\s+geen\b/,
    /\bpas\s+geen\b/,
    /\bschrijf\s+geen\b/,
    /\bdo\s+not\s+(?:modify|change|write|create|edit|delete)\b/,
    /\bwithout\s+(?:modifying|changing|writing|creating|editing|deleting)\b/,
    /\bread[- ]only\b/,
    /\banalyseer\s+uitsluitend\b/,
    /\banalyze\s+only\b/,
    /\binspect\s+only\b/,
  ].some((pattern) => pattern.test(normalizedForIntent));

  const buildIndicators = [
    /\bbouw\b/,
    /\bmaak\b/,
    /\bvoeg\s+toe\b/,
    /\bimplementeer\b/,
    /\bwijzig\b/,
    /\bherstel\b/,
    /\bverwijder\b/,
    /\bcreate\b/,
    /\bbuild\b/,
    /\badd\b/,
    /\bimplement\b/,
    /\bmodify\b/,
    /\bfix\b/,
    /\bremove\b/,
    /\bwrite\b/,
    /\bcompile\b/,
  ];
  const buildLikely =
    !explicitReadOnly &&
    buildIndicators.some((pattern) => pattern.test(normalizedForIntent));

  if (buildLikely) {
'@

if (-not $source.Contains($old)) {
    throw "Verwacht classifierblok niet gevonden; er is niets gewijzigd."
}

$updated = $source.Replace($old, $new)
[System.IO.File]::WriteAllText($sourcePath, $updated, [System.Text.UTF8Encoding]::new($false))

pnpm.cmd --filter @workspace/forge-runtime exec node --import tsx --test src/autonomous-cycle-classification.test.ts
if ($LASTEXITCODE -ne 0) {
    throw "Classifier-tests zijn mislukt; commit is niet gemaakt."
}

pnpm.cmd --filter @workspace/forge-runtime typecheck
if ($LASTEXITCODE -ne 0) {
    throw "Typecheck is mislukt; commit is niet gemaakt."
}

git add -- $sourcePath lib/forge-runtime/src/autonomous-cycle-classification.test.ts
git commit -m "fix(runtime): respect read-only mission intent"
if ($LASTEXITCODE -ne 0) {
    throw "Git-commit is mislukt."
}

git push origin forge-mission-reliability
if ($LASTEXITCODE -ne 0) {
    throw "Git-push is mislukt."
}

Write-Host "RESULTAAT: GESLAAGD" -ForegroundColor Green
Write-Host "Read-only opdrachten blijven analyse, echte wijzigingen blijven build-or-mutate, tests en typecheck zijn groen en de commit is gepusht." -ForegroundColor Green

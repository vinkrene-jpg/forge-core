param(
    [string]$Image = "forge-verification:latest"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    docker version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Docker is unavailable." }

    docker build --file Dockerfile.verification --tag $Image .
    if ($LASTEXITCODE -ne 0) { throw "Verification image build failed." }

    docker image inspect $Image | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Built verification image is unavailable." }

    Write-Output "Built $Image"
} finally {
    Pop-Location
}
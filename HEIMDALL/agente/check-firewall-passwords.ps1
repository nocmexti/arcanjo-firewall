param(
    [string]$HostsFile = "$PSScriptRoot\firewalls-ddns.txt",
    [string]$DefaultUser = "admin",
    [int]$Port = 2222,
    [int]$ConnectTimeoutSeconds = 8,
    [string]$ResultsFile = "$PSScriptRoot\password-check-results.csv"
)

$ErrorActionPreference = "Stop"

function ConvertTo-PlainText {
    param([Security.SecureString]$SecureString)

    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
    try {
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        if ($bstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    }
}

function Convert-WindowsPathToWslPath {
    param([string]$Path)

    $resolved = (Resolve-Path -LiteralPath $Path).Path
    if ($resolved -notmatch "^(?<drive>[A-Za-z]):\\(?<rest>.*)$") {
        throw "Caminho Windows nao suportado para conversao WSL: $resolved"
    }

    $drive = $Matches.drive.ToLowerInvariant()
    $rest = $Matches.rest -replace "\\", "/"
    "/mnt/$drive/$rest"
}

function Read-FirewallTargets {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Arquivo de firewalls nao encontrado: $Path"
    }

    Get-Content -LiteralPath $Path |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and -not $_.StartsWith("#") } |
        ForEach-Object {
            if ($_ -match "^(?:(?<user>[^@\s:]+)@)?(?<host>[^@\s:]+)(?::(?<port>\d{1,5}))?$") {
                $targetPort = if ($Matches.port) { [int]$Matches.port } else { $Port }
                if ($targetPort -lt 1 -or $targetPort -gt 65535) {
                    Write-Warning "Linha ignorada por porta invalida: $_"
                    return
                }

                [pscustomobject]@{
                    User = if ($Matches.user) { $Matches.user } else { $DefaultUser }
                    Host = $Matches.host
                    Port = $targetPort
                }
            }
            else {
                Write-Warning "Linha ignorada por formato invalido: $_"
            }
        }
}

Write-Host "Fleet Guardian - checagem de senha padronizada pfSense" -ForegroundColor Cyan
Write-Host "Hosts: $HostsFile"
Write-Host "Porta SSH padrao: $Port"
Write-Host ""

& wsl.exe sh -lc "command -v ssh >/dev/null && command -v sshpass >/dev/null" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Dependencias ausentes no WSL." -ForegroundColor Yellow
    Write-Host "Instale com:"
    Write-Host "  wsl sudo apt update"
    Write-Host "  wsl sudo apt install -y openssh-client sshpass"
    exit 2
}

$targets = @(Read-FirewallTargets -Path $HostsFile)
if ($targets.Count -eq 0) {
    Write-Host "Nenhum firewall encontrado em $HostsFile." -ForegroundColor Yellow
    exit 1
}

$securePassword = Read-Host "Digite a senha padrao para testar" -AsSecureString
$plainPassword = ConvertTo-PlainText -SecureString $securePassword
if ([string]::IsNullOrEmpty($plainPassword)) {
    Write-Host "Senha vazia. Abortado." -ForegroundColor Yellow
    exit 1
}

$checkerScript = Convert-WindowsPathToWslPath -Path "$PSScriptRoot\check-firewall-passwords.sh"
$results = New-Object System.Collections.Generic.List[object]

foreach ($target in $targets) {
    $label = "$($target.User)@$($target.Host):$($target.Port)"
    Write-Host "Testando $label ... " -NoNewline

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & wsl.exe env "SSHPASS=$plainPassword" bash "$checkerScript" "$($target.Host)" "$($target.User)" "$($target.Port)" "$ConnectTimeoutSeconds" 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    $joinedOutput = ($output -join " ").Trim()

    $status = if ($exitCode -eq 0) {
        "OK"
    }
    elseif ($exitCode -eq 5 -or $joinedOutput -match "Permission denied") {
        "SENHA_INVALIDA"
    }
    elseif ($exitCode -eq 124 -or $joinedOutput -match "Connection timed out|Operation timed out") {
        "TIMEOUT"
    }
    elseif ($joinedOutput -match "Connection refused") {
        "PORTA_FECHADA"
    }
    elseif ($joinedOutput -match "Could not resolve hostname|Name or service not known|Temporary failure in name resolution") {
        "DNS_INVALIDO"
    }
    else {
        "ERRO_$exitCode"
    }

    $color = if ($status -eq "OK") { "Green" } elseif ($status -eq "SENHA_INVALIDA") { "Red" } else { "Yellow" }
    Write-Host $status -ForegroundColor $color

    if ($joinedOutput) {
        Write-Host "  $joinedOutput"
    }

    $results.Add([pscustomobject]@{
        Host = $target.Host
        User = $target.User
        Port = $target.Port
        Status = $status
        Detail = $joinedOutput
        CheckedAt = (Get-Date).ToString("s")
    })
}

$plainPassword = $null
[GC]::Collect()

$results | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $ResultsFile

Write-Host ""
Write-Host "Resumo:" -ForegroundColor Cyan
$results | Group-Object Status | Sort-Object Name | ForEach-Object {
    Write-Host ("  {0}: {1}" -f $_.Name, $_.Count)
}
Write-Host ""
Write-Host "Relatorio salvo em: $ResultsFile"

if (($results | Where-Object { $_.Status -ne "OK" }).Count -gt 0) {
    exit 1
}

exit 0

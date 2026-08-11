param(
    [string]$HostsFile = "$PSScriptRoot\firewalls-ddns.txt",
    [string]$DefaultUser = "admin",
    [string]$ApiUser = "admin",
    [int]$Port = 2222,
    [int]$ConnectTimeoutSeconds = 10,
    [string]$AllowedInterfaces = "wan,lo0",
    [string]$ResultsFile = "$PSScriptRoot\fleet-guardian-api-config-results.csv",
    [string]$CredentialsFile = "$PSScriptRoot\fleet-guardian-api-credentials.csv",
    [switch]$Apply,
    [switch]$Rotate
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

function Get-OutputValue {
    param(
        [string]$Text,
        [string]$Name
    )

    $match = [regex]::Match($Text, "(?m)^$([regex]::Escape($Name))=(.*)$")
    if ($match.Success) {
        return $match.Groups[1].Value.Trim()
    }
    return ""
}

function Redact-Secrets {
    param([string]$Text)

    $Text `
        -replace "(?m)^(credential_secret=).+$", '$1***' `
        -replace "(?m)^(credential_id=).+$", '$1***'
}

Write-Host "Fleet Guardian - configuracao de chave da API pfSense" -ForegroundColor Cyan
Write-Host "Hosts: $HostsFile"
Write-Host "Usuario API local: $ApiUser"
Write-Host "Interfaces permitidas: $AllowedInterfaces"
Write-Host "Modo: $(if ($Apply) { 'APLICAR' } else { 'DRY-RUN / validar apenas' })"
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

if (-not $Apply) {
    Write-Host "Rodando em modo seguro. Nenhuma chave sera criada." -ForegroundColor Yellow
    Write-Host "Quando a validacao estiver OK, rode novamente com -Apply."
    Write-Host ""
}

$securePassword = Read-Host "Digite a senha SSH/API dos firewalls" -AsSecureString
$plainPassword = ConvertTo-PlainText -SecureString $securePassword
if ([string]::IsNullOrEmpty($plainPassword)) {
    Write-Host "Senha vazia. Abortado." -ForegroundColor Yellow
    exit 1
}

$configScript = Convert-WindowsPathToWslPath -Path "$PSScriptRoot\configure-fleet-guardian-api.sh"
$applyFlag = if ($Apply) { "1" } else { "0" }
$rotateFlag = if ($Rotate) { "1" } else { "0" }
$results = New-Object System.Collections.Generic.List[object]
$credentials = New-Object System.Collections.Generic.List[object]

foreach ($target in $targets) {
    $label = "$($target.User)@$($target.Host):$($target.Port)"
    Write-Host "Configurando $label ... " -NoNewline

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = $plainPassword | & wsl.exe bash "$configScript" "$($target.Host)" "$($target.User)" "$($target.Port)" "$ConnectTimeoutSeconds" "$ApiUser" "$applyFlag" "$rotateFlag" "$AllowedInterfaces" 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    $joinedOutput = ($output -join "`n").Trim()
    $redactedOutput = Redact-Secrets -Text $joinedOutput

    $status = if ($exitCode -eq 0) {
        "OK"
    }
    elseif ($joinedOutput -match "Permission denied") {
        "SENHA_INVALIDA"
    }
    elseif ($exitCode -eq 124 -or $joinedOutput -match "Connection timed out|Operation timed out") {
        "TIMEOUT"
    }
    elseif ($exitCode -eq 14 -or $joinedOutput -match "webgui=nao_encontrado_localmente") {
        "WEBGUI_LOCAL_INDISPONIVEL"
    }
    elseif ($joinedOutput -match "Connection refused") {
        "PORTA_FECHADA"
    }
    elseif ($joinedOutput -match "api_auth=falhou|HTTP_CODE=401|HTTP_CODE=403") {
        "API_AUTH_FALHOU"
    }
    elseif ($joinedOutput -match "key_validation=falhou|token_validation=falhou") {
        "VALIDACAO_CREDENCIAL_FALHOU"
    }
    elseif ($joinedOutput -match "key_status=ja_existe") {
        "CHAVE_JA_EXISTE"
    }
    else {
        "ERRO_$exitCode"
    }

    $color = if ($status -eq "OK") { "Green" } else { "Red" }
    Write-Host $status -ForegroundColor $color

    if ($redactedOutput) {
        Write-Host ($redactedOutput -replace "`n", "  ")
    }

    $family = Get-OutputValue -Text $joinedOutput -Name "family"
    $version = Get-OutputValue -Text $joinedOutput -Name "version"
    $authType = Get-OutputValue -Text $joinedOutput -Name "auth_type"
    $credentialId = Get-OutputValue -Text $joinedOutput -Name "credential_id"
    $credentialSecret = Get-OutputValue -Text $joinedOutput -Name "credential_secret"

    $results.Add([pscustomobject]@{
        Host = $target.Host
        User = $target.User
        Port = $target.Port
        Status = $status
        Family = $family
        Version = $version
        AuthType = $authType
        Detail = $redactedOutput
        Mode = if ($Apply) { "apply" } else { "dry-run" }
        CheckedAt = (Get-Date).ToString("s")
    })

    if ($Apply -and $status -eq "OK" -and $credentialSecret) {
        $credentials.Add([pscustomobject]@{
            Host = $target.Host
            Port = $target.Port
            ApiUrl = "https://$($target.Host)"
            Family = $family
            Version = $version
            AuthType = $authType
            CredentialId = $credentialId
            CredentialSecret = $credentialSecret
            CreatedAt = (Get-Date).ToString("s")
        })
    }
}

$plainPassword = $null
[GC]::Collect()

$results | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $ResultsFile
if ($credentials.Count -gt 0) {
    $credentials | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $CredentialsFile
}

Write-Host ""
Write-Host "Resumo:" -ForegroundColor Cyan
$results | Group-Object Status | Sort-Object Name | ForEach-Object {
    Write-Host ("  {0}: {1}" -f $_.Name, $_.Count)
}
Write-Host ""
Write-Host "Relatorio salvo em: $ResultsFile"
if ($credentials.Count -gt 0) {
    Write-Host "Credenciais salvas em: $CredentialsFile" -ForegroundColor Yellow
    Write-Host "Guarde esse arquivo como segredo. Ele contem tokens de API."
}

if (($results | Where-Object { $_.Status -ne "OK" }).Count -gt 0) {
    exit 1
}

exit 0

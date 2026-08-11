param(
    [string]$HostsFile = "$PSScriptRoot\firewalls-ddns.txt",
    [string]$User = "admin",
    [int]$Port = 2222,
    [int]$ConnectTimeoutSeconds = 12,
    [string]$AgentCredentialsFile = "$PSScriptRoot\fleet-guardian-agent-credentials.csv",
    [switch]$Install
)

$ErrorActionPreference = "Stop"

function Convert-WindowsPathToWslPath([string]$Path) {
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    if ($resolved -notmatch "^(?<drive>[A-Za-z]):\\(?<rest>.*)$") {
        throw "Caminho Windows nao suportado para conversao WSL: $resolved"
    }

    $drive = $Matches.drive.ToLowerInvariant()
    $rest = $Matches.rest -replace "\\", "/"
    return "/mnt/$drive/$rest"
}

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

function Read-FirewallTargets {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Arquivo de firewalls nao encontrado: $Path"
    }

    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }

        $targetUser = $User
        $targetHost = $line
        $targetPort = $Port

        if ($targetHost -like "*@*") {
            $parts = $targetHost.Split("@", 2)
            $targetUser = $parts[0]
            $targetHost = $parts[1]
        }

        if ($targetHost -match "^(?<host>.+):(?<port>\d+)$") {
            $targetHost = $Matches.host
            $targetPort = [int]$Matches.port
        }

        [pscustomobject]@{
            User = $targetUser
            Host = $targetHost
            Port = $targetPort
        }
    }
}

Write-Host "Fleet Guardian - instalacao do agente pfSense" -ForegroundColor Cyan
Write-Host "Hosts: $HostsFile"
Write-Host "Porta SSH padrao: $Port"
if (-not $Install) {
    Write-Host ""
    Write-Host "Rodando em modo seguro. Nada sera instalado." -ForegroundColor Yellow
    Write-Host "Use -Install para aplicar nos firewalls."
}

$targets = @(Read-FirewallTargets -Path $HostsFile)
if ($targets.Count -eq 0) {
    Write-Host "Nenhum firewall encontrado em $HostsFile." -ForegroundColor Yellow
    exit 1
}

$password = Read-Host "Digite a senha SSH dos firewalls" -AsSecureString
$plainPassword = ConvertTo-PlainText -SecureString $password
if ([string]::IsNullOrEmpty($plainPassword)) {
    Write-Host "Senha vazia. Abortado." -ForegroundColor Yellow
    exit 1
}

$scriptWsl = Convert-WindowsPathToWslPath "$PSScriptRoot\install-fleet-guardian-agent-one.sh"
$agentWsl = Convert-WindowsPathToWslPath "$PSScriptRoot\fleet-guardian-agent.php"
$installFlag = if ($Install) { "1" } else { "0" }
$credentialRows = New-Object System.Collections.Generic.List[object]

foreach ($target in $targets) {
    $label = "$($target.User)@$($target.Host):$($target.Port)"
    Write-Host "Processando $label ... " -NoNewline

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & wsl.exe env "SSHPASS=$plainPassword" bash "$scriptWsl" "$($target.Host)" "$($target.User)" "$($target.Port)" "$agentWsl" "$installFlag" "$ConnectTimeoutSeconds" 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    $joinedOutput = ($output -join " ").Trim()
    $agentSecret = $null
    if ($joinedOutput -match "agent_secret=(?<secret>[a-fA-F0-9]+)") {
        $agentSecret = $Matches.secret
        $joinedOutput = ($joinedOutput -replace "agent_secret=[a-fA-F0-9]+", "agent_secret=***").Trim()
    }
    if ($exitCode -eq 0) {
        Write-Host "OK $joinedOutput" -ForegroundColor Green
        if ($Install -and $agentSecret) {
            $credentialRows.Add([pscustomobject]@{
                Host = $target.Host
                SshPort = $target.Port
                AgentBaseUrl = "https://$($target.Host)"
                AgentSecret = $agentSecret
                InstalledAt = (Get-Date).ToString("s")
            }) | Out-Null
        }
    }
    else {
        Write-Host "ERRO_$exitCode $joinedOutput" -ForegroundColor Red
    }
}

$plainPassword = $null

if ($Install -and $credentialRows.Count -gt 0) {
    $existing = @()
    if (Test-Path -LiteralPath $AgentCredentialsFile) {
        $existing = @(Import-Csv -LiteralPath $AgentCredentialsFile)
    }
    $byHost = @{}
    foreach ($row in $existing) { $byHost[$row.Host] = $row }
    foreach ($row in $credentialRows) { $byHost[$row.Host] = $row }
    $byHost.Values | Sort-Object Host | Export-Csv -LiteralPath $AgentCredentialsFile -NoTypeInformation -Encoding UTF8
    Write-Host "Credenciais do agente salvas em: $AgentCredentialsFile" -ForegroundColor Cyan
    Write-Host "Guarde esse arquivo como segredo. Ele contem tokens do agente." -ForegroundColor Yellow
}

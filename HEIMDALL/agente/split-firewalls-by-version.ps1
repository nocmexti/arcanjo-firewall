param(
    [string]$InstallResultsFile = "$PSScriptRoot\pfsense-restapi-install-results.csv",
    [string]$SourceHostsFile = "$PSScriptRoot\firewalls-ddns.txt",
    [string]$OutputDirectory = "$PSScriptRoot\firewall-groups"
)

$ErrorActionPreference = "Stop"

function Get-DetailValue {
    param(
        [string]$Text,
        [string]$Name
    )

    $match = [regex]::Match($Text, "(?:^|\s|\|)\s*$([regex]::Escape($Name))=([^|\s]+)")
    if ($match.Success) {
        return $match.Groups[1].Value.Trim()
    }

    return ""
}

function Get-GroupName {
    param(
        [string]$Version,
        [string]$Family
    )

    if ($Family -eq "restapi_v2") {
        if ($Version -like "2.8.1*") { return "restapi-v2-2.8.1" }
        if ($Version -like "2.8.0*") { return "restapi-v2-2.8.0" }
        if ($Version -like "2.7.2*") { return "restapi-v2-2.7.2" }
        return "restapi-v2-outras"
    }

    if ($Family -eq "api_v1") {
        if ($Version -like "2.7.0*" -or $Version -like "2.7.1*") { return "api-v1-2.7.0-2.7.1" }
        if ($Version -like "2.6.*") { return "api-v1-2.6" }
        if ($Version -like "2.5.*") { return "api-v1-2.5" }
        return "api-v1-outras"
    }

    return "sem-familia"
}

function Read-SourceHostMap {
    param([string]$Path)

    $map = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $map
    }

    Get-Content -LiteralPath $Path |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and -not $_.StartsWith("#") } |
        ForEach-Object {
            if ($_ -match "^(?:(?<user>[^@\s:]+)@)?(?<host>[^@\s:]+)(?::(?<port>\d{1,5}))?$") {
                $map[$Matches.host] = $_
            }
        }

    return $map
}

if (-not (Test-Path -LiteralPath $InstallResultsFile)) {
    throw "Arquivo de resultados nao encontrado: $InstallResultsFile"
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$sourceHostMap = Read-SourceHostMap -Path $SourceHostsFile
$rows = Import-Csv -LiteralPath $InstallResultsFile

$groups = @{}
$problems = New-Object System.Collections.Generic.List[string]

foreach ($row in $rows) {
    $hostLine = if ($sourceHostMap.ContainsKey($row.Host)) {
        $sourceHostMap[$row.Host]
    }
    elseif ($row.Port -and $row.Port -ne "2222") {
        "$($row.User)@$($row.Host):$($row.Port)"
    }
    elseif ($row.User -and $row.User -ne "admin") {
        "$($row.User)@$($row.Host)"
    }
    else {
        $row.Host
    }

    if ($row.Status -ne "OK") {
        $problems.Add($hostLine)
        continue
    }

    $version = Get-DetailValue -Text $row.Detail -Name "versao"
    $family = Get-DetailValue -Text $row.Detail -Name "familia"
    $groupName = Get-GroupName -Version $version -Family $family

    if (-not $groups.ContainsKey($groupName)) {
        $groups[$groupName] = New-Object System.Collections.Generic.List[string]
    }

    $groups[$groupName].Add($hostLine)
}

foreach ($groupName in $groups.Keys | Sort-Object) {
    $path = Join-Path $OutputDirectory "firewalls-$groupName.txt"
    @(
        "# Grupo: $groupName"
        "# Gerado a partir de: $InstallResultsFile"
        "# Use com: .\configure-fleet-guardian-api.bat -HostsFile `"$path`""
        ""
        $groups[$groupName] | Sort-Object
    ) | Set-Content -LiteralPath $path -Encoding UTF8
}

if ($problems.Count -gt 0) {
    $path = Join-Path $OutputDirectory "firewalls-com-problema.txt"
    @(
        "# Firewalls com status diferente de OK no resultado de instalacao"
        ""
        $problems | Sort-Object
    ) | Set-Content -LiteralPath $path -Encoding UTF8
}

Write-Host "Arquivos gerados em: $OutputDirectory" -ForegroundColor Cyan
foreach ($groupName in $groups.Keys | Sort-Object) {
    Write-Host ("  firewalls-{0}.txt: {1}" -f $groupName, $groups[$groupName].Count)
}
if ($problems.Count -gt 0) {
    Write-Host ("  firewalls-com-problema.txt: {0}" -f $problems.Count) -ForegroundColor Yellow
}
